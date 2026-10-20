/**
 * The task board's dates, always in words.
 *
 * A member reads "Friday 16 October", never 2026-10-16. Every date here is a
 * civil YYYY-MM-DD the server already placed in the village's zone (`today`
 * on the board payload, `dueOn` and `saidOn` on each card), so the words come
 * straight from `taskDateWords` in the contract and the browser's own zone
 * never moves a day.
 *
 * The one place a zone matters is the moon chips. A new or full moon is an
 * instant, and which day it falls on depends on where you stand, so those read
 * the reader's own zone. A member of a village is nearly always in the
 * village's zone; the chip is a shortcut to a date, and the date it picks is
 * shown in words before anything is sent.
 */
import { TASK_COPY, addCivilDays, civilDaysFrom, taskDateWords, taskWeekday, type TaskCard } from "@shared/sessionTasks";
import { civilDateKey, fullMoonsBetween, newMoonsBetween } from "@shared/lunar";

/** What the due line says, and whether the date has gone by. A date gone by is a question in normal ink, never a red mark. */
export interface DueWords {
  text: string;
  passed: boolean;
}

/**
 * The due line of a card. "By Friday 16 October", "No date", or, for an open
 * task whose date is before today, "The date was Friday 16 October. Done, not
 * yet, or let go?". The question is only for someone who can answer it;
 * anyone else reads "The date was Friday 16 October". A finished task keeps
 * its plain "By" line: it was answered, so there is nothing to ask.
 */
export function dueWords(task: Pick<TaskCard, "dueOn" | "status" | "canAnswer">, today: string): DueWords {
  const words = task.dueOn ? taskDateWords(task.dueOn, today) : "";
  if (!task.dueOn || !words) return { text: TASK_COPY.noDate, passed: false };
  const passed = task.status === "open" && task.dueOn < today;
  if (!passed) return { text: TASK_COPY.due(words), passed };
  return { text: task.canAnswer ? TASK_COPY.duePassed(words) : TASK_COPY.duePast(words), passed };
}

/** The day a task was said, in words. The year shows only when it is not this year. */
export function saidWords(date: string, today?: string): string {
  return taskDateWords(date, today);
}

/** The second line of a card: where the task came from, and when. */
export function fromWords(task: Pick<TaskCard, "circleName" | "sessionTitle" | "saidOn">, today: string): string {
  const said = saidWords(task.saidOn, today);
  return task.circleName ? TASK_COPY.from(task.circleName, said) : TASK_COPY.fromNoCircle(task.sessionTitle, said);
}

/** The four quick dates the Not yet sheet offers. A chip whose date cannot be found (outside the moon table) is null and not shown. */
export interface ChipDates {
  thisFriday: string;
  nextWeek: string;
  nextNewMoon: string | null;
  nextFullMoon: string | null;
}

const readerZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** The first moon whose civil day, in `zone`, comes after `today`. */
function nextMoonAfter(between: (from: Date, to: Date) => Date[], today: string, zone: string): string | null {
  // Start a day early so a moon in the first hours of tomorrow, in a zone
  // behind UTC, is still seen; then keep only days strictly after today.
  const from = new Date(`${addCivilDays(today, -1)}T00:00:00Z`);
  const to = new Date(`${addCivilDays(today, 40)}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return null;
  for (const moon of between(from, to)) {
    let day: string;
    try {
      day = civilDateKey(moon, zone);
    } catch {
      day = moon.toISOString().slice(0, 10);
    }
    if (day > today) return day;
  }
  return null;
}

/**
 * The Not yet chips, every one a day after today, which is what the server
 * asks of a new date.
 *
 *   This Friday     the next Friday after today (on a Friday, the one a week on)
 *   Next week       a week from today
 *   Next new moon   the first new moon after today, from shared/lunar.ts
 *   Next full moon  the first full moon after today
 */
export function chipDates(today: string, zone: string = readerZone()): ChipDates {
  let friday = addCivilDays(today, 1);
  for (let i = 0; i < 7 && taskWeekday(friday) !== "Friday"; i += 1) friday = addCivilDays(friday, 1);
  return {
    thisFriday: friday,
    nextWeek: addCivilDays(today, 7),
    nextNewMoon: nextMoonAfter(newMoonsBetween, today, zone),
    nextFullMoon: nextMoonAfter(fullMoonsBetween, today, zone),
  };
}

/** True for a YYYY-MM-DD after today, the only kind of new date the server takes. */
export function isAfterToday(date: string, today: string): boolean {
  const days = civilDaysFrom(today, date);
  return days != null && days > 0;
}
