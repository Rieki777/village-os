/**
 * What the village treasury holds of the village's value token, in WHOLE tokens.
 *
 * ONE ACCOUNT, ONE TOKEN, never a sum. The account is `sys:treasury`
 * (`TREASURY`), the one the exchange sells from and seat fees settle into. The
 * token is the one `gratitude.pool_token` names, the same rule the cycle
 * close, `/api/game/config` (`currency.value`) and the launch check
 * `pool-token-spendable` read for "the value token".
 *
 * TWO READERS, ONE READING. The map's treasury chip (`mapStats.ts`) and the
 * health snapshot's `treasury_balance` (`health.ts`) both ask this. Until
 * 2026-10-31 the snapshot added every token in the account together, in raw
 * ledger units and across kinds, so 1,234.56 credits and 500 stay-credit froze
 * as 173456. It lives in its own file because `mapStats.ts` already imports
 * `health.ts`, and the snapshot importing it back would be a cycle.
 *
 * READ THROUGH THE LEDGER. `balanceOf` is the ledger's own read of the
 * `token_balances` cache, which postings recompute and nothing here writes.
 * It answers MINOR units; `fromLedgerUnits` scales them by the registry's
 * `decimals` for this token, so no number of places is assumed here. The
 * fraction is then left off (truncated toward zero), so the figure shows whole
 * tokens and never more than the account holds. A treasury below zero reads
 * below zero.
 *
 * A dial pointed at something that is not a platform token this ledger
 * moves, or at recognition, has no treasury balance a reader could honestly
 * show, and says why for the founder's editor.
 */
import type { Pool } from "mysql2/promise";
import { fromLedgerUnits } from "./economy";
import { TREASURY, balanceOf, tokenDef } from "./ledger";
import { stringVar } from "./variables";

export type TreasuryReading =
  | { n: number; sub: string; token: string; tokenName: string }
  | { why: string };

export async function treasuryReading(pool: Pool): Promise<TreasuryReading> {
  const slug = String(stringVar("gratitude.pool_token") ?? "").trim();
  const def = slug ? tokenDef(slug) : undefined;
  if (!def) {
    return { why: `The cycle pool is set to pay "${slug}", which is not a token this village issues, so there is no treasury balance to show.` };
  }
  if (def.governance !== "platform") {
    return { why: `${def.name} is kept on another ledger, so this village's treasury holds none of it here.` };
  }
  if (def.kind === "recognition") {
    return { why: `${def.name} is recognition, which carries no value of its own, so there is no treasury balance to show.` };
  }
  const units = await balanceOf(pool, TREASURY, def.slug);
  const whole = Math.trunc(fromLedgerUnits(def.slug, units)) || 0;
  return { n: whole, sub: `${def.name} held in the treasury`, token: def.slug, tokenName: def.name };
}
