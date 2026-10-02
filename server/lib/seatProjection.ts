/**
 * ONE SEAT, TWO DOORS: the seat object `/api/map` and `/api/org` both send.
 *
 * Both routes read the same rows (`listOrgRoles`, and `listOrgAssignments`
 * with a lapse context) and each used to write its own object literal on the
 * way out. They drifted the way two literals always do. The map carried how a
 * seat speaks for its circle, how its next holder is chosen, its term and its
 * class tags, and had no criticality or recruiting flag; `/api/org` carried
 * exactly the reverse, and its member tier could not tell an agent from a
 * person. A card drawn from either payload could only say "not written down"
 * about a field one door had simply never sent. `shared/circleView.ts` closed
 * the same defect for circles, and `shared/circleView.sources.test.ts` is what
 * holds both handlers to it; `seatProjection.test.ts` does the same here.
 *
 * WHAT DID NOT MOVE. Every key either route already sent stays, at the tier it
 * was sent at, spelled the way it was spelled: `/api/map` keeps `description`
 * for the aim, `minStage` and `vacant`; `/api/org` keeps `aim`, and its
 * editing tier keeps the seating id and the recruitment pack. A key renamed on
 * a live wire breaks every reader that has not shipped yet, so the shared
 * part is the CORE below and each route adds its own spellings to it.
 *
 * WHAT EACH DOOR GAINED, and nothing else:
 *   - `/api/map`: `criticality`, `recruiting`, `stateSource`.
 *   - `/api/org`: `representsCircle`, `howChosen`, `howChosenGloss`,
 *     `termEnds`, `archetypes` and `stateSource` (`SeatStructure`), and
 *     `isAgent` on a member-tier holder row. The route adds
 *     `village: { decidesBy }` beside `people` under the same rule.
 *
 * ── THE PRIVACY RULE FOR WHAT `/api/org` GAINED ────────────────────────────
 *
 * `/api/org` answers a stranger whatever the map module says, because the
 * pages that read it are core. `/api/map` answers a stranger only while the
 * map module is public AND `map.public_structure` is on, and that pair is the
 * village's own answer to "may a stranger see our structure" (the org export
 * keys on exactly the same pair). So a field `/api/org` gained here reaches a
 * caller only when `/api/map` would already show that same caller the same
 * field, or when the caller is at the member tier. `termEnds` is a date
 * derived from the holders' own terms, and it is never more public on
 * `/api/org` than on `/api/map`. `mapShowsStructureTo` is that rule, and
 * `orgSeatTier` is the only place it is applied.
 */
import type { ModuleLifecycle } from "../../shared/modules";
import { overrideInForce, seatState, type OrgAssignment, type OrgRole } from "./orgChart";

/**
 * The name a stranger reads for a seat an agent holds (0142).
 *
 * An agent's display name is a vendor's product name, and nothing about which
 * commercial services a village uses goes out on a public surface. A generic
 * word keeps the row consistent with the seat's own `holderCount`, which does
 * count the agent, so the two cannot disagree at the anonymous tier. The
 * client reads this literal back as "an agent holds this", so it is a
 * contract, and the test pins it.
 */
export const PUBLIC_AGENT_NAME = "An agent";

/** Where a seat's `state` came from: a hand-set override still in force, or the seatings. */
export type SeatStateSource = "declared" | "derived";

/** The seat fields that are structure on `/api/map` and are tiered on `/api/org`. */
export interface SeatStructure {
  /** 0083: this seat speaks for its circle on how it decides. */
  representsCircle: boolean;
  /** 0083: how the next holder is chosen, an id from shared/power.ts HOW_CHOSEN. */
  howChosen: string | null;
  howChosenGloss: string | null;
  /** The earliest term among the seat's live seatings, lapsed ones included. */
  termEnds: string | null;
  /**
   * The classes this seat is tagged for. A suggestion and never a permission,
   * and the same answer for every reader. Empty means every class; see the
   * note on `OrgRole.archetypes`.
   */
  archetypes: string[];
  stateSource: SeatStateSource;
}

/** What one caller may read about a seat. */
export interface SeatTier {
  /** The `SeatStructure` fields. Always true on `/api/map`, which gates its own door. */
  structure: boolean;
  /**
   * The holder rows: none; the public row, a first name and nothing else
   * (`/api/org` only); or the member row.
   */
  people: "none" | "public" | "member";
  /**
   * The editing tier: the seating id on each holder row and the recruitment
   * pack. `/api/org` only; `/api/map` never had one.
   */
  editing: boolean;
}

export interface SeatProjectionCtx {
  route: "map" | "org";
  /** One instant for the whole payload, so every seat's state and source agree. */
  now: Date;
  /** A member's first name, by user id. */
  nameOf: (userId: string) => string;
  /** The first word of a name; the server's own rule, handed in. */
  firstName: (name: string) => string;
  /** A holder's primary-character avatar. Read on the map's member tier only. */
  avatarOf?: (userId: string) => string | null;
}

