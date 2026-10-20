/**
 * HOW MANY TASKS WAIT ON YOU, for your own menu and the top of your own profile.
 *
 * One read of GET /api/sessions/tasks/count, which answers for the signed-in
 * member and nobody else: the open tasks they hold in person or through a seat
 * they sit in now, the same set the board's Holding and Your seats hold groups
 * draw, and the nearest date among them.
 *
 * NOTHING IS KEPT BETWEEN READS. Each mount asks again, and nothing sits in a
 * module-level cache, so a count read for one member can never be shown to
 * the next one who signs in on the same browser. The menus only mount the
 * count while they are open, so this is one small request per opening and
 * never a poll.
 *
 * IT FOLLOWS THE ANSWERS. The board and the bell call `tasksChanged()` after a
 * task is answered, and every mounted count reads again, so "It's done" in the
 * bell takes the number down without a reload.
 *
 * Signed out, or with the sessions module off, it sends nothing and answers
 * null. A failed read is also null: the count is a convenience, and showing no
 * number is truer than showing an old one.
 */
import { useEffect, useState } from "react";
import { authToken, gameFetch } from "@/lib/gameApi";
import { TASKS_COUNT_URL, type TaskCountPayload } from "@shared/sessionTasks";

/** The window event the board and the bell send after a task is answered. */
export const TASKS_CHANGED_EVENT = "village:tasks-changed";

/** Who answered: the board, or the bell. The board re-reads for the bell and not for itself. */
export type TasksChangedFrom = "board" | "bell";

/** Tell every mounted count, and the board, that a task changed, so they read again. */
export function tasksChanged(from: TasksChangedFrom): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ from: TasksChangedFrom }>(TASKS_CHANGED_EVENT, { detail: { from } }));
}

/** Who sent a tasks-changed event, or null for anything else. */
export function tasksChangedFrom(e: Event): TasksChangedFrom | null {
  const from = (e as CustomEvent<{ from?: unknown }>).detail?.from;
  return from === "board" || from === "bell" ? from : null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The count door's reply, read defensively. Null when it is not one. */
export function readTaskCount(v: unknown): TaskCountPayload | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const waiting = b.waiting;
  if (typeof waiting !== "number" || !Number.isInteger(waiting) || waiting < 0) return null;
  const nextDue = typeof b.nextDue === "string" && YMD.test(b.nextDue) ? b.nextDue : null;
  return { waiting, nextDue };
}

/**
 * The signed-in member's own count, or null while it loads, when it fails,
 * and whenever `enabled` is false. Pass the member's id as `who` so a change
 * of member reads afresh.
 */
export function useTaskCount(enabled: boolean, who?: number | string | null): TaskCountPayload | null {
  const [count, setCount] = useState<TaskCountPayload | null>(null);

  useEffect(() => {
    setCount(null);
    if (!enabled || !authToken()) return;
    let live = true;
    let asked = 0;
    const read = async () => {
      const mine = ++asked;
      try {
        const res = await gameFetch(TASKS_COUNT_URL, { cache: "no-store" });
        const next = res.ok ? readTaskCount(await res.json().catch(() => null)) : null;
        // Only the newest read may land, so a slow early reply never overwrites a fresh one.
        if (live && mine === asked) setCount(next);
      } catch {
        if (live && mine === asked) setCount(null);
      }
    };
    void read();
    const again = () => void read();
    window.addEventListener(TASKS_CHANGED_EVENT, again);
    return () => {
      live = false;
      window.removeEventListener(TASKS_CHANGED_EVENT, again);
    };
  }, [enabled, who]);

  return count;
}
