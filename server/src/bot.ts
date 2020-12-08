import WebSocket from 'ws';

import { createParser } from './parser';

// Message definitions

type HelpMessage = {
  kind: "help";
};

type AddReminderMessage = {
  kind: "add-reminder";
  text: string;
  seconds: number;
};

type AddReminderNoTimeMessage = {
  kind: "add-reminder-no-time";
  text: string;
};

type ListRemindersMessage = {
  kind: "list-reminders";
};

type ClearAllRemindersMessage = {
  kind: "clear-all-reminders";
};

type ClearReminderMessage = {
  kind: "clear-reminder";
  id: number;
};

type Time = {
  kind: "time";
  seconds: number;
};

type UnknownMessage = {
  kind: "unknown";
};

type Message = HelpMessage
             | AddReminderMessage
             | AddReminderNoTimeMessage
             | ListRemindersMessage
             | ClearAllRemindersMessage
             | ClearReminderMessage
             | Time
             | UnknownMessage;

// Parsing

const parseTimeWithUnitAsSeconds = function(quantity: string, unit: string) {
  let seconds = quantity.startsWith("a") ? 1 : Number(quantity);

  if (unit.toLowerCase().startsWith("minute")) {
    seconds *= 60;
  } else if (unit.toLowerCase().startsWith("hour")) {
    seconds *= 3600;
  }

  return seconds;
};

const parseMessage = createParser<Message>({
  intents: [
    {
      regexps: [
        /^help\.?$/i,
      ],
      func: () => ({ kind: 'help' }),
    },
    {
      regexps: [
        /^(?:remind|tell) me (?:about|of) (?:the|my) (?<text>.*) in (?<quantity>\d+|a|an) (?<unit>(?:second|minute|hour)s?)\.?$/i,
        /^in (?<quantity>\d+|a|an) (?<unit>(?:second|minute|hour)s?),? (?:remind|tell) me (?:about|of) (?:the|my) (?<text>.*)\.?$/i,
      ],
      func: ({quantity, text, unit }) => {
        return { kind: "add-reminder", text: text, seconds: parseTimeWithUnitAsSeconds(quantity, unit)};
      },
    },
    {
      regexps: [
        /^(?:remind|tell) me (?:about|of) (?:the|my) (?<text>.*)?$/i,
      ],
      func: ({text}) => ({ kind: 'add-reminder-no-time', text })
    },
    {
      regexps: [
        /^(?:list|show|tell) (?:(?:me|all|of|my) )*reminders\.?$/i,
      ],
      func: () => ({ kind: "list-reminders" }),
    },
    {
      regexps: [
        /^(?:clear|delete|remove|forget) (?:(?:all|of|my) )*reminders\.?$/i,
      ],
      func: () => ({ kind: "clear-all-reminders" }),
    },
    {
      regexps: [
        /^(?:clear|delete|remove|forget) (?:reminder )?(?<id>\d+)\.?$/i,
      ],
      func: ({ id }) => ({ kind: "clear-reminder", id: Number(id) }),
    },
    {
      regexps: [
        /^(?:(?:it takes) )*(?<quantity>\d+|a|an) (?<unit>(?:second|minute|hour)s?)\.?$/i,
      ],
      func: ({quantity, unit }) => {
        return { kind: "time", seconds: parseTimeWithUnitAsSeconds(quantity, unit)};
      },
    },
  ],
  fallback: { kind: "unknown" },
});

// Domain logic

const helpMessage = `I am a reminder bot, here to help you get organized. Here are some of the things you can ask me to do:

<ul>
  <li>Add reminders, e.g. <tt>remind me to make dinner in 5 minutes</tt>.</li>
  <li>List reminders, e.g. <tt>show all reminders</tt>.
  <li>Clear reminders, e.g. <tt>clear all reminders</tt> or <tt>clear reminder 3</tt>.
</ul>

At the moment I am not very sophisticated, but maybe you can help make me better!`;

type Reminder = {
  id: number;
  date: Date;
  text: string;
  timeout: NodeJS.Timeout;
};

type ReminderInfo = {
  id: number;
  date: Date | undefined;
  text: string | undefined;
}


