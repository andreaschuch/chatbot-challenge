import WebSocket from 'ws';

import { createParser } from './parser';

// Message definitions

enum TimeUnits {
  none = "none",
  seconds = "second",
  minutes = "minute",
  hours = "hour"
}

type HelpMessage = {
  kind: "help";
};

type AddReminderMessage = {
  kind: "add-reminder";
  text: string;
  quantity: number;
  unit: TimeUnits ;
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
  quantity: number;
  unit: TimeUnits ;
};

type Confirm = {
  kind: "confirm";
  confirm: Boolean;
}

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
             | Confirm
             | UnknownMessage;

// Parsing

const parseQuantity = function (quantity: string)
{
  return quantity.startsWith("a") ? 1 : Number(quantity);
}

const parseUnit = function (unit:string) {
  if (unit.toLowerCase().startsWith("sec")) {
    return TimeUnits.seconds
  } else if (unit.toLowerCase().startsWith("min")) {
    return TimeUnits.minutes
  } else if (unit.toLowerCase().startsWith("hour")) {
    return TimeUnits.hours
  }
  return TimeUnits.none
}

const convertDurationToSeconds = function(quantity: number, unit: TimeUnits) {
  let seconds = quantity
  switch (unit)
  {
    case TimeUnits.minutes: seconds *= 60;
    case TimeUnits.hours: seconds *= 3600;
  }
  return seconds;
}

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
        /^(?:remind|tell) me (?:about|of) (?:(?:the|my) )*(?<text>.*) in (?<quantity>\d+|a|an) (?<unit>(?:second|minute|hour)s?)\.?$/i,
        /^in (?<quantity>\d+|a|an) (?<unit>(?:second|minute|hour)s?),? (?:remind|tell) me (?:about|of) (?:(?:the|my) ) (?<text>.*)\.?$/i,
      ],
      func: ({quantity, text, unit }) => {
        return { kind: "add-reminder", text: text, quantity : parseQuantity(quantity), unit: parseUnit(unit)};
      },
    },
    {
      regexps: [
        /^(?:remind|tell) me (?:about|of) (?:(?:the|my) )*(?<text>.*)?$/i,
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
        return { kind: "time", quantity : parseQuantity(quantity), unit: parseUnit(unit)};
      },
    },
    {
      regexps: [
        /^(?:yes|sure|yeah|ok|okay)\.?$/i,
      ],
      func: () => {
        return ({ kind: "confirm", confirm: true});
      },
    },
    {
      regexps: [
        /^(?:no|nope|nevermind)\.?$/i,
      ],
      func: () => {
      return ({ kind: "confirm", confirm: false});
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
  quantity: number | undefined;
  unit: TimeUnits | undefined;
  text: string | undefined;
}


type State = {
  ws: WebSocket;
  reminders: Reminder[];
  nextId: number;
  dialogHistory : ReminderInfo[];
  userModel: Map<string, number>;
};


function executeMessage(state: State, message: Message) {
  switch (message.kind) {
    case "help": {
      return helpMessage;
    }

    case "add-reminder": {
      const quantity = message.quantity;
      const timeUnit = message.unit;
      const text = message.text
        .replace(/\bmy\b/g, 'your')
        .replace(/\bme\b/g, 'you');

      const id = state.nextId++;
      state.dialogHistory.push(<ReminderInfo>({id:id, quantity:quantity, unit:timeUnit, text:text}));

      const date = new Date();
      const seconds = convertDurationToSeconds(quantity, timeUnit);
      date.setSeconds(date.getSeconds() + seconds);

      const timeout = setTimeout(() => {
        state.ws.send(`It is time for your ${text}!`);
        if (!state.userModel.has(text)) {
          state.ws.send(`Should I remember that ${text} takes ${seconds} seconds?`);
        }
        state.reminders = state.reminders.filter((r) => r.id !== id);
      }, seconds * 1000);

      state.reminders.push({ id, date, text, timeout });

      const unit = seconds === 1 ? 'second' : 'seconds';
      return `Ok, I will remind you about ${text} in ${seconds} ${unit}.`;
    }

    case "add-reminder-no-time": {
      const text = message.text
        .replace(/\bmy\b/g, 'your')
        .replace(/\bme\b/g, 'you');

      const id = state.nextId++;

      state.dialogHistory.push(<ReminderInfo>({id:id, text:text}));

      var seconds = undefined;
      if (state.userModel.has(text)) {
        seconds = state.userModel.get(text);
      }
      if (!seconds) {
        return `How long does your ${text} take\?`;
      } else {
          const date = new Date();
          date.setSeconds(date.getSeconds() + seconds);

          const timeout = setTimeout(() => {
            state.ws.send(`It is time for your ${text}!`);
            state.reminders = state.reminders.filter((r) => r.id !== id);
          }, seconds * 1000);
          state.reminders.push({ id, date, text, timeout });

          const unit = seconds === 1 ? 'second' : 'seconds';
          return `Ok, I will remind you about ${text} in ${seconds} ${unit}.`;
      }
    }

    case "time": {
      const quantity = message.quantity;
      const timeUnit = message.unit;

      if (state.dialogHistory.length === 0){
        return "I'm sorry, I don't understand what you mean.";
      } else {
          var currentReminder = state.dialogHistory[state.dialogHistory.length-1]
          currentReminder.quantity = quantity;
          currentReminder.unit = timeUnit;

          const seconds = convertDurationToSeconds(quantity, timeUnit)
          const id = currentReminder.id;
          const date = new Date();
          date.setSeconds(date.getSeconds() + seconds);

          const text = currentReminder.text;

          const timeout = setTimeout(() => {
            state.ws.send(`It is time for your ${text}!`);
            if (text) {
              if (!state.userModel.has(text)) {
                state.ws.send(`Should I remember that ${text} takes ${seconds} seconds?`);
              }
            }
            state.reminders = state.reminders.filter((r) => r.id !== id);
          }, seconds * 1000);

          if (text) {
            state.reminders.push({ id, date, text, timeout });
          }

          const unit = seconds === 1 ? 'second' : 'seconds';
          return `Ok, I will remind you about your ${text} in ${seconds} ${unit}.`;
        }
    }

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

  case "confirm": {
    if (state.dialogHistory.length === 0){
      return "I'm sorry, I don't understand what you mean.";
    } else {
        var currentReminder = state.dialogHistory[state.dialogHistory.length-1]
        const confirm = message.confirm;
        const text = currentReminder.text;
        const quantity = currentReminder.quantity;
        const unit = currentReminder.unit;
        if (text && unit && quantity)
        {
          if (confirm){
            const seconds = convertDurationToSeconds(quantity, unit)
              state.userModel.set(text, seconds);
            return "Consider it done.";
            }
          else {
            return "Alright, I won't.";
          }
        }
      }
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
  const state: State = { nextId: 1, reminders: [], ws, dialogHistory: [], userModel: new Map()};

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
