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
