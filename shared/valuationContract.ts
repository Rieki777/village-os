/**
 * P1, THE CONTRACT-PRICE PATH (Rye's pick, 2026-11-06; spec 3.10).
 *
 * Rye, the same day: "we're not paying for hours we're paying for
 * contributions (value in)". A proposer, or Sera, may therefore name a contract
 * price for a deliverable: what is delivered and how it is accepted. This file
 * prices that:
 *
 *   - The named price is the WHOLE reward, shared out by Rye's rule exactly as
 *     a role's source figure is (`rewardFromTotal`, II.9): a base, Earned
 *     Equity to match, and the Credits bonus. Voice for what is paid (II.8).
 *   - The effort-based figure (`suggestValuation` on the estimate) is worked
 *     beside it as a REFERENCE: shown, never paid.
 *   - Hours are used for one thing only, the legal-floor check: a contract
 *     whose base is under minimum wage for the estimated effort is a warning
 *     with both figures (II.10). It is never a refusal, and never a cap (II.6).
 *   - The no-sign band sits around the contract price, since that is the
 *     suggestion a person sets (C1, C3).
 *
 * Pure: no clock, no pool.
 */
import { ENGINE_DEFAULTS, priceWork, rewardFromTotal, voiceFor, type ValuationModel, type WorkInputs } from "./valuation";
import { suggestValuation, wholeMoney, type EngineContext, type PayeeSuggestion, type Suggestion, type Warning } from "./valuationEngine";

export interface ContractInputs {
  /** The whole reward the proposer names for the deliverable, in minor units of the village's currency. */
  priceMinor: number;
  /** What is delivered. */
  deliverable: string;
  /** How it is accepted as done. */
  acceptance?: string | null;
  /** The estimate of effort: the legal-floor check and the reference. Hours are never priced from it. */
  effort: WorkInputs;
}

const DELIVERABLE_MAX = 200;

export function suggestContract(model: ValuationModel, c: ContractInputs, ctx: EngineContext): Suggestion {
  const deliverable = String(c.deliverable ?? "").trim().slice(0, DELIVERABLE_MAX);
  const problems: { problem: string; fixAt: "work:inputs" }[] = [];
  if (!(Number.isFinite(c.priceMinor) && c.priceMinor > 0)) problems.push({ problem: "Name the contract price for the deliverable.", fixAt: "work:inputs" });
  if (!deliverable) problems.push({ problem: "Say what is delivered for the contract price.", fixAt: "work:inputs" });
  if (problems.length) return { ok: false, refusals: problems };

  // The reference, and the labour at minimum wage for the floor check. Both from the estimate.
  const effort = suggestValuation(model, c.effort, ctx);
  if (!effort.ok) return effort;
  const priced = priceWork(model, c.effort);
  const ref = effort.payees[0];
  const labourMinor = priced.ok ? priced.price.payees[0].labourMinor : 0;

  const cashPct = ctx.cashSharePct ?? c.effort.cashPct;
  const r = rewardFromTotal(model, c.priceMinor, { cashPct });
  const held = ctx.eeMeaningWritten ? 0 : r.equityUnits;
  const credits = r.payTokens.find((t) => t.token === model.tokens.credits)?.amount ?? 0;
  const voice = voiceFor(model, r.totalMinor - held * 100);
  const belowFloor = r.baseUnits * 100 < labourMinor;
  const dials = { ...ENGINE_DEFAULTS, ...(model.engine ?? {}) };
  const money = (m: number) => wholeMoney(m, model.currency);

  const warnings: Warning[] = [...effort.warnings.filter((w) => w.fixAt)];
  if (belowFloor) {
    warnings.push({ text: `The contract's base, ${money(r.baseUnits * 100)}, is under the legal minimum for the estimated effort, ${money(labourMinor)}.` });
  }

  const span = `${money(ref.range.lowTotalMinor)} to ${money(ref.range.highTotalMinor)}`;
  const payee: PayeeSuggestion = {
    payee: ref.payee,
    paidCount: ref.paidCount,
    expected: { totalMinor: r.totalMinor, cashMinor: r.cashMinor, credits, earnedEquity: r.equityUnits - held, earnedEquityHeld: held, voice },
    range: { lowTotalMinor: r.totalMinor, highTotalMinor: r.totalMinor, width: "narrow", why: ["a contract price"] },
    band: { lowMinor: Math.round((r.totalMinor * (100 - dials.bandPct)) / 100), highMinor: Math.round((r.totalMinor * (100 + dials.bandPct)) / 100) },
    receipt: {
      folded: [
        { key: "reward", label: "Reward", result: money(r.totalMinor) },
        { key: "contract", label: `Contract price for ${deliverable}`, result: money(r.totalMinor) },
      ],
      unfolded: [
        { key: "contract", label: `Contract price for ${deliverable}`, result: money(r.totalMinor) },
        { key: "base", label: "Base price", result: money(r.baseUnits * 100) },
        {
          key: "added",
          label: `Earned Equity to match${held ? " (owed)" : ""}, Credits ${model.reward.creditsBonusPct}%`,
          result: `+${money((r.equityUnits + r.bonusUnits) * 100)}`,
        },
        { key: "reward", label: "Reward", result: money(r.totalMinor) },
        { key: "reference", label: "For comparison, the effort estimate gives", result: span },
      ],
    },
    paidAs: [
      ...(r.cashMinor ? [{ token: "cash", amount: r.cashMinor }] : []),
      ...(credits > 0 ? [{ token: model.tokens.credits, amount: credits }] : []),
      ...(r.equityUnits > 0 ? [held ? { token: model.tokens.equity, amount: r.equityUnits, owed: true as const } : { token: model.tokens.equity, amount: r.equityUnits }] : []),
      ...(voice > 0 ? [{ token: model.tokens.voice, amount: voice }] : []),
    ],
    levers: [],
    contract: {
      deliverable,
      acceptance: String(c.acceptance ?? "").trim().slice(0, DELIVERABLE_MAX) || null,
      reference: { totalMinor: ref.expected.totalMinor, lowTotalMinor: ref.range.lowTotalMinor, highTotalMinor: ref.range.highTotalMinor },
      belowFloor,
    },
  };
  return { ok: true, modelVersion: model.version, currency: model.currency, payees: [payee], warnings };
}
