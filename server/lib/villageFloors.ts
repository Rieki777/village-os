/**
 * PASSING AN EVERYDAY POWER MOVES WHO SETS ITS STAGE, AND NOTHING ELSE
 * (Rye, 2026-11-01: "All powers should be able to be passed to a village";
 * the coordinator's guardrail of 2026-11-05).
 *
 * An everyday power is one the stage ladder hands every member: voting,
 * posting, messaging, vouching and the rest (`STAGE_UNLOCKS` keys that
 * `TRANSFERABLE` keeps off the hand-over set). Passing one the way a
 * governance power passes, a `capability_holding` row naming one looking-after
 * role, would strip it from every other member. The role-proposals lane showed
 * that on 1 November, and Rye agreed the hand-over is for governance powers.
 *
 * So passing an everyday power writes NO holding row. It moves one thing: who
 * sets the stage that opens it. Its floor dial, `progression.unlock.<key>`,
 * then changes only through a village vote (a mechanics proposal and its
 * landing, server/lib/changeset.ts), and the direct dial route refuses it to
 * everybody, the admin included. Every member keeps the power exactly as the
 * ladder gives it.
 *
 * One `app_config` document records which floors the village sets, beside
 * #772's pending request and #906's cooling list.
 */
import type { Pool } from "mysql2/promise";
import { STAGE_UNLOCKS, TRANSFERABLE, type Capability } from "../../shared/capabilities";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";

export const VILLAGE_FLOORS_KEY = "village-floors";

/** The everyday powers: every key a stage opens that the hand-over set leaves out. */
export const EVERYDAY_FLOOR_KEYS: readonly Capability[] = (Object.keys(STAGE_UNLOCKS) as Capability[]).filter((c) => !TRANSFERABLE[c]);

export function isEverydayFloor(capability: string): boolean {
  return (EVERYDAY_FLOOR_KEYS as readonly string[]).includes(capability);
}

/** The dial that holds an everyday power's stage. */
export const floorDialKey = (capability: string) => `progression.unlock.${capability}`;

/** The everyday power a dial key sets the stage of, or null. */
export function floorOfDial(key: string): Capability | null {
  const m = /^progression\.unlock\.(.+)$/.exec(key);
  return m && isEverydayFloor(m[1]) ? (m[1] as Capability) : null;
}

/** The floors the village sets, well formed only, in `EVERYDAY_FLOOR_KEYS` order. */
export async function readVillageFloors(pool: Pool): Promise<Capability[]> {
  const doc = await readConfigDocument<{ keys?: unknown }>(pool, VILLAGE_FLOORS_KEY);
  const keys = new Set(Array.isArray(doc?.keys) ? doc!.keys.map(String) : []);
  return EVERYDAY_FLOOR_KEYS.filter((c) => keys.has(c));
}

/** Pass these floors to the village. Returns the ones newly passed. Writes no holding row. */
export async function passFloors(pool: Pool, capabilities: readonly string[]): Promise<Capability[]> {
  const before = await readVillageFloors(pool);
  const added = EVERYDAY_FLOOR_KEYS.filter((c) => capabilities.includes(c) && !before.includes(c));
  if (added.length) {
    const keys = EVERYDAY_FLOOR_KEYS.filter((c) => before.includes(c) || added.includes(c));
    await writeConfigDocument(pool, VILLAGE_FLOORS_KEY, { keys });
  }
  return added;
}

export const FLOOR_IS_THE_VILLAGES =
  "The village sets the stage that opens this power, so it changes only by a village vote. Propose the change, and the village decides.";

/** The direct dial route's refusal for a floor the village sets, or null. */
export async function floorDialRefusal(pool: Pool, dialKey: string): Promise<string | null> {
  const cap = floorOfDial(dialKey);
  if (!cap) return null;
  return (await readVillageFloors(pool)).includes(cap) ? FLOOR_IS_THE_VILLAGES : null;
}
