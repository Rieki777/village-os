/**
 * THE VALUATION MODEL: how a figure for a piece of work is worked out, line by
 * line, so any member can follow it by hand (VALUATION_MODEL_PLAN.md, which
 * supersedes VALUATION_MODEL_SPEC.md where they differ).
 *
 * Rye, 2026-10-30: "we also need a valuation model built in that's showing how
 * and where we've come up with figures for roles, quests, etc". THE MODEL ONLY
 * SUGGESTS. Pay is still what a person sets (`value_minor`, `value_tokens`,
 * `cash_minor`, read by `quoteWorkPay`), and this file writes nothing.
 *
 * WORK IS PRICED AND PAID ON COMPLETION, CONTRACT BY CONTRACT (Rye, 2026-10-31:
 * "The UI should just give hourly estimates as work is paid on the contract of
 * completed work (contract basis) and not hourly (employee)"). Hours are only
 * an estimate of effort that sets the price.
 *
 * THE REWARD (Rye, 2026-11-01): "Let's as a rule double the pay with earned
 * equity with a default 10% more as village credits", and "we show the overall
 * value of what we're paying as the total reward price but it's broken down
 * into cash + credits + Earned Equity so that it's roughly 200-250% above
 * minimum wage". So:
 *   - THE BASE PRICE values each estimated hour at its band's legal minimum
 *     wage, plus complexity, responsibility and village benefit (each a
 *     percentage of that labour). The base is paid in cash from the budget, and
 *     whatever the budget does not cover is paid in Credits.
 *   - EARNED EQUITY MATCHES THE BASE (100%), and CREDITS ADD 10% of it. Both
 *     are model settings.
 *   - THE TOTAL REWARD (base + Earned Equity + the Credits bonus, about 2.1x
 *     minimum wage) is the figure a member sees, broken into cash + Credits +
 *     Earned Equity.
 *   - VOICE IS EVERYTHING PAID (Rye, 2026-11-01, over "the base price"). No caps
 *     on work pay (`WORK_PAY_TRIGGERS`).
 *
 * THE ROUNDING: every line is worked from the figures SHOWN (cents, hundredths
 * of an hour, whole percents), so a pencil reproduces each one. Every token
 * amount and the cash round DOWN to whole units, so splitting one job into
 * pieces can never pay more than the whole job. (A minting carry was weighed
 * and declined: it would be a money-like store outside the ledger.)
 *
 * Pure: no clock, no pool.
 */
import { formatMoney } from "./money";
import type { SourcePay } from "./structurePlan";
import type { TokenAmount } from "./workValue";

/** Days in a moon, as the role card counts them (`shared/roleProposalLoad.ts`). */
export const DAYS_A_MOON = 29.53;
/** Days in an average month (365.25 / 12, written as a person would follow it). */
export const DAYS_A_MONTH = 30.44;

/** Where a figure came from, and when. Every rate carries one. */
export interface ValuationSource {
  sentence: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
}

/** A kind of work, and what one estimated hour of its effort is valued at in the base price. */
export interface RateBand {
  key: string;
  label: string;
  /** The value of one ESTIMATED hour of effort in the base price, in minor units of the model's currency: the band's legal minimum wage. A pricing input for completed work, never a wage. */
  hourValueMinor: number;
  source: ValuationSource | null;
  /** The legal floor the value is measured against, in the currency it is set in. Shown on the model's page only, never on a card. */
  floor?: { perHourMinor: number; currency: string; source: ValuationSource } | null;
}

/** One step on a percentage scale (complexity, responsibility). */
export interface ValuationLevel {
  key: string;
  label: string;
  pct: number;
}

/** How the base price becomes the total reward (Rye, 2026-11-01). */
export interface RewardRule {
  /** Earned Equity paid as a percentage of the base price. 100 doubles the pay. */
  equityMatchPct: number;
  /** Credits paid on top, as a percentage of the base price. */
  creditsBonusPct: number;
  /** The share of the base price paid in cash when a person or budget sets none. The rest of the base is Credits. */
  defaultCashPct: number;
}

/**
 * One version of a village's model. Each save is a new version and none is
 * ever edited. Every field is a setting the valuation pages can change, within
 * the bounds `validateModel` holds; `diffModels` says which door a change needs.
 */
export interface ValuationModel {
  /** 0 is the platform default, before a village has saved a version of its own. */
  version: number;
  /** ISO code the model prices in. */
  currency: string;
  /** The tokens the reward is paid in, by slug. Their live names are the card's to render. */
  tokens: { credits: string; equity: string; voice: string };
  /** Voice per currency unit of everything paid. */
  voicePerUnit: number;
  reward: RewardRule;
  /** Rate bands. The platform ships none: minimum wages depend on place, and a village sets its own. */
  bands: RateBand[];
  complexity: ValuationLevel[];
  responsibility: ValuationLevel[];
  /**
   * Village benefit is held within ± this many percent of labour (Rye,
   * 2026-10-31: "leave the 25% swing but any changes requires approval by a
   * finance or steward role"). Any benefit on a piece of work, and any change
   * to this range, needs a finance or steward role's approval.
   */
  benefit: { maxPct: number };
  /**
   * The most Voice one member may be paid in a moon, or null for no cap. Rye,
   * 2026-10-31: ballots are weighed by Voice, and "this would reflect reality
   * where those who are massive contributors have large voice holdings", so
   * the option ships OFF. The engine applies it at payment (`capVoice`).
   */
  voiceCapPerMemberPerMoon: number | null;
  /** The least a quest's total reward should be for each payee, in minor units. Below it, the working warns. */
  minQuestMinor: number;
  /** The rate the floors are converted at, when they are set in another currency. Display only. */
  exchange: { currency: string; perUnit: number; source: ValuationSource } | null;
}

