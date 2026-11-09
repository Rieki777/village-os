/**
 * WHICH CANVAS BLOCKS A KEY MOMENT FLAGGED IN A MOON, read from the notices
 * themselves.
 *
 * A `canvas_revisit` row's dedupe key is `canvas_revisit:<moment>:<block>:
 * <moon>:<user>` (shared/canvasRevisit.ts), so the notifications table already
 * is the record of which (moment, block) pairs fired in which moon, once per
 * person who heard it. The canvas moon reads it back to know which blocks a
 * trigger flagged (plan 4.4), so there is no second store to keep in step
 * with the first.
 *
 * What comes back is the moment and the block, and nothing else: never the
 * recipient, never how many heard it. The caller decides which moments a
 * village-wide surface may name (a conflict flag never reaches one).
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

export interface FlaggedPair {
  moment: string;
  block: string;
}

/**
 * Every distinct (moment, block) flagged in any of these moons. The key is
 * parsed strictly here, so a row that matches the LIKE by accident (a moon
 * number that is a substring of another) is dropped by the parse.
 */
export async function flaggedInMoons(pool: Pool, moons: readonly number[]): Promise<FlaggedPair[]> {
  const wanted = Array.from(new Set(moons.filter((m) => Number.isInteger(m))));
  if (!wanted.length) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dedupe_key FROM notifications WHERE type = 'canvas_revisit' AND (${wanted.map(() => "dedupe_key LIKE ?").join(" OR ")})`,
    wanted.map((m) => `canvas_revisit:%:%:${m}:%`),
  );
  const seen = new Set<string>();
  const out: FlaggedPair[] = [];
  for (const r of rows) {
    const parts = String(r.dedupe_key).split(":");
    if (parts.length < 5 || parts[0] !== "canvas_revisit") continue;
    const [, moment, block, moon] = parts;
    if (!wanted.includes(Number(moon)) || String(Number(moon)) !== moon) continue;
    const key = `${moment}:${block}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ moment, block });
  }
  return out;
}
