/**
 * SETTING A FIGURE WITH THE ENGINE: the person's half of "role pay is set by
 * the Treasurer AND the valuation algorithm" (Rye, 2026-11-06).
 *
 * The engine (`shared/valuationEngine.ts`) suggests. A person sets. This file
 * says what a set figure needs, writes the record it leaves, reads those
 * records back into the range shown, and works the cycle's cash share. Rye's
 * answers of 2026-11-06 (spec §6):
 *
 *   - C1: inside the no-sign band (the suggestion ±10%) the setter's word stands.
 *   - C3: outside it, a written reason and a second, DIFFERENT signer (a holder
 *     of role.pay or steward.veto); with none, the village vote after 7 days.
 *   - C10: the setter may change the inputs, but every change is logged and the
 *     figure is judged against the ORIGINAL suggestion, so changing the hours
 *     cannot make a figure "inside".
 *   - The conflict rule (D7): on work that pays them, the setter's word never
 *     stands alone, and a second signer is nobody the work pays and nobody
 *     whose own pay the setter set this season.
 *   - C7: a short cash budget is shared pro rata, one share for the cycle, and
 *     the deficit is the member's choice: Earned Equity, Credits, or money owed.
 *     Unanswered, it is money owed, which changes nothing they are owed.
 *
 * Nothing here refuses or trims a figure for its size (II.6): a far-off figure
 * waits for a second signer or the vote, and that is all. Calibration moves the
 * range shown and never the expected figure or the band (no automatic
 * re-pricing, Rye 2026-10-30).
 *
 * Pure: no clock, no pool. Who holds which power is the server's to work out
 * through the one gate; this file is handed the member ids.
 */
import { ENGINE_DEFAULTS, paidTokens, rewardFromTotal, type EngineDials, type ValuationModel } from "./valuation";
import type { TokenAmount } from "./workValue";
import type { PayeeSuggestion, RangeWidth } from "./valuationEngine";

/**
 * Why a setter set a figure away from the suggestion (spec 3.5, research 03 §4.2).
 * A short list so people pick honestly; "Other" asks for words. A village may
 * change the list by the same doors as any dial.
 */
export const REASON_CODES: readonly string[] = [
  "The effort estimate was off",
  "The skill needed is higher or lower",
  "The local going rate is different",
  "Urgency or short notice",
  "Community benefit the estimate misses",
  "The cash budget this cycle",
  "Fairness with similar work",
  "Other",
];

/** Days a figure outside the band waits for its second signer before it goes to the village vote by itself (spec 3.4). */
export const SECOND_SIGN_DAYS = 7;

/** A member's id, as the server holds it. */
export type MemberId = string | number;

/** Who is setting, who the work pays, and who could sign second. */
export interface SettingContext {
  setterId: MemberId;
  /** Everyone this work pays. */
  payeeIds: MemberId[];
  /** Holders of the setting power (role.pay for roles, quest.approve for quests) or of steward.veto, live now. */
  secondSigners: MemberId[];
  /** Members whose own pay this setter set this season: they may not sign the setter's figure (no swapping). */
  setterSetPayOf: MemberId[];
}

/** One input the setter changed after the proposer's were frozen. */
export interface InputChange {
  field: string;
  from: string;
  to: string;
}

export interface SettingOptions {
  /** A reason code or written reason. Needed outside the band. */
  reason?: string;
  note?: string;
  /** The setter's own number, asked before the suggestion was shown. */
  ownNumberFirst?: number;
  inputChanges?: InputChange[];
}

export type SignNeed = "none" | "second" | "vote";

export interface SettingDecision {
  /** Always true: a figure is never refused for its size (II.6). */
  ok: true;
  inside: boolean;
  gapMinor: number;
  gapPct: number;
  needs: SignNeed;
  /** Who may sign second. Empty when the village votes. */
  signers: MemberId[];
  /** Present when a second signer is asked: after this many days, the village vote. */
  voteAfterDays?: number;
  /** What the setter still has to give. */
  missing: "reason"[];
  /** The setter is paid by this work. */
  conflicted: boolean;
}

