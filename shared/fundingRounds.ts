/**
 * FUNDING ROUNDS: the village chooses which proposed quests to fund within a
 * pot (Rye, 2026-11-06). Pure: the stage of a round, and the shape of an idea.
 *
 * ── THE STAGES ─────────────────────────────────────────────────────────────
 *
 * seed (ideas come in), grow (a proposer shapes theirs into a quest), choose
 * (members tick what they would fund), harvest (the count runs and funded
 * ideas become quests holding an earmark on the pot), then closed.
 *
 * The stage is DERIVED from the round's dates, never stored, so a clock cannot
 * drift from the record. A later date that is NULL holds the round in the
 * stage before it: a round with no grow date stays in seed until the pot's
 * holder sets one. That is how a village runs seed only for a whole season
 * (Rye, 6 Nov: Amora stays in seed until this season ends).
 */

export const ROUND_STAGES = ["seed", "grow", "choose", "harvest", "closed"] as const;
export type RoundStage = (typeof ROUND_STAGES)[number];

export const POT_CLOCKS = ["lunar", "seasonal", "fixed"] as const;
export type PotClock = (typeof POT_CLOCKS)[number];

export const IDEA_STATUSES = ["seed", "grown", "on_ballot", "funded", "not_funded", "withdrawn", "held", "stopped"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export type ShownAs = "named" | "anonymous";

export interface RoundDates {
  seedAt: string | Date;
  growAt: string | Date | null;
  chooseAt: string | Date | null;
  harvestAt: string | Date | null;
  closedAt: string | Date | null;
}

const ms = (d: string | Date | null): number | null => {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
  return Number.isFinite(t) ? t : null;
};

/**
 * The stage a round is in at `now`. Before its seed date a round is still in
 * seed (it simply has not opened); the route refuses ideas then, by date.
 */
export function stageAt(dates: RoundDates, now: Date): RoundStage {
  const t = now.getTime();
  if (ms(dates.closedAt) != null && t >= (ms(dates.closedAt) as number)) return "closed";
  const grow = ms(dates.growAt);
  if (grow == null || t < grow) return "seed";
  const choose = ms(dates.chooseAt);
  if (choose == null || t < choose) return "grow";
  const harvest = ms(dates.harvestAt);
  if (harvest == null || t < harvest) return "choose";
  return "harvest";
}

/** True while the round takes new ideas: in seed, on or after its seed date. */
export function acceptsIdeas(dates: RoundDates, now: Date): boolean {
  const seed = ms(dates.seedAt);
  return stageAt(dates, now) === "seed" && seed != null && now.getTime() >= seed;
}

/** Dates must run forward: each set date after the one before it. */
export function datesProblem(dates: RoundDates): string | null {
  const order: Array<[string, number | null]> = [
    ["seed", ms(dates.seedAt)],
    ["grow", ms(dates.growAt)],
    ["choose", ms(dates.chooseAt)],
    ["harvest", ms(dates.harvestAt)],
  ];
  if (order[0][1] == null) return "A round needs the date its ideas open.";
  let last = order[0][1] as number;
  let gap = false;
  for (let i = 1; i < order.length; i++) {
    const v = order[i][1];
    if (v == null) {
      gap = true;
      continue;
    }
    if (gap) return `Set the ${order[i - 1][0]} date before the ${order[i][0]} date.`;
    if (v <= last) return `The ${order[i][0]} date must come after the ${order[i - 1][0]} date.`;
    last = v;
  }
  return null;
}

/** Field limits, the same on the client and the server. */
export const IDEA_LIMITS = { title: 160, what: 4000, whoHelps: 2000, whoMight: 1000 } as const;

export interface IdeaInput {
  title: string;
  what: string;
  whoHelps: string | null;
  roughCostMinor: number | null;
  whoMight: string | null;
  shownAs: ShownAs;
  structureKey: string | null;
  circleId: string | null;
  locale: string | null;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optional = (v: unknown, max: number): string | null => text(v, max) || null;

/** Read an idea from a request body. Returns the idea or what is missing, in plain words. */
export function parseIdea(body: unknown): { ok: true; idea: IdeaInput } | { ok: false; problem: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = text(b.title, IDEA_LIMITS.title);
  const what = text(b.what, IDEA_LIMITS.what);
  if (!title) return { ok: false, problem: "Give your idea a short name." };
  if (!what) return { ok: false, problem: "Say what you would do." };
  let roughCostMinor: number | null = null;
  if (b.roughCostMinor != null && b.roughCostMinor !== "") {
    const n = Number(b.roughCostMinor);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false, problem: "The rough cost must be a whole amount." };
    roughCostMinor = n;
  }
  const shownAs: ShownAs = b.shownAs === "anonymous" ? "anonymous" : "named";
  const key = optional(b.structureKey, 128);
  const circle = optional(b.circleId, 64);
  const locale = optional(b.locale, 16);
  return {
    ok: true,
    idea: {
      title,
      what,
      whoHelps: optional(b.whoHelps, IDEA_LIMITS.whoHelps),
      roughCostMinor,
      whoMight: optional(b.whoMight, IDEA_LIMITS.whoMight),
      shownAs,
      structureKey: key,
      circleId: circle,
      locale,
    },
  };
}

/** Grow's field limits, the same on the client and the server. */
export const GROW_LIMITS = { deliverable: 2000 } as const;

export interface GrowInput {
  title?: string;
  what?: string;
  /** Absent means unchanged; null clears it. */
  deliverable?: string | null;
  askMinor?: number | null;
  sharedImpact?: boolean;
}

/** Read grow's changes from a request body. Only the fields sent change. */
export function parseGrow(body: unknown): { ok: true; grow: GrowInput } | { ok: false; problem: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const grow: GrowInput = {};
  if ("title" in b) {
    const t = text(b.title, IDEA_LIMITS.title);
    if (!t) return { ok: false, problem: "Give your idea a short name." };
    grow.title = t;
  }
  if ("what" in b) {
    const w = text(b.what, IDEA_LIMITS.what);
    if (!w) return { ok: false, problem: "Say what you would do." };
    grow.what = w;
  }
  if ("deliverable" in b) grow.deliverable = optional(b.deliverable, GROW_LIMITS.deliverable);
  if ("askMinor" in b) {
    if (b.askMinor == null || b.askMinor === "") grow.askMinor = null;
    else {
      const n = Number(b.askMinor);
      if (!Number.isInteger(n) || n <= 0) return { ok: false, problem: "The amount you ask for must be a whole amount above zero." };
      grow.askMinor = n;
    }
  }
  if ("sharedImpact" in b) grow.sharedImpact = b.sharedImpact === true;
  return { ok: true, grow };
}

/** An idea is ready for the ballot once it says what it delivers and what it asks. */
export function isGrown(idea: { deliverable: string | null; askMinor: number | null }): boolean {
  return Boolean(idea.deliverable) && idea.askMinor != null && idea.askMinor > 0;
}

/** Below this many members, the anonymous tick is not offered: anonymity cannot hold (plan Q6). */
export const ANONYMOUS_MIN_MEMBERS = 8;

/** How an idea's author is shown. The server redacts before anything leaves it. */
export interface Byline {
  kind: "named" | "anonymous";
  text: string;
}

export const ANONYMOUS_BYLINE: Byline = { kind: "anonymous", text: "a member" };
