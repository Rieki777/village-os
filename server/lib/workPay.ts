/**
 * WHAT A CARD SAYS A PIECE OF WORK PAYS, from the engine's own answer.
 *
 * Rye, 2026-10-21: quest and role cards show every token assigned to them, or
 * "inquire for payment details" when no value is set, with live token names
 * and a live currency conversion so the cards stay accurate.
 *
 * Every figure here comes from `quoteWorkPay` (server/lib/economy.ts), the
 * function the consent and the cycle settlement pay from. A card therefore
 * cannot promise a token amount the engine would not post: the same rules and
 * the same refusals. Nothing here posts anything.
 *
 * MONEY IS THE VALUE ONLY. A token is never converted into money on a card,
 * because a token only has a price when the exchange posts one, and "no price
 * set" is not "worth nothing". The value is held in the village's currency and
 * the client converts it for display (shared/money.ts).
 *
 * A ROLE'S CASH IS HANDED IN, NEVER READ HERE. It lives in the role's terms,
 * and the terms model may not be reachable from any module that moves value
 * (shared/seatSettings.boundary.test.ts). This file names `role.cycle`, which
 * makes it one of those modules, so the seat projection reads the cash and
 * passes it through.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  HEARTS,
  humanAtScale,
  quoteWorkPay,
  rulesFor,
  ruleCannotPay,
  toLedgerUnits,
  type MintRule,
} from "./economy";
import { tokenDef } from "./ledger";
import { MAX_BADGE_MULTIPLIER, readBadgeMultipliers } from "./badges";
import { listBadgesWithMultipliers } from "../repos/badgeMultipliers";
import {
  GRATITUDE_NEVER_PAYS,
  readWorkValue,
  type PayBadge,
  type PayLine,
  type StatedCash,
  type TokenAmount,
  type WorkPay,
} from "../../shared/workValue";

/** The stay token, spelled as `faucetFor` spells it (economy.ts says why it is not imported). */
const STAY_TOKEN = "stay-credit";

/** What a quest or a role carries that a card needs. */
export interface ValuedWork {
  valueMinor?: number | null;
  valueCurrency?: string | null;
  valueTokens?: TokenAmount[] | null;
  /** The cash it pays (0285), owed when it is paid and never paid by the platform. */
  cashMinor?: number | null;
  cashCurrency?: string | null;
}

/** The enabled rules each kind of work answers to, read once per request. */
export async function questPayRules(pool: Pool | PoolConnection): Promise<MintRule[]> {
  return rulesFor(pool, "quest.completed");
}

export async function rolePayRules(pool: Pool | PoolConnection): Promise<MintRule[]> {
  return rulesFor(pool, "role.cycle");
}

function linesOf(work: ValuedWork, rules: readonly MintRule[], kind: "quest" | "seat"): { lines: PayLine[]; source: WorkPay["source"] } {
  const quote = quoteWorkPay(rules, work.valueTokens ?? null, kind);
  return {
    source: quote.source,
    lines: quote.lines.map((l) => ({
      token: l.token,
      name: tokenDef(l.token)?.name ?? l.token,
      amount: humanAtScale(l.units, l.decimals),
      ...(tokenDef(l.token)?.kind === "voice" ? { voice: true } : {}),
    })),
  };
}

/** The cash a piece of work states it pays, or null. Zero pays none. */
function workCash(work: ValuedWork) {
  const cash = readWorkValue(work.cashMinor, work.cashCurrency);
  return cash && cash.minor > 0 ? cash : null;
}

/**
 * What a quest pays, for its card. The quest's stay credits are its own
 * payment, released by the same consent, so they are a line here too.
 */
export function questPay(quest: ValuedWork & { stayCreditReward?: number | null }, rules: readonly MintRule[]): WorkPay {
  const { lines, source } = linesOf(quest, rules, "quest");
  const stay = Math.max(0, Math.floor(Number(quest.stayCreditReward ?? 0)));
  if (stay > 0 && !ruleCannotPay(STAY_TOKEN) && toLedgerUnits(STAY_TOKEN, stay) > 0) {
    lines.push({ token: STAY_TOKEN, name: tokenDef(STAY_TOKEN)?.name ?? STAY_TOKEN, amount: stay });
  }
  return { value: readWorkValue(quest.valueMinor, quest.valueCurrency), lines, source, cadence: "once", cashPay: workCash(quest) };
}

