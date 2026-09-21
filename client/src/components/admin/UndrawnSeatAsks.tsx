/**
 * THE ASKS WHOSE SEAT HAS NO CARD ON THE ORG CHART.
 *
 * The org chart draws the steward's queue on the seat it belongs to, inside
 * the seat's card, and it draws a card only for a seat inside a circle it is
 * drawing. A member is offered every seat recorded under their name wherever
 * it sits (`GET /api/org/my-unclaimed-seats`), so a member could ask for a
 * seat the steward had no card for. The ask was filed, `GET /api/org/seat-claims`
 * returned it, and the page drew no control for it: an ask nobody could
 * answer, waiting forever on a decision nobody was shown. Found in a local QA
 * pass on 2026-09-21 and counted by accessible name: one Confirm on the page
 * while two asks were open.
 *
 * TWO WAYS A SEAT HAS NO CARD, and this does not enumerate them. It sits in no
 * circle, and the chart names it only in its amber "Seats with no circle"
 * notice. Or its circle is not one the chart draws, which is the more invisible
 * of the two: it is grouped under an id nothing renders, and it is not
 * circle-less either, so the amber notice never names it. Any ask whose seat
 * is not in `drawnSeatIds` lands here, whatever the reason, including reasons
 * nobody has thought of yet.
 *
 * `drawnSeatIds` COMES FROM THE CHART, never from here. OrgChartTab works it
 * out from the same map its cards read, so the two cannot disagree about which
 * seats are on the page. A second copy of the rule in this file would be one
 * that drifts.
 *
 * ONE GROUP PER SEAT, under the seat's name. `SeatClaimAsks` takes the asks for
 * one seat and says "this seat", which on a card means the heading above it.
 * Grouping keeps that true here too, and keeps the component's own contract.
 *
 * Nothing draws on the many days no such ask exists.
 */
import { SeatClaimAsks, type SeatClaimAsk, type SeatClaimAsksProps } from "./SeatClaimAsks";

export interface UndrawnSeatAsksProps {
  /** Every open ask the steward can answer. The ones with a card are skipped. */
  asks: SeatClaimAsk[];
  /** The seats the org chart drew a card for, as it worked them out. */
  drawnSeatIds: ReadonlySet<string>;
  /** Every seat on the chart, so a seat with no card can say why it has none. */
  roles: ReadonlyArray<{ id: string | number; circleId?: string | number | null }>;
  /** The circles the chart draws. */
  circles: ReadonlyArray<{ id: string | number }>;
  call: SeatClaimAsksProps["call"];
  onDone: SeatClaimAsksProps["onDone"];
}

export function UndrawnSeatAsks({ asks, drawnSeatIds, roles, circles, call, onDone }: UndrawnSeatAsksProps) {
  const bySeat = new Map<string, SeatClaimAsk[]>();
  for (const a of asks) {
    const seat = String(a.roleId);
    if (drawnSeatIds.has(seat)) continue;
    bySeat.set(seat, [...(bySeat.get(seat) ?? []), a]);
  }
  if (!bySeat.size) return null;

  const roleById = new Map(roles.map((r) => [String(r.id), r]));
  const drawnCircleIds = new Set(circles.map((c) => String(c.id)));
  const whyNoCard = (seat: string): string => {
    const r = roleById.get(seat);
    if (!r) return "This seat is no longer on the chart.";
    if (r.circleId == null || r.circleId === "") return "In no circle yet.";
    return drawnCircleIds.has(String(r.circleId)) ? "" : "Its circle is not on this page.";
  };

  return (
    <section aria-labelledby="undrawn-asks-h" className="bg-white border border-amber-300 rounded-xl p-4 mb-6">
      <h3 id="undrawn-asks-h" className="font-semibold text-gray-900 text-sm">Asks for seats not drawn below</h3>
      <p className="text-xs text-gray-600 mt-0.5">
        These seats sit outside every circle on this page, so their asks have no card to appear on. Answer them here.
      </p>
      <div className="mt-3 space-y-4">
        {Array.from(bySeat, ([seat, seatAsks]) => (
          <div key={seat}>
            <p className="text-sm font-medium text-gray-900">{seatAsks[0].roleName}</p>
            <p className="text-[11px] text-gray-600">{whyNoCard(seat)}</p>
            <SeatClaimAsks asks={seatAsks} call={call} onDone={onDone} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default UndrawnSeatAsks;
