/**
 * THE ADDRESS THAT OPENS "APPLY FOR A SEAT" WITH SEVERAL SEATS PICKED.
 *
 * A seat card's door picks one seat (`proposeTermsHref`, `?seat=<id>`). The
 * character page lets a member pick up to five seats that fit their character
 * and propose them in one application, so the wizard's start reads a LIST:
 * the `seat` parameter repeated, `?seat=a&seat=b`, or one `seats=a,b,c`. The
 * builder writes the repeated form, which an older reader still opens on the
 * first seat.
 *
 * NOTHING HERE DECIDES WHAT MAY BE APPLIED FOR. The list is handed to the
 * wizard as it came, in order and without repeats. The seats step judges it
 * with the rules it already has: more than five is refused by `seatsProblem`
 * in the field's own words, and a full seat is taken off the list and named
 * by `SeatPicksField`. A link is a suggestion; the step is the judge.
 */
import { MAX_SEATS } from "./seatApplications";

/**
 * At most this many ids are read from one address. Twice and more the five an
 * application holds, so a link one over the limit still reaches the step that
 * says so, and a crafted address cannot draw hundreds of rows.
 */
export const MAX_SEATS_IN_LINK = MAX_SEATS * 4;

/** The seat ids an address names, in order, without repeats or blanks. */
export function seatsFromSearch(search: string | URLSearchParams): string[] {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  // In the order the address names them, whichever spelling each one used.
  const raw: string[] = [];
  q.forEach((v, k) => {
    if (k === "seat") raw.push(v);
    else if (k === "seats") raw.push(...v.split(","));
  });
  const out: string[] = [];
  for (const r of raw) {
    const id = r.trim();
    if (!id || id.length > 128 || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_SEATS_IN_LINK) break;
  }
  return out;
}

/** Where "Propose these" goes: the wizard on "Apply for a seat" with every picked seat. */
export function applySeatsHref(seatIds: readonly string[], opts: { seasonId?: string | null } = {}): string {
  const q = new URLSearchParams({ type: "role_application" });
  for (const id of seatIds) {
    const s = String(id ?? "").trim();
    if (s) q.append("seat", s);
  }
  if (opts.seasonId) q.set("season", opts.seasonId);
  return `/propose?${q.toString()}`;
}
