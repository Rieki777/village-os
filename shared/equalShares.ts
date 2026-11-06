/**
 * THE METHOD OF EQUAL SHARES, FOR A FUNDING ROUND.
 *
 * A round's ballot is an approval ballot: each member ticks every quest they
 * would fund. This file counts it. It is pure (no pool, no clock) so the
 * server, the dry run and the tests all count the same way.
 *
 * ── THE METHOD ─────────────────────────────────────────────────────────────
 *
 * Each voter starts with a budget: pot x (their weight / all weight). A quest
 * is affordable at rate r when its backers, each paying r x their weight (or
 * whatever they have left, if less), together cover its cost. Fund the
 * affordable quest with the smallest r / cost, take the payments, and repeat
 * until nothing is affordable. Then the completion step: raise the budgets
 * evenly and count again, keeping the last result that still fits the real
 * pot. With equal weights this is the method used in Wieliczka and Aarau in
 * 2023; with weights it is the same as a member holding three units of weight
 * voting as three people, so a group holding a fifth of the weight can fund
 * about a fifth of the pot and never all of it.
 *
 * ── TWO COUNTS ─────────────────────────────────────────────────────────────
 *
 * `countBothWays` runs it twice on one ballot: the POWER count on counted
 * Voice (capped per member by the same water-fill as `capWeights`) and the
 * PEOPLE count on equal weights. Which one decides is a village setting the
 * caller holds; this file only counts. `divergenceOf` names each quest one
 * count funds and the other does not.
 *
 * ── NUMBERS ────────────────────────────────────────────────────────────────
 *
 * Costs and the pot are whole minor units. Budgets and rates are doubles,
 * compared with a relative tolerance, and never posted anywhere: what leaves
 * this file is which quests are funded, and their costs, which are integers.
 *
 * `forEach` over Maps, never `for...of`: `pnpm check` typechecks at the ES5
 * default and refuses to iterate a Map (see shared/governanceShare.ts).
 */
import { capWeights } from "./governanceShare";

export interface ShareOption {
  id: string;
  /** Whole minor units of the pot's unit. */
  cost: number;
}

export interface ShareMark {
  voter: string;
  option: string;
}

export interface ShareBallot {
  /** Whole minor units available to fund quests. */
  pot: number;
  /** Each voter's weight. A voter absent here, or at zero, counts for nothing. */
  weights: ReadonlyMap<string, number>;
  options: readonly ShareOption[];
  /** Approval marks: one per (voter, option) the voter ticked. */
  marks: readonly ShareMark[];
  /** Breaks exact ties, the same way on every run (a round id and close time). */
  seed: string;
}

export interface ShareStep {
  /** 1-based order in which it was funded: the order a reveal plays. */
  order: number;
  option: string;
  cost: number;
  /** How many backers paid toward it. */
  backers: number;
  /** What each unit of weight paid, in minor units. */
  rate: number;
}

export interface ShareResult {
  funded: string[];
  steps: ShareStep[];
  spent: number;
  leftover: number;
}

const EPS = 1e-9;

/** A stable 32-bit FNV-1a hash, enough to order a handful of ids by seed. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The ids in a deterministic order drawn from the seed: the public tie-break. */
export function seededOrder(ids: readonly string[], seed: string): string[] {
  return ids
    .slice()
    .sort((a, b) => {
      const ha = fnv1a(`${seed}\u0000${a}`);
      const hb = fnv1a(`${seed}\u0000${b}`);
      return ha !== hb ? ha - hb : a < b ? -1 : a > b ? 1 : 0;
    });
}

interface Prepared {
  options: ShareOption[];
  backersOf: Map<string, string[]>;
  weight: Map<string, number>;
  totalWeight: number;
  rank: Map<string, number>;
}