/**
 * What a village prices with until it saves a version of its own. The slugs
 * are the server's `CREDITS`, `EARNED_EQUITY` and `VILLAGE_VOICE`
 * (`server/lib/economy.ts`), spelled out because shared code cannot import the
 * server; a test holds them equal.
 */
export const PLATFORM_DEFAULT_MODEL: ValuationModel = {
  version: 0,
  currency: "USD",
  tokens: { credits: "credits", equity: "earned-equity", voice: "village-voice" },
  voicePerUnit: 1,
  reward: { equityMatchPct: 100, creditsBonusPct: 10, defaultCashPct: 0 },
  bands: [],
  complexity: [
    { key: "routine", label: "Routine", pct: 0 },
    { key: "conditions", label: "Hazard or hard conditions", pct: 10 },
    { key: "hazardous", label: "Hazardous or complex", pct: 25 },
  ],
  responsibility: [
    { key: "none", label: "None", pct: 0 },
    { key: "coordinates", label: "Holds a budget or coordinates others", pct: 10 },
    { key: "accountable", label: "Accountable for safety, money or people", pct: 20 },
  ],
  benefit: { maxPct: 25 },
  voiceCapPerMemberPerMoon: null,
  minQuestMinor: 500,
  exchange: null,
};

/**
 * The least the TOTAL reward may be, as a multiple of a band's legal floor: the
 * legal cost to an employer of a minimum hour, with social security and the
 * 13th month (VALUATION_MODEL_PLAN.md 2.2). The base itself is never under the
 * floor. Both multiples show on the model's own page only, never on a card
 * (Rye, 2026-10-31: "only visible in the economics page and not on any of the
 * cards").
 */
export const HARD_MINIMUM_MULTIPLE = 1.35;

/**
 * One line of the working, ready to read: what it is, how it was worked out,
 * and what it came to. A token line carries `token`, and the card renders that
 * token's live name in place of `label`, so a rename reaches the working too.
 */