/** What a set figure needs, judged against the FIRST suggestion. */
export function combineSetting(first: PayeeSuggestion, set: { totalMinor: number }, ctx: SettingContext, opts: SettingOptions = {}): SettingDecision {
  const expected = first.expected.totalMinor;
  const inside = set.totalMinor >= first.band.lowMinor && set.totalMinor <= first.band.highMinor;
  const conflicted = ctx.payeeIds.includes(ctx.setterId);
  const signers = ctx.secondSigners.filter((id) => id !== ctx.setterId && !ctx.payeeIds.includes(id) && !ctx.setterSetPayOf.includes(id));
  const needs: SignNeed = inside && !conflicted ? "none" : signers.length ? "second" : "vote";
  const missing: "reason"[] = !inside && !(opts.reason ?? "").trim() ? ["reason"] : [];
  return {
    ok: true,
    inside,
    gapMinor: set.totalMinor - expected,
    gapPct: expected > 0 ? Math.round(((set.totalMinor - expected) / expected) * 100) : 0,
    needs,
    signers: needs === "second" ? signers : [],
    ...(needs === "second" ? { voteAfterDays: SECOND_SIGN_DAYS } : {}),
    missing,
    conflicted,
  };
}

/** The append-only record one set act leaves (spec 3.5). */
export interface SettingRecord {
  workKind: "quest" | "role" | "proposal";
  workId: number;
  /** What calibration groups by: kind and band, e.g. "role:general". */
  category: string;
  suggestedMinor: number;
  rangeLowMinor: number;
  rangeHighMinor: number;
  bandLowMinor: number;
  bandHighMinor: number;
  setMinor: number;
  gapMinor: number;
  inside: boolean;
  needs: SignNeed;
  reason: string | null;
  note: string | null;
  ownNumberFirst: number | null;
  inputChanges: InputChange[];
  setterId: MemberId;
  /** Filled when the second signer signs; null for a word-alone or voted figure. */
  signerId: MemberId | null;
  conflicted: boolean;
  /** Earned Equity was owed, not paid, when this was set: never pooled with paid records. */
  eeHeld: boolean;
  at: string;
}

export function settingRecord(p: {
  workKind: SettingRecord["workKind"];
  workId: number;
  category: string;
  first: PayeeSuggestion;
  set: { totalMinor: number };
  ctx: SettingContext;
  opts?: SettingOptions;
  signerId?: MemberId | null;
  at: string;
}): SettingRecord {
  const opts = p.opts ?? {};
  const d = combineSetting(p.first, p.set, p.ctx, opts);
  return {
    workKind: p.workKind,
    workId: p.workId,
    category: p.category,
    suggestedMinor: p.first.expected.totalMinor,
    rangeLowMinor: p.first.range.lowTotalMinor,
    rangeHighMinor: p.first.range.highTotalMinor,
    bandLowMinor: p.first.band.lowMinor,
    bandHighMinor: p.first.band.highMinor,
    setMinor: p.set.totalMinor,
    gapMinor: d.gapMinor,
    inside: d.inside,
    needs: d.needs,
    reason: (opts.reason ?? "").trim() || null,
    note: (opts.note ?? "").trim() || null,
    ownNumberFirst: opts.ownNumberFirst ?? null,
    inputChanges: opts.inputChanges ?? [],
    setterId: p.ctx.setterId,
    signerId: p.signerId ?? null,
    conflicted: d.conflicted,
    eeHeld: p.first.expected.earnedEquityHeld > 0,
    at: p.at,
  };
}

// ── Calibration ─────────────────────────────────────────────────────────────

/** How much the village's own record must hold before it may widen a range (spec 3.5, QA G6). */
export const CALIBRATION_DEFAULTS = { minPairs: 5, priorK: 8, flagPct: 15 };

export interface CategoryCalibration {
  /** The category, with ":ee-held" when its records were set while Earned Equity was owed. */
  key: string;
  category: string;
  eeHeld: boolean;
  count: number;
  /** Distinct setter and signer pairs: one person setting twelve times counts once. */
  pairs: number;
  medianRatio: number;
  /** The 10th and 90th percentile of set / suggested, shrunk towards 1. */
  lowRatio: number;
  highRatio: number;
  aboveShare: number;
  belowShare: number;
  /** Present when the village sets this kind of work off the suggestion by at least the flag. */
  flag: { direction: "higher" | "lower"; pct: number; proposal: string } | null;
}

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 1;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * What the setting records say, category by category. Conflicted records are
 * left out; records set while Earned Equity was owed are kept apart; a category
 * with fewer distinct pairs than `minPairs` says nothing.
 */
