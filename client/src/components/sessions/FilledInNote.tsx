/**
 * FILLED IN BY THE FACILITATOR (0288, shared/sessionOnBehalf.ts). One line
 * under anything the person facilitating filled in or changed for somebody:
 * an arrival, an agenda item, a tension, a proposal, an action. Everybody in
 * the room reads it, by the role and never by the facilitator's name. The
 * person it was for, and the facilitator who filled it in, see Undo beside
 * it while the room is open (`canUndo`, from the server).
 */
import { useState } from "react";
import { ON_BEHALF_COPY, type FilledIn } from "@shared/sessionOnBehalf";
import { BTN_QUIET } from "./roomUi";
import type { RoomActions } from "./useSessionRoom";

export default function FilledInNote({ filled, actions }: { filled: FilledIn | null | undefined; actions: Pick<RoomActions, "undoFill"> }) {
  const [busy, setBusy] = useState(false);
  if (!filled) return null;
  const undo = actions.undoFill;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-filled-in={filled.act}>
      <span>{filled.act === "added" ? ON_BEHALF_COPY.filledInBy() : ON_BEHALF_COPY.changedBy()}</span>
      {filled.canUndo && undo && (
        <button
          type="button"
          className={`${BTN_QUIET} min-h-0 px-2 py-0.5 text-xs`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void undo(filled.id).finally(() => setBusy(false));
          }}
        >
          {busy ? ON_BEHALF_COPY.undoing : ON_BEHALF_COPY.undo}
        </button>
      )}
    </p>
  );
}
