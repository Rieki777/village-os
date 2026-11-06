/**
 * "IT'S DONE" FROM THE BELL, under a notice about one task.
 *
 * A notice that a task is in your hands (session_action_held), or that its
 * date is near (session_action_due), links that one card on the board
 * (taskBoardLink). Under it sit two controls: "It's done" and "Open".
 *
 *   It's done   POST taskDoneUrl(id). The server reads the task's version
 *               itself and answers through the same rights, lock, event row
 *               and notices as the board's own Done. A task already done
 *               answers with the card and nothing changes.
 *   Open        the same link as the row: the card on the board.
 *
 * The notice is marked read when the panel closes, not the moment it is
 * done: a read row of a kind that already has several read rows folds into
 * their batch, and the undo would vanish from under the member's hand.
 *
 * After it lands the row reads TASK_COPY.bell.marked, with "Open it again",
 * which is the board's own reopen (PATCH taskUrl(id) with the version the done
 * door handed back). A refusal is the server's own sentence, said in the row.
 * A task that was let go loses "It's done" and keeps "Open", because the
 * reason it was let go is on the board.
 *
 * IT STILL SAYS SO WHEN THE BELL OPENS AGAIN. The panel unmounts on close, so
 * the card "It's done" handed back is kept for the signed-in member in
 * bellAnswers (never across members, never in storage), and a row drawn again
 * starts as done, with its undo.
 *
 * ACCESSIBILITY. Both answers are real buttons whose names start with the
 * words they show and carry the task ("It's done: Fix the gate latch"), so a
 * voice user can say what they see (WCAG 2.5.3), and Open is a link because it
 * goes somewhere. What happened is said in a status line that is mounted,
 * empty, before anything is said into it. Focus never falls to the page: after
 * "It's done" it moves to "Open it again", after that to "It's done", and when
 * "It's done" goes because the task was let go, to "Open".
 *
 * A BATCHED LINE NEVER GETS THIS. Four notices folded into one line open; they
 * do not act. Once opened, each notice inside it is a single notice again and
 * NotificationBell draws this under it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { gameFetch } from "@/lib/gameApi";
import { ROOM_COPY } from "@shared/sessions";
import { TASK_COPY, TASK_REFUSALS, taskBoardLink, taskDoneUrl, taskUrl, type TaskCard } from "@shared/sessionTasks";
import { tasksChanged } from "./useTaskCount";
import { bellAnswerFor, forgetBellAnswer, rememberBellAnswer } from "./bellAnswers";

/** The two notice types that carry the buttons. */
export const BELL_TASK_TYPES: readonly string[] = ["session_action_held", "session_action_due"];

export interface BellTaskActionsProps {
  entryId: number;
  /** What the notice is about, for the buttons' names: the task's own words. */
  what: string;
  /** Mark the notice read: on Open, and on leaving the panel after It's done. */
  onRead: () => void;
  /** Close the panel, as following the row's own link does. */
  onLeave: () => void;
  /** The signed-in member, whose own answers the bell remembers between openings. */
  who?: string | null;
  /** Inside an opened batch: indented with the notice above it. */
  nested?: boolean;
}

type Phase = "ready" | "working" | "marked" | "undoing" | "letGo";

const isCard = (v: unknown): v is TaskCard =>
  !!v && typeof v === "object" && typeof (v as TaskCard).entryId === "number" && typeof (v as TaskCard).version === "number";

/** The server's sentence when it sent one, or a plain one for the status. */
export function bellRefusal(body: unknown, status: number): string {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const said = typeof b.error === "string" ? b.error.trim() : "";
  // A machine code ("auth_required") is not a sentence, and is never shown.
  if (said && /\s/.test(said)) return said;
  if (status === 401) return ROOM_COPY.signedOut;
  if (status === 403) return TASK_REFUSALS.notYours;
  if (status === 404) return TASK_REFUSALS.notFound;
  if (status === 429) return TASK_REFUSALS.tooMany;
  return TASK_COPY.bell.failed;
}