export interface ValuationLine {
  key: string;
  label: string;
  working: string;
  result: string;
  token?: string;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const hundredths = (n: number): number => Math.round(n * 100) / 100;
const down = (n: number): number => Math.floor(n + 1e-9);
const estimateWords = (h: number): string => (hundredths(h) === 1 ? "1 estimated hour" : `${hundredths(h)} estimated hours`);
const versionWords = (v: number): string => (v === 0 ? "platform default (no village version yet)" : `village version ${v}`);
const moneyIn = (currency: string) => (minor: number): string => formatMoney(minor, currency);
const signed = (money: (m: number) => string, minor: number): string => (minor < 0 ? `−${money(-minor)}` : `+${money(minor)}`);

/** The total reward as a multiple of the base price: 2.1 on the default (base + 100% Earned Equity + 10% Credits). */
export function rewardMultiple(model: ValuationModel): number {
  return hundredths((100 + model.reward.equityMatchPct + model.reward.creditsBonusPct) / 100);
}

// ── The reward ───────────────────────────────────────────────────────────────

/** How a piece of work is paid: its total reward broken into cash, Credits and Earned Equity, and its Voice. */
export interface Reward {
  /** The base price paid as cash and Credits, in whole units. */
  baseUnits: number;
  equityUnits: number;
  bonusUnits: number;
  /** Null when no cash is paid. */
  cashMinor: number | null;
  /** The total reward in minor units: cash + Credits + Earned Equity. */
  totalMinor: number;
  /** Credits (the base the budget does not cover, plus the bonus) and Earned Equity. A token at nothing is left out. */
  payTokens: TokenAmount[];
  /** Everything paid, as Voice. */
  voice: TokenAmount;
  lines: ValuationLine[];
}

/** The share of the base asked for in cash: what a person or budget sets, else the model's default, held to 0–100. */
const cashShare = (model: ValuationModel, asked: number | undefined): number =>
  clamp(Math.round(finite(asked) ? asked : model.reward.defaultCashPct), 0, 100);

/** Cash, Credits, Earned Equity and Voice from the base, the match and the bonus, with the working's tail. */
function payOut(
  model: ValuationModel,
  money: (m: number) => string,
  parts: { baseUnits: number; equityUnits: number; bonusUnits: number },
  opts: { cashPct?: number; fixedCashMinor?: number },
): Omit<Reward, "lines"> & { lines: ValuationLine[] } {
  const { baseUnits, equityUnits, bonusUnits } = parts;
  const fixed = finite(opts.fixedCashMinor) && opts.fixedCashMinor > 0 ? Math.round(opts.fixedCashMinor) : null;
  let cashMinor: number;
  let cashWorking: string;
  if (fixed !== null) {
    cashMinor = Math.min(fixed, baseUnits * 100);
    cashWorking = cashMinor === fixed ? "already set, kept as it is" : `set at ${money(fixed)}, held to the base price`;
  } else {
    const pct = cashShare(model, opts.cashPct);
    cashMinor = down((baseUnits * pct) / 100) * 100;
    cashWorking = `${pct}% of the ${baseUnits} base, from the budget, rounded down`;
  }
  const cashUnits = Math.ceil(cashMinor / 100 - 1e-9);
  const credits = Math.max(0, baseUnits - cashUnits) + bonusUnits;
  const totalMinor = cashMinor + (credits + equityUnits) * 100;
  const voice = { token: model.tokens.voice, amount: down((totalMinor / 100) * model.voicePerUnit) };
  const lines: ValuationLine[] = [
    { key: "cash", label: "Cash", working: cashWorking, result: money(cashMinor) },
    {
      key: `token:${model.tokens.credits}`,
      label: model.tokens.credits,
      token: model.tokens.credits,
      working: `${baseUnits} base − ${cashUnits} cash + ${bonusUnits} bonus`,
      result: String(credits),
    },
    {
      key: `token:${model.tokens.equity}`,
      label: model.tokens.equity,
      token: model.tokens.equity,
      working: `matching the base, ${model.reward.equityMatchPct}%`,
      result: String(equityUnits),
    },
    {
      key: "total",
      label: "Total reward",
      working: `${money(cashMinor)} cash + ${credits} Credits + ${equityUnits} Earned Equity`,
      result: money(totalMinor),
    },
    {
      key: `token:${voice.token}`,
      label: voice.token,
      token: voice.token,
      working: `everything paid × ${model.voicePerUnit} per unit, rounded down`,
      result: String(voice.amount),
    },
  ];
  const payTokens: TokenAmount[] = [];
  if (credits > 0) payTokens.push({ token: model.tokens.credits, amount: credits });
  if (equityUnits > 0) payTokens.push({ token: model.tokens.equity, amount: equityUnits });
  return { baseUnits, equityUnits, bonusUnits, cashMinor: cashMinor > 0 ? cashMinor : null, totalMinor, payTokens, voice, lines };
}

/**
 * The reward for a base price: Earned Equity matching it, the Credits bonus on
 * top, the base paid in cash (`cashPct` of it, or cash already set) and Credits.
 * Every amount rounds down to whole units.
 */
export function rewardFromBase(
  model: ValuationModel,
  baseMinor: number,
  opts: { cashPct?: number; fixedCashMinor?: number } = {},
): Reward {
  const money = moneyIn(model.currency);
  const units = Math.max(0, baseMinor) / 100;
  const parts = {
    baseUnits: down(units),
    equityUnits: down((units * model.reward.equityMatchPct) / 100),
    bonusUnits: down((units * model.reward.creditsBonusPct) / 100),
  };
  const head: ValuationLine[] = [
    { key: "match", label: "Earned Equity match", working: `${model.reward.equityMatchPct}% of ${money(baseMinor)}, rounded down`, result: String(parts.equityUnits), token: model.tokens.equity },
    { key: "bonus", label: "Credits bonus", working: `${model.reward.creditsBonusPct}% of ${money(baseMinor)}, rounded down`, result: String(parts.bonusUnits), token: model.tokens.credits },
  ];
  const out = payOut(model, money, parts, opts);
  return { ...out, lines: [...head, ...out.lines] };
}

/**
 * The reward when the TOTAL is given (a source's figure for the whole
 * arrangement): the total shared into the base, the Earned Equity match and the
 * Credits bonus in the model's proportions, adding up to the total exactly.
 */
export function rewardFromTotal(
  model: ValuationModel,
  totalMinor: number,
  opts: { cashPct?: number; fixedCashMinor?: number } = {},
): Reward {
  const money = moneyIn(model.currency);
  const total = down(Math.max(0, totalMinor) / 100);
  const k = 100 + model.reward.equityMatchPct + model.reward.creditsBonusPct;
  const equityUnits = down((total * model.reward.equityMatchPct) / k);
  const bonusUnits = down((total * model.reward.creditsBonusPct) / k);
  const parts = { baseUnits: total - equityUnits - bonusUnits, equityUnits, bonusUnits };
  const head: ValuationLine[] = [
    {
      key: "shares",
      label: "The total, shared out",
      working: `${total} as base ${100}, Earned Equity ${model.reward.equityMatchPct} and Credits bonus ${model.reward.creditsBonusPct}, out of ${k}`,
      result: `${parts.baseUnits} + ${equityUnits} + ${bonusUnits}`,
    },
  ];
  const out = payOut(model, money, parts, opts);
  return { ...out, lines: [...head, ...out.lines] };
}

/** The tokens to store for a reward: Voice, plus Credits and Earned Equity. */
export function paidTokens(p: { voice: TokenAmount; payTokens: TokenAmount[] | null }): TokenAmount[] {
  return [...(p.voice.amount > 0 ? [p.voice] : []), ...(p.payTokens ?? [])];
}

// ── A quest or a role from its effort lines ─────────────────────────────────

/**
 * Who an effort line pays:
 *   - "lead": one person (people is always 1).
 *   - "each": every person who joins is paid this line, per person; `peopleExpected` sets the cost.
 *   - "crew": one payment for the whole crew, for all its people's estimated effort.
 */
export type Payee = "lead" | "each" | "crew";
const PAYEES: readonly Payee[] = ["lead", "each", "crew"];
const PAYEE_WORDS: Record<Payee, string> = { lead: "the lead", each: "each person who joins", crew: "the crew, together" };

/**
 * One band, one payee, its people and their estimated effort. Hours are only
 * an ESTIMATE that sets the price; they are never a rate of pay, a schedule, or
 * a record of time worked, and the price does not move with the hours spent.
 */
export interface EffortLine {
  band: string;
  payee: Payee;
  /** People on the line. "lead" is always 1; "each" counts per person, so it is 1 there too. */
  people?: number;
  /** The estimated hours of effort, per person. */
  estimatedHours: number;
  estimateLow?: number;
  estimateHigh?: number;
}

export interface MaterialLine {
  label: string;
  amountMinor: number;
  source?: string;
}

/** What a piece of work carries into the model. */
export interface WorkInputs {
  kind: "quest" | "role";
  lines: EffortLine[];
  /** A complexity level's key. */
  complexity?: string | null;
  /** A responsibility level's key (roles). */
  responsibility?: string | null;
  /** Village benefit, in whole percents of labour. */
  benefitPct?: number;
  benefitReason?: string | null;
  /** A budget line, never pay. */
  materials?: MaterialLine[];
  /** How many people join, for "each" lines. */
  peopleExpected?: number;
  /** The share of the base price paid in cash, from the budget. */
  cashPct?: number;
}

/** One payee's figure. */
export interface PayeePrice extends Reward {
  payee: Payee;
  /** How many are paid this figure: `peopleExpected` for "each", 1 otherwise. */
  paidCount: number;
  labourMinor: number;
  complexityMinor: number;
  responsibilityMinor: number;
  benefitMinor: number;
  /** The base price, at minimum wage, with the adjustments. */
  priceMinor: number;
  /** The base price at the low and the high estimates. Null when no line gives a range. */
  rangeMinor: { low: number; high: number } | null;
  /** The total reward is under the model's minimum quest value. */
  belowMinimum: boolean;
}

export interface WorkPrice {
  modelVersion: number;
  currency: string;
  /** A village benefit is set, so a finance or steward role who is not paid by this work must approve it (Rye, 2026-10-31). */
  benefitNeedsApproval: boolean;
  payees: PayeePrice[];
  materialsMinor: number;
  /** Every payee's total reward times how many are paid, plus materials. */
  costMinor: number;
  /** The cash every payee's reward draws from the budget, plus materials. */
  cashNeededMinor: number;
  /** The lines shared by the whole work: model, materials, cost. Each payee carries its own. */
  lines: ValuationLine[];
  warnings: string[];
}

export type WorkPriceResult = { ok: true; price: WorkPrice } | { ok: false; problems: string[] };

/**
 * A quest or a role priced from its effort lines, with every line of the
 * working. A role passes its effort estimate for the moon (`effortPerMoon`).
 *
 * Every adjustment is a percentage OF LABOUR, worked on each payee's own
 * labour, so the lines simply add up. Village benefit never applies to
 * materials (Rye, 2026-10-30: materials are never member pay). Refuses, with
 * every reason, an unknown band, a band with no value, a level the model lacks,
 * a benefit outside the model's bounds or without a reason, and bad estimates.
 */
export function priceWork(model: ValuationModel, work: WorkInputs): WorkPriceResult {
  const money = moneyIn(model.currency);
  const problems: string[] = [];
  if (!work.lines.length) problems.push("Add at least one effort line.");

  const level = (list: ValuationLevel[], key: string | null | undefined, what: string): ValuationLevel | null => {
    if (!key) return null;
    const hit = list.find((l) => l.key === key);
    if (!hit) problems.push(`The model has no ${what} level "${key}".`);
    return hit ?? null;
  };
  const cx = level(model.complexity, work.complexity, "complexity");
  const resp = level(model.responsibility, work.responsibility, "responsibility");
  const benefitPct = finite(work.benefitPct) ? Math.round(work.benefitPct) : 0;
  const reason = (work.benefitReason ?? "").trim();
  if (Math.abs(benefitPct) > model.benefit.maxPct) {
    problems.push(`Village benefit is held to ±${model.benefit.maxPct}% of labour. A wider swing needs a finance or steward role to change the model.`);
  }
  if (benefitPct !== 0 && !reason) problems.push("Give a one-line reason for the village benefit.");

  const bandOf = (key: string): RateBand | null => {
    const b = model.bands.find((x) => x.key === key);
    if (!b) problems.push(`The model has no band "${key}". Set your rates first.`);
    else if (!(b.hourValueMinor > 0)) problems.push(`The band "${b.label}" has no value yet. Set your rates first.`);
    return b && b.hourValueMinor > 0 ? b : null;
  };
  type Shown = { line: EffortLine; band: RateBand; people: number; hours: number; low: number; high: number };
  const shown: Shown[] = [];
  work.lines.forEach((line, i) => {
    const band = bandOf(line.band);
    if (!PAYEES.includes(line.payee)) problems.push(`Line ${i + 1} names no payee: the lead, each person who joins, or a crew.`);
    const people = line.payee === "crew" ? Math.round(line.people ?? 1) : 1;
    if (line.payee === "lead" && finite(line.people) && line.people !== 1) problems.push(`Line ${i + 1} pays the lead, which is one person.`);
    if (line.payee === "crew" && !(people >= 1)) problems.push(`Line ${i + 1} needs at least one person in the crew.`);
    const hours = finite(line.estimatedHours) ? hundredths(line.estimatedHours) : NaN;
    const low = finite(line.estimateLow) ? hundredths(line.estimateLow) : hours;
    const high = finite(line.estimateHigh) ? hundredths(line.estimateHigh) : hours;
    if (!(hours > 0)) problems.push(`Line ${i + 1} needs its estimated hours.`);
    else if (!(low <= hours && hours <= high && low > 0)) problems.push(`Line ${i + 1}'s estimates must run low, then expected, then high.`);
    if (band) shown.push({ line, band, people, hours, low, high });
  });
  for (const m of work.materials ?? []) {
    if (!finite(m.amountMinor) || m.amountMinor < 0) problems.push(`The material "${m.label}" needs an amount of zero or more.`);
  }
  if (problems.length) return { ok: false, problems };

  const pct = (minor: number, p: number): number => Math.round((minor * p) / 100);
  const warnings: string[] = [];
  const payees: PayeePrice[] = [];
  for (const payee of PAYEES) {
    const mine = shown.filter((s) => s.line.payee === payee);
    if (!mine.length) continue;
    const lines: ValuationLine[] = [];
    const labourAt = (h: (s: Shown) => number): number => mine.reduce((sum, s) => sum + Math.round(s.people * h(s) * s.band.hourValueMinor), 0);
    for (const s of mine) {
      const minor = Math.round(s.people * s.hours * s.band.hourValueMinor);
      lines.push({
        key: `labour:${s.band.key}`,
        label: `Estimated effort, ${s.band.label}`,
        working: `${s.people > 1 ? `${s.people} people × ` : ""}${estimateWords(s.hours)} × ${money(s.band.hourValueMinor)} minimum wage`,
        result: money(minor),
      });
    }
    const labourMinor = labourAt((s) => s.hours);
    const complexityMinor = cx ? pct(labourMinor, cx.pct) : 0;
    const responsibilityMinor = resp ? pct(labourMinor, resp.pct) : 0;
    const benefitMinor = pct(labourMinor, benefitPct);
    if (cx) lines.push({ key: "complexity", label: "Complexity", working: `${cx.label}, ${cx.pct}% of ${money(labourMinor)}`, result: signed(money, complexityMinor) });
    if (resp) {
      lines.push({ key: "responsibility", label: "Responsibility", working: `${resp.label}, ${resp.pct}% of ${money(labourMinor)}`, result: signed(money, responsibilityMinor) });
    }
    if (benefitPct !== 0) {
      lines.push({ key: "benefit", label: "Village benefit", working: `${benefitPct}% of ${money(labourMinor)}: ${reason}`, result: signed(money, benefitMinor) });
    }
    const priceMinor = labourMinor + complexityMinor + responsibilityMinor + benefitMinor;
    lines.push({ key: "base", label: "Base price", working: `for ${PAYEE_WORDS[payee]}, on completion`, result: money(priceMinor) });

    const ranged = mine.some((s) => s.low !== s.hours || s.high !== s.hours);
    const sumAt = (h: (s: Shown) => number): number => {
      const l = labourAt(h);
      return l + (cx ? pct(l, cx.pct) : 0) + (resp ? pct(l, resp.pct) : 0) + pct(l, benefitPct);
    };
    const rangeMinor = ranged ? { low: sumAt((s) => s.low), high: sumAt((s) => s.high) } : null;
    if (rangeMinor) lines.push({ key: "range", label: "Range", working: "the base price at the low and the high estimates", result: `${money(rangeMinor.low)} to ${money(rangeMinor.high)}` });

    const reward = rewardFromBase(model, priceMinor, { cashPct: work.cashPct });
    const belowMinimum = work.kind === "quest" && reward.totalMinor < model.minQuestMinor;
    if (belowMinimum) warnings.push(`The reward for ${PAYEE_WORDS[payee]} is under the model's minimum quest value of ${money(model.minQuestMinor)}.`);
    const paidCount = payee === "each" ? Math.max(1, Math.round(work.peopleExpected ?? 1)) : 1;
    payees.push({ ...reward, payee, paidCount, labourMinor, complexityMinor, responsibilityMinor, benefitMinor, priceMinor, rangeMinor, belowMinimum, lines: [...lines, ...reward.lines] });
  }

  const shared: ValuationLine[] = [{ key: "model", label: "Model", working: versionWords(model.version), result: `v${model.version}` }];
  const materials = work.materials ?? [];
  const materialsMinor = materials.reduce((sum, m) => sum + Math.round(m.amountMinor), 0);
  materials.forEach((m, i) =>
    shared.push({ key: `material:${i}`, label: m.label, working: m.source ? `budget, never pay · ${m.source}` : "budget, never pay", result: money(m.amountMinor) }),
  );
  const costMinor = payees.reduce((sum, p) => sum + p.totalMinor * p.paidCount, 0) + materialsMinor;
  const cashNeededMinor = payees.reduce((sum, p) => sum + (p.cashMinor ?? 0) * p.paidCount, 0) + materialsMinor;
  const costWords = payees.map((p) => (p.paidCount > 1 ? `${p.paidCount} × ${money(p.totalMinor)}` : money(p.totalMinor)));
  if (materialsMinor > 0) costWords.push(money(materialsMinor));
  shared.push({ key: "cost", label: "Total reward to the village", working: costWords.join(" + "), result: money(costMinor) });
  shared.push({ key: "cashNeeded", label: "Cash from the budget", working: "cash in every reward, plus materials", result: money(cashNeededMinor) });

  return {
    ok: true,
    price: { modelVersion: model.version, currency: model.currency, benefitNeedsApproval: benefitPct !== 0, payees, materialsMinor, costMinor, cashNeededMinor, lines: shared, warnings },
  };
}

/** A weekly effort estimate as an estimate for the moon, worked from the figure shown. */
export function effortPerMoon(hoursAWeek: number): number {
  return hundredths((hundredths(hoursAWeek) * DAYS_A_MOON) / 7);
}

// ── A role from the source's monthly figure ─────────────────────────────────

/** A role's suggested reward for one moon, from the source's monthly figure. */
export interface RolePrice {
  modelVersion: number;
  currency: "USD";
  /** The total reward for the moon. */
  valueMinorPerMoon: number;
  /** Everything paid, as Voice. Set whoever splits the reward. */
  voice: TokenAmount;
  /** "model": the model suggests the breakdown. "person": a person sets it. */
  splitBy: "model" | "person";
  /** Null when no cash is suggested, and always when a person sets the breakdown. */
  cashMinor: number | null;
  /** Credits and Earned Equity. Null when a person sets the breakdown. */
  payTokens: TokenAmount[] | null;
  lines: ValuationLine[];
}

/**
 * The source's pay models whose breakdown the model suggests (Rye, 2026-10-31).
 * Volunteer, Reciprocity / In-Kind, Revenue Share, Equity / Ownership and any
 * model not named here show the figure, and a person sets the breakdown.
 */
export const AUTO_SPLIT_MODELS: readonly string[] = ["Stipend", "Part-Time Salaried", "Full-Time Salaried", "Hybrid"];

const modelKey = (s: string): string => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
const AUTO_SPLIT_KEYS = new Set(AUTO_SPLIT_MODELS.map(modelKey));

/** Whether the source's pay model splits itself. Case, spacing and dashes do not matter. */
export function autoSplits(model: string | null | undefined): boolean {
  return typeof model === "string" && AUTO_SPLIT_KEYS.has(modelKey(model));
}

/**
 * Whether the source's figure may be written to the role: only a settled one
 * (the source's "Active") with a figure. Pending and agreed-not-paying figures
 * are shown, never written (Rye, 2026-10-31).
 */
export function sourcePayWrites(sp: SourcePay | null | undefined): boolean {
  return !!sp && sp.standing === "settled" && sp.monthlyUsd !== null;
}

/** The tokens to store on the role for a price: Voice, plus Credits and Earned Equity when the model split the reward. */
export function rolePriceTokens(p: RolePrice): TokenAmount[] {
  return paidTokens(p);
}

/**
 * A role's reward for one moon from the source's monthly figure, with every
 * line of the working. Null when the source sends no figure, or when the model
 * does not price in dollars (the figure is dollars, and nothing here converts it).
 *
 * THE SOURCE'S FIGURE IS THE WHOLE ARRANGEMENT'S VALUE (its Operations role,
 * 2026-10-30), so it is the TOTAL reward, shared into the base, the Earned
 * Equity match and the Credits bonus (`rewardFromTotal`). Whether Earned Equity
 * should instead sit on top of it is Rye's to say.
 *
 * It prices whatever the figure's standing, so a pending figure can be shown;
 * whether it may be WRITTEN is `sourcePayWrites`. `opts.cashMinorPerMoon` is
 * cash already set on the role: it is kept, up to the base.
 */
export function priceRoleFromMonthly(
  model: ValuationModel,
  sourcePay: SourcePay | null,
  opts: { cashPct?: number; cashMinorPerMoon?: number } = {},
): RolePrice | null {
  if (!sourcePay || sourcePay.monthlyUsd === null) return null;
  if (model.currency.trim().toUpperCase() !== "USD") return null;
  const money = moneyIn("USD");

  const monthlyMinor = Math.round(sourcePay.monthlyUsd * 100);
  const valueMinor = Math.round((monthlyMinor * DAYS_A_MOON) / DAYS_A_MONTH);
  const sourceWords = [sourcePay.model, sourcePay.statusLabel].filter(Boolean).join(", ") || "no model or status sent";
  const head: ValuationLine[] = [
    { key: "model", label: "Model", working: versionWords(model.version), result: `v${model.version}` },
    { key: "source", label: "Monthly figure from the source", working: sourceWords, result: `${money(monthlyMinor)} a month` },
    { key: "moon", label: "Total reward for the moon", working: `${money(monthlyMinor)} × ${DAYS_A_MOON} days ÷ ${DAYS_A_MONTH} days`, result: money(valueMinor) },
  ];
  const reward = rewardFromTotal({ ...model, currency: "USD" }, valueMinor, { cashPct: opts.cashPct, fixedCashMinor: opts.cashMinorPerMoon });
  const base = { modelVersion: model.version, currency: "USD" as const, valueMinorPerMoon: valueMinor, voice: reward.voice };

  if (!autoSplits(sourcePay.model)) {
    const voiceLine = reward.lines.find((l) => l.key === `token:${model.tokens.voice}`)!;
    const split: ValuationLine = {
      key: "split",
      label: "How it is paid",
      working: `${sourcePay.model ?? "A role with no pay model"} is not split by the model`,
      result: "set by a person",
    };
    return { ...base, splitBy: "person", cashMinor: null, payTokens: null, lines: [...head, voiceLine, split] };
  }
  return { ...base, splitBy: "model", cashMinor: reward.cashMinor, payTokens: reward.payTokens, lines: [...head, ...reward.lines] };
}

// ── The model as a whole: bounds, spread, changes, preview ──────────────────

/** The highest band's value over the lowest, to two places. Null with fewer than two valued bands. */
export function bandSpread(model: ValuationModel): number | null {
  const rates = model.bands.map((b) => b.hourValueMinor).filter((r) => r > 0);
  if (rates.length < 2) return null;
  return hundredths(Math.max(...rates) / Math.min(...rates));
}

/**
 * How many times its legal floor a band's base value is, to two places,
 * converting the floor at the model's exchange rate. Null when the band names
 * no floor, or the floor's currency needs a rate the model does not hold.
 */
export function floorMultiple(model: ValuationModel, band: RateBand): number | null {
  const f = band.floor;
  if (!f || !(f.perHourMinor > 0)) return null;
  let floorInModel: number;
  if (f.currency === model.currency) floorInModel = f.perHourMinor;
  else if (model.exchange && model.exchange.currency === f.currency && model.exchange.perUnit > 0) floorInModel = f.perHourMinor / model.exchange.perUnit;
  else return null;
  return hundredths(band.hourValueMinor / floorInModel);
}

/** The total reward for an estimated hour as a multiple of the legal floor: "N× the minimum wage", for the model's page only. */
export function rewardFloorMultiple(model: ValuationModel, band: RateBand): number | null {
  const base = floorMultiple(model, band);
  return base === null ? null : hundredths(base * rewardMultiple(model));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every reason a model may not be saved. Empty when it may. */
export function validateModel(model: ValuationModel): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{3}$/.test(model.currency)) out.push("The currency must be a three-letter code.");
  if (!(model.voicePerUnit > 0)) out.push("Voice per unit must be more than zero.");
  const r = model.reward;
  if (!(r.equityMatchPct >= 0 && r.equityMatchPct <= 300)) out.push("The Earned Equity match must be between 0% and 300% of the base.");
  if (!(r.creditsBonusPct >= 0 && r.creditsBonusPct <= 100)) out.push("The Credits bonus must be between 0% and 100% of the base.");
  if (!(r.defaultCashPct >= 0 && r.defaultCashPct <= 100)) out.push("The default cash share must be between 0% and 100% of the base.");
  const keys = new Set<string>();
  for (const b of model.bands) {
    if (keys.has(b.key)) out.push(`Two bands share the key "${b.key}".`);
    keys.add(b.key);
    if (!b.label.trim()) out.push(`The band "${b.key}" needs a name.`);
    if (!(b.hourValueMinor >= 0)) out.push(`The band "${b.label}" needs a value of zero or more.`);
    if (b.hourValueMinor > 0 && (!b.source || !b.source.sentence.trim() || !ISO_DATE.test(b.source.date))) {
      out.push(`The band "${b.label}" needs a source sentence and a date.`);
    }
  }
  const levels = (list: ValuationLevel[], what: string, max: number): void => {
    const seen = new Set<string>();
    for (const l of list) {
      if (seen.has(l.key)) out.push(`Two ${what} levels share the key "${l.key}".`);
      seen.add(l.key);
      if (!(l.pct >= 0 && l.pct <= max)) out.push(`The ${what} level "${l.label}" must be between 0% and ${max}%.`);
    }
  };
  levels(model.complexity, "complexity", 30);
  levels(model.responsibility, "responsibility", 25);
  for (const b of model.bands) {
    const base = floorMultiple(model, b);
    const total = rewardFloorMultiple(model, b);
    if (base !== null && base < 1) out.push(`The band "${b.label}" is valued under its legal floor.`);
    if (total !== null && total < HARD_MINIMUM_MULTIPLE) out.push(`The band "${b.label}" rewards under ${HARD_MINIMUM_MULTIPLE}x its legal floor in total.`);
  }
  if (!(model.benefit.maxPct >= 0 && model.benefit.maxPct <= 25)) out.push("The village benefit range must be between 0% and 25%.");
  if (model.voiceCapPerMemberPerMoon !== null && !(model.voiceCapPerMemberPerMoon > 0)) out.push("A Voice cap must be more than zero, or off.");
  if (!(model.minQuestMinor >= 0)) out.push("The minimum quest value must be zero or more.");
  if (model.exchange && (!(model.exchange.perUnit > 0) || !ISO_DATE.test(model.exchange.source.date))) {
    out.push("The exchange rate needs a rate above zero and a dated source.");
  }
  return out;
}

