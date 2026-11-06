/**
 * ADMIN ACCESS THROUGH A POWER GROUP (sheet 19; Rye, 2026-10-31: "admin access
 * only, for Founders Circle and steward roles").
 *
 * A power group (the `roles` table, Admin > Power groups) may carry admin
 * access (`roles.grants_admin`, 0307). Whoever holds that group, in a holding
 * whose term has not run out, may open the admin panel. It is read here, live,
 * from the same two caches the capability gate reads (`loadRoles`,
 * `loadRoleHolders`), on every request: the access ends the moment the holding
 * ends or lapses, and nothing is ever written to a member's account to say so.
 * A stored flag would outlive the holding that justified it.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 *
 * It is admin ACCESS, the door `isAdmin` guards, and nothing more. The
 * capability gate's admin short-circuit (`capabilityCtx().isAdmin`) still reads
 * the account's own role, so a group never hands anybody a decide power or the
 * veto it does not already grant through its own capabilities, and the
 * break-glass still needs a founder seated with `steward.veto`. One source:
 * the org seat named "steward" carries no switch of its own (coordinator,
 * 2026-11-01), because the Steward Circle group is what the ruling's
 * "steward roles" means.
 *
 * Standing examples are inert here as everywhere: an example group grants
 * nothing, and an example account is never counted as a way in.
 */

/** A power group, as far as this file reads one. */
export interface AdminGroup {
  id: string;
  name: string;
  grantsAdmin?: boolean;
  isExample?: boolean;
}

/** One holding of a power group. */
export interface GroupHolding {
  roleId: string;
  userId: string;
  termEndsAt?: string | Date | null;
}

export type HoldingLapsed = (h: GroupHolding, now: Date) => boolean;

/** The account roles that reach the panel on their own. Kept beside `adminReaches` in server/index.ts. */
const ACCOUNT_ADMIN = new Set(["admin", "founder"]);

/** The groups that give this member admin access right now, in the groups' own order. */
export function adminGroupsOf(
  userId: string,
  groups: readonly AdminGroup[],
  holdings: readonly GroupHolding[],
  now: Date,
  lapsed: HoldingLapsed,
): AdminGroup[] {
  const live = new Set(
    holdings.filter((h) => h.userId === userId && !lapsed(h, now)).map((h) => h.roleId),
  );
  return groups.filter((g) => g.grantsAdmin === true && g.isExample !== true && live.has(g.id));
}

/** Whether this account can open the admin panel: its own role, or a live admin group. */
export function hasAdminReach(
  user: { id: string; role?: unknown },
  groups: readonly AdminGroup[],
  holdings: readonly GroupHolding[],
  now: Date,
  lapsed: HoldingLapsed,
): boolean {
  return ACCOUNT_ADMIN.has(String(user.role ?? "")) || adminGroupsOf(user.id, groups, holdings, now, lapsed).length > 0;
}

/**
 * Every account that can open the admin panel, examples excluded, on the
 * groups and holdings as given. The last-admin guard asks it about the state a
 * change WOULD leave, so it takes them as arguments and never reads a cache.
 */
export function accountsWithReach<U extends { id: string; role?: unknown }>(
  users: readonly U[],
  groups: readonly AdminGroup[],
  holdings: readonly GroupHolding[],
  now: Date,
  lapsed: HoldingLapsed,
  isExample: (u: U) => boolean,
): U[] {
  return users.filter((u) => !isExample(u) && hasAdminReach(u, groups, holdings, now, lapsed));
}

/** The refusal when a change would leave nobody able to open the panel. */
export const LAST_ADMIN_REFUSAL =
  "That would leave nobody able to open the admin panel. Give somebody else admin access first.";
