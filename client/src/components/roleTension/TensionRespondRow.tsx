/**
 * ONE TENSION RAISED WITH A ROLE THE READER HOLDS: a row in Waiting on you
 * (client/src/components/profile/WaitingOnYou.tsx), with the holder's three
 * answers (shared/roleTensions.ts):
 *
 *   Take it              the holder is on it; the row stays, marked taken.
 *   Answer               with an optional word back; the row leaves, and the
 *                        role card counts it.
 *   Bring to the circle  the words go into the circle's backlog for its next
 *                        session, where every member can read them. The row
 *                        says so before the holder confirms.
 *
 * The row never names who raised it. The server decides every move again and
 * answers with a sentence when it refuses, which the row shows in place.
 */
import { useId, useState } from "react";
import { toast } from "sonner";
import { gameFetch } from "@/lib/gameApi";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, HINT, INPUT, LABEL } from "@/components/sessions/roomUi";
import { TENSION_COPY, TENSION_LIMITS, tensionRespondUrl, type HeldTension, type TensionAction } from "@shared/roleTensions";

const refusalOf = (body: unknown): string => {
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error.trim() : "";
  return said && /\s/.test(said) ? said : TENSION_COPY.respondFailed;
};

export default function TensionRespondRow({
  tension,
  onResponded,
}: {
  tension: HeldTension;
  /** Told after the server accepted a move: take keeps the row, the others remove it. */
  onResponded: (id: string, action: TensionAction) => void;
}) {
  const [asking, setAsking] = useState<"answer" | "bring_to_circle" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  const textId = `${ids}-text`;
  const noteId = `${ids}-note`;
  const where = [TENSION_COPY.rowWhere(tension.role, tension.circle), TENSION_COPY.raisedOn(tension.raisedOn)].filter(Boolean).join(" · ");

  const respond = async (action: TensionAction) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = note.trim();
      const body = action !== "take" && trimmed ? { action, note: trimmed } : { action };
      const res = await gameFetch(tensionRespondUrl(tension.id), { method: "POST", body: JSON.stringify(body) });
      const reply = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(TENSION_COPY.responded[action]);
        setAsking(null);
        setNote("");
        onResponded(tension.id, action);
      } else setError(refusalOf(reply));
    } catch {
      setError(TENSION_COPY.respondFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-muted px-4 py-3.5 text-foreground" data-raised-tension={tension.id}>
      <p id={textId} className="whitespace-pre-line break-words font-semibold leading-snug">
        {tension.text}
      </p>
      <p className={`${HINT} mt-0.5`}>{where}</p>
      {(tension.status === "taken" || tension.overdue) && (
        <p className="mt-1 text-sm font-medium text-foreground">
          {tension.status === "taken" ? TENSION_COPY.takenBy : TENSION_COPY.overdue}
        </p>
      )}
      {asking === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tension.status === "open" && (
            <button type="button" className={BTN_SECONDARY} disabled={busy} aria-describedby={textId} onClick={() => void respond("take")}>
              {TENSION_COPY.take}
            </button>
          )}
          <button type="button" className={BTN_SECONDARY} disabled={busy} aria-describedby={textId} onClick={() => setAsking("answer")}>
            {TENSION_COPY.answer}
          </button>
          <button type="button" className={BTN_QUIET} disabled={busy} aria-describedby={textId} onClick={() => setAsking("bring_to_circle")}>
            {TENSION_COPY.bring}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {asking === "bring_to_circle" && <p className="text-sm font-semibold text-foreground">{TENSION_COPY.bringWarning}</p>}
          <div>
            <label htmlFor={noteId} className={LABEL}>
              {TENSION_COPY.noteLabel}
            </label>
            <input
              id={noteId}
              type="text"
              value={note}
              maxLength={TENSION_LIMITS.note}
              placeholder={TENSION_COPY.notePlaceholder}
              onChange={(e) => setNote(e.target.value)}
              className={`${INPUT} mt-1`}
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} aria-describedby={textId} onClick={() => void respond(asking)}>
              {asking === "answer" ? TENSION_COPY.confirmAnswer : TENSION_COPY.confirmBring}
            </button>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setAsking(null)}>
              {TENSION_COPY.cancel}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
