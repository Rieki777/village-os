/**
 * The legend (0083, spec 10): the five glyphs WITH COUNTS, the shape
 * spectrum with the village's marker on it, and the village's way of
 * deciding as a chip whose gloss opens on tap. Persistent bottom-left on
 * desktop, collapsible on mobile; the footer slot is where the currency
 * picker lives in v1.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { PowerBlock, PowerSeat, SeatStateWord } from "./types";

/**
 * THE BUCKETS THE SEAT TALLY COUNTS INTO.
 *
 * Five states plus `other`, and the five answer to `SeatState` in
 * `server/lib/orgChart.ts`. That column is not the authority: `expired` is
 * DERIVED by `seatState()` and the 0049 enum deliberately cannot hold it, so
 * the server's own type is the only enumeration of what can arrive here.
 * `seatStates.test.ts` reads that union out of source and holds this list to
 * it, the way objectionStates.test.ts reads OBJECTION_RULINGS.
 */
export const SEAT_TALLY_BUCKETS: readonly (SeatStateWord | "other")[] = [
  "open",
  "partial",
  "filled",
  "forming",
  "expired",
  "other",
];

const EMPTY_TALLY: Record<string, number> = Object.fromEntries(
  SEAT_TALLY_BUCKETS.map((b) => [b, 0]),
);

function GlyphSample({ kind }: { kind: "open" | "partial" | "filled" | "forming" | "expired" }) {
  const r = 7;
  const c = 9;
  return (
    <svg viewBox="0 0 18 18" className="w-4.5 h-4.5 w-[18px] h-[18px] shrink-0" aria-hidden="true">
      {kind === "open" && (
        <>
          <circle cx={c} cy={c} r={r} fill="white" stroke="#6b7280" strokeWidth={1.6} strokeDasharray="2.5 2.5" />
          <path d={`M ${c - 3} ${c} H ${c + 3} M ${c} ${c - 3} V ${c + 3}`} stroke="#6b7280" strokeWidth={1.4} strokeLinecap="round" />
        </>
      )}
      {kind === "partial" && (
        <>
          <circle cx={c} cy={c} r={r} fill="white" stroke="var(--color-teal-deep)" strokeWidth={1.6} />
          <path d={`M ${c} ${c} L ${c} ${c - r + 2} A ${r - 2} ${r - 2} 0 0 1 ${c + r - 2} ${c} Z`} fill="var(--color-teal-deep)" />
          <line x1={c} y1={c + r - 2} x2={c} y2={c + r + 1.5} stroke="var(--color-teal-deep)" strokeWidth={1.2} />
        </>
      )}
      {kind === "filled" && <circle cx={c} cy={c} r={r} fill="var(--color-teal-deep)" stroke="white" strokeWidth={1.6} />}
      {kind === "forming" && (
        <g opacity={0.55}>
          <circle cx={c} cy={c} r={r} fill="white" stroke="var(--color-teal-deep)" strokeWidth={1.6} strokeDasharray="1.2 2.4" />
          <path d={`M ${c - 2.6} ${c - 3.2} H ${c + 2.6} L ${c - 2.6} ${c + 3.2} H ${c + 2.6} Z`} fill="none" stroke="var(--color-teal-deep)" strokeWidth={1.1} />
        </g>
      )}
      {kind === "expired" && (
        <>
          <circle cx={c} cy={c} r={r} fill="var(--color-teal-deep)" stroke="#6b7280" strokeWidth={1.6} opacity={0.55} />
          <circle cx={c + 4.5} cy={c - 4.5} r={3.4} fill="white" stroke="var(--color-teal-deep)" strokeWidth={1} />
          <line x1={c + 4.5} y1={c - 4.5} x2={c + 4.5} y2={c - 6.6} stroke="var(--color-teal-deep)" strokeWidth={0.9} />
        </>
      )}
    </svg>
  );
}

