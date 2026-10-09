/**
 * A stream of what people add while an item runs: its notes, or its ideas.
 * Newest last, the way a conversation reads. Whoever wrote an entry, the
 * facilitator or the note taker can take it out again.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { ROOM_COPY, SESSION_LIMITS, cleanText, type EntryKind } from "@shared/sessions";
import { BTN_ICON, BTN_SECONDARY, HINT, INPUT, entryRightsFor, nameOf, type StageProps } from "./roomUi";

export interface EntryStreamProps extends Omit<StageProps, "now"> {
  kind: Extract<EntryKind, "note" | "idea">;
  itemId: number | null;
  title: string;
  addLabel: string;
}

export default function EntryStream({ view, actions, kind, itemId, title, addLabel }: EntryStreamProps) {
  const [text, setText] = useState("");
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
      if (r.ok) setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h4 id={headingId} className="text-sm font-semibold text-foreground">
        {title}
      </h4>
      {list.length ? (
        <ul className="space-y-1.5">
          {list.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2">
              <p className="min-w-0 flex-1 whitespace-pre-line text-sm text-foreground">
                {e.text}
                <span className="block text-xs text-muted-foreground">{nameOf(view, e.authorUserId) ?? ""}</span>
              </p>
              {entryRightsFor(view, e).remove && (
                <button type="button" className={BTN_ICON} aria-label={ROOM_COPY.remove} onClick={() => void actions.deleteEntry(e.id)}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={HINT}>{ROOM_COPY.nothingYet}</p>
      )}
      {canAdd && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">{addLabel}</span>
            <input
              className={INPUT}
              value={text}
              maxLength={SESSION_LIMITS.text}
              placeholder={addLabel}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="submit" className={BTN_SECONDARY} disabled={busy || !text.trim()}>
            {ROOM_COPY.add}
          </button>
        </form>
      )}
    </section>
  );
}