export function calibrate(records: readonly SettingRecord[], dials: Partial<typeof CALIBRATION_DEFAULTS> = {}): CategoryCalibration[] {
  const d = { ...CALIBRATION_DEFAULTS, ...dials };
  const groups: Record<string, SettingRecord[]> = {};
  for (const r of records) {
    if (r.conflicted || !(r.suggestedMinor > 0)) continue;
    const key = r.eeHeld ? `${r.category}:ee-held` : r.category;
    (groups[key] ??= []).push(r);
  }
  const out: CategoryCalibration[] = [];
  for (const key of Object.keys(groups)) {
    const rs = groups[key];
    const ratios = rs.map((r) => r.setMinor / r.suggestedMinor).sort((a, b) => a - b);
    const pairs = new Set(rs.map((r) => `${r.setterId}:${r.signerId ?? "-"}`)).size;
    const n = ratios.length;
    const shrink = (q: number): number => round4((n * q + d.priorK) / (n + d.priorK));
    const medianRatio = round4(quantile(ratios, 0.5));
    const above = rs.filter((r) => r.setMinor > (r.bandHighMinor ?? Math.round(r.suggestedMinor * 1.1))).length;
    const below = rs.filter((r) => r.setMinor < (r.bandLowMinor ?? Math.round(r.suggestedMinor * 0.9))).length;
    const enough = pairs >= d.minPairs;
    const offPct = Math.round(Math.abs(medianRatio - 1) * 100);
    const direction = medianRatio >= 1 ? "higher" : "lower";
    out.push({
      key,
      category: rs[0].category,
      eeHeld: rs[0].eeHeld,
      count: n,
      pairs,
      medianRatio,
      lowRatio: enough ? shrink(quantile(ratios, 0.1)) : 1,
      highRatio: enough ? shrink(quantile(ratios, 0.9)) : 1,
      aboveShare: round4(above / n),
      belowShare: round4(below / n),
      flag:
        enough && offPct >= d.flagPct
          ? {
              direction,
              pct: offPct,
              proposal: `Over ${n} settings by ${pairs} different setters, the village set ${rs[0].category} work ${offPct}% ${direction} than the model suggested. Propose a model change for it.`,
            }
          : null,
    });
  }
  return out;
}

/**
 * The range shown, widened by what the village's records say. The expected
 * figure and the no-sign band are never touched: they are not in what this
 * returns, and the suggestion passed in is not changed.
 */
export function widenRange(s: PayeeSuggestion, cal: CategoryCalibration | undefined, dials: Partial<EngineDials> = {}): PayeeSuggestion["range"] {
  if (!cal || cal.pairs < CALIBRATION_DEFAULTS.minPairs || (cal.lowRatio === 1 && cal.highRatio === 1)) return s.range;
  const e = { ...ENGINE_DEFAULTS, ...dials };
  const expected = s.expected.totalMinor;
  const lowTotalMinor = Math.min(s.range.lowTotalMinor, Math.round(expected * cal.lowRatio));
  const highTotalMinor = Math.max(s.range.highTotalMinor, Math.round(expected * cal.highRatio));
  const widthPct = expected > 0 ? ((highTotalMinor - lowTotalMinor) / expected) * 100 : 0;
  const width: RangeWidth = widthPct < e.narrowPct ? "narrow" : widthPct < e.mediumPct ? "medium" : "wide";
  const why = [...s.range.why];
  if (cal.medianRatio > 1) why.push("the village often sets this kind of work higher");
  else if (cal.medianRatio < 1) why.push("the village often sets this kind of work lower");
  return { lowTotalMinor, highTotalMinor, width, why };
}

// ── The cycle's cash share, and the deficit ─────────────────────────────────

/**
 * One cash share of the base for every work this cycle (C7): the budget left
 * over the base still to be set, held to 0-100, so the order works are set in
 * never decides who gets cash. No budget set: no cash is offered.
 */
export function cycleCashShare(budgetLeftMinor: number | null, baseToSetMinor: number): number {
  if (budgetLeftMinor === null || !(budgetLeftMinor > 0)) return 0;
  if (!(baseToSetMinor > 0)) return 100;
  return Math.max(0, Math.min(100, Math.floor((budgetLeftMinor * 100) / baseToSetMinor)));
}

export type DeficitChoice = "owed" | "credits" | "equity";

