/**
 * ONE TASK, as the profile's board and the room's From last time draw it.
 *
 * It reads top to bottom the way a member asks about a task:
 *   1. what it is                  the words said in the call, never rewritten
 *   2. where it came from          "From the Garden circle · Friday 9 October"
 *   3. who holds it                you, a person, a seat and who sits there, or the circle
 *   4. by when                     a date in words, or "No date"
 *   5. the latest answer           the one line given with it, if any
 *   6. what you can answer         only the buttons the server's rights allow
 *   7. Open the record             only for people who were in the room, and admins
 *
 * A DONE TASK CAN BE ACCEPTED AS ACCOMPLISHED. Its chip then reads
 * Accomplished and a line says "Accepted on Friday 6 November". Whoever may
 * accept it (`canAccept`: a live holder of the power that seats people, never
 * for their own work) gets "Accept as accomplished", which opens the answer
 * sheet with an optional note. A done task nobody may accept reads "Waiting
 * to be accepted".
 *
 * The server decides every right (`taskRights` in shared/sessionTasks.ts) and
 * sends it as three flags. These only keep a button off the screen where the
 * server would refuse it. A card still in an open session has no buttons at
 * all: it is answered in the room.
 *
 * A DATE GONE BY IS A QUESTION, for whoever can answer it. The line reads
 * "The date was Friday 16 October. Done, not yet, or let go?" in the card's
 * normal ink. Anyone else reads only "The date was Friday 16 October": a
 * question with no way to answer it reads as a nudge at somebody else. Nothing
 * here turns red, counts how often a date moved, or keeps a tally per person.
 *
 * The card wears the room's action tile and its hammer glyph, so a task on
 * the profile and the same task in the room read as one thing.
 */
import { useId, useState } from "react";
import { Link } from "wouter";
import { SESSION_SOMEONE } from "@shared/sessions";
import { TASK_COPY, taskDateWords, type TaskCard as TaskCardData, type TaskOp } from "@shared/sessionTasks";
import {
  BTN_PRIMARY,
  BTN_QUIET,
  BTN_SECONDARY,
  CHIP,
  ENTRY_GLYPH,
  ENTRY_TEXT,
  ENTRY_TILE,
  GLYPH,
  GLYPH_ICON,
  GLYPH_STROKE,
  HINT,
} from "@/components/sessions/roomUi";
import { dueWords, fromWords } from "./dateWords";
import TaskAnswerSheet from "./TaskAnswerSheet";

export interface TaskCardProps {
  task: TaskCardData;
  /** Village-local YYYY-MM-DD, from the payload that drew the card. */
  today: string;
  /** The card the server handed back after an answer, or after somebody else answered first. */
  onAnswered?: (t: TaskCardData) => void;
  /** The room's tighter tile. */
  compact?: boolean;
  /** Leave out "Open the record", for a card drawn inside that record. */
  hideRecordLink?: boolean;
}

/** The status a card wears: Holding, Done, Let go, Back with the circle, or Holding, new date. */
export function taskStatusLabel(task: Pick<TaskCardData, "status" | "heldAs" | "latest">): string {
  const L = TASK_COPY.statusLabels;
  if (task.status === "done") return task.latest?.kind === "accepted" ? L.accepted : L.done;
  if (task.status === "let_go") return L.let_go;
  if (task.heldAs === "circle") return L.circle;
  return task.latest?.kind === "not_yet" ? L.newDate : L.open;
}

/** Who holds it, as one line. A seat names the people who sit in it now. */
export function holderWords(task: Pick<TaskCardData, "heldAs" | "holderName" | "seat">): string {
  switch (task.heldAs) {
    case "you":
      return TASK_COPY.heldYou;
    case "person":
      return TASK_COPY.heldPerson(task.holderName?.trim() || SESSION_SOMEONE);
    case "seat":
      if (!task.seat) return TASK_COPY.heldCircle;
      return task.seat.holders.length > 0 ? TASK_COPY.heldSeat(task.seat.name, task.seat.holders) : TASK_COPY.heldSeatVacant(task.seat.name);
    case "circle":
      return TASK_COPY.heldCircle;
  }
}

/** The latest answer's line, when it carried one. */
export function latestWords(task: Pick<TaskCardData, "latest">): string | null {
  const note = task.latest?.note?.trim();
  if (!note) return null;
  return task.latest?.byFacilitator ? TASK_COPY.latestByFacilitator(note) : TASK_COPY.latest(note);
}

