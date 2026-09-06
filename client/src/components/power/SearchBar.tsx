/**
 * "Who does X" (0083, spec 6): deterministic type-ahead over seats, circles,
 * aims, accountabilities and holder names, zero tokens spent. Picking a
 * result zooms the camera and pulses the seat. The Ask button keeps calling
 * /api/assistant/coordinate, exactly as the concierge always has, for the
 * questions a substring cannot answer.
 */
import { useMemo, useRef, useState } from "react";
import { Compass, Search } from "lucide-react";
import MicButton from "@/components/MicButton";
import { authToken } from "@/lib/gameApi";
import type { PowerCircle, PowerData, PowerSeat } from "./types";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export interface SearchHit {
  kind: "circle" | "role" | "holder";
  id: string;
  /** For a holder hit: the holder key the person filter uses. */
  holderKey?: string;
  title: string;
  line: string;
  avatar?: string | null;
  circleId: string | null;
}

/** Pure, ranked, deterministic: title prefix beats title substring beats
 *  body substring; ties break by name then id. Exported for tests. */
export function searchHits(data: Pick<PowerData, "circles" | "roles">, query: string, cap = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: Array<{ score: number; hit: SearchHit }> = [];

  const scoreText = (title: string, body: string): number => {
    const t = title.toLowerCase();
    if (t.startsWith(q)) return 3;
    if (t.includes(q)) return 2;
    if (body.toLowerCase().includes(q)) return 1;
    return 0;
  };

  for (const c of data.circles as PowerCircle[]) {
    const score = scoreText(c.name, c.purpose ?? "");
    if (score) {
      scored.push({
        score,
        hit: { kind: "circle", id: c.id, title: c.name, line: c.purpose ?? "a circle", circleId: c.id },
      });
    }
  }
  // The circle each seat sits in, so a result can SAY where it lives.
  const circleName = new Map(
    (data.circles as PowerCircle[]).map((c) => [c.id, c.name] as const),
  );

  for (const s of data.roles as PowerSeat[]) {
    /*
     * SEARCH THE DOMAIN, NOT ONLY THE AIM.
     *
     * A reader types the thing they want done ("water", "money", "the
     * kitchen"). Half the time that word is in the seat's DOMAIN, which is
     * the field that says what the seat decides on, and this only ever read
     * the aim. So the seat that owns the question was findable exactly when
     * its aim happened to repeat its domain.
     */
    const body = [s.description ?? "", s.domain ?? "", ...(s.accountabilities ?? [])].join(" ");
    const score = scoreText(s.name, body);
    if (score) {
      /*
       * A RESULT THAT ANSWERS THE QUESTION IT WAS ASKED.
       *
       * This line used to read "3 of 4 held", which is true and is not what
       * anybody typed a search to find out. The question behind the query is
       * "who do I talk to about this", so the answer names the person where
       * we are allowed to, and the circle always, because "Kitchen Lead, held
       * by Ana, in the Gathering Circle" ends the search and a fraction does
       * not.
       *
       * `holders` arrives empty for a reader without `map.viewPeople`, so the
       * name half is absent rather than wrong, and the count carries it.
       */
      const named = s.holders.map((h) => h.name).filter(Boolean) as string[];
      const where = s.circleId ? circleName.get(s.circleId) : null;
      const who = s.vacant
        ? "open call"
        : named.length
          ? `held by ${named.slice(0, 2).join(" and ")}${named.length > 2 ? ` and ${named.length - 2} more` : ""}`
          : `${s.holderCount} of ${s.seats} held`;
      scored.push({
        score,
        hit: {
          kind: "role",
          id: s.id,
          title: s.name,
          line: where ? `${who}, in ${where}` : who,
          circleId: s.circleId,
        },
      });
    }
    for (const h of s.holders) {
      if (!h.name) continue;
      if (h.name.toLowerCase().includes(q)) {
        scored.push({
          score: h.name.toLowerCase().startsWith(q) ? 3 : 2,
          hit: {
            kind: "holder",
            id: s.id,
            holderKey: h.userId ?? h.name,
            title: h.name,
            line: `holds ${s.name}`,
            avatar: h.avatar ?? null,
            circleId: s.circleId,
          },
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title) || a.hit.id.localeCompare(b.hit.id));
  return scored.slice(0, cap).map((s) => s.hit);
}

export default function SearchBar({
  data,
  onPick,
  onAskResult,
}: {
  data: PowerData;
  onPick: (hit: SearchHit) => void;
  /** The concierge's answer, handed up so the page can show and act on it. */
  onAskResult?: (result: any) => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [askAnswer, setAskAnswer] = useState<any>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchHits(data, query), [data, query]);

  const pick = (hit: SearchHit) => {
    setQuery("");
    setAskAnswer(null);
    onPick(hit);
  };

  const ask = () => {
    if (query.trim().length < 3 || !data.conciergeEnabled) return;
    setBusy(true);
    setAskAnswer(null);
    fetch("/api/assistant/coordinate", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? d.error ?? "Could not ask");
        setAskAnswer(d);
        onAskResult?.(d);
      })
      .catch((e) => setAskAnswer({ error: e.message }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="relative max-w-2xl mx-auto" data-power-search>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="power-search-hits"
            aria-activedescendant={hits.length ? `power-hit-${active}` : undefined}
            aria-label="Find a role, a circle, or a person"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && hits.length) {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp" && hits.length) {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                if (hits.length) pick(hits[Math.min(active, hits.length - 1)]);
                else ask();
              } else if (e.key === "Escape") {
                setQuery("");
              }
            }}
            placeholder="Who does… kitchen, water, a name"
            className="w-full text-sm border border-border rounded-xl pl-9 pr-3 py-2.5 bg-card"
          />
        </div>
        <MicButton onText={(t) => setQuery((v) => (v ? v.replace(/\s*$/, " ") : "") + t)} disabled={busy} />
        {data.conciergeEnabled && (
          <button
            type="button"
            onClick={ask}
            disabled={busy || query.trim().length < 3}
            className="text-sm bg-teal-deep text-white rounded-xl px-4 font-medium disabled:opacity-40"
          >
            {busy ? "…" : "Ask"}
          </button>
        )}
      </div>

      {hits.length > 0 && (
        <ul
          id="power-search-hits"
          role="listbox"
          aria-label="Matches"
          className="absolute z-30 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
        >
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.id}-${h.holderKey ?? ""}`} role="option" aria-selected={i === active} id={`power-hit-${i}`}>
              <button
                type="button"
                onClick={() => pick(h)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm ${i === active ? "bg-muted" : ""}`}
              >
                {h.avatar ? (
                  <img src={h.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-teal-deep/10 text-teal-deep text-[10px] flex items-center justify-center font-semibold">
                    {h.kind === "circle" ? "◯" : h.kind === "role" ? "▣" : "☺"}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block font-medium text-foreground truncate">{h.title}</span>
                  <span className="block text-xs text-muted-foreground truncate">{h.line}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {askAnswer && (
        <div className="mt-3 bg-card border border-border rounded-xl p-4 text-sm text-left">
          {askAnswer.error && <p role="alert" className="text-red-600 text-xs">{askAnswer.error}</p>}
          {askAnswer.match && (
            <p className="text-foreground">
              That sounds like{" "}
              <button
                type="button"
                className="font-semibold text-teal-deep"
                onClick={() =>
                  askAnswer.match.kind !== "quest" &&
                  pick({
                    kind: askAnswer.match.kind === "circle" ? "circle" : "role",
                    id: askAnswer.match.id,
                    title: askAnswer.match.name,
                    line: "",
                    circleId: askAnswer.match.kind === "circle" ? askAnswer.match.id : null,
                  })
                }
              >
                {askAnswer.match.name}
              </button>
              {askAnswer.vacant && <span className="text-amber-700">, and nobody holds this yet. Raise your hand!</span>}
              {askAnswer.contact && <span>, talk to {askAnswer.contact.name}.</span>}
            </p>
          )}
          {askAnswer.match === null && !askAnswer.error && (
            <p className="text-muted-foreground flex items-start gap-2">
              <Compass className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              {askAnswer.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
