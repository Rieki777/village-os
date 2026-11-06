/**
 * THE STARTER ROLES, AND THE ONE POWER A LATER RULING ADDED TO ONE OF THEM.
 *
 * `seedStarterRoles` is the boot seed that used to sit inline in
 * server/index.ts, moved unchanged. It writes `server/seeds/roles-seed.json`
 * into an EMPTY roles table only, so it reaches a village once, on its first
 * boot, and a village's own edits are never overwritten by a later release.
 *
 * That is exactly why it cannot carry a power the platform adds afterwards to a
 * village that already has its roles, and `grantCashPayToTreasury` exists.
 * Rye, 2026-10-30, on `cash.pay` (marking the cash the village owes as paid,
 * 0285): "yes and this one is then given to a finance role as well". The seed
 * gives it to the Treasury role of every new village. A village that booted
 * before this release gets the same grant, once, through `runOnce`, on the
 * seeded Treasury role if it still has one.
 *
 * WHY THE GRANT IS SAFE TO RUN EVERYWHERE. `cash.pay` is new, so no village
 * can have taken it off its Treasury role on purpose. The grant touches the one
 * role the platform seeded under the id `treasury` (a rename keeps the id), adds
 * the one key, and changes nothing a village wrote: not the name, not the
 * description, not any other power. A village that deleted its Treasury role
 * gets nothing, and the founding stewards hold the power anyway once it
 * launches, because `cash.pay` is in the handover set.
 */
import fs from "fs";
import { APPROVE_ALONE_CAPABILITY, APPROVE_ALONE_GROUPS, APPROVE_OWN_CAPABILITY, APPROVE_OWN_GROUPS } from "../../shared/moonRecap";

/** The id `server/seeds/roles-seed.json` gives the finance role. */
export const TREASURY_ROLE_ID = "treasury";

/** The slice of the roles collection these two need. */
export interface RolesStore<T extends { id: string; capabilities?: string[] }> {
  all(): T[];
  replaceAll(rows: T[]): Promise<void>;
}

/** The starter roles, into an empty table only. A failure is logged and the boot carries on. */
export async function seedStarterRoles<T extends { id: string; capabilities?: string[] }>(
  repo: RolesStore<T>,
  seedFile: string,
): Promise<void> {
  if (repo.all().length !== 0 || !fs.existsSync(seedFile)) return;
  try {
    const seed = JSON.parse(fs.readFileSync(seedFile, "utf-8"));
    if (Array.isArray(seed) && seed.length) {
      // Seed rows predate the map columns (0018): default what NOT NULL needs.
      await repo.replaceAll(seed.map((r: any) => ({ seats: 1, circleId: null, ...r })));
      console.log(`[seed] ${seed.length} starter role(s) seeded`);
    }
  } catch (e) {
    console.error("[seed] roles seed failed (continuing)", e);
  }
}

/**
 * Give `cash.pay` to the seeded Treasury role, where there is one and it does
 * not carry it yet. Returns whether it wrote. Idempotent, and run once.
 */
export async function grantCashPayToTreasury<T extends { id: string; capabilities?: string[] }>(
  repo: RolesStore<T>,
): Promise<boolean> {
  const all = repo.all();
  const treasury = all.find((r) => r.id === TREASURY_ROLE_ID);
  if (!treasury) return false;
  const granted = Array.isArray(treasury.capabilities) ? treasury.capabilities : [];
  if (granted.includes("cash.pay")) return false;
  await repo.replaceAll(all.map((r) => (r.id === TREASURY_ROLE_ID ? { ...r, capabilities: [...granted, "cash.pay"] } : r)));
  console.log("[roles] the Treasury role now grants cash.pay (Rye, 2026-10-30)");
  return true;
}

