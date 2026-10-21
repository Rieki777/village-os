/**
 * The small number beside "My tasks" in the avatar menu and the mobile menu.
 *
 * It is the member's own count of tasks waiting on them, read for them alone
 * (useTaskCount). Nothing shows while it loads, when the read fails, or when
 * nothing waits: a zero is not something to be told.
 *
 * The digit is drawn for the eye and hidden from a screen reader, and a whole
 * sentence stands in for it ("3 tasks wait on you"), so the link reads as
 * "My tasks, 3 tasks wait on you" and never as "My tasks 3".
 */
import { TASK_COPY } from "@shared/sessionTasks";
import { useTaskCount } from "./useTaskCount";

export interface TaskCountBadgeProps {
  /** The signed-in member's id, so a change of member reads afresh. */
  who?: number | string | null;
}

export default function TaskCountBadge({ who }: TaskCountBadgeProps) {
  const count = useTaskCount(true, who);
  const n = count?.waiting ?? 0;
  if (n <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-task-count
        className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-amber px-1.5 text-[11px] font-bold leading-none text-foreground align-middle"
      >
        {n > 99 ? "99+" : n}
      </span>
      <span className="sr-only">, {TASK_COPY.menu.waiting(n)}</span>
    </>
  );
}
