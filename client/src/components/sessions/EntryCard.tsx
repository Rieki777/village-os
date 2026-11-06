/**
 * ONE CARD SOMEBODY WROTE: a note, an idea, a line on what we learned, an
 * action, a tension. Every list of entries in the room draws its cards here,
 * so a card reads and edits the same way wherever it is met.
 *
 * Rye's first call asked for it plainly: "be able to edit all cards". So a
 * card carries a pencil for everybody the server lets change its words (the
 * person who wrote it, the facilitator, the note taker, an admin in the room;
 * roomUi's `entryRightsFor` reads that matrix), and a tap on the words opens
 * the editor too (EditableText). Two things stay final on purpose, and the
 * card shows them as final, with no pencil for a change the server refuses:
 *
 *   A proposal decided by consent keeps the words the room agreed. It is drawn
 *   by Proposal, which says so in a lock line, and a decided one that reaches
 *   this card gets no pencil and no remove.
 *
 *   An action's holder sets its date and lets it go, and the words stay with
 *   whoever wrote it and the hosts (`edit` is already false for the holder).
 *
 * `readOnly` is for cards that belong to somewhere else: what an earlier,
 * closed session left behind is shown here and changed nowhere.
 *
 * `extra` sits under the words and outside the tap target, so choosing a seat
 * or a date under an action never opens the editor by accident.
 */
import { useState, type ReactNode } from "react";
import FilledInNote from "./FilledInNote";
import { X } from "lucide-react";
import { ENTRY_LABELS, ROOM_COPY, SESSION_LIMITS, SESSION_REFUSALS, cleanLine, cleanText, type SessionEntry } from "@shared/sessions";
import EditableText from "./EditableText";
import {
  BTN_ICON,
  ENTRY_GLYPH,
  ENTRY_META,
  ENTRY_TEXT,
  ENTRY_TILE,
  GLYPH,
  GLYPH_ICON,
  GLYPH_STROKE,
  LEARNED_QUOTE,
  entryRightsFor,
  nameOf,
  type StageProps,
} from "./roomUi";

export interface EntryCardProps extends Omit<StageProps, "now"> {
  entry: SessionEntry;
  /** The word for this card in "Edit <label>" and in the open box. Defaults to the kind's own name. */
  label?: string;
  /** One sentence: no line breaks, and Enter saves. What we learned and actions are one line. */
  singleLine?: boolean;
  /** Under the words: an action's holder, seat and date. */
  extra?: ReactNode;
  /** Draw the words as the item's pull-quote (what we learned). */
  quote?: boolean;
  /** Shown and never changed here, such as a card carried over from an earlier session. */
  readOnly?: boolean;
  /** Read quieter, for a card parked to the backlog. */
  muted?: boolean;
}

/*
 * While the editor is open inside it, the card takes the gold edge the open
 * editor would otherwise draw itself. `has-[textarea]` reads that from the
 * card's own contents, so the card holds no state of its own about it, and the
 * date field under an action (an input, never a textarea) does not raise it.
 */
const TILE_OPEN = "has-[textarea]:border-notice/60 has-[textarea]:ring-1 has-[textarea]:ring-notice/30";

export default function EntryCard({ view, actions, entry, label, singleLine = false, extra, quote = false, readOnly = false, muted = false }: EntryCardProps) {
  const [removing, setRemoving] = useState(false);
  const rights = entryRightsFor(view, entry);
  const decided = entry.kind === "decision" && entry.status === "done";
  const mayEdit = !readOnly && rights.edit && !decided;
  const mayRemove = !readOnly && rights.remove && !decided;
  const Glyph = ENTRY_GLYPH[entry.kind];
  const word = label ?? ENTRY_LABELS[entry.kind].toLowerCase();
  const author = readOnly ? null : nameOf(view, entry.authorUserId);

  // One removal per tap: a second tap while the first is out sends nothing.
  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await actions.deleteEntry(entry.id);
    } finally {
      setRemoving(false);
    }
  };

  const save = async (next: string) => {
    const clean = singleLine ? cleanLine(next, SESSION_LIMITS.text) : cleanText(next, SESSION_LIMITS.text);
    if (!clean) return { ok: false, error: SESSION_REFUSALS.textNeeded };
    const r = await actions.patchEntry(entry.id, { text: clean }, { quiet: true });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };

  return (
    <div className={`${ENTRY_TILE} ${TILE_OPEN} ${muted ? "border-dashed" : ""}`} data-entry={entry.kind}>
      <span className={GLYPH} aria-hidden="true">
        <Glyph className={GLYPH_ICON} strokeWidth={GLYPH_STROKE} />
      </span>
      <div className="min-w-0 flex-1">
        <EditableText
          value={entry.text}
          may={mayEdit}
          label={word}
          max={SESSION_LIMITS.text}
          singleLine={singleLine}
          mic={!singleLine}
          draftKey={`${view.id}:edit:entry:${entry.id}`}
          onSave={save}
          bare
          tools={
            mayRemove ? (
              <button type="button" className={BTN_ICON} aria-label={ROOM_COPY.remove} disabled={removing} onClick={() => void remove()}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null
          }
          render={(text) => (
            <div className="min-w-0">
              <p className={quote ? LEARNED_QUOTE : muted ? ENTRY_TEXT.replace("text-foreground", "text-muted-foreground") : ENTRY_TEXT}>{text}</p>
              {author && <span className={ENTRY_META}>{author}</span>}
            </div>
          )}
        />
        {!readOnly && <FilledInNote filled={entry.filledIn} actions={actions} />}
        {extra}
      </div>
    </div>
  );
}
