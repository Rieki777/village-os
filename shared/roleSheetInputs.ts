/**
 * FOUR PAYLOADS, ONE CARD: every seat a card can draw, read into `SeatInput`.
 *
 * `/api/map` (PowerSeat), `/api/org` (its three tiers), `/api/roles` (a
 * permission role) and a proposed seat out of `normaliseProposedSeat` all
 * describe a role, each in its own spelling and each at its own tier. These
 * functions are the only place those spellings are read, so the view model in
 * `shared/roleSheet.ts` sees one shape. `seasonForSheet` does the same for the
 * season the card's clock reads, so no two hosts spell that mapping twice.
 *
 * INPUTS ARE `any` ON PURPOSE, as `shared/circleView.ts` argues for its own:
 * the caller holds a JSON payload, and the RETURN is the typed thing.
 *
 * THE ONE RULE THAT MATTERS HERE: A KEY THE PAYLOAD DID NOT SEND IS UNREAD.
 * `has(o, k)` decides it, never truthiness. `howChosen: null` is a seat whose
 * next holder is not written down; a payload with no `howChosen` key at all is
 * a tier (or a deploy) that does not carry it, and the card must not say "not
 * written down" about something it was never sent.
 */
import type { RoleInput } from "./permissionSheet";
import { isSeatState, SHEET_WORDS, type SeatHolderIn, type SeatInput, type SheetContext } from "./roleSheet";

/**
 * The name `/api/org`'s public tier sends for a seat an agent holds. It is the
 * server's own literal (`PUBLIC_AGENT_NAME`, server/lib/seatProjection.ts), and
 * `roleSheet.test.ts` pins the two together. On a row that carries nothing but
 * a name, this is the only way the card can know a machine holds the seat.
 */
export const PUBLIC_AGENT_NAME = "An agent";

const has = (o: unknown, k: string): boolean =>
  !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

/** Text or a number, trimmed; null for anything else or for blank. */
const str = (v: unknown): string | null => {
  if (typeof v !== "string" && !(typeof v === "number" && Number.isFinite(v))) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => x !== null) : [];

/** A whole number of at least `min`, or the fallback. */
const whole = (v: unknown, fallback: number, min = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};

const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** A circle as either payload serves it (both go through `circleView`). */
function circleIn(c: any): SeatInput["circle"] {
  if (!c || typeof c !== "object") return null;
  return { id: String(c.id ?? ""), name: String(c.name ?? ""), decidesBy: str(c.decidesBy), color: str(c.color) };
}

function holderIn(h: any, opts: { literalAgent: boolean }): SeatHolderIn {
  const name = str(h?.name);
  // A row that carries nothing but a name is `/api/org`'s public tier. There
  // the server writes the literal in place of an agent's vendor name.
  const publicRow = opts.literalAgent && !has(h, "kind") && !has(h, "userId");
  return {
    name,
    userId: typeof h?.userId === "string" && h.userId ? h.userId : null,
    kind: h?.kind === "member" || h?.kind === "documented" ? h.kind : undefined,
    isAgent: bool(h?.isAgent) ?? (publicRow && name === PUBLIC_AGENT_NAME ? true : undefined),
    focus: has(h, "focus") ? str(h.focus) : undefined,
    lapsed: bool(h?.lapsed),
    avatar: typeof h?.avatar === "string" && h.avatar ? h.avatar : null,
    termEndsAt: typeof h?.termEndsAt === "string" && h.termEndsAt ? h.termEndsAt : null,
  };
}

/** The fields both seat payloads spell the same way, each unread when absent. */
function sharedSeatFields(seat: any): Pick<
  SeatInput,
  | "id"
  | "name"
  | "isExample"
  | "domain"
  | "accountabilities"
  | "whyItMatters"
  | "seats"
  | "state"
  | "stateSource"
  | "criticality"
  | "recruiting"
  | "representsCircle"
  | "howChosen"
  | "howChosenGloss"
  | "termEnds"
  | "archetypes"
> {
  const crit = seat?.criticality;
  const src = seat?.stateSource;
  return {
    id: String(seat?.id ?? ""),
    name: String(seat?.name ?? ""),
    isExample: !!seat?.isExample,
    domain: str(seat?.domain),
    accountabilities: strList(seat?.accountabilities),
    whyItMatters: str(seat?.whyItMatters),
    seats: whole(seat?.seats, 1),
    state: isSeatState(seat?.state) ? seat.state : null,
    stateSource: has(seat, "stateSource") && (src === "declared" || src === "derived") ? src : undefined,
    criticality: has(seat, "criticality") && (crit === "high" || crit === "normal") ? crit : undefined,
    recruiting: has(seat, "recruiting") ? bool(seat.recruiting) : undefined,
    representsCircle: has(seat, "representsCircle") ? bool(seat.representsCircle) : undefined,
    howChosen: has(seat, "howChosen") ? str(seat.howChosen) : undefined,
    howChosenGloss: has(seat, "howChosenGloss") ? str(seat.howChosenGloss) : undefined,
    termEnds: has(seat, "termEnds") ? str(seat.termEnds) : undefined,
    archetypes: has(seat, "archetypes") ? strList(seat.archetypes) : undefined,
  };
}

/**
 * A `/api/map` seat. The map always serves its structure; the holder rows ride
 * `viewer.viewPeople`. `signedIn` is the host's (`!!authToken()`), since the
 * map payload does not say.
 */