function prepare(ballot: ShareBallot): Prepared {
  const weight = new Map<string, number>();
  let totalWeight = 0;
  ballot.weights.forEach((w, id) => {
    const v = Number.isFinite(w) && w > 0 ? w : 0;
    if (v > 0) {
      weight.set(id, v);
      totalWeight += v;
    }
  });
  const options = ballot.options.filter((o) => Number.isFinite(o.cost) && o.cost > 0);
  const known = new Set(options.map((o) => o.id));
  const backersOf = new Map<string, string[]>();
  options.forEach((o) => backersOf.set(o.id, []));
  const seen = new Set<string>();
  for (const m of ballot.marks) {
    const key = `${m.voter}\u0000${m.option}`;
    if (seen.has(key) || !known.has(m.option) || !weight.has(m.voter)) continue;
    seen.add(key);
    backersOf.get(m.option)!.push(m.voter);
  }
  const rank = new Map<string, number>();
  seededOrder(options.map((o) => o.id), ballot.seed).forEach((id, i) => rank.set(id, i));
  return { options, backersOf, weight, totalWeight, rank };
}

/** One pass of the method at a given virtual pot. */
function runOnce(p: Prepared, virtualPot: number): ShareResult & { budgets: Map<string, number> } {
  const budget = new Map<string, number>();
  p.weight.forEach((w, id) => budget.set(id, p.totalWeight > 0 ? (virtualPot * w) / p.totalWeight : 0));
  const left = new Set(p.options.map((o) => o.id));
  const funded: string[] = [];
  const steps: ShareStep[] = [];
  let spent = 0;

  for (;;) {
    let best: { option: ShareOption; rate: number; score: number } | null = null;
    for (const o of p.options) {
      if (!left.has(o.id)) continue;
      const backers = p.backersOf.get(o.id) ?? [];
      if (backers.length === 0) continue;
      let available = 0;
      for (const b of backers) available += budget.get(b) ?? 0;
      if (available + EPS * o.cost < o.cost) continue;
      // Smallest rate r with sum(min(budget_b, r * w_b)) = cost: walk the
      // backers from the one who runs out first.
      const byCap = backers
        .map((b) => ({ b, w: p.weight.get(b) ?? 0, cap: (budget.get(b) ?? 0) / (p.weight.get(b) ?? 1) }))
        .sort((x, y) => x.cap - y.cap);
      let paid = 0;
      let wRest = 0;
      for (const x of byCap) wRest += x.w;
      let rate: number | null = null;
      for (const x of byCap) {
        const need = (o.cost - paid) / wRest;
        if (need <= x.cap * (1 + EPS)) {
          rate = need;
          break;
        }
        paid += budget.get(x.b) ?? 0;
        wRest -= x.w;
      }
      if (rate === null) continue;
      const score = rate / o.cost;
      const better =
        best === null ||
        score < best.score * (1 - EPS) ||
        (Math.abs(score - best.score) <= best.score * EPS && (p.rank.get(o.id) ?? 0) < (p.rank.get(best.option.id) ?? 0));
      if (better) best = { option: o, rate, score };
    }
    if (best === null) break;
    const backers = p.backersOf.get(best.option.id) ?? [];
    for (const b of backers) {
      const have = budget.get(b) ?? 0;
      budget.set(b, have - Math.min(have, best.rate * (p.weight.get(b) ?? 0)));
    }
    left.delete(best.option.id);
    funded.push(best.option.id);
    spent += best.option.cost;
    steps.push({ order: steps.length + 1, option: best.option.id, cost: best.option.cost, backers: backers.length, rate: best.rate });
  }
  return { funded, steps, spent, leftover: Math.max(0, virtualPot - spent), budgets: budget };
}

/** Completion steps: raise the virtual pot by 1% of the real one each time, up to this multiple. */
const COMPLETION_STEPS = 900;