/**
 * Would `GET /api/map` show this caller the seat structure today.
 *
 * The map module's gate first (`requireModule`): `off` hides it from everyone,
 * `preview` shows it to an admin, `members` to a signed-in caller, `public` to
 * anyone. Then the route's own door: a stranger is turned away unless
 * `map.public_structure` is on.
 */
export function mapShowsStructureTo(v: {
  lifecycle: ModuleLifecycle;
  publicStructure: boolean;
  signedIn: boolean;
  admin: boolean;
}): boolean {
  switch (v.lifecycle) {
    case "public":
      return v.signedIn || v.publicStructure;
    case "members":
      return v.signedIn;
    case "preview":
      return v.admin;
    default:
      return false;
  }
}

/** `/api/map`: structure always (the route has already decided to answer), holders behind map.viewPeople. */
export function mapSeatTier(viewPeople: boolean): SeatTier {
  return { structure: true, people: viewPeople ? "member" : "none", editing: false };
}

/**
 * `/api/org`'s three tiers, plus the structure rule above.
 *
 *   EDITING  admin: everything, the seating ids and the recruitment pack.
 *   MEMBER   map.viewPeople: the holder rows, focus, note and lapse state.
 *   PUBLIC   anyone while `org.public_people` is on: a first name only.
 *
 * `viewPeople` still wins, so turning the public lock on never takes the
 * people away from a member who was already entitled to them.
 */
export function orgSeatTier(v: {
  editing: boolean;
  viewPeople: boolean;
  peopleArePublic: boolean;
  mapStructure: boolean;
}): SeatTier {
  return {
    structure: v.viewPeople || v.mapStructure,
    people: v.viewPeople ? "member" : v.peopleArePublic ? "public" : "none",
    editing: v.editing,
  };
}

/** Where the seat's state came from, read by the same rule `seatState` applies. */
export function stateSource(role: OrgRole, now: Date): SeatStateSource {
  return overrideInForce(role, now) ? "declared" : "derived";
}

/**
 * The earliest term on the seat, as an ISO string, or null.
 *
 * "Live" is a seating that has not ended: a lapsed seating still counts, so a
 * seat whose only term has passed reports that past date. It is a DATE about
 * the seat, which is why it is structure and not a holder field; who the date
 * belongs to stays on the member row as `termEndsAt`.
 */
export function earliestLiveTerm(held: Array<Pick<OrgAssignment, "termEndsAt">>): string | null {
  let earliest: Date | null = null;
  for (const h of held) {
    if (h.termEndsAt && (!earliest || h.termEndsAt.getTime() < earliest.getTime())) earliest = h.termEndsAt;
  }
  return earliest ? earliest.toISOString() : null;
}

function seatStructure(role: OrgRole, held: OrgAssignment[], now: Date): SeatStructure {
  return {
    representsCircle: role.representsCircle,
    howChosen: role.howChosen,
    howChosenGloss: role.howChosenGloss,
    termEnds: earliestLiveTerm(held),
    archetypes: role.archetypes,
    stateSource: stateSource(role, now),
  };
}

/*
 * THE PUBLIC HOLDER ROW: a first name, and nothing riding along with it.
 *
 * Every other field on a holder is either a sentence somebody typed ABOUT a
 * person or a handle that resolves to them elsewhere, and this repo has
 * already paid for each one once:
 *
 *   userId       a stable id on a payload that answers anonymous callers is
 *                the exact defect `regenNameFor` was written to stop, and
 *                `buildOrgExport` refuses user ids by name.
 *   note         "Away and inactive." is the string that leaked through
 *                `/api/content/roles`, and `releaseSeatingsForUser` wipes it
 *                on departure because it restates the person.
 *   focus        `buildOrgExport` refuses it too, and the loop test asserts
 *                "mornings only" out of the anonymous tier.
 *   kind         says whether a named person has an account here.
 *   lapsed       a judgement about somebody's mandate. The seat's own `state`
 *                and `holderCount` already carry the vacancy fact at this
 *                tier, and they name nobody.
 *   isAgent      the public row says it in the name instead, below.
 *
 * `displayName` goes through `firstName()` here and does NOT at the member
 * tier. A documented holder is a real person WITHOUT an account: they never
 * signed up for anything, an admin typed their name, and this is the door
 * their full name would otherwise leave by.
 */
function publicHolder(h: OrgAssignment, ctx: SeatProjectionCtx): { name: string } {
  return {
    name: h.isAgent
      ? PUBLIC_AGENT_NAME
      : h.holderKind === "member" && h.userId
        ? ctx.nameOf(h.userId)
        : ctx.firstName(h.displayName ?? ""),
  };
}

