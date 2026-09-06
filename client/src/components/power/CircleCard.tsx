/**
 * THE CIRCLE INSPECTOR: what this circle is, and who to bring what to.
 *
 * Stepping into a circle used to change the picture and nothing else. The
 * side panel went on showing the village summary until you tapped a SEAT, so
 * the whole question a reader arrives with, "what does this circle do and
 * who do I talk to", had no surface. Peerdom answers it in its inspector and
 * that is the single interaction this map was missing.
 *
 * AIM AND DOMAIN, said in the reader's words. Sociocracy defines a circle by
 * both: what it works toward, and what it decides on. The aim is the
 * circle's stored purpose. The domain is DERIVED, from the domains its seats
 * carry, because `circles` has no domain column and inventing one would mean
 * a migration to store a fact the seats already hold between them. Derived
 * and labelled as such beats blank, and it stays true when a seat moves.
 *
 * The scene art is `CircleScene`, the eleven hand-drawn banners that already
 * ship for the cards page. Stepping into a circle should feel like arriving
 * somewhere.
 */
import { useMemo } from "react";
import { ArrowLeft, Hand } from "lucide-react";
import CircleScene from "@/components/CircleScene";
import { ExampleChip } from "@/components/ExamplesBanner";
import SeatGlyph from "./SeatGlyph";
import type { PowerCircle, PowerData, PowerSeat } from "./types";

export default function CircleCard({
  circle,
  data,
  onSelectSeat,
  onOut,
}: {
  circle: PowerCircle;
  data: PowerData;
  onSelectSeat: (seatId: string) => void;
  /** Step back out to whatever holds this circle. */
  onOut: () => void;
}) {
  const seats = useMemo(
    () => data.roles.filter((r) => r.circleId === circle.id),
    [data.roles, circle.id],
  );

  const held = seats.reduce((n, s) => n + s.holderCount, 0);
  const places = seats.reduce((n, s) => n + s.seats, 0);
  const open = Math.max(0, places - held);

  /*
   * THE DOMAIN, SUMMARISED, BECAUSE THE RAW FIELD IS AN ESSAY.
   *
   * A circle has no domain column, so this derives one from the domains its
   * seats carry. The first version joined them whole with a separator, and
   * live on Amora's Community Circle that produced a SIX HUNDRED character
   * run-on in a 320px panel: four seats, each with a paragraph, glued into
   * one unreadable block. Correct data, useless surface.
   *
   * A reader is asking one question here: does this circle decide about the
   * thing I came with. That is answered by the FIRST SENTENCE of each seat's
   * domain, which is where these are written to say what they cover. The
   * full text is one tap away on the seat itself, which is where somebody
   * who needs the detail is going anyway.
   */
  const domains = useMemo(() => {
    const out: string[] = [];
    for (const s of seats) {
      const raw = (s.domain ?? "").trim();
      if (!raw) continue;
      // First sentence, or a clean clip if the first sentence is itself long.
      const firstStop = raw.search(/[.;]\s/);
      let head = firstStop > 0 ? raw.slice(0, firstStop) : raw;
      if (head.length > 88) head = `${head.slice(0, 85).trimEnd()}…`;
      if (head && !out.some((o) => o.toLowerCase() === head.toLowerCase())) out.push(head);
    }
    return out;
  }, [seats]);
  const DOMAIN_CAP = 4;

  // The double link, named. `representsCircle` marks the seat that speaks
  // for this circle where it joins the one above.
  const speaksFor = seats.filter((s) => s.representsCircle);

  const method = circle.decidesBy
    ? data.power.glossary.decidesBy.find((m) => m.id === circle.decidesBy)
    : null;

  const children = data.circles.filter((c) => c.parentCircleId === circle.id);

  return (
    <div data-power-card>
      <button
        type="button"
        onClick={onOut}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        Step back out
      </button>

      <div className="rounded-lg overflow-hidden mb-3">
        <CircleScene circle={{ id: circle.id, name: circle.name }} />
      </div>

      <h3 className="font-display text-lg font-bold text-foreground">
        {circle.name}
        {circle.isExample && <ExampleChip className="ml-2 align-middle" />}
      </h3>
      {circle.status === "forming" && (
        <p className="text-xs text-muted-foreground mb-2">Still forming. Be one of the first to hold a seat here.</p>
      )}

      <dl className="space-y-2.5 my-3">
        {circle.purpose && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Works toward</dt>
            <dd className="text-sm text-foreground">{circle.purpose}</dd>
          </div>
        )}
        {domains.length > 0 && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Decides on
            </dt>
            <dd className="text-sm text-foreground">
              <ul className="list-disc pl-4 space-y-0.5">
                {domains.slice(0, DOMAIN_CAP).map((d, i) => (
                  <li key={`${d}-${i}`}>{d}</li>
                ))}
              </ul>
              {domains.length > DOMAIN_CAP && (
                <p className="text-xs text-muted-foreground mt-1">
                  and {domains.length - DOMAIN_CAP} more, on the seats below.
                </p>
              )}
            </dd>
          </div>
        )}
        {method && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">How it decides</dt>
            <dd className="text-sm text-foreground">
              {method.label}
              {circle.decidesByGloss ? `. ${circle.decidesByGloss}` : ""}
            </dd>
          </div>
        )}
      </dl>

      <p className="text-xs text-muted-foreground mb-1">
        {seats.length} role{seats.length === 1 ? "" : "s"}, {held} of {places} seat
        {places === 1 ? "" : "s"} held
        {children.length > 0 && `, ${children.length} circle${children.length === 1 ? "" : "s"} inside`}
      </p>
      {open > 0 && (
        <p className="text-xs text-amber-700 mb-3 flex items-center gap-1.5">
          <Hand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {open} open call{open === 1 ? "" : "s"}. Tap a dashed seat to raise your hand.
        </p>
      )}

      {speaksFor.length > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {speaksFor.map((s) => s.name).join(", ")} speak
          {speaksFor.length === 1 ? "s" : ""} for this circle where it links out.
        </p>
      )}

      {seats.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-3">
          {seats.map((s: PowerSeat) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelectSeat(s.id)}
                className="w-full flex items-center gap-2 text-left text-sm py-1.5 px-2 -mx-2 rounded hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
                  <SeatGlyph
                    x={9}
                    y={9}
                    r={6}
                    state={s.state}
                    held={s.holderCount}
                    seats={s.seats}
                    holders={[]}
                    showAvatars={false}
                  />
                </svg>
                <span className="flex-1 min-w-0 truncate text-foreground">{s.name}</span>
                {s.vacant && <span className="text-[11px] text-amber-700 shrink-0">open</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