/**
 * Which door a change needs: a saved version, a finance or steward role's
 * approval, a village proposal, or the founder ring.
 */
export type ChangeDoor = "version" | "steward" | "proposal" | "founder";

export interface ModelChange {
  key: string;
  label: string;
  from: string;
  to: string;
  door: ChangeDoor;
}

/** How far one version may move a band's value before the change needs a village proposal. */
export const VERSION_RATE_STEP_PCT = 10;

const DOOR_RANK: Record<ChangeDoor, number> = { version: 0, steward: 1, proposal: 2, founder: 3 };

/** The strictest door any of the changes needs. */
export function doorFor(changes: readonly ModelChange[]): ChangeDoor {
  return changes.reduce<ChangeDoor>((d, c) => (DOOR_RANK[c.door] > DOOR_RANK[d] ? c.door : d), "version");
}

/**
 * Every difference between two versions, value by value, with the door each
 * one needs (VALUATION_MODEL_PLAN.md 3.1):
 *   - founder: the currency, the Voice rate, the Voice cap.
 *   - proposal: a band value moving more than 10%, a band removed, the band spread.
 *   - steward: the village benefit range (a finance or steward role approves).
 *   - version: everything else within its bounds, the reward settings among them
 *     (Rye, 2026-10-31: "these are all settings we should be able to tweak in
 *     our valuation model pages").
 */
