/**
 * THE CIRCLE WALL: every circle as a card (2026-10-23).
 *
 * The map answers "who runs what" and "where does this sit". The question most
 * visitors arrive with is a different one, "where could I help", and the map
 * makes them hunt for it circle by circle. The wall answers it at a glance:
 * each circle with its icon, what it is for, how full it is and how many
 * openings it has, sorted so the openings come first. It reads the same
 * payload as the map and opens the same circle card, so the two can never
 * disagree.
 *
 * On a phone it is what sits under the small map, where a folding list used to
 * be; on a wider screen it is what the List chip shows in the map's place.
 * Rye, 2026-10-23: "map, then circle cards".
 */
import { useMemo, useState } from "react";
import { cssColourForCircle } from "@shared/circleView";
import { iconFor } from "@/lib/circleIcons";
import { ExampleChip } from "@/components/ExamplesBanner";
import { initialsFrom } from "./holderFace";
import { circleCounts, countable } from "./villageCounts";
import type { PowerCircle, PowerData } from "./types";

export type WallSort = "openings" | "working" | "all";

const SORTS: ReadonlyArray<{ id: WallSort; label: string }> = [
  { id: "openings", label: "Openings first" },
  { id: "working", label: "At work today" },
  { id: "all", label: "Everything" },
];

/** At most this many tokens under a card, the rest as "+n". */
const MAX_TOKENS = 5;

const isActive = (c: PowerCircle) => (c.status ?? "active") === "active";

/** The cards in the order a sort asks for. Pure, so the order is testable. */
export function wallOrder(data: Pick<PowerData, "circles" | "roles">, sort: WallSort): PowerCircle[] {
  const circles = countable(data.circles);
  const byOrder = (a: PowerCircle, b: PowerCircle) =>
    (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));
  if (sort === "working") return circles.filter(isActive).sort(byOrder);
  if (sort === "all") return [...circles].sort(byOrder);
  const openings = new Map(circles.map((c) => [c.id, circleCounts(c.id, data).openings]));
  return [...circles].sort(
    (a, b) =>
      (openings.get(b.id) ?? 0) - (openings.get(a.id) ?? 0) ||
      Number(isActive(b)) - Number(isActive(a)) ||
      byOrder(a, b),
  );
}

/** "1 of 4 held, 3 open", or plain words when there is nothing to count. */
export function cardLine(c: { places: number; held: number; openings: number }): string {
  if (!c.places) return "No roles yet";
  if (!c.openings) return `All ${c.places} held`;
  return `${c.held} of ${c.places} held, ${c.openings} open`;
}

export default function CircleWall({
  data,
  onOpen,
  className = "",
}: {
  data: PowerData;
  /** A card was chosen: open that circle, the way stepping into it on the map does. */
  onOpen: (circleId: string) => void;
  className?: string;
}) {
  const [sort, setSort] = useState<WallSort>("openings");
  const cards = useMemo(() => wallOrder(data, sort), [data, sort]);

  return (
    <section aria-label="Every circle, as cards" data-power-wall className={className}>
      <div role="group" aria-label="Order the circles" className="flex flex-wrap gap-1.5 mb-3">
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={sort === s.id}
            onClick={() => setSort(s.id)}
            className={`text-xs px-3 py-1.5 min-h-[32px] rounded-full border ${
              sort === s.id ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No circles at work yet.</p>
      ) : (
        <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id}>
              <WallCard circle={c} data={data} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WallCard({ circle, data, onOpen }: { circle: PowerCircle; data: PowerData; onOpen: (id: string) => void }) {
  const counts = circleCounts(circle.id, data);
  const tone = cssColourForCircle({ id: circle.id, color: circle.color ?? null });
  const Icon = iconFor(circle.icon);
  const forming = circle.status === "forming";
  const line = cardLine(counts);

  // Held places first, as initials where the reader may see people, then one
  // token per opening. The tokens say the same thing as the meter, in people.
  const holders = data.viewer?.viewPeople
    ? data.roles
        .filter((r) => r.circleId === circle.id)
        .flatMap((r) => r.holders)
        .map((h) => (h.isAgent ? "⚙" : initialsFrom(h.name)))
    : [];
  const heldTokens = Array.from({ length: counts.held }, (_, i) => holders[i] || "");
  const tokens: Array<{ kind: "held" | "open"; text: string }> = [
    ...heldTokens.map((text) => ({ kind: "held" as const, text })),
    ...Array.from({ length: counts.openings }, () => ({ kind: "open" as const, text: "+" })),
  ];
  const shown = tokens.slice(0, MAX_TOKENS);
  const more = tokens.length - shown.length;
  const heldShare = counts.places ? counts.held / counts.places : 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(circle.id)}
      data-wall-circle={circle.id}
      aria-label={`${circle.name}${forming ? ", forming" : ""}. ${line}. Open this circle.`}
      className={`w-full h-full text-left rounded-xl border p-4 bg-card hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
        forming ? "border-dashed border-border" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 w-10 h-10 rounded-lg grid place-items-center"
          style={{ background: `color-mix(in srgb, ${tone} 22%, transparent)`, color: tone }}
        >
          <Icon className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground leading-snug">{circle.name}</span>
            {forming && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-dashed border-border text-muted-foreground">forming</span>
            )}
            {circle.isExample && <ExampleChip />}
          </span>
          {circle.purpose && <span className="block text-xs text-muted-foreground line-clamp-2 mt-0.5">{circle.purpose}</span>}
        </span>
      </div>

      {counts.places > 0 && (
        <span
          role="meter"
          aria-valuemin={0}
          aria-valuemax={counts.places}
          aria-valuenow={counts.held}
          aria-label={`${counts.held} of ${counts.places} held`}
          className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <span className="h-full" style={{ width: `${heldShare * 100}%`, background: tone }} />
          <span className="h-full" style={{ width: `${(1 - heldShare) * 100}%`, background: "var(--color-amber)", opacity: 0.55 }} />
        </span>
      )}

      <span className={`block text-xs mt-2 ${counts.openings ? "text-amber-700" : "text-muted-foreground"}`}>{line}</span>

      {shown.length > 0 && (
        <span aria-hidden="true" className="mt-2 flex items-center gap-1">
          {shown.map((t, i) =>
            t.kind === "held" ? (
              <span key={i} className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold bg-muted text-foreground border-2" style={{ borderColor: tone }}>
                {t.text}
              </span>
            ) : (
              <span key={i} className="w-6 h-6 rounded-full grid place-items-center text-xs border border-dashed text-amber-700" style={{ borderColor: "var(--color-amber)" }}>
                +
              </span>
            ),
          )}
          {more > 0 && <span className="text-[11px] text-muted-foreground ml-1">+{more}</span>}
        </span>
      )}
    </button>
  );
}
