/**
 * PEOPLE YOU WORKED WITH THIS CYCLE, one tap from the send form.
 *
 * The chips come from `/api/game/gratitude/suggestions`, which is
 * `gratitudeSuggestionsFor` in server/lib/gratitudeNudge.ts: the same function
 * the gratitude nudge counts, so the people a notice promised are the people
 * this row shows. A tap fills the recipient field and nothing else. Sending
 * stays the form's own button, so a chip can never send anything by itself.
 *
 * Nothing loaded, or nobody to suggest, renders nothing at all: an empty row
 * of chips would read as "you worked with nobody", which is a claim about the
 * member and not a gap in the render.
 */
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";

interface Suggestion {
  name: string;
  handle: string;
  sources: string[];
}

/** Why this person is here, in the words a member would use. */
const SOURCE_WORDS: Record<string, string> = {
  quest: "a quest together",
  crew: "a quest crew together",
  session: "a session together",
  circle: "the same circle",
};

export default function SuggestionChips({
  selected,
  onPick,
  refreshKey,
}: {
  /** What the recipient field holds now, so the matching chip reads as chosen. */
  selected: string;
  onPick(to: string): void;
  /** Bumped after a send, so somebody just thanked leaves the row. */
  refreshKey: number;
}) {
  const [people, setPeople] = useState<Suggestion[]>([]);

  useEffect(() => {
    let alive = true;
    gameFetch("/api/game/gratitude/suggestions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.suggestions)) setPeople(d.suggestions as Suggestion[]);
      })
      .catch(() => { /* the row stays away; the form still works */ });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (people.length === 0) return null;
  const chosen = selected.trim().replace(/^@+/, "").toLowerCase();

  return (
    <div className="mb-3">
      <p id="gratitude-suggestions-label" className="mb-2 text-sm text-muted-foreground">
        People you worked with this cycle
      </p>
      <ul aria-labelledby="gratitude-suggestions-label" className="flex flex-wrap gap-2">
        {people.map((p) => {
          const on = chosen === p.handle.toLowerCase();
          const why = p.sources.map((s) => SOURCE_WORDS[s]).filter(Boolean).join(", ");
          return (
            <li key={p.handle}>
              <button
                type="button"
                aria-pressed={on}
                title={why ? `You shared ${why}` : undefined}
                onClick={() => onPick(`@${p.handle}`)}
                className={`min-h-11 rounded-full border px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  on
                    ? "border-teal-deep bg-teal-deep text-white"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
              >
                {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
