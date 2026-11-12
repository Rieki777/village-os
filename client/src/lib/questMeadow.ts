/**
 * THE QUEST MEADOW (Phase C, decision 5), as plain values.
 *
 * The board draws its quests as a meadow: one bed per circle, and each quest
 * a plant in it.
 *
 *   seed    an open quest nobody carries yet
 *   bud     somebody carries it now (picked up or handed in)
 *   flower  done this moon (consented since this moon's new moon) and nobody
 *           carries it again yet
 *
 * A PLANT DESCRIBES THE WORK AND NEVER A PERSON. The state reads the quest's
 * own life signs from GET /api/quests/field, which counts claims across the
 * whole village. Nothing here knows who carried a quest, how many anybody
 * finished, or orders a bed by anything but the board's own order.
 *
 * Bud before flower: a quest someone is in the middle of is the one a hand
 * can join now, so a repeatable quest done this moon and taken up again
 * reads as a bud.
 *
 * No DOM and no fetching here, so the meaning is pinned by plain tests
 * (questMeadow.test.ts).
 */
import { cycleBoundsFor } from "@shared/lunar";
import { GOLDEN_ANGLE } from "@/components/journey/nature/geometry";
import type { BoardQuest, QuestSigns } from "./questBoard";

export type PlantState = "seed" | "bud" | "flower";

export const PLANT_STATES: readonly PlantState[] = ["seed", "bud", "flower"];

/** A quest's plant, from its life signs. No signs (or an older server) is a seed. */
export function plantFor(signs: QuestSigns | null | undefined): PlantState {
  if ((signs?.active ?? 0) > 0) return "bud";
  if ((signs?.moon ?? 0) > 0) return "flower";
  return "seed";
}

/**
 * The plant for a piece of work a member holds, on their own profile: a bud
 * while it is picked up or handed in, a flower when it was consented this
 * moon. Work finished in an earlier moon, or declined, draws no plant (null):
 * a flower means "this moon" everywhere, and the profile never sums anybody's
 * work into a garden.
 */
export function claimPlant(
  claim: { status: string; resolvedAt?: string | null },
  now: Date = new Date(),
): PlantState | null {
  if (claim.status === "claimed" || claim.status === "submitted") return "bud";
  if (claim.status !== "consented" || !claim.resolvedAt) return null;
  const at = new Date(claim.resolvedAt).getTime();
  if (Number.isNaN(at)) return null;
  return at >= cycleBoundsFor(now).startsAt.getTime() && at <= now.getTime() ? "flower" : null;
}

export interface MeadowPlant {
  quest: BoardQuest;
  state: PlantState;
}

export interface MeadowBed {
  /** The circle's own name, or null for quests that name no circle. */
  circle: string | null;
  plants: MeadowPlant[];
}

/**
 * One bed per circle, in the order the board first meets each circle, and
 * each bed's plants in board order. Quests with no circle share one bed at
 * the end. A circle with no quest has no bed: the meadow draws what grows.
 */
export function meadowBeds(
  quests: readonly BoardQuest[],
  perQuest: Record<string, QuestSigns> | null | undefined,
): MeadowBed[] {
  const beds = new Map<string, MeadowBed>();
  const loose: MeadowPlant[] = [];
  for (const quest of quests) {
    const plant = { quest, state: plantFor(perQuest?.[quest.id]) };
    const circle = String(quest.circle ?? "").trim();
    if (!circle) {
      loose.push(plant);
      continue;
    }
    const bed = beds.get(circle) ?? { circle, plants: [] };
    bed.plants.push(plant);
    beds.set(circle, bed);
  }
  const out = Array.from(beds.values());
  if (loose.length) out.push({ circle: null, plants: loose });
  return out;
}

/** Every plant in reading order: bed by bed, then within a bed. The arrow keys walk this. */
export function meadowOrder(beds: readonly MeadowBed[]): MeadowPlant[] {
  return beds.flatMap((b) => b.plants);
}

/**
 * The next plant for an arrow key: right and down step forward, left and up
 * step back, and the walk wraps at either end. Unknown keys answer null, so
 * the caller lets the browser keep them.
 */
export function stepThrough(order: readonly { quest: { id: string } }[], currentId: string | null, key: string): string | null {
  if (!order.length) return null;
  const forward = key === "ArrowRight" || key === "ArrowDown";
  const back = key === "ArrowLeft" || key === "ArrowUp";
  if (!forward && !back) return null;
  const at = order.findIndex((p) => p.quest.id === currentId);
  if (at === -1) return order[0].quest.id;
  const next = (at + (forward ? 1 : -1) + order.length) % order.length;
  return order[next].quest.id;
}

export interface BedSpot {
  /** Centre, in the bed's own box (0..width, 0..height). */
  x: number;
  y: number;
}

export interface BedLayout {
  width: number;
  height: number;
  spots: BedSpot[];
}

/** The soil is seen at a slant: the spiral is squashed to this share of its height. */
export const BED_SLANT = 0.72;

/**
 * Where each plant stands in a bed: Vogel's golden-angle spiral (the
 * sunflower's packing, docs/DESIGN_RULE.md), squashed into the soil so the
 * meadow reads as ground seen at a slant. The first plant stands at the
 * heart of the bed.
 *
 * The bed grows with what grows in it, never the other way round: the
 * spiral's step is fixed so neighbouring centres stay at least `gap` apart
 * after the squash, and the box is sized to hold the whole spiral plus half a
 * gap of soil all round. So a thumb-sized target around each plant never
 * covers its neighbour's centre, however many quests a circle carries.
 *
 * Deterministic: the same count always gives the same layout, so a plant
 * never jumps between renders.
 */
export function bedLayout(count: number, gap = 44): BedLayout {
  const n = Math.max(0, Math.floor(count));
  // Vogel's nearest neighbours sit about one step apart; the squash shortens
  // the vertical part of that, so the step is widened to make up for it.
  const step = gap / BED_SLANT;
  const raw = Array.from({ length: n }, (_, i) => {
    const r = step * Math.sqrt(i);
    const a = i * GOLDEN_ANGLE;
    return { x: r * Math.cos(a), y: r * Math.sin(a) * BED_SLANT };
  });
  const pad = gap * 0.75;
  if (!raw.length) return { width: gap * 2, height: gap * 2, spots: [] };
  const minX = Math.min(...raw.map((p) => p.x));
  const maxX = Math.max(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  const maxY = Math.max(...raw.map((p) => p.y));
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);
  return {
    width,
    height,
    spots: raw.map((p) => ({ x: p.x - minX + pad, y: p.y - minY + pad })),
  };
}
