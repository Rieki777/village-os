/**
 * NAME A TENSION, open on every stage. Something sensed that wants its own
 * time goes straight to the backlog, so it is held without taking over the
 * item the room is on.
 */
import { useState } from "react";
import { Sprout } from "lucide-react";
import { ROOM_COPY, SESSION_COPY, SESSION_LIMITS, cleanText } from "@shared/sessions";
import { BTN_PRIMARY, BTN_QUIET, INPUT, type StageProps } from "./roomUi";

export default function TensionCatcher({ view, actions }: Omit<StageProps, "now">) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!view.me.joined || view.status !== "open") return null;

  const send = async () => {
    const clean = cleanText(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      const r = await actions.addEntry({ kind: "tension", text: clean, itemId: null });
      if (r.ok) {
        setText("");
        setOpen(false);
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN_QUIET}
          onClick={() => {
            setOpen(true);
            setSaved(false);
          }}
        >
          <Sprout className="h-4 w-4" aria-hidden="true" />
          {SESSION_COPY.addTension}
        </button>
        {saved && (
          <p role="status" className="text-sm text-open">
            {ROOM_COPY.tensionSaved}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{SESSION_COPY.addTension}</span>
        <textarea
          className={`${INPUT} min-h-16`}
          value={text}
          maxLength={SESSION_LIMITS.text}
          placeholder={ROOM_COPY.tensionPlaceholder}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !text.trim()}>
          {ROOM_COPY.send}
        </button>
        <button type="button" className={BTN_QUIET} onClick={() => setOpen(false)}>
          {ROOM_COPY.cancel}
        </button>
      </div>
    </form>
  );
}