function memberHolder(h: OrgAssignment, tier: SeatTier, ctx: SeatProjectionCtx): Record<string, unknown> {
  const row = {
    userId: h.userId,
    /*
     * The seating's own id, EDITING TIER ONLY, and on `/api/org` only.
     *
     * Without it no admin surface could address a seating, which is why
     * `DELETE /api/admin/org/seatings/:id` and its `/forget` sibling shipped
     * with a test suite and no door: a village could seat somebody and never
     * unseat them, and the right-to-be-forgotten path was reachable only by
     * curl. It stops at the editing tier because a seating id is a handle on
     * a person's record.
     */
    ...(ctx.route === "org" && tier.editing ? { assignmentId: h.id } : {}),
    // A documented holder is a real person with no account yet, so there is
    // a name to show and no profile to link to.
    name: h.holderKind === "member" && h.userId ? ctx.nameOf(h.userId) : h.displayName,
    kind: h.holderKind,
    // An agent is a documented holder, so `kind` alone reads the same for a
    // machine and for a person with no account (0142). The name on this row
    // is the agent's display name, a vendor's, so a reader must check this
    // before it prints the name as somebody's.
    isAgent: h.isAgent,
    focus: h.focus,
    // Derived: their term ran out, or the season they were seated in has
    // turned. They are still holding it.
    lapsed: !!h.lapsed,
  };
  if (ctx.route === "map") {
    return {
      ...row,
      // 0083: faces ride the same tier names do, so the anonymous map stays
      // glyphs and counts.
      avatar: h.userId ? (ctx.avatarOf?.(h.userId) ?? null) : null,
      termEndsAt: h.termEndsAt ? h.termEndsAt.toISOString() : null,
    };
  }
  return { ...row, note: h.note, lapsedReason: h.lapsedReason ?? null };
}

function projectHolders(held: OrgAssignment[], tier: SeatTier, ctx: SeatProjectionCtx): Array<Record<string, unknown>> {
  if (tier.people === "none") return [];
  if (tier.people === "public") return held.map((h) => publicHolder(h, ctx));
  return held.map((h) => memberHolder(h, tier, ctx));
}

/**
 * THE RECRUITMENT PACK, EDITING TIER ONLY. 0049 created these six columns and
 * `WRITABLE` has accepted them ever since, while `ROLE_COLS` selected none: an
 * admin could write a seat's pay reality through the API and never see it
 * again. They are readable now, and they stop here. This is the editing tier,
 * `compensationReality` is money, and the public export carries neither.
 */
function recruitmentPack(role: OrgRole) {
  return {
    authority: role.authority,
    firstYearOutcomes: role.firstYearOutcomes,
    first90DayOutcomes: role.first90DayOutcomes,
    locationExpectations: role.locationExpectations,
    compensationReality: role.compensationReality,
    evidenceRequired: role.evidenceRequired,
  };
}

/** One seat, for one caller, on one route. */
export function projectSeat(
  role: OrgRole,
  held: OrgAssignment[],
  tier: SeatTier,
  ctx: SeatProjectionCtx,
): Record<string, unknown> {
  // THE CORE both routes send, at every tier. `state` is derived, never
  // stored; `holderCount` counts every live seating, lapsed ones included.
  const core = {
    id: role.id,
    name: role.name,
    circleId: role.circleId ?? null,
    // A seat is its AIM (spelled per route below), what it DECIDES on, what it
    // answers for and WHY IT MATTERS. Each was read every request and dropped
    // by one of the two literals this replaced at some point.
    domain: role.domain ?? null,
    accountabilities: role.accountabilities ?? [],
    whyItMatters: role.whyItMatters ?? null,
    seats: role.seats,
    criticality: role.criticality,
    recruiting: role.recruiting,
    state: seatState(role, held, ctx.now),
    holderCount: held.length,
    isExample: role.isExample,
    ...(tier.structure ? seatStructure(role, held, ctx.now) : {}),
  };
  const holders = projectHolders(held, tier, ctx);
  if (ctx.route === "map") {
    return { ...core, description: role.aim ?? "", minStage: null, vacant: held.length < role.seats, holders };
  }
  return { ...core, aim: role.aim, holders, ...(tier.editing ? recruitmentPack(role) : {}) };
}

/** The active seats, each with its own live seatings, in the order the rows arrived. */
export function projectSeats(
  roles: OrgRole[],
  assignments: OrgAssignment[],
  tier: SeatTier,
  ctx: SeatProjectionCtx,
): Array<Record<string, unknown>> {
  const bySeat = new Map<string, OrgAssignment[]>();
  for (const a of assignments) {
    const list = bySeat.get(a.orgRoleId) ?? [];
    list.push(a);
    bySeat.set(a.orgRoleId, list);
  }
  return roles.filter((r) => r.active).map((r) => projectSeat(r, bySeat.get(r.id) ?? [], tier, ctx));
}