type State = {
  ws: WebSocket;
  reminders: Reminder[];
  nextId: number;
  currentReminder : ReminderInfo;
  storage: Map<string, number>;
};


function executeMessage(state: State, message: Message) {
  switch (message.kind) {
    case "help": {
      return helpMessage;
    }

    case "add-reminder": {
      const seconds = message.seconds;
      const text = message.text
        .replace(/\bmy\b/g, 'your')
        .replace(/\bme\b/g, 'you');

      const id = state.nextId++;

      const date = new Date();
      date.setSeconds(date.getSeconds() + seconds);

      const timeout = setTimeout(() => {
        state.ws.send(`It is time for your ${text}!`);
        state.reminders = state.reminders.filter((r) => r.id !== id);
      }, seconds * 1000);

      state.reminders.push({ id, date, text, timeout });
      state.storage.set(text, seconds);

      const unit = seconds === 1 ? 'second' : 'seconds';
      return `Ok, I will remind you about ${text} in ${seconds} ${unit}.`;
    };

    case "add-reminder-no-time": {
      const text = message.text
        .replace(/\bmy\b/g, 'your')
        .replace(/\bme\b/g, 'you');

        const id = state.nextId++;
        state.currentReminder.id = id;
        state.currentReminder.text = text;

        if (state.storage.has(text)) {
          const seconds = state.storage.get(text);
          return `Ok, I will remind you about your ${text} in ${seconds} seconds.`;
        }

        return `How long does your ${text} take\?`;
    };

    case "time": {
      const seconds = message.seconds;

      const id = state.currentReminder.id;

      const date = new Date();
      date.setSeconds(date.getSeconds() + seconds);
      state.currentReminder.date = date;

      const text = state.currentReminder.text;

      const timeout = setTimeout(() => {
        state.ws.send(`It is time for your ${text}!`);
        state.reminders = state.reminders.filter((r) => r.id !== id);
      }, seconds * 1000);

      if (text) {
        state.reminders.push({ id, date, text, timeout });
        state.storage.set(text, seconds);
      }

      const unit = seconds === 1 ? 'second' : 'seconds';
      return `Ok, I will remind you about your ${text} in ${seconds} ${unit}.`;
    };

    case "list-reminders": {
    if (state.reminders.length === 0) {
      return "You have no reminders.";
    }

    const now = new Date().getTime();

    return `
      <table border="1">
        <thead>
          <tr>
            <th>id</th>
            <th>seconds remaining</th>
            <th>text</th>
          </tr>
        </thead>
        <tbody>
          ${state.reminders
            .map(({ id, date, text }) => `
              <tr>
                <td>${id}</td>
                <td>${Math.round((date.getTime() - now) / 1000)}</td>
                <td>${text}</td>
              </tr>`)
            .join("")}
        </tbody>
      </table>`;
  }

  case "clear-all-reminders": {
    clearAllReminders(state);
    return "Ok, I have cleared all of your reminders.";
  }

  case "clear-reminder": {
    const reminder = state.reminders.find((r) => r.id === message.id);

    if (!reminder) {
      return `There is no reminder with id ${message.id}.`;
    }

    clearTimeout(reminder.timeout);
    state.reminders = state.reminders.filter((r) => r !== reminder);

    return `Ok, I will not remind you to ${reminder.text}.`;
  }

  case "unknown":
    return "I'm sorry, I don't understand what you mean.";
  }
}

function clearAllReminders(state: State) {
  for (const { timeout } of state.reminders) {
    clearTimeout(timeout);
  }

  state.reminders = [];
}

// Websocket wrapper

export default (ws: WebSocket) => {
  const state: State = { nextId: 1, reminders: [], ws, currentReminder: <ReminderInfo> {}, storage: new Map()};

  ws.on('message', (rawMessage) => {
    const message = parseMessage(rawMessage.toString());
    const reply = executeMessage(state, message);
    ws.send(reply);
  });

  ws.on('close', () => {
    clearAllReminders(state);
  });

  ws.send('Greetings, friend! Type <tt>help</tt> to get started.');
};