/** What a role pays each seat every cycle, for its card, with the cash its terms state. */
export function rolePay(role: ValuedWork, rules: readonly MintRule[], cash: StatedCash | null): WorkPay {
  // A seat is paid its role's own list and never a flat amount (Rye,
  // 2026-11-01): a flat role amount pays dues-paying members instead
  // (`payDuesDividend`), so a card never promises it to a seat.
  const { lines, source } = linesOf(role, rules.map((r) => ({ ...r, amount: null })), "seat");
  return { value: readWorkValue(role.valueMinor, role.valueCurrency), lines, source, cadence: "cycle", cash, cashPay: workCash(role) };
}

/**
 * One token a steward may put on a quest or a role. No ceiling rides along:
 * work is paid in full (Rye, 2026-10-22, `ceilingBinds` in shared/workValue.ts).
 */
export interface PayableToken {
  token: string;
  name: string;
  /** The rule's fixed amount, which a quest with no list of its own is paid. Null when the rule reads it from the work. */
  standard: number | null;
  decimals: number;
}

/**
 * The tokens the editor offers: a platform token the engine can issue, with an
 * enabled rule saying it may pay this kind of work. Gratitude is never one of them.
 */
export function payableTokens(rules: readonly MintRule[]): PayableToken[] {
  const out: PayableToken[] = [];
  for (const r of rules) {
    if (r.tokenSlug === HEARTS || ruleCannotPay(r.tokenSlug)) continue;
    if (out.some((t) => t.token === r.tokenSlug)) continue;
    const def = tokenDef(r.tokenSlug);
    out.push({
      token: r.tokenSlug,
      name: def?.name ?? r.tokenSlug,
      // A role rule's flat amount is the dues dividend, never a role's standard
      // pay (Rye, 2026-11-01), so a role's editor never opens on it.
      standard: r.trigger === "role.cycle" ? null : r.amount,
      decimals: def?.decimals ?? 0,
    });
  }
  return out;
}

/**
 * Why a steward's line cannot be stored, or null. Asked at the save, so a
 * figure the engine would refuse is refused before it is ever written, in a
 * sentence that names what to change.
 */
export function payLineProblem(rules: readonly MintRule[], token: string): string | null {
  if (token === HEARTS) return GRATITUDE_NEVER_PAYS;
  const offered = payableTokens(rules).find((t) => t.token === token);
  if (!offered) {
    const name = tokenDef(token)?.name ?? token;
    const cannot = ruleCannotPay(token);
    if (cannot) return `${name} cannot be paid here: ${cannot}.`;
    return `This village has no enabled rule paying ${name} for this kind of work. Add one on the Mint panel first.`;
  }
  return null;
}

/** One badge's multipliers, as `payBadgeBoosts` reads them. */
export interface BadgeBoost {
  name: string;
  multipliers: Record<string, number>;
}

/**
 * The badges that multiply token pay, read once per request (0278). The same
 * filter `rewardMultipliersFor` (server/lib/seasonPatterns.ts) pays from, less
 * the holder: active, no example, never a self or a hypha badge, and not
 * dormant this season. Public, like the badges themselves.
 */
export async function payBadgeBoosts(pool: Pool | PoolConnection, dormant: readonly string[]): Promise<BadgeBoost[]> {
  const skip = new Set(dormant);
  const out: BadgeBoost[] = [];
  for (const r of await listBadgesWithMultipliers(pool)) {
    if (skip.has(r.id)) continue;
    const multipliers = readBadgeMultipliers(r.multipliers);
    if (multipliers) out.push({ name: r.name, multipliers });
  }
  return out;
}

/**
 * The work's pay with the badges that multiply its lines. A factor of 1 or
 * less multiplies nothing and is left off, Gratitude is never a line, and no
 * factor reads past the ceiling the payment itself applies.
 */
export function withPayBadges(pay: WorkPay, boosts: readonly BadgeBoost[]): WorkPay {
  const badges: PayBadge[] = [];
  for (const b of boosts) {
    for (const line of pay.lines) {
      const factor = Number(b.multipliers[line.token]);
      if (!Number.isFinite(factor) || factor <= 1 || line.token === HEARTS) continue;
      badges.push({ badge: b.name, token: line.token, name: line.name, factor: Math.min(factor, MAX_BADGE_MULTIPLIER) });
    }
  }
  return { ...pay, badges };
}