/** Count an approval ballot by the Method of Equal Shares, with completion. */
export function equalShares(ballot: ShareBallot): ShareResult {
  const pot = Math.max(0, Math.floor(ballot.pot));
  const p = prepare(ballot);
  const finish = (r: ShareResult): ShareResult => ({ funded: r.funded, steps: r.steps, spent: r.spent, leftover: pot - r.spent });
  if (pot === 0 || p.totalWeight === 0 || p.options.length === 0) return { funded: [], steps: [], spent: 0, leftover: pot };
  let best = runOnce(p, pot);
  const step = pot / 100;
  for (let i = 1; i <= COMPLETION_STEPS; i++) {
    const r = runOnce(p, pot + step * i);
    if (r.spent > pot) break;
    if (r.funded.length === p.options.length) {
      best = r;
      break;
    }
    best = r;
  }
  return finish(best);
}

/** The usual count, shown beside equal shares: most weight first, fund while it fits. */
export function greedyByWeight(ballot: ShareBallot): ShareResult {
  const pot = Math.max(0, Math.floor(ballot.pot));
  const p = prepare(ballot);
  const support = new Map<string, number>();
  p.options.forEach((o) => {
    let s = 0;
    for (const b of p.backersOf.get(o.id) ?? []) s += p.weight.get(b) ?? 0;
    support.set(o.id, s);
  });
  const ordered = p.options
    .filter((o) => (support.get(o.id) ?? 0) > 0)
    .sort((a, b) => (support.get(b.id) ?? 0) - (support.get(a.id) ?? 0) || (p.rank.get(a.id) ?? 0) - (p.rank.get(b.id) ?? 0));
  let left = pot;
  const funded: string[] = [];
  const steps: ShareStep[] = [];
  for (const o of ordered) {
    if (o.cost > left) continue;
    left -= o.cost;
    funded.push(o.id);
    steps.push({ order: steps.length + 1, option: o.id, cost: o.cost, backers: (p.backersOf.get(o.id) ?? []).length, rate: 0 });
  }
  return { funded, steps, spent: pot - left, leftover: left };
}

export interface BothWaysInput {
  pot: number;
  /** Every member of the electorate with their counted Voice; zero is allowed. */
  voice: ReadonlyMap<string, number>;
  options: readonly ShareOption[];
  marks: readonly ShareMark[];
  seed: string;
  /** Per-member cap on counted Voice, in percent. 100 or more means no cap. */
  capPct: number;
}

export interface BothWays {
  power: ShareResult;
  people: ShareResult;
  /** The weights the power count used, after the cap. */
  powerWeights: Map<string, number>;
}

/** Run the power count (capped Voice) and the people count (equal) on one ballot. */
export function countBothWays(input: BothWaysInput): BothWays {
  const raw = new Map<string, number>();
  input.voice.forEach((v, id) => raw.set(id, Number.isFinite(v) && v > 0 ? v : 0));
  const powerWeights = input.capPct >= 100 ? raw : capWeights(raw, input.capPct);
  const equal = new Map<string, number>();
  input.voice.forEach((_v, id) => equal.set(id, 1));
  const base = { pot: input.pot, options: input.options, marks: input.marks, seed: input.seed };
  return {
    power: equalShares({ ...base, weights: powerWeights }),
    people: equalShares({ ...base, weights: equal }),
    powerWeights,
  };
}

export interface Divergence {
  option: string;
  fundedBy: "power" | "people";
  cost: number;
}

/** Each quest only one of the two counts funds, power first, then people, in option order. */
export function divergenceOf(both: Pick<BothWays, "power" | "people">, options: readonly ShareOption[]): Divergence[] {
  const power = new Set(both.power.funded);
  const people = new Set(both.people.funded);
  const out: Divergence[] = [];
  for (const o of options) if (power.has(o.id) && !people.has(o.id)) out.push({ option: o.id, fundedBy: "power", cost: o.cost });
  for (const o of options) if (people.has(o.id) && !power.has(o.id)) out.push({ option: o.id, fundedBy: "people", cost: o.cost });
  return out;
}
