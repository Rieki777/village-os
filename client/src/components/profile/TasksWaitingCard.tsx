/**
 * WAITING ON YOU: a small card near the top of the member's own profile.
 *
 * When open tasks wait on the member (held by them, or by a seat they sit in
 * now), it says how many and the nearest date in words, with one button that
 * brings the task board into view. When nothing waits it draws nothing at all.
 *
 * It reads the count door (useTaskCount), one cheap query, and not the board's
 * full read: the board loads its own cards further down, and this card must
 * not double the slowest request on every profile visit.
 *
 * A date already behind today reads "The earliest date was ..." in the card's
 * normal ink. It is a fact about the date, never a warning. "Today" here is
 * the reader's own calendar day; a member of a village is nearly always in
 * the village's zone, and the board itself measures by the village's.
 */
import { useAuth } from "@/contexts/AuthContext";
import { useTaskCount } from "@/components/tasks/useTaskCount";
import { BTN_SECONDARY, HINT, LABEL_CAPS, PANEL } from "@/components/sessions/roomUi";
import { TASK_BOARD_ANCHOR, TASK_COPY, taskDateWords, type TaskCountPayload } from "@shared/sessionTasks";

/** The reader's calendar day as YYYY-MM-DD. */
export function readerToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The card's two lines: how many, and the nearest date. */
export function waitingWords(count: TaskCountPayload, today: string): { count: string; date: string } {
  const C = TASK_COPY.waitingCard;
  const words = count.nextDue ? taskDateWords(count.nextDue, today) : "";
  const date = !count.nextDue || !words ? C.noDate : count.nextDue < today ? C.nextDuePassed(words) : C.nextDue(words);
  return { count: C.count(count.waiting), date };
}

/** Bring the board into view and hand focus to its heading. */
function openBoard(): void {
  let reduce = false;
  try {
    reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    reduce = false;
  }
  document.getElementById(TASK_BOARD_ANCHOR)?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  document.getElementById("task-board-h")?.focus({ preventScroll: true });
}

export interface TasksWaitingCardProps {
  /** The sessions module is on for this member. Off, nothing is asked. */
  enabled: boolean;
}

export default function TasksWaitingCard({ enabled }: TasksWaitingCardProps) {
  const { user } = useAuth();
  const count = useTaskCount(enabled && !!user, user?.id ?? null);
  if (!count || count.waiting <= 0) return null;
  const C = TASK_COPY.waitingCard;
  const words = waitingWords(count, readerToday());
  return (
    <section aria-labelledby="tasks-waiting-h" className={`${PANEL} mb-8 flex flex-wrap items-center justify-between gap-4`}>
      <div className="min-w-0">
        <h2 id="tasks-waiting-h" className={LABEL_CAPS}>
          {C.heading}
        </h2>
        <p className="mt-1 text-base font-semibold text-card-foreground">{words.count}</p>
        <p className={`${HINT} mt-0.5`}>{words.date}</p>
      </div>
      <button type="button" className={BTN_SECONDARY} onClick={openBoard}>
        {C.button}
      </button>
    </section>
  );
}
