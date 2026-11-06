/**
 * WHO DECIDES WHAT WAITS FROM THE OUTSIDE SERVICE, AND WHO SETS PAY, as the
 * code's own holder test answers it (review S2, spec R38 and R23).
 *
 * The inputs are the ones the publish door uses (`publishDoorFor` and
 * `holderMayPublish` in ./orgDraftDecide): the live holders the gate counts
 * (`liveHoldersOf`: role-held, a badge deny taken off, never a stage), the roles
 * carrying the power, and whether a launch vote has carried. So the member view
 * never names somebody the door would refuse, and never offers "the admins"
 * after launch.
 *
 * The answer names roles and holders' first names only (`roleWithHolders`),
 * which are chart facts members already see. Never an id, a surname or an
 * address, and never anything the service sent.
 */
import type { Pool } from "mysql2/promise";
import { roleWithHolders } from "../../shared/roleHolderLabel";
import type { Door } from "../../shared/seraDecides";
import { launchedByVote } from "./orgDraftDecide";

/** The steward seat's reserved role id (server/lib/capabilityHolding.ts). Its holders read as "the stewards". */
const STEWARD_ROLE = "steward";
/** At most this many roles are named; the rest are counted. */
export const DOOR_ROLE_CAP = 3;

export function doorFrom(input: {
  /** The live holders, as the gate counts them. */
  holders: readonly string[];
  /** The roles carrying the power, example roles left out. */
  carrying: ReadonlyArray<{ id: string; name: string }>;
  /** Who sits in which role. */
  holdings: ReadonlyArray<{ roleId: string; userId: string }>;
  /** A holder's name, for the first name. */
  nameOf: (userId: string) => string | null;
  launched: boolean;
}): Door {
  const live = new Set(input.holders.map(String));
  if (live.size === 0) return input.launched ? { by: "vote" } : { by: "admins" };
  const labels: string[] = [];
  const named = new Set<string>();
  let stewards = false;
  for (const role of input.carrying) {
    const who = Array.from(new Set(input.holdings.filter((h) => h.roleId === role.id && live.has(String(h.userId))).map((h) => String(h.userId))));
    if (who.length === 0) continue;
    for (const u of who) named.add(u);
    if (role.id === STEWARD_ROLE) stewards = true;
    else labels.push(roleWithHolders(role.name, who.map((u) => input.nameOf(u))));
  }
  const others = Array.from(live).filter((u) => !named.has(u)).length;
  return { by: "holders", labels: labels.slice(0, DOOR_ROLE_CAP), more: Math.max(0, labels.length - DOOR_ROLE_CAP), stewards, others };
}

/** The reads the door needs, handed in by the server, which owns the caches. */
export interface Deciders {
  liveHoldersOf(capability: string): Promise<string[]>;
  rolesCarrying(capability: string): ReadonlyArray<{ id: string; name: string }>;
  roleHolders(): ReadonlyArray<{ roleId: string; userId: string }>;
}

/** Who decides the chart, and who sets pay, now. */
export async function doorsNow(
  pool: Pool,
  deciders: Deciders,
  members: { byId(id: string): Promise<unknown> },
): Promise<{ decides: Door; paySetBy: Door }> {
  const launched = await launchedByVote(pool);
  const holdings = deciders.roleHolders();
  const door = async (capability: string): Promise<Door> => {
    const holders = await deciders.liveHoldersOf(capability);
    const names = new Map<string, string | null>();
    for (const id of holders) {
      const m = (await members.byId(String(id))) as { name?: unknown } | null;
      names.set(String(id), typeof m?.name === "string" ? m.name : null);
    }
    return doorFrom({ holders, carrying: deciders.rolesCarrying(capability), holdings, nameOf: (u) => names.get(u) ?? null, launched });
  };
  return { decides: await door("org.decide"), paySetBy: await door("cash.pay") };
}