export function diffModels(from: ValuationModel, to: ValuationModel): ModelChange[] {
  const out: ModelChange[] = [];
  const m = (model: ValuationModel) => moneyIn(model.currency);
  const push = (key: string, label: string, a: unknown, b: unknown, door: ChangeDoor): void => {
    if (String(a) !== String(b)) out.push({ key, label, from: String(a), to: String(b), door });
  };
  push("currency", "Currency", from.currency, to.currency, "founder");
  push("voicePerUnit", "Voice per unit paid", from.voicePerUnit, to.voicePerUnit, "founder");
  const cap = (x: number | null) => (x === null ? "off" : String(x));
  push("voiceCap", "Voice cap per member per moon", cap(from.voiceCapPerMemberPerMoon), cap(to.voiceCapPerMemberPerMoon), "founder");
  const per = (model: ValuationModel, minor: number) => `${m(model)(minor)} per estimated hour`;
  for (const b of to.bands) {
    const was = from.bands.find((x) => x.key === b.key);
    if (!was) {
      out.push({ key: `band:${b.key}`, label: `Band ${b.label}`, from: "none", to: per(to, b.hourValueMinor), door: "version" });
      continue;
    }
    if (was.hourValueMinor !== b.hourValueMinor) {
      const step = was.hourValueMinor > 0 ? (Math.abs(b.hourValueMinor - was.hourValueMinor) / was.hourValueMinor) * 100 : Infinity;
      out.push({
        key: `band:${b.key}`,
        label: `Band ${b.label}`,
        from: per(from, was.hourValueMinor),
        to: per(to, b.hourValueMinor),
        door: step > VERSION_RATE_STEP_PCT + 1e-9 ? "proposal" : "version",
      });
    }
    if ((was.source?.sentence ?? "") !== (b.source?.sentence ?? "") || (was.source?.date ?? "") !== (b.source?.date ?? "")) {
      out.push({ key: `source:${b.key}`, label: `Source for ${b.label}`, from: was.source?.sentence ?? "none", to: b.source?.sentence ?? "none", door: "version" });
    }
  }
  for (const b of from.bands) {
    if (!to.bands.some((x) => x.key === b.key)) out.push({ key: `band:${b.key}`, label: `Band ${b.label}`, from: per(from, b.hourValueMinor), to: "removed", door: "proposal" });
  }
  push("spread", "Band spread (highest ÷ lowest)", bandSpread(from) ?? "none", bandSpread(to) ?? "none", "proposal");
  const levels = (a: ValuationLevel[], b: ValuationLevel[], what: string): void => {
    for (const l of b) push(`${what}:${l.key}`, `${what === "complexity" ? "Complexity" : "Responsibility"}: ${l.label}`, `${a.find((x) => x.key === l.key)?.pct ?? "none"}%`, `${l.pct}%`, "version");
  };
  levels(from.complexity, to.complexity, "complexity");
  levels(from.responsibility, to.responsibility, "responsibility");
  push("benefit", "Village benefit range", `±${from.benefit.maxPct}%`, `±${to.benefit.maxPct}%`, "steward");
  push("equityMatch", "Earned Equity match", `${from.reward.equityMatchPct}%`, `${to.reward.equityMatchPct}%`, "version");
  push("creditsBonus", "Credits bonus", `${from.reward.creditsBonusPct}%`, `${to.reward.creditsBonusPct}%`, "version");
  push("defaultCash", "Default cash share of the base", `${from.reward.defaultCashPct}%`, `${to.reward.defaultCashPct}%`, "version");
  push("minQuest", "Minimum quest value", m(from)(from.minQuestMinor), m(to)(to.minQuestMinor), "version");
  const ex = (x: ValuationModel["exchange"]) => (x ? `${x.perUnit} ${x.currency} per unit (${x.source.date})` : "none");
  push("exchange", "Exchange rate", ex(from.exchange), ex(to.exchange), "version");
  return out;
}

