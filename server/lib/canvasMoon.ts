/**
 * THE CANVAS MOON: which blocks a new moon asks about (plan 4.4; Wave 4).
 *
 * "The moon's question is the block the village chose to grow, plus any block
 * a trigger flagged. With no choice made, blocks rotate in canvas order. The
 * platform never picks 'the lowest-rated' block." This file is that sentence,
 * and nothing in it reads a canvas reading's level, so it cannot pick by one.
 *
 * ── THE THREE SOURCES, IN THE PLAN'S ORDER ─────────────────────────────────
 *
 *   chosen    the loaded season file's moon for this new moon
 *             (`moons[].blocks`, shared/canvasSeason.ts), matched by date:
 *             within two days either side of the new moon, because the file
 *             writes a civil date in its own timezone and the sky writes an
 *             instant. A moon entry with no blocks means "any block that
 *             moved", which is not a choice, so it adds nothing here.
 *   flagged   every block a key moment flagged in the moon that is ending or
 *             the one beginning (server/repos/canvasRevisits.ts), EXCEPT the
 *             conflict moment: a conflict notice reaches the care holder
 *             alone, and naming its block in a line every member reads would
 *             tell the whole village that the pathway was used.
 *   rotated   only when both are empty: one block, by the moon's own number,
 *             in canvas order.
 *
 * ── ZERO MODEL CALLS ───────────────────────────────────────────────────────
 *
 * The line is a template over two reads. It is carried outward by the weekly
 * brief (a provider seam in ./calendarBrief.ts) and by the moon digest
 * (./moonDigest.ts), and it names block titles only.
 */
import type { Pool } from "mysql2/promise";
import { cycleBoundsFor, newMoonsBetween } from "../../shared/lunar";
import { CANVAS_BLOCK_IDS, CANVAS_BLOCKS, isCanvasBlockId, type CanvasBlockId } from "../../shared/governanceCanvas";
import { flaggedInMoons } from "../repos/canvasRevisits";
import { readCanvasSeason } from "../repos/canvasSeason";

const DAY = 86_400_000;

export interface CanvasMoonQuestion {
  /** The new moon this question is for. */
  newMoonAt: string;
  /** The absolute lunation number that begins at it, the key the flags are stored under. */
  moon: number;
  /** In canvas order. Titles only ever leave this file. */
  blocks: Array<{ id: CanvasBlockId; name: string }>;
  source: { chosen: CanvasBlockId[]; flagged: CanvasBlockId[]; rotated: CanvasBlockId | null };
}

/**
 * The lunation a new moon begins. Read a day and a half after the instant,
 * because the settlement clock's boundary and the true new moon can sit up to
 * a day apart (shared/lunar.ts), and a raise is keyed with the same function.
 */
export function lunationBegunBy(newMoonAt: Date): number {
  return cycleBoundsFor(new Date(newMoonAt.getTime() + 1.5 * DAY)).cycleNumber;
}

/** The first new moon strictly after this instant. */
export function nextNewMoonAfter(at: Date): Date | null {
  return newMoonsBetween(new Date(at.getTime() + 1), new Date(at.getTime() + 31 * DAY))[0] ?? null;
}

/** The new moon within `days` of this instant, if there is one. */
export function newMoonNear(at: Date, days: number): Date | null {
  return newMoonsBetween(new Date(at.getTime() - days * DAY), new Date(at.getTime() + days * DAY))[0] ?? null;
}

/** Pure, so every rule above is provable without a database. */
export function composeCanvasMoon(input: {
  newMoonAt: Date;
  chosen: readonly string[];
  flagged: ReadonlyArray<{ moment: string; block: string }>;
}): CanvasMoonQuestion {
  const moon = lunationBegunBy(input.newMoonAt);
  const chosen = CANVAS_BLOCK_IDS.filter((b) => input.chosen.includes(b));
  const flagged = CANVAS_BLOCK_IDS.filter((b) =>
    input.flagged.some((f) => f.moment !== "conflict" && isCanvasBlockId(f.block) && f.block === b),
  );
  const both = new Set<CanvasBlockId>([...chosen, ...flagged]);
  const rotated = both.size ? null : CANVAS_BLOCK_IDS[((moon % CANVAS_BLOCK_IDS.length) + CANVAS_BLOCK_IDS.length) % CANVAS_BLOCK_IDS.length];
  if (rotated) both.add(rotated);
  return {
    newMoonAt: input.newMoonAt.toISOString(),
    moon,
    blocks: CANVAS_BLOCK_IDS.filter((b) => both.has(b)).map((id) => ({ id, name: CANVAS_BLOCKS[id].name })),
    source: { chosen, flagged, rotated },
  };
}

/** The season file's choice for this new moon, or nothing when there is no file or no moon near it. */
async function chosenForNewMoon(pool: Pool, newMoonAt: Date): Promise<string[]> {
  const read = await readCanvasSeason(pool);
  if (read.state !== "stored") return [];
  const out: string[] = [];
  for (const m of read.season.moons) {
    const [y, mo, d] = m.date.split("-").map(Number);
    const noon = Date.UTC(y, mo - 1, d, 12);
    if (Math.abs(noon - newMoonAt.getTime()) <= 2 * DAY) out.push(...m.blocks);
  }
  return out;
}

/** The question for one new moon, read from the village as it stands. */
export async function canvasMoonQuestion(pool: Pool, newMoonAt: Date): Promise<CanvasMoonQuestion> {
  const moon = lunationBegunBy(newMoonAt);
  const [chosen, flagged] = await Promise.all([chosenForNewMoon(pool, newMoonAt), flaggedInMoons(pool, [moon - 1, moon])]);
  return composeCanvasMoon({ newMoonAt, chosen, flagged });
}