export function fromMapSeat(seat: any, data: any, opts: { signedIn: boolean }): SeatInput {
  const holders: any[] = Array.isArray(seat?.holders) ? seat.holders : [];
  const circles: any[] = Array.isArray(data?.circles) ? data.circles : [];
  return {
    mode: "seat",
    ...sharedSeatFields(seat),
    circle: circleIn(circles.find((c) => c?.id === seat?.circleId)),
    circleNameOnly: null,
    // The map spells the aim `description`, and sends "" for none.
    aim: str(seat?.description),
    holderCount: whole(seat?.holderCount, holders.length),
    villageDecidesBy: has(data?.power, "decidesBy") ? str(data.power.decidesBy) : undefined,
    holders: holders.map((h) => holderIn(h, { literalAgent: false })),
    namesServed: !!data?.viewer?.viewPeople,
    signedIn: opts.signedIn,
    offers: { raiseHand: true, contact: true },
  };
}

/**
 * A `/api/org` row. Its structure fields arrive only where the map would show
 * the same caller the same fields (server/lib/seatProjection.ts), so on a
 * stranger's page they are absent and read as unread here. `village` is absent
 * at that tier too, and before the projection shipped.
 *
 * `raiseHand` is the host's: whether the map module is on for this viewer. The
 * contact relay is the map's alone and is never offered from `/api/org`.
 */
export function fromOrgSeat(
  row: any,
  circles: any[] | null | undefined,
  people: any,
  village: any,
  opts: { raiseHand?: boolean } = {},
): SeatInput {
  const holders: any[] = Array.isArray(row?.holders) ? row.holders : [];
  const list: any[] = Array.isArray(circles) ? circles : [];
  return {
    mode: "seat",
    ...sharedSeatFields(row),
    circle: circleIn(list.find((c) => c?.id === row?.circleId)),
    circleNameOnly: null,
    aim: str(row?.aim),
    holderCount: whole(row?.holderCount, holders.length),
    villageDecidesBy: has(village, "decidesBy") ? str(village.decidesBy) : undefined,
    holders: holders.map((h) => holderIn(h, { literalAgent: true })),
    namesServed: !!people?.visible,
    signedIn: !!people?.signedIn,
    offers: { raiseHand: !!opts.raiseHand, contact: false },
  };
}

/**
 * `/api/season` (the client's `useSeason()`), read into the card's clock.
 *
 * Null while the read has not landed or failed: the card then prints no clock
 * at all, never a 0. A season with no end date (`openEnded`) arrives with
 * `daysLeft: null`, which the view model also reads as "no clock".
 */
export function seasonForSheet(state: any): SheetContext["season"] {
  if (!state || typeof state !== "object") return null;
  const current = state.current && typeof state.current === "object" ? state.current : null;
  const days = state.daysLeft;
  return {
    name: str(current?.name),
    endsOn: str(current?.endsOn),
    daysLeft: typeof days === "number" && Number.isFinite(days) ? days : null,
  };
}

/** A permission role from `/api/roles`. Names ride `map.viewPeople` there. */
export function fromPermissionRole(role: any, opts: { signedIn?: boolean } = {}): RoleInput {
  const holders: any[] = Array.isArray(role?.holders) ? role.holders : [];
  const holderCount = whole(role?.holderCount, holders.length);
  return {
    id: String(role?.id ?? ""),
    name: String(role?.name ?? ""),
    description: str(role?.description),
    capabilities: strList(role?.capabilities),
    minStage: str(role?.minStage),
    isExample: !!role?.isExample,
    seats: whole(role?.seats, 1),
    holderCount,
    holders: holders.map((h) => ({ name: str(h?.name), userId: typeof h?.userId === "string" ? h.userId : null })),
    // The payload has no flag for it: names are served when the rows are.
    namesServed: holders.length > 0 || holderCount === 0,
    signedIn: !!opts.signedIn,
  };
}

/**
 * A proposed seat, AFTER `normaliseProposedSeat` (shared/proposedSeats.ts), so
 * the preview reads vendor aliases exactly the way accepting publishes them.
 * Takes the normalised result or its `payload`.
 *
 * Nothing is seated and nothing is decided, so the holders, state, term, next
 * holder and way of deciding are all unread. A circle the proposal names but
 * this page has not placed is shown by name; one given by id is named from
 * `circles` when the host has them.
 */
export function fromProposedSeat(norm: any, opts: { circles?: any[] } = {}): SeatInput {
  const p: any = norm && typeof norm === "object" && has(norm, "payload") ? norm.payload : norm;
  const crit = p?.criticality;
  const byId = str(p?.circleId) ? (opts.circles ?? []).find((c) => c?.id === p.circleId) : null;
  const name = str(p?.name);
  return {
    mode: "proposal",
    id: `proposed:${name ?? ""}`,
    name: name ?? SHEET_WORDS.seatNeedsAName,
    isExample: false,
    circle: null,
    circleNameOnly: str(p?.circleName) ?? str(byId?.name),
    aim: str(p?.aim),
    domain: str(p?.domain),
    accountabilities: strList(p?.accountabilities),
    whyItMatters: str(p?.whyItMatters),
    seats: whole(p?.seats, 1, 1),
    holderCount: null,
    state: null,
    stateSource: undefined,
    criticality: crit === "high" || crit === "normal" ? crit : undefined,
    recruiting: bool(p?.recruiting),
    representsCircle: undefined,
    howChosen: undefined,
    howChosenGloss: undefined,
    termEnds: undefined,
    archetypes: undefined,
    villageDecidesBy: undefined,
    holders: [],
    namesServed: false,
    signedIn: true,
    offers: { raiseHand: false, contact: false },
  };
}
