/**
 * THE VALUATION ENGINE: the one suggestion any editing surface asks for.
 *
 * Rye, 2026-11-06 (relayed): "Role pay is set by the Treasurer AND the
 * valuation algorithm", with value in equal to value out. This file is the
 * algorithm's half. It wraps the pricer (`shared/valuation.ts`, which holds the
 * arithmetic of Rye's reward rule and its own tests) and adds what a person
 * needs to set a figure with it:
 *
 *   - VALUE IN: the suggested total reward price, split into cash, Credits and
 *     Earned Equity, with Voice for everything paid (II.7, II.8).
 *   - A RANGE, as two totals and plain words, with the reason it is as wide as
 *     it is. It is information only.
 *   - A NO-SIGN BAND, the expected total plus or minus a dial (10%). It is
 *     separate from the range on purpose: wide estimates never widen it, so a
 *     proposer cannot make any figure "inside" by guessing wide (QA G3).
 *   - A RECEIPT a member can follow, folded and unfolded, with NO per-hour
 *     figure anywhere (II.10, II.11), and no hours at all unless the village
 *     turns `receiptShowsHours` on (Rye, 2026-11-06: "we're not paying for
 *     hours we're paying for contributions (value in)"). `priceWork`'s own
 *     lines keep the rates, and they belong to the economics page only.
 *   - LEVERS for the setter: the nearest level up and down, each repriced by
 *     this engine. A lever never changes the hours alone, because a step per
 *     hour is an hourly figure (QA F13).
 *
 * It SUGGESTS. It writes nothing and decides nothing (Rye, 2026-10-30). It never
 * caps a figure (II.6) and never reads Gratitude (II.4): its inputs are the
 * model, the work, and three facts about the village.
 *
 * Pure: no clock, no pool, no I/O.
 */
import {
  ENGINE_DEFAULTS,
  PLATFORM_DEFAULT_MODEL,
  priceWork,
  rewardFromBase,
  type EngineDials,
  type Payee,
  type PayeePrice,
  type ValuationModel,
  type WorkInputs,
  voiceFor,
} from "./valuation";
import { exponentOf } from "./money";

export { ENGINE_DEFAULTS };

const dialsOf = (model: ValuationModel): EngineDials => ({ ...ENGINE_DEFAULTS, ...(model.engine ?? {}) });

/**
 * The model a village prices with: its own saved version, or the platform's
 * rules in the village's OWN currency (II.27: the platform never assumes one).
 * The minimum quest value is left blank (0, no warning) until the village sets
 * one, because 500 minor units is $5 in one place and ₡5 in another.
 */
export function modelForVillage(currency: string, saved?: ValuationModel | null): ValuationModel {
  if (saved) return saved;
  return { ...PLATFORM_DEFAULT_MODEL, currency: currency.trim().toUpperCase(), minQuestMinor: 0 };
}

/** Money in whole units with the currency's own symbol, as a member reads it: "₡15,668". */
export function wholeMoney(minor: number, currency: string): string {
  const major = Math.trunc(minor / Math.pow(10, exponentOf(currency)));
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(major);
  } catch {
    return `${major.toLocaleString("en")} ${currency}`;
  }
}
const signedWhole = (minor: number, currency: string): string => (minor < 0 ? `−${wholeMoney(-minor, currency)}` : `+${wholeMoney(minor, currency)}`);

/** One line of the receipt: what it is, and what it came to. A token line carries `token` for the card to name. */
export interface ReceiptLine {
  key: string;
  label: string;
  result: string;
}

/** What the work pays, ready for the card to render with live token names. Cash is in minor units under "cash". */
export interface PaidAs {
  token: string;
  amount: number;
  /** Earned Equity owed once the village says what it means (#892). */
  owed?: true;
}

export type RangeWidth = "narrow" | "medium" | "wide";

