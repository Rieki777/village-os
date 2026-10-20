/**
 * One answer to one task, sent with the version the member saw.
 *
 * THE SERVER'S ANSWER DECIDES WHAT THE CARD SHOWS. Nothing moves on the
 * screen before the reply: a 200 carries the card as it now stands, and that
 * card replaces the old one. The toast is the sheet's own sentence, said only
 * once the server took the answer.
 *
 * SOMEBODY GOT THERE FIRST. Two people can hold one task (a seat has several
 * holders, and the facilitator may note an answer in the room), so the PATCH
 * carries the version this card was drawn from. A 409 comes back with the
 * card as it is now: that card replaces this one, and the member reads
 * TASK_REFUSALS.moved, so they answer what is really there and not what was.
 *
 * Any other refusal stays in the sheet as a sentence beside the button, and
 * the card is left as it was.
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import { ROOM_COPY } from "@shared/sessions";
import { TASK_COPY, TASK_REFUSALS, taskUrl, type TaskAnswer, type TaskCard, type TaskOp } from "@shared/sessionTasks";

/** What happened to one answer. `moved` and `ok` both hand back a card to show. */
export type TaskAnswerOutcome =
  | { kind: "ok"; task: TaskCard }
  | { kind: "moved"; task: TaskCard }
  | { kind: "refused"; error: string };

const isCard = (v: unknown): v is TaskCard =>
  !!v && typeof v === "object" && typeof (v as TaskCard).entryId === "number" && typeof (v as TaskCard).version === "number";

/** The server's own sentence when it sent one, or the room's plain fallback. */
function refusalOf(body: unknown, status: number): string {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const said = typeof b.error === "string" ? b.error.trim() : "";
  if (said && /\s/.test(said)) return said;
  if (status === 401) return ROOM_COPY.signedOut;
  if (status === 404) return TASK_REFUSALS.notFound;
  if (status === 429) return TASK_REFUSALS.tooMany;
  if (status === 403) return TASK_REFUSALS.notYours;
  return ROOM_COPY.writeFailed;
}

/** Fields an answer may carry beside its op. */
export interface TaskAnswerFields {
  dueOn?: string;
  note?: string;
}

/**
 * `onCard` receives every card the server hands back, after a success and
 * after a 409, so the list that drew the card can put the new one in its
 * place.
 */
export function useTaskAnswer(onCard?: (t: TaskCard) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A second tap while the first is in flight sends nothing.
  const inFlight = useRef(false);

  const send = useCallback(
    async (task: TaskCard, op: TaskOp, fields: TaskAnswerFields = {}): Promise<TaskAnswerOutcome> => {
      if (inFlight.current) return { kind: "refused", error: "" };
      inFlight.current = true;
      setBusy(true);
      setError("");
      const body: TaskAnswer = { op, version: task.version };
      if (fields.dueOn) body.dueOn = fields.dueOn;
      const note = fields.note?.trim();
      if (note) body.note = note;
      let outcome: TaskAnswerOutcome;
      try {
        const res = await gameFetch(taskUrl(task.entryId), { method: "PATCH", body: JSON.stringify(body) });
        const reply = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.ok && isCard(reply.task)) {
          outcome = { kind: "ok", task: reply.task };
        } else if (res.status === 409 && isCard(reply.task)) {
          outcome = { kind: "moved", task: reply.task };
        } else {
          outcome = { kind: "refused", error: refusalOf(reply, res.ok ? 0 : res.status) };
        }
      } catch {
        outcome = { kind: "refused", error: ROOM_COPY.offline };
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
      if (outcome.kind === "ok") {
        toast.success(TASK_COPY.sheets[op].toast);
        onCard?.(outcome.task);
      } else if (outcome.kind === "moved") {
        toast.message(TASK_REFUSALS.moved);
        onCard?.(outcome.task);
      } else {
        setError(outcome.error);
      }
      return outcome;
    },
    [onCard],
  );

  return { send, busy, error, clearError: () => setError("") };
}