/**
 * How much Voice a payment may carry for a member under the model's cap, given
 * what they have already been paid this moon. No cap, no change. The engine
 * applies it at payment; the pricer cannot see a member's moon.
 */
export function capVoice(model: ValuationModel, alreadyThisMoon: number, amount: number): number {
  const cap = model.voiceCapPerMemberPerMoon;
  if (cap === null) return amount;
  return clamp(Math.floor(cap - Math.max(0, alreadyThisMoon)), 0, amount);
}

/** How Voice is spread across members: the figures the governance page's graphic needs. */
export interface VoiceDistribution {
  members: number;
  total: number;
  /** The share held by the three largest holders, 0 to 1. */
  top3Share: number;
  /** The share held by the largest tenth of holders (at least one), 0 to 1. */
  topTenthShare: number;
  /** 0 when everyone holds the same, towards 1 when one member holds it all. */
  gini: number;
}

/** Voice concentration from members' balances. Zero and negative balances count as zero. */
export function voiceDistribution(balances: readonly number[]): VoiceDistribution {
  const xs = balances.map((b) => (finite(b) && b > 0 ? b : 0)).sort((a, b) => b - a);
  const n = xs.length;
  const total = xs.reduce((s, x) => s + x, 0);
  if (!n || total === 0) return { members: n, total, top3Share: 0, topTenthShare: 0, gini: 0 };
  const share = (k: number) => xs.slice(0, k).reduce((s, x) => s + x, 0) / total;
  // Gini from the ascending order: sum of (2i - n - 1) * x_i over n * total.
  const asc = [...xs].reverse();
  const g = asc.reduce((s, x, i) => s + (2 * (i + 1) - n - 1) * x, 0) / (n * total);
  const round4 = (v: number) => Math.round(v * 10000) / 10000;
  return { members: n, total, top3Share: round4(share(3)), topTenthShare: round4(share(Math.max(1, Math.round(n / 10)))), gini: round4(g) };
}

