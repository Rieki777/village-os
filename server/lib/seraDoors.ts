/**
 * WHO DECIDES WHAT WAITS FROM THE OUTSIDE SERVICE, AND WHO SETS PAY, as
 * members are shown it on the count (review S2; the coordinator's ruling N2 of
 * 2026-11-06).
 *
 * MEMBERS SEE NO MORE THAN THE PUBLIC POWERS VIEW. The holders are the ones
 * `villagePowerRows` names for `/api/village/powers`: role held, lapsed terms
 * filtered, example users dropped, the role named the same way, and badge
 * denies NOT applied. A deny-aware list beside that deny-blind one would tell
 * any member whose power sits under a warning badge, which `badges.ts` hides on
 * purpose. The publish door itself stays deny-aware (`holderMayPublish`); this
 * is display only, and a test holds the two views equal.
 *
 * Launch still decides the empty case: before a launch vote has carried the
 * admin panel holds the door (alone, or beside the role holders), and after it
 * a door open to nobody is the village's vote.
 *
 * The answer carries role names and holders' first names only (`roleWithHolders`).
 */
import type { Pool } from "mysql2/promise";
import { roleWithHolders } from "../../shared/roleHolderLabel";
import type { Door } from "../../shared/seraDecides";
import { launchedByVote } from "./orgDraftDecide";
import { rolesCarryingCapability } from "./roleGrants";
import { holdingHasLapsed } from "./stewardship";
import { isExampleUser } from "./examples";

/** The steward seat's reserved role id (server/lib/capabilityHolding.ts). Its holders read as "the stewards". */
const STEWARD_ROLE = "steward";
/** At most this many roles are named; the rest are counted. */
export const DOOR_ROLE_CAP = 3;

export interface DoorInput {
  capability: string;
  /** Every role this village defines, with its powers (the public view's `groups`). */
  roles: ReadonlyArray<{ id: unknown; name?: unknown; capabilities?: unknown; isExample?: unknown }>;
  /** Who sits in which role, with terms (the public view's `holdings`). */
  holdings: ReadonlyArray<{ roleId: string; userId: string; termEndsAt?: string | Date | null; viaOrgRoleId?: string }>;
  /** A member's full name, or null for an example user or a tombstone, who are never named. */
  nameOf: (userId: string) => string | null;
  /** A chart role's name, for a holding that came through a seat. */
  orgRoleName: (id: string) => string | undefined;
  /** The role the village holds this power through, when it does. */
  villageHolder: { roleId: string; roleName: string } | null;
  now?: Date;
}

/** The holders the public powers view names for this power, each with the role it names them under. */
export function doorHolders(input: DoorInput): Array<{ roleId: string; role: string; userId: string }> {
  const now = input.now ?? new Date();
  const live = input.holdings.filter((h) => !holdingHasLapsed(h, now) && input.nameOf(String(h.userId)) !== null);
  if (input.villageHolder) {
    const held = input.villageHolder;
    return live.filter((h) => h.roleId === held.roleId).map((h) => ({ roleId: h.roleId, role: held.roleName, userId: String(h.userId) }));
  }
  const groupName = new Map(input.roles.map((g) => [String(g.id), String(g.name ?? g.id)]));
  const carrying = new Set(rolesCarryingCapability(input.roles, input.capability).map((r) => r.id));
  const out: Array<{ roleId: string; role: string; userId: string }> = [];
  const seen = new Set<string>();
  for (const h of live) {
    if (!carrying.has(h.roleId)) continue;
    const role = (h.viaOrgRoleId && input.orgRoleName(h.viaOrgRoleId)) || groupName.get(h.roleId) || h.roleId;
    const line = `${role}\u0000${h.userId}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({ roleId: h.roleId, role, userId: String(h.userId) });
  }
  return out;
}

export function doorFrom(input: DoorInput & { launched: boolean }): Door {
  const holders = doorHolders(input);
  if (holders.length === 0) return input.launched ? { by: "vote" } : { by: "admins" };
  const byRole = new Map<string, string[]>();
  let stewards = false;
  for (const h of holders) {
    if (h.roleId === STEWARD_ROLE && !input.villageHolder) {
      stewards = true;
      continue;
    }
    byRole.set(h.role, [...(byRole.get(h.role) ?? []), h.userId]);
  }
  const labels = Array.from(byRole.entries()).map(([role, users]) => roleWithHolders(role, users.map((u) => input.nameOf(u))));
  return {
    by: "holders",
    labels: labels.slice(0, DOOR_ROLE_CAP),
    more: Math.max(0, labels.length - DOOR_ROLE_CAP),
    stewards,
    others: 0,
    // Before launch the admin panel's door stands beside the holders' (publishDoorFor).
    admins: !input.launched,
  };
}

/** The reads the door needs, handed in by the server, which owns the caches. The same inputs `/api/village/powers` reads. */
export interface Deciders {
  roles(): DoorInput["roles"];
  roleHolders(): DoorInput["holdings"];
  orgRoles(): Promise<ReadonlyArray<{ id: string; name: string }>>;
  villageHolder(capability: string): Promise<{ roleId: string; roleName: string } | null>;
}

/** Who decides the chart, and who sets pay, now, as members are shown it. */
export async function doorsNow(
  pool: Pool,
  deciders: Deciders,
  members: { all(): Promise<unknown[]> },
): Promise<{ decides: Door; paySetBy: Door }> {
  const [launched, people, orgRoles] = await Promise.all([launchedByVote(pool), members.all(), deciders.orgRoles()]);
  const names = new Map<string, string>();
  for (const m of people as Array<Record<string, unknown>>) {
    if (isExampleUser(m)) continue;
    if (typeof m.id === "string" || typeof m.id === "number") names.set(String(m.id), String(m.name ?? ""));
  }
  const orgName = new Map(orgRoles.map((r) => [r.id, r.name]));
  const door = async (capability: string): Promise<Door> =>
    doorFrom({
      capability,
      roles: deciders.roles(),
      holdings: deciders.roleHolders(),
      nameOf: (u) => names.get(u) ?? null,
      orgRoleName: (id) => orgName.get(id),
      villageHolder: await deciders.villageHolder(capability),
      launched,
    });
  return { decides: await door("org.decide"), paySetBy: await door("cash.pay") };
}