/** A change the setter could make, and the total it would come to. */
export interface Lever {
  key: string;
  label: string;
  /** Which input it changes. Never "hours" alone. */
  changes: "complexity" | "responsibility";
  totalMinor: number;
  deltaMinor: number;
}

export interface PayeeSuggestion {
  payee: Payee;
  paidCount: number;
  expected: {
    /** VALUE IN: the total reward price, with any Earned Equity owed counted in it. */
    totalMinor: number;
    cashMinor: number | null;
    credits: number;
    /** Earned Equity paid now. */
    earnedEquity: number;
    /** Earned Equity owed until the village writes what it means. */
    earnedEquityHeld: number;
    /** Voice for everything paid now. */
    voice: number;
  };
  range: { lowTotalMinor: number; highTotalMinor: number; width: RangeWidth; why: string[] };
  /** Inside this, one setter's word stands (spec 3.4). Never widened by estimates or calibration. */
  band: { lowMinor: number; highMinor: number };
  receipt: { folded: ReceiptLine[]; unfolded: ReceiptLine[] };
  paidAs: PaidAs[];
  levers: Lever[];
  /** Present on a contract-price suggestion (P1, `shared/valuationContract.ts`). */
  contract?: {
    deliverable: string;
    acceptance: string | null;
    /** The effort-based figure, worked beside the contract as a reference. Never paid. */
    reference: { totalMinor: number; lowTotalMinor: number; highTotalMinor: number } | null;
    /** The contract's base is under minimum wage for the estimated effort (II.10). A warning, never a refusal. */
    belowFloor: boolean;
  };
}

/** A refusal names where it is fixed (IV.8), so nothing is a dead end (0.4). */
export interface Refusal {
  problem: string;
  fixAt: "valuation:bands" | "valuation:levels" | "work:inputs";
}
export interface Warning {
  text: string;
  fixAt?: string;
}

export type Suggestion =
  | { ok: true; modelVersion: number; currency: string; payees: PayeeSuggestion[]; warnings: Warning[] }
  | { ok: false; refusals: Refusal[] };

/** The three facts about the village the engine reads. Nothing else reaches it. */
export interface EngineContext {
  /** Whether the village has written what Earned Equity is a share of (#892). */
  eeMeaningWritten: boolean;
  /** The cycle's one cash share of the base, from the cash budget (spec 3.7). Absent: the model's default. */
  cashSharePct?: number;
}

const fixFor = (problem: string): Refusal["fixAt"] => {
  if (/Set your rates first/.test(problem)) return "valuation:bands";
  if (/has no (complexity|responsibility) level|benefit is held/.test(problem)) return "valuation:levels";
  return "work:inputs";
};

const hundredths = (n: number): number => Math.round(n * 100) / 100;
const hoursWords = (h: number): string => `${hundredths(h)} ${hundredths(h) === 1 ? "hour" : "hours"}`;