async function readReply(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as unknown;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

const SMALL_BTN =
  "inline-flex items-center justify-center min-h-11 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export default function BellTaskActions({ entryId, what, onRead, onLeave, who = null, nested = false }: BellTaskActionsProps) {
  // Answered from the bell before, by this member: the row starts as done.
  const [kept] = useState(() => bellAnswerFor(who, entryId));
  const [phase, setPhase] = useState<Phase>(kept ? "marked" : "ready");
  const [card, setCard] = useState<TaskCard | null>(kept);
  const [line, setLine] = useState(kept ? TASK_COPY.bell.marked : "");
  const rootRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the next render, once the button it was on has gone.
  const focusNext = useRef<"done" | "undo" | "open" | null>(null);
  const live = useRef(true);
  // Done here, so the notice is read once the panel closes.
  const readLater = useRef(false);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (readLater.current) onReadRef.current();
    };
  }, []);

  // A layout effect, so focus moves in the same commit that swaps the button.
  // A passive effect ran a frame later: Escape pressed inside that frame put
  // focus back on the bell, then this effect pulled it into the closing panel
  // and it fell to the page.
  useLayoutEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    if (next === "open") rootRef.current?.querySelector<HTMLAnchorElement>("a[data-bell-open]")?.focus();
    else (next === "undo" ? undoRef : doneRef).current?.focus();
  }, [phase]);

  const markDone = async () => {
    if (phase === "working" || phase === "undoing") return;
    setPhase("working");
    setLine("");
    try {
      const res = await gameFetch(taskDoneUrl(entryId), { method: "POST" });
      const reply = await readReply(res);
      if (!live.current) return;
      if (res.ok && isCard(reply.task)) {
        setCard(reply.task);
        setLine(TASK_COPY.bell.marked);
        rememberBellAnswer(who, reply.task);
        // With no undo to land on, Open is what is left in the row.
        focusNext.current = reply.task.canReopen ? "undo" : "open";
        setPhase("marked");
        readLater.current = true;
        tasksChanged("bell");
        return;
      }
      if (res.status === 409) {
        // Let go: the reason is on the board, so only Open stays.
        const said = typeof reply.error === "string" && /\s/.test(reply.error) ? reply.error : TASK_REFUSALS.letGoNotDone;
        setLine(said);
        // "It's done" had focus and is gone: Open is what is left.
        focusNext.current = "open";
        setPhase("letGo");
        return;
      }
      setLine(bellRefusal(reply, res.status));
      setPhase("ready");
    } catch {
      if (!live.current) return;
      setLine(TASK_COPY.bell.failed);
      setPhase("ready");
    }
  };

  const openAgain = async () => {
    if (!card || phase !== "marked") return;
    setPhase("undoing");
    try {
      const res = await gameFetch(taskUrl(entryId), {
        method: "PATCH",
        body: JSON.stringify({ op: "reopened", version: card.version }),
      });
      const reply = await readReply(res);
      if (!live.current) return;
      if (res.ok && isCard(reply.task)) {
        setCard(reply.task);
        setLine(TASK_COPY.bell.reopened);
        forgetBellAnswer(who, entryId);
        focusNext.current = "done";
        setPhase("ready");
        tasksChanged("bell");
        return;
      }
      if (res.status === 409 && isCard(reply.task)) {
        // Somebody answered first. Show what is really there.
        setCard(reply.task);
        setLine(TASK_REFUSALS.moved);
        if (reply.task.status === "done") rememberBellAnswer(who, reply.task);
        else forgetBellAnswer(who, entryId);
        if (reply.task.status === "open") {
          focusNext.current = "done";
          setPhase("ready");
        } else {
          // The undo had focus; when it does not come back, Open is what is left.
          if (reply.task.status === "let_go" || !reply.task.canReopen) focusNext.current = "open";
          setPhase(reply.task.status === "let_go" ? "letGo" : "marked");
        }
        tasksChanged("bell");
        return;
      }
      setLine(bellRefusal(reply, res.status));
      setPhase("marked");
    } catch {
      if (!live.current) return;
      setLine(TASK_COPY.bell.failed);
      setPhase("marked");
    }
  };

  const B = TASK_COPY.bell;
  const showDone = phase === "ready" || phase === "working";
  const showUndo = (phase === "marked" || phase === "undoing") && !!card?.canReopen;

  return (
    <div ref={rootRef} className={`${nested ? "pl-7 pr-4" : "px-4"} pb-3 -mt-1 border-b border-border`} data-bell-task={entryId}>
      <div className="flex flex-wrap items-center gap-2">
        {showDone && (
          <button
            ref={doneRef}
            type="button"
            onClick={() => void markDone()}
            disabled={phase === "working"}
            aria-label={B.doneLabel(what)}
            className={`${SMALL_BTN} bg-teal-deep text-white hover:bg-teal-deep-dark`}
          >
            {phase === "working" ? B.working : B.done}
          </button>
        )}
        {showUndo && (
          <button
            ref={undoRef}
            type="button"
            onClick={() => void openAgain()}
            disabled={phase === "undoing"}
            aria-label={B.undoLabel(what)}
            className={`${SMALL_BTN} border border-border text-foreground hover:bg-muted`}
          >
            {phase === "undoing" ? B.working : B.undo}
          </button>
        )}
        <Link
          href={taskBoardLink(entryId)}
          onClick={() => {
            readLater.current = false;
            onRead();
            onLeave();
          }}
          aria-label={B.openLabel(what)}
          data-bell-open=""
          className={`${SMALL_BTN} border border-border text-teal-deep hover:bg-muted`}
        >
          {B.open}
        </Link>
      </div>
      {/* Mounted empty, so what is written into it later is announced. */}
      <p role="status" className={line ? "mt-2 text-xs text-foreground" : "sr-only"}>
        {line}
      </p>
    </div>
  );
}
