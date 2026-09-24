/**
 * WHO HOLDS A POWER RIGHT NOW, for the doors that have to know whether this
 * village has anybody in the chair (Rye, 2026-09-15 for redemption, and again
 * 2026-09-23 for a raised hand).
 *
 * The counting rule is `liveHoldersOfCapability` in ./roleGrants, which walks
 * the gate's own planes and deliberately leaves out the admin short-circuit.
 * This file is only the wire: the caller's two caches, plus one read of the
 * badge rows for the whole village.
 *
 * The badge half honours the SAME dormancy rule the gate does. A seasonally
 * dormant badge grants nothing while its season is not running, and a deny is
 * never dormant (0050), so a sleeping badge cannot make somebody a steward and
 * a warning badge still takes it away.
 *
 * ── WHY IT TAKES THE CAPABILITY, AND WHY IT LEFT server/index.ts ───────────
 *
 * It answered `redemption.confirm` alone until 2026-09-23, when a raised hand
 * became a second caller and the alternative was a second copy of the badge
 * read. `liveHoldersOfCapability`'s own header says why two spellings of one
 * counting rule is the thing to avoid.
 *
 * It moved out of `server/index.ts` on 2026-09-24. Nothing about the counting
 * changed in the move: the caller still owns the caches and the pool, and hands
 * them in as `HolderReads`.
 */
import { liveHoldersOfCapability } from "./roleGrants";

/** What the caller knows and this file does not: the caches, and the badge rows. */
export interface HolderReads {
  /** Is the badges module live here. An off module's planes are not read at all. */
  badgesLive(): boolean;
  /** The badge ids asleep for this season. A deny is never dormant (0050). */
  dormantBadgeIds(): Promise<string[]>;
  /** One read of the badge capability rows for the whole village. */
  badgeRows(): Promise<unknown[]>;
  /** Who sits where, live. */
  roleHolders(): ReadonlyArray<any>;
  /** Every role this village defines, live. */
  roles(): ReadonlyArray<any>;
}

/** A stored list that may be an array or the JSON text of one, or neither. */
function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Every member who holds `capability` today, counted the way the gate counts. */
export async function liveHoldersNow(reads: HolderReads, capability: string): Promise<string[]> {
  const badges: Record<string, { grants: string[]; denies: string[] }> = {};
  if (reads.badgesLive()) {
    const asleep = new Set(await reads.dormantBadgeIds());
    for (const r of await reads.badgeRows()) {
      const row = r as any;
      const plane = (badges[String(row.user_id)] ??= { grants: [], denies: [] });
      if (!asleep.has(String(row.badge_id))) plane.grants.push(...asList(row.capabilities));
      plane.denies.push(...asList(row.denies));
    }
  }
  return liveHoldersOfCapability(reads.roleHolders(), reads.roles(), capability, new Date(), badges);
}
