/**
 * The power map's client-side data shapes (0083): what /api/map now serves,
 * written once here so ten components read one contract.
 */

export interface PowerGlossaryEntry {
  id: string;
  label: string;
  gloss: string;
  spectrum?: number;
}

export interface PowerBlock {
  shape: string | null;
  shapeGloss: string | null;
  decidesBy: string | null;
  decidesByGloss: string | null;
  glossary: {
    shapes: PowerGlossaryEntry[];
    decidesBy: PowerGlossaryEntry[];
    domains: PowerGlossaryEntry[];
    howChosen: PowerGlossaryEntry[];
  };
}

export interface PowerHolder {
  userId: string | null;
  name: string | null;
  kind?: "member" | "documented";
  /**
   * A software agent holds this seat (0142). SEPARATE FROM `kind` and not a
   * third value in it: an agent IS a documented holder, and modelling it as a
   * third enum member would have meant a live enum ALTER, which this platform
   * names as its forbidden migration class. So `kind` says what the seating
   * is and this says what the holder is.
   */
  isAgent?: boolean;
  focus?: string | null;
  lapsed?: boolean;
  avatar?: string | null;
  termEndsAt?: string | null;
}

export type SeatStateWord = "open" | "filled" | "partial" | "forming" | "expired";

export interface PowerSeat {
  id: string;
  name: string;
  /** The seat's AIM: what it works toward. */
  description: string;
  /** The seat's DOMAIN: what it decides on. Sociocracy's other half. */
  domain?: string | null;
  /** What this seat is answerable for. */
  accountabilities?: string[];
  /**
   * Why the village bothers having this seat at all.
   *
   * The one field of the four that answers "should I care about this",
   * rather than "what does it do". All 25 of Amora's seats carry one, and it
   * spent a release off the `/api/map` wire because nothing read it, which is
   * how a written answer becomes an unwritten one.
   */
  whyItMatters?: string | null;
  circleId: string | null;
  seats: number;
  holderCount: number;
  vacant: boolean;
  state?: SeatStateWord;
  isExample?: boolean;
  representsCircle?: boolean;
  howChosen?: string | null;
  howChosenGloss?: string | null;
  /** Earliest live term on the seat, ISO. Structure tier: a date, no name. */
  termEnds?: string | null;
  holders: PowerHolder[];
}

export interface PowerCircle {
  id: string;
  name: string;
  purpose?: string | null;
  parentCircleId?: string | null;
  status?: string;
  order?: number;
  color?: string | null;
  isExample?: boolean;
  decidesBy?: string | null;
  decidesByGloss?: string | null;
  decidesByDomains?: Record<string, { method: string; gloss?: string }> | null;
}

export interface PowerRelationType {
  id: string;
  label: string;
  inverseLabel: string;
  symmetric: boolean;
  isCover: boolean;
}

export interface PowerRelation {
  id: string;
  typeId: string;
  fromKind: "org_role" | "circle";
  fromId: string;
  toKind: "org_role" | "circle";
  toId: string;
}

export interface PowerData {
  circles: PowerCircle[];
  roles: PowerSeat[];
  quests: Array<{ id: string; title: string; circleId: string | null; isExample?: boolean }>;
  power: PowerBlock;
  relationTypes: PowerRelationType[];
  relations: PowerRelation[];
  season: { current: { id?: string; name?: string } | null; nextRollAt: string | null };
  viewer: {
    viewPeople: boolean;
    canContact: boolean;
    mayDeclare?: string[];
    /** Arrange mode: this reader may drag circles into each other (0208). */
    mayArrange?: boolean;
    /*
     * THE THREE MAP EDITORS, and why there are three of them reading one
     * source. The reasoning lives here rather than beside the fields in
     * server/index.ts because that file's ratchet may only ever turn down,
     * comments included, and this is where the payload's shape is already
     * written once for ten components to read.
     *
     * Styling the map, writing the newcomer's walk and naming its paths and
     * waters move off the admin page onto /map. They are three flags and not
     * one because they are three different claims: the day a village
     * delegates any one of them, the payload already has somewhere to say so,
     * with no re-plumbing.
     *
     * All three read `admin` on the server, and that is the point rather than
     * a shortcut. Every endpoint behind them is gated by isAdmin and nothing
     * else (PUT /api/admin/brand, and /api/admin/map/walk and
     * /api/admin/map/vocabulary in server/routes/mapScene.ts), and
     * shared/capabilities.ts holds no key about style, brand, look or
     * identity. Gating them on the nearest existing key instead, because a
     * panel leaving the admin page has to be gated by SOMETHING, would have
     * handed styling to every holder of `map.edit` and the walk to every
     * holder of `story.tell`. So these move WHERE the panels live and never
     * WHO may use them; delegation is its own decision, per panel, later.
     *
     * Optional because a deployment serving an older payload has no opinion,
     * and absent must read as "no", never as "yes". The server is the
     * authority and re-checks on every write; these only decide whether the
     * editing chrome is drawn at all, which is the rule the sibling surface
     * already follows: a reader who may not edit sees no editor rather than a
     * disabled one.
     */
    mayStyleMap?: boolean;
    mayEditWalk?: boolean;
    mayNameMapThings?: boolean;
  };
  vacantHighlight: boolean;
  conciergeEnabled: boolean;
}

export type Selection = { kind: "circle" | "role"; id: string } | null;

export interface Filters {
  open: boolean;
  mine: boolean;
  expiring: boolean;
  /** One circle id, or null. */
  circle: string | null;
  /** Seats this holder key (userId or name) holds, or null. */
  person: string | null;
}

export const NO_FILTERS: Filters = { open: false, mine: false, expiring: false, circle: null, person: null };

export function anyFilterOn(f: Filters): boolean {
  return f.open || f.mine || f.expiring || f.circle !== null || f.person !== null;
}

/** Days until an ISO date, floored; negative when it has passed. */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / 86400000);
}

/** The amber window (spec 9): a term inside 30 days reads as ending soon. */
export function termEndingSoon(iso: string | null | undefined, now = new Date()): boolean {
  const d = daysUntil(iso, now);
  return d !== null && d >= 0 && d <= 30;
}

/** Does a seat pass the active filters? Pure, so the accordion and the SVG
 *  dim exactly the same seats. */
export function seatPassesFilters(
  seat: PowerSeat,
  f: Filters,
  viewerUserId: string | null,
  now = new Date(),
): boolean {
  if (f.open && !(seat.state === "open" || seat.state === "partial")) return false;
  if (f.expiring && !(seat.state === "expired" || termEndingSoon(seat.termEnds, now))) return false;
  if (f.circle && seat.circleId !== f.circle) return false;
  if (f.mine) {
    if (!viewerUserId) return false;
    if (!seat.holders.some((h) => h.userId === viewerUserId)) return false;
  }
  if (f.person) {
    if (!seat.holders.some((h) => (h.userId ?? h.name ?? "") === f.person)) return false;
  }
  return true;
}