/** The acceptance line a done task carries: when it was accepted, or that it waits for someone who may. */
export function acceptanceWords(task: Pick<TaskCardData, "status" | "latest" | "acceptedOn" | "waitingToBeAccepted">, today: string): string | null {
  if (task.status !== "done") return null;
  if (task.latest?.kind === "accepted") {
    const on = task.acceptedOn ? taskDateWords(task.acceptedOn, today) : "";
    return on ? TASK_COPY.acceptedOn(on) : TASK_COPY.statusLabels.accepted;
  }
  return task.waitingToBeAccepted === true ? TASK_COPY.waitingToBeAccepted : null;
}

/** The buttons this card offers, in reading order, each with how strongly it is drawn. */
function buttonsFor(task: TaskCardData): { op: TaskOp; look: string }[] {
  if (task.inSessionNow) return [];
  const out: { op: TaskOp; look: string }[] = [];
  if (task.canTake) out.push({ op: "taken", look: BTN_PRIMARY });
  if (task.canAnswer && task.status === "open") {
    out.push({ op: "done", look: BTN_PRIMARY });
    out.push({ op: "not_yet", look: BTN_SECONDARY });
    out.push({ op: "let_go", look: BTN_SECONDARY });
    if (task.heldAs !== "circle") out.push({ op: "handed_back", look: BTN_QUIET });
  }
  if (task.canAccept === true && task.status === "done" && task.latest?.kind !== "accepted") out.push({ op: "accepted", look: BTN_PRIMARY });
  if (task.canReopen && task.status !== "open") out.push({ op: "reopened", look: BTN_SECONDARY });
  return out;
}

export default function TaskCard({ task, today, onAnswered, compact = false, hideRecordLink = false }: TaskCardProps) {
  // The card the server last handed back here. A newer card from the parent
  // wins, so a list that re-reads is never overruled by an older answer.
  const [answered, setAnswered] = useState<TaskCardData | null>(null);
  const [op, setOp] = useState<TaskOp | null>(null);
  const ids = useId();
  const textId = `${ids}-text`;

  const shown = answered && answered.entryId === task.entryId && answered.version >= task.version ? answered : task;
  const due = dueWords(shown, today);
  const latest = latestWords(shown);
  const acceptance = acceptanceWords(shown, today);
  const buttons = buttonsFor(shown);
  const Glyph = ENTRY_GLYPH.action;
  // The room's own entry tile. On the profile it breathes a little more from `sm` up.
  const shell = compact ? ENTRY_TILE : `${ENTRY_TILE} sm:p-5`;

  const done = (t: TaskCardData) => {
    setAnswered(t);
    setOp(null);
    onAnswered?.(t);
  };

  return (
    <article className={shell} aria-labelledby={textId} data-task={shown.status}>
      <span className={GLYPH} aria-hidden="true">
        <Glyph className={GLYPH_ICON} strokeWidth={GLYPH_STROKE} />
      </span>
      <div className="min-w-0 flex-1">
        <p id={textId} className={ENTRY_TEXT}>
          {shown.text}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{fromWords(shown, today)}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={CHIP}>{taskStatusLabel(shown)}</span>
          {/* Back with the circle is already the chip's word: said once. */}
          {shown.heldAs !== "circle" && <span className="text-sm text-foreground">{holderWords(shown)}</span>}
        </div>
        {/* Normal ink either way: a date gone by asks, it never warns. */}
        <p className={`mt-1 text-sm ${due.passed ? "text-foreground" : "text-muted-foreground"}`} data-passed={due.passed || undefined}>
          {due.text}
        </p>
        {acceptance && (
          <p className="mt-1 text-sm text-foreground" data-acceptance>
            {acceptance}
          </p>
        )}
        {latest && <p className="mt-1 break-words text-sm text-muted-foreground">{latest}</p>}

        {shown.inSessionNow ? (
          <p className={`${HINT} mt-3`}>{TASK_COPY.inSessionNow}</p>
        ) : (
          buttons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {buttons.map((b) => (
                <button key={b.op} type="button" className={b.look} aria-describedby={textId} onClick={() => setOp(b.op)}>
                  {TASK_COPY.buttons[b.op]}
                </button>
              ))}
            </div>
          )
        )}

        {shown.recordLink && !hideRecordLink && (
          <Link href={`/sessions/${shown.sessionId}`} className={`${BTN_QUIET} mt-2`} aria-describedby={textId}>
            {TASK_COPY.buttons.record}
          </Link>
        )}
      </div>

      {op && <TaskAnswerSheet task={shown} op={op} today={today} onDone={done} onClose={() => setOp(null)} />}
    </article>
  );
}
