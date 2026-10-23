/**
 * SEND A TENSION ON: one tension named in a room becomes one of a circle's
 * agenda items, or one for no circle in particular (shared/sessionLibrary.ts,
 * feature 2). Used in this room's backlog (TensionCatcher.tsx) and in "From
 * last time" (FromLastTime.tsx), where `sessionId` is the earlier session the
 * tension was named in. That session's record is never written to: once the
 * tension is sent, the room says where it went and "From last time" stops
 * offering it.
 *
 * One quiet button opens a small group: which circle (the village's live
 * circles, this room's own first chosen, or no circle in particular, which is
 * always there), a sentence saying who will read its words for the choice
 * made, and Send it. Escape or Cancel closes it and the focus returns to the
 * button; after a send the focus goes to the section heading named by
 * `returnFocusTo`, since the card may leave the screen. A refusal is said
 * inline in the server's words; what landed is read out in the room's toast.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { TENSION_SEND_COPY } from "@shared/sessionLibrary";
import type { SessionEntry, SessionView } from "@shared/sessions";
import type { RoomActions } from "./useSessionRoom";
import { BTN_QUIET, BTN_SECONDARY, HINT, INPUT, LABEL } from "./roomUi";

export interface SendTensionProps {
  view: SessionView;
  actions: RoomActions;
  entry: SessionEntry;
  /** The session the tension was named in: this room's, or the earlier one "From last time" reads. */
  sessionId: number;
  /** The id of the heading the focus goes to after a send. */
  returnFocusTo: string;
}

export default function SendTension({ view, actions, entry, sessionId, returnFocusTo }: SendTensionProps) {
  const options = view.circleOptions;
  const ownCircle = view.circleId && options.some((c) => c.id === view.circleId) ? view.circleId : "";
  const [open, setOpen] = useState(false);
  const [circleId, setCircleId] = useState(ownCircle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const backToOpener = useRef(false);
  const idBase = `send-tension-${sessionId}-${entry.id}`;

  // Back from Cancel or Escape, the focus returns to the button that opened it.
  useEffect(() => {
    if (!open && backToOpener.current) {
      backToOpener.current = false;
      opener.current?.focus();
    }
  }, [open]);

  const close = () => {
    backToOpener.current = true;
    setOpen(false);
    setError(null);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      close();
    }
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await actions.sendTension({ sessionId, entryId: entry.id, circleId: circleId || null }, { quiet: true });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(false);
    toast.success(TENSION_SEND_COPY.sent(options.find((c) => c.id === circleId)?.name ?? null));
    // The card may leave the screen with the send; the focus waits on the section's heading.
    window.requestAnimationFrame(() => document.getElementById(returnFocusTo)?.focus());
  };

  if (!open) {
    return (
      <button ref={opener} type="button" className={BTN_QUIET} onClick={() => setOpen(true)}>
        {TENSION_SEND_COPY.send}
      </button>
    );
  }

  return (
    <div role="group" aria-label={TENSION_SEND_COPY.send} onKeyDown={onKeyDown} className="mt-2 space-y-2 rounded-xl border border-border bg-muted px-3 py-3">
      <div>
        <label htmlFor={`${idBase}-circle`} className={LABEL}>
          {TENSION_SEND_COPY.circleLabel}
        </label>
        <select id={`${idBase}-circle`} autoFocus className={`mt-1 ${INPUT}`} value={circleId} onChange={(e) => setCircleId(e.target.value)}>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="">{TENSION_SEND_COPY.noCircle}</option>
        </select>
      </div>
      <p className={HINT}>{circleId ? TENSION_SEND_COPY.warning : TENSION_SEND_COPY.warningNoCircle}</p>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void send()}>
          {busy ? TENSION_SEND_COPY.sending : TENSION_SEND_COPY.sendYes}
        </button>
        <button type="button" className={BTN_QUIET} disabled={busy} onClick={close}>
          {TENSION_SEND_COPY.cancel}
        </button>
      </div>
    </div>
  );
}
