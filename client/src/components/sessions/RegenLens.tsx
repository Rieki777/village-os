/**
 * THE REGENERATIVE LENS, under an open proposal in the room
 * (shared/sessionPulse.ts `LENS_COPY`): four questions for a room that wants
 * to look at a proposal whole before it consents. Folded away until somebody
 * opens it, and kept nowhere: the room's answers are the room's to speak.
 */
import { useState } from "react";
import { LENS_COPY } from "@shared/sessionPulse";
import { BTN_QUIET } from "./roomUi";

export default function RegenLens({ entryId }: { entryId: number }) {
  const [open, setOpen] = useState(false);
  const listId = `lens-${entryId}`;
  return (
    <div className="mb-3">
      <button type="button" className={BTN_QUIET} aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
        {open ? LENS_COPY.hide : LENS_COPY.show}
      </button>
      {open && (
        <ol id={listId} className="mt-2 list-decimal space-y-1.5 rounded-xl border border-border bg-card px-6 py-3 text-sm text-foreground">
          {LENS_COPY.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
