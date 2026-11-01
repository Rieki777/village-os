/**
 * A stream of what people add while an item runs: its notes, its ideas, or
 * its wins and celebrations.
 * Newest last, the way a conversation reads. Each one is an EntryCard, so
 * whoever wrote it, the facilitator, the note taker or an admin in the room
 * can fix its words in place or take it out again, once: a second tap while
 * the first is out sends nothing.
 *
 * The add box is the room's growing box, full width with the voice button
 * beside it, so a long note is read whole while it is typed. What is being
 * typed is a draft, so it is still there when the room comes back to this
 * item. Enter adds it; Shift and Enter starts a new line.
 */
import { useState } from "react";
import { ROOM_COPY, SESSION_LIMITS, cleanText, type EntryKind } from "@shared/sessions";
import EntryCard from "./EntryCard";
import GrowingText from "./GrowingText";
import { BTN_SECONDARY, HINT, LABEL_CAPS, UNDER_BOX, useDraft, type StageProps } from "./roomUi";

export interface EntryStreamProps extends Omit<StageProps, "now"> {
  kind: Extract<EntryKind, "note" | "idea" | "win">;
  itemId: number | null;
  title: string;
  addLabel: string;
  /** A line under the heading saying what the stream is for. */
  help?: string;
}

export default function EntryStream({ view, actions, kind, itemId, title, addLabel, help }: EntryStreamProps) {
  const draft = useDraft(`${view.id}:${itemId ?? "loose"}:${kind}`);
  const text = draft.text;
  const [busy, setBusy] = useState(false);
  const list = view.entries.filter((e) => e.kind === kind && e.itemId === itemId);
  const canAdd = view.me.joined && view.status === "open";
  const headingId = `stream-${kind}-${itemId ?? "loose"}`;

  const add = async () => {
    const clean = cleanText(text, SESSION_LIMITS.text);
    if (!clean || busy) return;
    setBusy(true);
    try {
      const r = await actions.addEntry({ kind, text: clean, itemId });
      if (r.ok) draft.clear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h4 id={headingId} className={LABEL_CAPS}>
          {title}
        </h4>
        {help && (
          <p id={`${headingId}-help`} className={`${HINT} mt-1`}>
            {help}
          </p>
        )}
      </div>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((e) => (
            <li key={e.id}>
              <EntryCard view={view} actions={actions} entry={e} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={HINT}>{ROOM_COPY.nothingYet}</p>
      )}
      {canAdd && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <GrowingText value={text} onValue={draft.set} onSubmit={() => void add()} label={addLabel} max={SESSION_LIMITS.text} minRows={2} describedBy={help ? `${headingId}-help` : undefined} mic />
          <div className={UNDER_BOX}>
            <button type="submit" className={BTN_SECONDARY} disabled={busy || !text.trim()}>
              {ROOM_COPY.add}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
