/**
 * WORDS ANYBODY ALLOWED CAN FIX IN PLACE: a card's text, an item's title, the
 * session's name.
 *
 * Closed, it draws the words the way the caller asks (`render`: an h1, an h3,
 * a paragraph), and for somebody who may change them it adds a pencil, named
 * "Edit <what>" for a screen reader, and lets a tap on the words open the
 * editor too. The words keep their own role, so a heading stays a heading:
 * the pencil is the way in for a keyboard and a screen reader, and the tap is
 * a shortcut for a hand.
 *
 * Open, it is the room's growing box (GrowingText) on a gold-edged tile, with
 * the keys said in words under it, an optional warning (a proposal's
 * rewording starts its consent round again), and Save and Cancel.
 *
 * WHAT IT PROMISES.
 *
 *   It closes only on a yes. `onSave` returns the server's answer, and a
 *   refusal keeps the box open with the words still in it and the server's
 *   own sentence under it. "Saved." is said only after the answer was ok.
 *
 *   The room moving does not lose a half edit. The draft is held outside the
 *   component under `draftKey` (roomUi's useDraft), so an editor unmounted by
 *   the facilitator moving the room opens again with the words in it.
 *
 *   A poll does not write over the editor. What the room holds is snapshotted
 *   when the editor opens, the way AgendaList's item editor does it, and a
 *   new value arriving while it is open waits until it closes. The snapshot
 *   is held beside the draft (under `draftKey` plus ":base"), so it survives
 *   an unmount too.
 *
 *   Nothing is sent for nothing. Saving words that are empty, the same as the
 *   editor opened on, or the same as the room now holds, just closes. The
 *   snapshot matters here: if somebody else fixed the words while this editor
 *   sat open, a Save with nothing typed would otherwise send the old words
 *   back and quietly undo their fix (and on an open proposal, start its
 *   consent round again for nothing).
 *
 * INSIDE A CARD. An entry card (EntryCard) already draws its own tile and
 * glyph, so it asks for the editor `bare`, without a second tile inside the
 * first, and the card raises its own gold edge while a box is open in it. The
 * card's other tools (the remove button) are handed in as `tools` and sit
 * beside the pencil, so a hand finds them in one place; they step aside while
 * the editor is open, so nothing can take the card away under a half edit.
 */
import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { ROOM_COPY } from "@shared/sessions";
import GrowingText from "./GrowingText";
import { BTN_ICON, BTN_PRIMARY, BTN_QUIET, ENTRY_TILE_EDITING, ENTRY_TOOLS, HINT, useDraft } from "./roomUi";

export interface EditableTextProps {
  /** what the room holds */
  value: string;
  /** Returns the server's answer; the edit closes only on ok. */
  onSave(next: string): Promise<{ ok: boolean; error?: string }>;
  /** draws the pencil / tap-to-edit */
  may: boolean;
  /** "note", "Item title"... used in ROOM_COPY.editThis and as the box label */
  label: string;
  max: number;
  singleLine?: boolean;
  mic?: boolean;
  /** useDraft key, so a half edit survives the room moving */
  draftKey: string;
  /** How the text reads when not editing (an h1, an h3, a <p>). */
  render(text: string, openEdit: () => void): ReactNode;
  /** a line shown while editing, e.g. ROOM_COPY.rewordWarn */
  warn?: string;
  /** Draw the open editor without its own tile, for a caller that is already a tile. */
  bare?: boolean;
  /** More buttons beside the pencil while closed, such as remove. */
  tools?: ReactNode;
}

export default function EditableText({
  value,
  onSave,
  may,
  label,
  max,
  singleLine = false,
  mic = false,
  draftKey,
  render,
  warn,
  bare = false,
  tools,
}: EditableTextProps) {
  const draft = useDraft(draftKey);
  // The words the editor opened on, so a poll that changes `value` while it
  // is open is never mistaken for an edit made here.
  const base = useDraft(`${draftKey}:base`);
  // A draft already held under this key is a half edit the room moved away
  // from: open on it again.
  const [open, setOpen] = useState(() => may && draft.text !== "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  const openEdit = () => {
    if (!may || open) return;
    if (!draft.text) {
      draft.set(value);
      base.set(value);
    }
    setError(null);
    setSaid("");
    setOpen(true);
  };

  const cancel = () => {
    draft.clear();
    base.clear();
    setError(null);
    setOpen(false);
  };

  const save = async () => {
    if (saving) return;
    const words = draft.text;
    const next = words.trim();
    // The live words stand in only when no snapshot was recorded.
    const opened = (base.text || value).trim();
    if (!next || next === opened || next === value.trim()) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await onSave(words);
      if (r.ok) {
        draft.clear();
        base.clear();
        setOpen(false);
        setSaid(ROOM_COPY.saved);
      } else {
        setError(r.error || ROOM_COPY.writeFailed);
      }
    } finally {
      setSaving(false);
    }
  };

  // The live region stays mounted through open and closed, so "Saved." is
  // spoken by a region the reader already knows, never a new one.
  const live = (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {said}
    </p>
  );

  const editing = open && may;
  return (
    <>
      {editing ? (
        <div className={bare ? "flex min-w-0 flex-1 flex-col gap-2" : ENTRY_TILE_EDITING}>
          <GrowingText
            value={draft.text}
            onValue={draft.set}
            onSubmit={() => void save()}
            onCancel={cancel}
            label={label}
            max={max}
            minRows={singleLine ? 1 : 3}
            singleLine={singleLine}
            mic={mic}
            autoFocus
            disabled={saving}
          />
          {warn && <p className="text-sm font-medium text-notice">{warn}</p>}
          <p className={`${HINT} text-xs`}>{singleLine ? ROOM_COPY.editKeysOneLine : ROOM_COPY.editKeys}</p>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={saving} onClick={() => void save()}>
              {saving ? ROOM_COPY.saving : ROOM_COPY.save}
            </button>
            <button type="button" className={BTN_QUIET} disabled={saving} onClick={cancel}>
              {ROOM_COPY.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 items-start gap-1">
          {/* Only a card's words fill the row, so its tools sit at the card's
              right edge. A title elsewhere (the session's name, an item's
              name) hugs its words, so the pencil sits beside them. */}
          <div className={`min-w-0 ${bare ? "flex-1" : ""} ${may ? "cursor-text" : ""}`} onClick={may ? openEdit : undefined}>
            {render(value, openEdit)}
          </div>
          {(may || tools) && (
            <div className={ENTRY_TOOLS}>
              {may && (
                <button type="button" className={BTN_ICON} aria-label={ROOM_COPY.editThis(label)} onClick={openEdit}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {tools}
            </div>
          )}
        </div>
      )}
      {live}
    </>
  );
}