export interface DeficitSettlement {
  choice: DeficitChoice;
  /** Whole units of the base the cash share did not cover. */
  deficitUnits: number;
  cashNowMinor: number;
  /** Money owed to the member, carried to a later cycle (a `cash_owed` row). */
  cashOwedLaterMinor: number;
  credits: number;
  earnedEquity: number;
}

/**
 * The member's answer for the part of the base a short budget did not cover
 * (C7). Unanswered is money owed. The total is the same whatever they choose.
 * With no budget set the village offers no cash, so there is no deficit and the
 * base stays in Credits (II.7).
 */
export function settleDeficit(
  paid: { baseUnits: number; cashMinor: number | null; credits: number; earnedEquity: number },
  sharePct: number,
  choice: DeficitChoice | undefined,
  opts: { budgetSet?: boolean } = {},
): DeficitSettlement {
  const cashNowMinor = paid.cashMinor ?? 0;
  const picked: DeficitChoice = choice ?? "owed";
  if (opts.budgetSet === false || sharePct >= 100) {
    return { choice: picked, deficitUnits: 0, cashNowMinor, cashOwedLaterMinor: 0, credits: paid.credits, earnedEquity: paid.earnedEquity };
  }
  const cashUnits = Math.ceil(cashNowMinor / 100 - 1e-9);
  const deficitUnits = Math.max(0, Math.min(paid.credits, paid.baseUnits - cashUnits));
  if (picked === "credits") return { choice: picked, deficitUnits, cashNowMinor, cashOwedLaterMinor: 0, credits: paid.credits, earnedEquity: paid.earnedEquity };
  if (picked === "equity") {
    return { choice: picked, deficitUnits, cashNowMinor, cashOwedLaterMinor: 0, credits: paid.credits - deficitUnits, earnedEquity: paid.earnedEquity + deficitUnits };
  }
  return { choice: picked, deficitUnits, cashNowMinor, cashOwedLaterMinor: deficitUnits * 100, credits: paid.credits - deficitUnits, earnedEquity: paid.earnedEquity };
}

// ── A set figure, as the work stores it ─────────────────────────────────────

/**
 * What a work stores once a figure is set: the figure shared out by Rye's rule
 * (`rewardFromTotal`: the base, the Earned Equity match and the Credits bonus,
 * as for any whole reward, II.9), with the cycle's cash share out of the base.
 * While Earned Equity is owed (its meaning unwritten, #892) its line is left
 * off and Voice counts only what is paid (II.8); the setting record keeps what
 * is owed.
 */
export function storedPayFor(
  model: ValuationModel,
  totalMinor: number,
  opts: { cashPct?: number; eeHeld: boolean },
): { valueMinor: number; valueTokens: TokenAmount[]; cashMinor: number | null; earnedEquityOwed: number } {
  const r = rewardFromTotal(model, totalMinor, { cashPct: opts.cashPct });
  if (!opts.eeHeld) return { valueMinor: r.totalMinor, valueTokens: paidTokens(r), cashMinor: r.cashMinor, earnedEquityOwed: 0 };
  const owed = r.equityUnits;
  const voice = { token: r.voice.token, amount: Math.floor(((r.totalMinor - owed * 100) / 100) * model.voicePerUnit + 1e-9) };
  const tokens = paidTokens({ voice, payTokens: r.payTokens.filter((t) => t.token !== model.tokens.equity) });
  return { valueMinor: r.totalMinor, valueTokens: tokens, cashMinor: r.cashMinor, earnedEquityOwed: owed };
}

// ── P4, the retro top-up (Rye's pick, 2026-11-06) ───────────────────────────

/**
 * Why a retro top-up cannot be proposed, or null. After delivery, any member
 * may propose to RAISE a set figure, and the village decides by its existing
 * vote; a top-up never lowers a figure. Lowering one is a different proposal
 * (C12), and the refusal names it. The outcome, in words, is required: a top-up
 * says what the work achieved beyond what was expected.
 */
export function topUpProblem(currentMinor: number | null, proposedMinor: number, outcome: string): string | null {
  if (currentMinor === null) return "This work has no figure set yet. Set one first, then a top-up can raise it.";
  if (!(Number.isFinite(proposedMinor) && proposedMinor > currentMinor)) {
    return "A top-up only raises a figure. To lower one, propose a different figure to the village in an org draft.";
  }
  if (!String(outcome ?? "").trim()) return "Say what the work achieved beyond what was expected.";
  return null;
}
