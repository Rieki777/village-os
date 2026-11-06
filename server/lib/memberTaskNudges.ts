/**
 * Your list's two gentle notes, in-app only (the bell): a task due within two
 * days, and a task someone asked you for. The notice type is not one the
 * email cadence knows, so it never becomes an email, and it carries the
 * member's own task title and nothing else. Nothing outside the village's
 * daytime window (comms.quiet_start_hour to comms.quiet_end_hour), and one
 * notice per task and date, however often the job runs.
 */
import type { Pool } from "mysql2/promise";
import { addDays } from "../../shared/companionItems";
import { nextInWindow } from "../../shared/comms/quietHours";
import { numberVar } from "./variables";
import type { NotifyInput } from "./notify";
import { askedForTasks, dueSoonTasks } from "../repos/memberTasks";

export const DUE_SOON_DAYS = 2;
export const LIST_LINK = "/profile";

export function dueWords(today: string, dueOn: string): string {
  if (dueOn <= today) return "today";
  return dueOn === addDays(today, 1) ? "tomorrow" : `on ${dueOn}`;
}

export interface NudgeDeps {
  pool: Pool;
  notify: (input: NotifyInput) => Promise<unknown>;
  zone: string;
  today: string;
  now?: Date;
  window?: { start: number; end: number };
}

export async function runListNudges(d: NudgeDeps): Promise<string> {
  const now = d.now ?? new Date();
  const w = d.window ?? { start: numberVar("comms.quiet_start_hour"), end: numberVar("comms.quiet_end_hour") };
  if (nextInWindow(now, d.zone, w.start, w.end).getTime() !== now.getTime()) return "outside the village's daytime window";
  let due = 0;
  let asked = 0;
  for (const t of await dueSoonTasks(d.pool, d.today, addDays(d.today, DUE_SOON_DAYS))) {
    await d.notify({
      userId: t.userId, type: "my_task_due", title: `Due ${dueWords(d.today, t.dueOn)}: ${t.title}`.slice(0, 255),
      body: null, link: LIST_LINK, dedupeKey: `my-task-due:${t.id}:${t.dueOn}`,
    });
    due += 1;
  }
  for (const t of await askedForTasks(d.pool)) {
    await d.notify({
      userId: t.userId, type: "my_task_asked", title: `Asked by ${t.requestedBy}: ${t.title}`.slice(0, 255),
      body: null, link: LIST_LINK, dedupeKey: `my-task-asked:${t.id}`,
    });
    asked += 1;
  }
  return `${due} due-soon, ${asked} asked-for (one notice each, ever)`;
}