/** The suggestion for one piece of work. */
export function suggestValuation(model: ValuationModel, work: WorkInputs, ctx: EngineContext): Suggestion {
  const inputs: WorkInputs = { ...work, cashPct: ctx.cashSharePct ?? work.cashPct };
  const priced = priceWork(model, inputs);
  if (!priced.ok) return { ok: false, refusals: priced.problems.map((problem) => ({ problem, fixAt: fixFor(problem) })) };

  const dials = dialsOf(model);
  const warnings: Warning[] = priced.price.warnings.map((text) => ({ text }));
  if (!ctx.eeMeaningWritten && model.reward.equityMatchPct > 0) {
    warnings.push({
      text: "Earned Equity is owed on this work until the village says what Earned Equity means.",
      fixAt: "admin:tokens:earned-equity",
    });
  }
  const totalAt = (baseMinor: number): number => rewardFromBase(model, Math.max(0, baseMinor), { cashPct: inputs.cashPct }).totalMinor;

  const payees = priced.price.payees.map((p): PayeeSuggestion => {
    const mine = inputs.lines.filter((l) => l.payee === p.payee);
    const held = ctx.eeMeaningWritten ? 0 : p.equityUnits;
    const credits = p.payTokens.find((t) => t.token === model.tokens.credits)?.amount ?? 0;
    const paidNowMinor = p.totalMinor - held * 100;
    const voice = voiceFor(model, paidNowMinor);

    // The range: the total at the person's own low and high estimates, or the single-estimate spread.
    const why: string[] = [];
    let lowBase: number;
    let highBase: number;
    if (p.rangeMinor) {
      lowBase = p.rangeMinor.low;
      highBase = p.rangeMinor.high;
      const lowH = mine.reduce((s, l) => s + (l.estimateLow ?? l.estimatedHours), 0);
      const highH = mine.reduce((s, l) => s + (l.estimateHigh ?? l.estimatedHours), 0);
      why.push(model.receiptShowsHours ? `the hours could be ${hundredths(lowH)} to ${hundredths(highH)}` : "the effort estimate is a range");
    } else {
      lowBase = Math.round((p.priceMinor * (100 - dials.singleLowPct)) / 100);
      highBase = Math.round((p.priceMinor * (100 + dials.singleHighPct)) / 100);
      why.push("one estimate only");
    }
    const lowTotalMinor = totalAt(lowBase);
    const highTotalMinor = totalAt(highBase);
    const widthPct = p.totalMinor > 0 ? ((highTotalMinor - lowTotalMinor) / p.totalMinor) * 100 : 0;
    const width: RangeWidth = widthPct < dials.narrowPct ? "narrow" : widthPct < dials.mediumPct ? "medium" : "wide";
    const band = { lowMinor: Math.round((p.totalMinor * (100 - dials.bandPct)) / 100), highMinor: Math.round((p.totalMinor * (100 + dials.bandPct)) / 100) };

    const receipt = receiptOf(model, inputs, p, { lowTotalMinor, highTotalMinor, width, why, held });
    const paidAs: PaidAs[] = [];
    if (p.cashMinor) paidAs.push({ token: "cash", amount: p.cashMinor });
    if (credits > 0) paidAs.push({ token: model.tokens.credits, amount: credits });
    if (p.equityUnits > 0) paidAs.push(held ? { token: model.tokens.equity, amount: p.equityUnits, owed: true } : { token: model.tokens.equity, amount: p.equityUnits });
    if (voice > 0) paidAs.push({ token: model.tokens.voice, amount: voice });

    return {
      payee: p.payee,
      paidCount: p.paidCount,
      expected: { totalMinor: p.totalMinor, cashMinor: p.cashMinor, credits, earnedEquity: p.equityUnits - held, earnedEquityHeld: held, voice },
      range: { lowTotalMinor, highTotalMinor, width, why },
      band,
      receipt,
      paidAs,
      levers: leversOf(model, inputs, p, ctx),
    };
  });
  return { ok: true, modelVersion: model.version, currency: model.currency, payees, warnings };
}

const WIDTH_WORDS: Record<RangeWidth, string> = { narrow: "Narrow range", medium: "Medium range", wide: "Wide range" };