export default function Legend({
  seats,
  power,
  footer,
}: {
  seats: PowerSeat[];
  power: PowerBlock;
  /** The currency picker mounts here in v1; the site header is a follow-up. */
  footer?: ReactNode;
}) {
  const [openOnMobile, setOpenOnMobile] = useState(false);
  const [glossOpen, setGlossOpen] = useState(false);

  const real = seats.filter((s) => !s.isExample);
  const counted = real.length ? real : seats;
  /**
   * THE TALLY, and it has to add up to the number of seats.
   *
   * `s.state` arrives from the server and its authority is `SeatState` in
   * `server/lib/orgChart.ts`, which this file mirrors by hand as
   * `SeatStateWord` in ./types. Read straight, `counts[s.state] += 1` on a
   * state this build has not heard of writes `NaN` onto a key nothing below
   * renders, so the seat is counted NOWHERE: the legend goes on saying "3
   * open, 2 held" over six seats and no reader can tell it is short. Seats
   * are how a village describes who holds power, so a tally that quietly
   * drops one is a false statement about that.
   *
   * `seatStates.test.ts` holds the five below to the server's union. The
   * `other` bucket is for the server that is ahead of this build, and it
   * renders only when it has something in it.
   */
  const counts: Record<string, number> = { ...EMPTY_TALLY };
  for (const s of counted) {
    // Read as a bare string on purpose: the TYPE says SeatStateWord, and the
    // value came off the wire, and this whole class of defect is the gap
    // between those two sentences. A server that literally sends "other"
    // lands in the same bucket, which is where it belongs anyway.
    const word = String(s.state ?? (s.holderCount > 0 ? "filled" : "open"));
    counts[word !== "other" && word in counts ? word : "other"] += 1;
    // Representation is a property OF a seat, not one of its states, so it
    // tallies alongside rather than inside the state buckets. A seat that
    // speaks for its circle is also open, or held, or forming.
    if (s.representsCircle) counts.represents = (counts.represents ?? 0) + 1;
  }
  counts.represents = counts.represents ?? 0;

  const rows: Array<{ kind: "open" | "partial" | "filled" | "forming" | "expired"; word: string }> = [
    { kind: "open", word: "open call" },
    { kind: "partial", word: "partly held" },
    { kind: "filled", word: "held" },
    { kind: "forming", word: "forming" },
    // The state key stays `expired`, which is the server's word for the
    // derived state. What a member READS is what changed: a seat whose term
    // reached its date has lost nothing and its holder is still holding it,
    // so the legend says what the seat is waiting for. Same word as the
    // holder chip and the term line on the seat card, on purpose.
    { kind: "expired", word: "ready to be re-chosen" },
  ];

  const shape = power.glossary.shapes.find((s) => s.id === power.shape) ?? null;
  const decides = power.glossary.decidesBy.find((d) => d.id === power.decidesBy) ?? null;
  const decideGloss = power.decidesByGloss || decides?.gloss || null;

  const body = (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {rows.map((rw) => (
          <li key={rw.kind} className="flex items-center gap-2 text-xs text-foreground">
            <GlyphSample kind={rw.kind} />
            <span>{rw.word}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">{counts[rw.kind]}</span>
          </li>
        ))}
        {counts.other > 0 && (
          <li className="flex items-center gap-2 text-xs text-foreground">
            <span
              className="w-3 h-3 shrink-0 rounded-full border border-dashed border-muted-foreground"
              aria-hidden="true"
            />
            <span>in a state this page has not been taught</span>
            <span className="ml-auto text-muted-foreground tabular-nums">{counts.other}</span>
          </li>
        )}
        {/* THE DOUBLE LINK. Counted, so a village that has not named a
            representative anywhere sees a zero and knows the mark exists,
            instead of never meeting it. Sociocracy's one structural idea a
            normal org chart cannot draw, so it is worth a line here. */}
        <li className="flex items-center gap-2 text-xs text-foreground">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
            <line x1="0" y1="8" x2="4" y2="8" stroke="var(--color-teal-deep)" strokeWidth={1.2} strokeDasharray="2.5 2" />
            <circle cx="9" cy="8" r="3" fill="var(--color-teal-deep)" />
            <circle cx="9" cy="8" r="5.4" fill="none" stroke="var(--color-teal-deep)" strokeWidth={1} />
          </svg>
          <span>speaks for this circle where it links out</span>
          <span className="ml-auto text-muted-foreground tabular-nums">{counts.represents}</span>
        </li>
      </ul>

      {/* The spectrum (card A design 5): one strip from "one holds it" to
          "all hold it", the village's marker on it. Drawn once for the whole
          village; that is the line from pyramid to circle made honest. */}
      <div>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
          <span>one holds it</span>
          <span>all hold it</span>
        </div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-amber/60 via-sage/50 to-teal-deep/60">
          {shape && typeof shape.spectrum === "number" && (
            <div
              className="absolute -top-1 w-4 h-4 rounded-full bg-card border-2 border-teal-deep shadow"
              style={{ left: `calc(${shape.spectrum * 100}% - 8px)` }}
              title={shape.label}
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {shape ? (
            <>
              <span className="font-semibold text-foreground">{shape.label}.</span>{" "}
              {power.shape === "other" && power.shapeGloss ? power.shapeGloss : shape.gloss}
            </>
          ) : (
            "This village has not declared its shape yet."
          )}
        </p>
      </div>

      {decides && (
        <div>
          <button
            type="button"
            onClick={() => setGlossOpen((v) => !v)}
            aria-expanded={glossOpen}
            className="text-xs bg-teal-deep/10 text-teal-deep px-2.5 py-1 rounded-full font-medium hover:bg-teal-deep/20"
          >
            Decides by {decides.label.toLowerCase()}
          </button>
          {glossOpen && decideGloss && <p className="text-[11px] text-muted-foreground mt-1.5">{decideGloss}</p>}
        </div>
      )}

      {footer && <div className="pt-2 border-t border-border">{footer}</div>}
    </div>
  );

  return (
    <div data-power-legend className="bg-card border border-border rounded-xl p-3 w-56 max-w-full text-left shadow-sm">
      <button
        type="button"
        className="md:hidden w-full flex items-center justify-between text-xs font-semibold text-foreground"
        onClick={() => setOpenOnMobile((v) => !v)}
        aria-expanded={openOnMobile}
      >
        Legend
        <ChevronDown className={`w-4 h-4 transition-transform ${openOnMobile ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div className={`${openOnMobile ? "mt-2" : "hidden"} md:block`}>{body}</div>
    </div>
  );
}