/** One payee's total reward before and after a proposed version. */
export interface ImpactRow {
  work: string;
  payee: Payee;
  beforeMinor: number | null;
  afterMinor: number | null;
}

/**
 * Who would gain or lose under a proposed version: each sample work priced
 * under both, payee by payee, plus the change in total reward to the village.
 * A work that one version cannot price shows null on that side, so the preview
 * never hides it.
 */
export function previewImpact(
  from: ValuationModel,
  to: ValuationModel,
  works: readonly { label: string; inputs: WorkInputs }[],
): { rows: ImpactRow[]; costBeforeMinor: number; costAfterMinor: number } {
  const rows: ImpactRow[] = [];
  let costBeforeMinor = 0;
  let costAfterMinor = 0;
  for (const w of works) {
    const a = priceWork(from, w.inputs);
    const b = priceWork(to, w.inputs);
    if (a.ok) costBeforeMinor += a.price.costMinor;
    if (b.ok) costAfterMinor += b.price.costMinor;
    for (const payee of PAYEES) {
      if (!w.inputs.lines.some((l) => l.payee === payee)) continue;
      const pa = a.ok ? a.price.payees.find((p) => p.payee === payee) : undefined;
      const pb = b.ok ? b.price.payees.find((p) => p.payee === payee) : undefined;
      rows.push({ work: w.label, payee, beforeMinor: pa?.totalMinor ?? null, afterMinor: pb?.totalMinor ?? null });
    }
  }
  return { rows, costBeforeMinor, costAfterMinor };
}