/** The receipt, folded and unfolded, worked from the figures shown and carrying no per-hour figure. */
function receiptOf(
  model: ValuationModel,
  work: WorkInputs,
  p: PayeePrice,
  r: { lowTotalMinor: number; highTotalMinor: number; width: RangeWidth; why: string[]; held: number },
): PayeeSuggestion["receipt"] {
  const cur = model.currency;
  const money = (m: number) => wholeMoney(m, cur);
  const unfolded: ReceiptLine[] = [];
  work.lines
    .filter((l) => l.payee === p.payee)
    .forEach((l, i) => {
      const band = model.bands.find((b) => b.key === l.band)!;
      const people = l.payee === "crew" ? Math.round(l.people ?? 1) : 1;
      const hours = hundredths(l.estimatedHours);
      const minor = Math.round(people * hours * band.hourValueMinor);
      const who = model.receiptShowsHours ? (people > 1 ? `, ${people} people, ${hoursWords(hours)} each` : `, ${hoursWords(hours)}`) : people > 1 ? `, ${people} people` : "";
      unfolded.push({ key: `labour:${i}`, label: `Estimated effort, ${band.label}${who}`, result: money(minor) });
    });
  const level = (list: { key: string; label: string; pct: number }[], key: string | null | undefined) => (key ? list.find((x) => x.key === key) : undefined);
  const cx = level(model.complexity, work.complexity);
  const resp = level(model.responsibility, work.responsibility);
  if (cx && cx.pct !== 0) unfolded.push({ key: "complexity", label: `${cx.label}, ${cx.pct}%`, result: signedWhole(p.complexityMinor, cur) });
  if (resp && resp.pct !== 0) unfolded.push({ key: "responsibility", label: `${resp.label}, ${resp.pct}%`, result: signedWhole(p.responsibilityMinor, cur) });
  if (p.benefitMinor !== 0) {
    const pct = Math.round(work.benefitPct ?? 0);
    unfolded.push({ key: "benefit", label: `Good for the village, ${pct}%: ${(work.benefitReason ?? "").trim()}`, result: signedWhole(p.benefitMinor, cur) });
  }
  unfolded.push({ key: "base", label: "Base price", result: money(p.baseUnits * 100) });
  const owedWords = r.held ? " (owed)" : "";
  unfolded.push({
    key: "added",
    label: `Added on top: Earned Equity to match${owedWords}, Credits ${model.reward.creditsBonusPct}%`,
    result: `+${money((p.equityUnits + p.bonusUnits) * 100)}`,
  });
  unfolded.push({ key: "reward", label: "Reward", result: money(p.totalMinor) });
  const span = `${money(r.lowTotalMinor)} to ${money(r.highTotalMinor)}`;
  unfolded.push({ key: "range", label: `Range: ${r.why[0]}`, result: span });

  const folded: ReceiptLine[] = [
    { key: "reward", label: "Reward", result: money(p.totalMinor) },
    { key: "likely", label: `Likely ${span}. ${WIDTH_WORDS[r.width]}: ${r.why.join(", ")}`, result: span },
  ];
  return { folded, unfolded };
}

/** The nearest level up and down on complexity and responsibility, each repriced; at most three. */
function leversOf(model: ValuationModel, work: WorkInputs, p: PayeePrice, ctx: EngineContext): Lever[] {
  const out: Lever[] = [];
  const tryLevel = (what: "complexity" | "responsibility", key: string, label: string): void => {
    const s = suggestValuationBare(model, { ...work, [what]: key }, ctx, p.payee);
    if (s === null) return;
    out.push({ key: `${what}:${key}`, label, changes: what, totalMinor: s, deltaMinor: s - p.totalMinor });
  };
  const near = (what: "complexity" | "responsibility", list: { key: string; label: string; pct: number }[], current: string | null | undefined): void => {
    const sorted = [...list].sort((a, b) => a.pct - b.pct);
    const i = sorted.findIndex((l) => l.key === current);
    const at = i < 0 ? -1 : i;
    const up = sorted[at + 1];
    const down = at > 0 ? sorted[at - 1] : undefined;
    if (up) tryLevel(what, up.key, `${up.label} instead`);
    if (down) tryLevel(what, down.key, `${down.label} instead`);
  };
  near("complexity", model.complexity, work.complexity);
  if (work.kind === "role") near("responsibility", model.responsibility, work.responsibility);
  return out.slice(0, 3);
}

/** The expected total for one payee, without levers (so levers never recurse). */
function suggestValuationBare(model: ValuationModel, work: WorkInputs, _ctx: EngineContext, payee: Payee): number | null {
  const r = priceWork(model, work);
  if (!r.ok) return null;
  return r.price.payees.find((x) => x.payee === payee)?.totalMinor ?? null;
}
