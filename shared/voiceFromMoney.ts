/**
 * VOICE FROM VALUE, FROM DONATIONS AND FROM INVESTMENT: THE ARITHMETIC.
 *
 * Rye, 2026-11-08, relayed verbatim by the master coordinator (spec
 * voice-from-money in the ops repo):
 *
 *   - The scale is the village model's `voicePerUnit` (Voice per currency unit
 *     of value). The first village chose 1 Voice per 1,000 of its currency.
 *   - Work pays Voice on everything paid (II.8), at that scale.
 *   - A DONATION earns Voice at the same scale, 1:1.
 *   - An INVESTMENT buys equity at face value and earns Voice at a tenth of
 *     the scale: "you can buy it at a 1 for 10 that people are earning it
 *     with other ways".
 *   - Nothing else earns Voice: not dues, shop goods, stays, nor credit packs.
 *   - A proposal may set its own rate, which is why the rates are percentages
 *     a fund or a vote can carry, and a vote may count only work-earned Voice.
 *
 * ONE SCALE. Money Voice reads the same `voicePerUnit` as work Voice, so the
 * two can never drift onto different scales. The rates here are percentages
 * of it: a donation at 100, an investment at 10.
 *
 * Voice carries 2 decimals (II.28, `VOICE_DECIMALS`), and what a member
 * receives is floored (the payments rule: floor what the member receives), so
 * 1,505 at 1 per 1,000 is 1.50 and 9 is nothing.
 *
 * Pure: no pool, no clock. Amounts in and out are WHOLE units of the currency
 * or token (a number that may carry decimals), never minor units; the callers
 * convert at their own edge.
 */
import { VOICE_DECIMALS, minorPerWhole } from "./tokenScale";

/** Ledger source of Voice a donation earned. */
export const DONATION_VOICE_SOURCE = "donation_voice";
/** Ledger source of Voice an investment earned, direct or by backing a quest or pot. */
export const INVESTMENT_VOICE_SOURCE = "investment_voice";
/** Ledger source of the invested equity an investment bought. */
export const INVESTMENT_EQUITY_SOURCE = "investment";

/** A donation earns at the work rate (Rye, 2026-11-08). */
export const DONATION_RATE_PCT_DEFAULT = 100;
/** An investment earns at a tenth of the work rate (Rye, 2026-11-08). */
export const INVESTMENT_RATE_PCT_DEFAULT = 10;

/**
 * THE SOURCES THAT ARE WORK. An ALLOW-list, on purpose: a source nobody has
 * named does not count as work, so a new way of minting Voice cannot slip into
 * a work-only count unnoticed (a derived allowlist fails closed).
 *
 * `admin_mint` is the hand mint and approved mint requests. It counts as work
 * because it exists to honour work done before the platform (clarify C7).
 */
export const WORK_VOICE_SOURCES: readonly string[] = ["quest_consent", "role_cycle", "proposal_accepted", "admin_mint"];

/**
 * THE SOURCES THAT ARE MONEY. `dues_dividend` is here because dues are money
 * paid in, and since 2026-11-08 dues earn no Voice at all (clarify C6).
 */
export const MONEY_VOICE_SOURCES: readonly string[] = [DONATION_VOICE_SOURCE, INVESTMENT_VOICE_SOURCE, "dues_dividend"];

export type VoiceSourceKind = "work" | "money" | "unclassified";

export function voiceSourceKind(source: string): VoiceSourceKind {
  if (WORK_VOICE_SOURCES.includes(source)) return "work";
  if (MONEY_VOICE_SOURCES.includes(source)) return "money";
  return "unclassified";
}

/**
 * Floor a Voice amount to Voice's own decimals. The epsilon keeps 2.30 from
 * reading as 2.29. It is 1e-7, the same as the valuation engine's `voiceFor`
 * (#981), so a figure the engine stores and the Voice a payment posts agree to
 * the hundredth; an amount in minor units times any scale is never within
 * 1e-7 of the next hundredth unless float error put it there.
 */
export function floorVoice(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const per = minorPerWhole(VOICE_DECIMALS);
  return Math.floor(amount * per + 1e-7) / per;
}

/**
 * Voice for `units` of value at `voicePerUnit`, at `ratePct` of the scale.
 * Anything that is not a positive, finite amount, scale or rate earns 0.
 */
export function voiceForUnits(units: number, voicePerUnit: number, ratePct: number = 100): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  if (!Number.isFinite(voicePerUnit) || voicePerUnit <= 0) return 0;
  if (!Number.isFinite(ratePct) || ratePct <= 0) return 0;
  return floorVoice((units * voicePerUnit * ratePct) / 100);
}

/** Work Voice on everything paid now (II.8). Earned Equity that is owed is the caller's to leave out. */
export function workVoiceFromPaid(paidUnits: number, voicePerUnit: number): number {
  return voiceForUnits(paidUnits, voicePerUnit, 100);
}

export interface MoneyInRates {
  donationPct: number;
  investmentPct: number;
}

/**
 * What one gift issues. A donation issues Voice only. An investment issues
 * invested equity at face value (1 unit of currency buys 1 unit, floored at
 * the equity's 2 decimals) and Voice at the investment rate (clarify C1).
 */
export function moneyInIssue(
  kind: "donation" | "investment",
  units: number,
  voicePerUnit: number,
  rates: MoneyInRates,
): { voice: number; equity: number } {
  if (kind === "donation") return { voice: voiceForUnits(units, voicePerUnit, rates.donationPct), equity: 0 };
  const equity = Number.isFinite(units) && units > 0 ? Math.floor(units * 100 + 1e-9) / 100 : 0;
  return { voice: voiceForUnits(units, voicePerUnit, rates.investmentPct), equity };
}

/**
 * A member's work share: Voice minted to them from work sources over all
 * Voice minted to them, each source already net of its own reversals. An
 * unclassified source counts in the whole and never in the work, so the share
 * can only be understated. 0 when nothing was ever minted.
 *
 * Why a share of the balance is the right count: decay takes the same share of
 * every holder's balance, and Voice otherwise leaves a member only through a
 * claim or an exit sweep, which take from the balance as a whole. So the share
 * of a balance that came from work is the share of what was minted that came
 * from work.
 *
 * `unattributedReversed` is Voice taken back whose original posting could not
 * be found. It comes off the work AND the whole, which can only lower the
 * share, so a reversal nobody can trace never inflates a work-only count.
 */
export function workShare(netBySource: Readonly<Record<string, number>>, unattributedReversed: number = 0): number {
  let work = 0;
  let all = 0;
  for (const [source, amount] of Object.entries(netBySource)) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) continue;
    all += n;
    if (voiceSourceKind(source) === "work") work += n;
  }
  const lost = Number.isFinite(unattributedReversed) && unattributedReversed > 0 ? unattributedReversed : 0;
  work -= lost;
  all -= lost;
  return all > 0 && work > 0 ? work / all : 0;
}