/**
 * THE END-OF-MOON REVIEW'S TWO HELD-BACK KEYS, granted to named power groups
 * (decisions 18 and 19, 3 November 2026).
 *
 * `moon.approve_alone` goes to the founders' and stewards' power groups, the
 * same two ids 0307 gave admin access to; `moon.approve_own` goes to the
 * Treasury power group only. The ids are in shared/moonRecap.ts.
 *
 * WHY TYPESCRIPT AND NOT A MIGRATION. `roles.capabilities` is JSON, and
 * appending to a JSON array in SQL needs a function that has never run on
 * production (scripts/check-migration-sql.mjs). server/lib/seasonGoalIds.ts
 * is the worked example of the same choice.
 *
 * SCOPED BY ID, IDEMPOTENT BY ITS OWN CHECK. Only a role whose id is named
 * here is touched, a role that already carries the key is left alone, and
 * nothing else on the role changes. It runs once through `runOnce`, so a
 * village that later takes a key off either group keeps it off: the grant
 * never comes back on a later boot. A village with none of these roles gets
 * nothing. Returns the number of roles it wrote.
 */
export async function grantMoonReviewKeys<T extends { id: string; capabilities?: string[] }>(
  repo: RolesStore<T>,
  grants: ReadonlyArray<{ capability: string; roleIds: readonly string[] }>,
  what = "the end-of-moon review's approval keys (decisions 18 and 19)",
): Promise<number> {
  const all = repo.all();
  let written = 0;
  const next = all.map((r) => {
    const caps = Array.isArray(r.capabilities) ? r.capabilities : [];
    const add = grants.filter((g) => g.roleIds.includes(r.id) && !caps.includes(g.capability)).map((g) => g.capability);
    if (add.length === 0) return r;
    written += 1;
    return { ...r, capabilities: [...caps, ...add] };
  });
  if (written === 0) return 0;
  await repo.replaceAll(next);
  console.log(`[roles] ${what} reached ${written} power group(s)`);
  return written;
}

/**
 * STEWARD CIRCLE SEATS ROLES AND ADOPTS ROLE PROPOSALS (Rye, 2026-11-01).
 *
 * His ruling that day: founders and stewards are equivalent, and stewards and
 * Ops seat roles and adopt role-changing proposals directly until they hand the
 * power to the village. His answer to the role powers design (Q4) put the three
 * keys that takes on the seeded Steward Circle. The seed carries them for a new
 * village; this reaches a village that already has the group, once, through
 * `runOnce`, by the same generic grant the moon review uses.
 *
 * `power.assign` is deliberately NOT granted to an existing village here. The
 * moment anybody holds it, an admin who does not is refused on the routes that
 * hand out powers, and a holder may give only what they hold (Q7). Granting it
 * silently on a release would change who may edit powers on a live village the
 * day it deploys. A new village gets it on Founders Circle through the seed; an
 * existing one gives it to a role on purpose, from the role's own editor.
 */
export const STEWARD_CIRCLE_GRANTS = [
  { capability: "org.seat", roleIds: ["steward-circle"] },
  { capability: "org.decide", roleIds: ["steward-circle"] },
  { capability: "proposal.decide", roleIds: ["steward-circle"] },
] as const;

/**
 * A funding pot is a power held by the Treasurer by default (Rye, 2026-11-06,
 * relayed: "a whole pot is a power held by the Treasurer by default"). The
 * seed gives `pot.steward` to the Treasury role of a new village; a village
 * that booted earlier gets it once, through `runOnce`, on the seeded Treasury
 * role if it still has one. `pot.steward` is new, so no village can have taken
 * it off on purpose.
 */
export const POT_STEWARD_GRANTS = [{ capability: "pot.steward", roleIds: [TREASURY_ROLE_ID] }] as const;

/** The two grants, as decisions 18 and 19 name them. */
export const MOON_REVIEW_GRANTS = [
  { capability: APPROVE_ALONE_CAPABILITY, roleIds: APPROVE_ALONE_GROUPS },
  { capability: APPROVE_OWN_CAPABILITY, roleIds: APPROVE_OWN_GROUPS },
] as const;
