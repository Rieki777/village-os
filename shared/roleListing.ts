/**
 * LISTING: which roles a visitor or a member may discover (role journey PR-A,
 * Rye 9 Nov 2026: only confirmed roles are listed).
 *
 * `listed` is a nullable column. NULL reads as listed, so a village that has
 * never touched it changes nothing on deploy. Only an explicit 0 hides a role.
 * An unlisted role still exists: its holders keep it, history keeps it, and a
 * steward or admin sees it with a "Not listed" chip. It is absent from every
 * discovery surface: /api/org, /api/map, the open form, the draft board,
 * Circles, "Roles that fit", the map card and /roles.
 *
 * Pure: shared by the server projection and every client surface.
 */

export const LISTING_WORDS = {
  chip: "Not listed",
  chipHint: "Only holders, stewards and admins can see this role. It is left out of every list a visitor or member browses.",
  startUnlistedLabel: "Roles accepted from a sync start unlisted",
  startUnlistedHelp:
    "On, a role that arrives from a sync and is accepted starts unlisted, and a steward lists it once its card is ready. Off, accepted roles are listed at once.",
  listOnly: "List only these",
  listOnlyHelp: "Lists the roles you tick and unlists every other role. The roles listed before are kept, so you can put them back.",
  undo: "Put the earlier listing back",
} as const;

/** NULL and absent read as listed. Only an explicit false hides a role. */
export function isListed(role: { listed?: boolean | null } | null | undefined): boolean {
  return role?.listed !== false;
}

/**
 * Whether a role is left in a list for one reader.
 * Stewards and admins see every role. A holder sees their own roles.
 * Everyone else sees listed roles only.
 */
export function visibleTo(
  role: { id: string; listed?: boolean | null },
  viewer: { seesUnlisted: boolean; ownRoleIds?: ReadonlySet<string> | readonly string[] },
): boolean {
  if (isListed(role) || viewer.seesUnlisted) return true;
  const own = viewer.ownRoleIds;
  if (!own) return false;
  return Array.isArray(own) ? own.includes(role.id) : (own as ReadonlySet<string>).has(role.id);
}

/**
 * A circle with no listed role is left off the public circles list.
 * A circle that holds no role at all is not a circle awaiting confirmation, so
 * it stays: only a circle whose roles are all unlisted goes.
 */
export function circleHasListedRole(
  circleId: string,
  roles: ReadonlyArray<{ circleId?: string | null; listed?: boolean | null; active?: boolean }>,
): boolean {
  let any = false;
  for (const r of roles) {
    if (r.circleId !== circleId || r.active === false) continue;
    any = true;
    if (isListed(r)) return true;
  }
  return !any;
}

/** A circle with at least one live, listed role. */
function circleListsARole(
  circleId: string,
  roles: ReadonlyArray<{ circleId?: string | null; listed?: boolean | null; active?: boolean }>,
): boolean {
  return roles.some((r) => r.circleId === circleId && r.active !== false && isListed(r));
}

/** A role "invites" applications: a free place not forming, a declared open state, or recruiting. */
const OPEN_STATES = new Set(["open", "partial", "expired"]);
export function invitesApplications(r: { seats: number; held: number; state: string; recruiting: boolean }): boolean {
  const openPlaces = Math.max(0, r.seats - r.held);
  return (openPlaces > 0 && r.state !== "forming") || OPEN_STATES.has(r.state) || r.recruiting === true;
}

export interface ListingBefore {
  id: string;
  /** What the role read as before: true listed (or never set), false unlisted. */
  listed: boolean;
}

export interface ListOnlyPlan {
  /** Ids to write as listed. */
  list: string[];
  /** Ids to write as unlisted. */
  unlist: string[];
  /** What each role read as before, for putting it back. */
  before: ListingBefore[];
}

/** "List only these": the named roles listed, every other role unlisted, with the earlier state kept. */
export function planListOnly(
  roles: ReadonlyArray<{ id: string; listed?: boolean | null }>,
  keep: readonly string[],
): ListOnlyPlan {
  const keepSet = new Set(keep);
  const list: string[] = [];
  const unlist: string[] = [];
  const before: ListingBefore[] = [];
  for (const r of roles) {
    before.push({ id: r.id, listed: isListed(r) });
    (keepSet.has(r.id) ? list : unlist).push(r.id);
  }
  return { list, unlist, before };
}

/** The stored record of one "List only these" run. */
export interface ListingRecord {
  at: string;
  kept: string[];
  before: ListingBefore[];
  /** Set when this run was put back. */
  undoneAt?: string | null;
}

/** What one reader may see of unlisted roles. */
export interface ListingViewer {
  seesUnlisted: boolean;
  ownRoleIds?: ReadonlySet<string>;
}

/** The roles a person holds now, by role id. */
export function ownRoleIdsOf(
  assignments: ReadonlyArray<{ orgRoleId: string; userId?: string | null; endedAt?: unknown }>,
  userId: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!userId) return out;
  for (const a of assignments) if (a.userId === userId && !a.endedAt) out.add(a.orgRoleId);
  return out;
}

/**
 * The circles a reader sees. A circle stays when it has a listed role, when it
 * has no role at all, or when a circle beneath it stays (so the tree keeps its
 * parents). A viewer who sees unlisted roles sees every circle.
 */
export function circlesToShow<C extends { id: string; parentCircleId?: string | null }>(
  circles: readonly C[],
  roles: ReadonlyArray<{ circleId?: string | null; listed?: boolean | null; active?: boolean }>,
  viewer: ListingViewer,
): C[] {
  if (viewer.seesUnlisted) return [...circles];
  // A CURATING VILLAGE shows only what it listed (phase A, verify 2.2). Once any live role is
  // unlisted, the village has said what a visitor may find, and a circle holding no listed role
  // goes too, an empty or projected one included. Before, "List only these" hid every role but
  // left eleven projected circles on /api/org and the map, which read as the projected roles
  // still being public. A village that has never unlisted a role keeps its empty circles.
  const curating = roles.some((r) => r.active !== false && !isListed(r));
  const keep = new Set<string>();
  for (const c of circles) if (curating ? circleListsARole(c.id, roles) : circleHasListedRole(c.id, roles)) keep.add(c.id);
  const byId = new Map(circles.map((c) => [c.id, c]));
  for (const id of Array.from(keep)) {
    let up = byId.get(id)?.parentCircleId ?? null;
    const seen = new Set<string>();
    while (up && !seen.has(up)) {
      seen.add(up);
      keep.add(up);
      up = byId.get(up)?.parentCircleId ?? null;
    }
  }
  return circles.filter((c) => keep.has(c.id));
}

export const LISTING_RECORDS_MAX = 20;

/** Keeps the newest records only. */
export function pushRecord(records: readonly ListingRecord[], next: ListingRecord): ListingRecord[] {
  return [...records, next].slice(-LISTING_RECORDS_MAX);
}
