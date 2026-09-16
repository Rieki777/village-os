/**
 * REDEMPTION, THE HALF THAT MOVES VALUE.
 *
 * `server/lib/redemption.ts` decides and posts nothing, the way
 * `server/lib/spending.ts` does. This file is the other half: the `redemptions`
 * row, the two postings, and the reconciliation that compares them. The split
 * is the same one the monolith ratchet in scripts/check-file-lines.mjs pushes
 * every module toward, and it earns its keep here because the decisions are
 * pure and testable with no database while everything below needs one.
 *
 * THE THREE MECHANISMS THIS FILE EXISTS TO GET RIGHT, each measured somewhere
 * else in this codebase first:
 *
 *   1. THE HOLD IS POSTED AFTER THE ROW COMMITS, AND A THROW IS A REFUSAL.
 *      `postTransfer` rolls back and rethrows on a database error, and the row
 *      is committed by then, so an unwrapped throw leaves a `requested`
 *      redemption with no hold behind it. That is a row saying tokens are held
 *      while they are still spendable, which is the exact gap this whole module
 *      exists to close, reintroduced by the error path.
 *      (`requestVoiceClaim`, server/lib/voiceClaim.ts.)
 *
 *   2. THE STATE MOVES FIRST, AS A COMPARE-AND-SET, AND THE POSTING FOLLOWS.
 *      Only the caller whose UPDATE actually changed a row may post.
 *      (`settleVoiceClaim`, and `closeBallot`, and the mint co-sign approve.)
 *
 *   3. THE ROW OWNS BOTH LEDGER KEYS. `burn_key` is derived at INSERT and
 *      stored, and `token_ledger`.`idempotency_key` is UNIQUE, so a second
 *      confirmation that raced past mechanism 2 still writes one ledger row.
 *      (`admin_mint:req:<id>`, server/index.ts.)
 *
 * UNITS: minor everywhere in this file, human only at the route boundary.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { balanceOf, ledgerEntryExists, memberAccount, postTransfer, tokenDef } from "./ledger";
import {
  claimRedemptionState,
  expiredIdRows,
  heldRowsByToken,
  historyRows,
  insertRedemptionRow,
  markHoldRefused,
  moneyAskedSinceRows,
  openCountAllRows,
  openCountRows,
  openedSinceRows,
  openRedemptionRows,
  owedRowsByToken,
  queueRows,
  redemptionRowsById,
  unclaimConfirmation,
  villageMoneyAskedSinceRowsForUpdate,
} from "../repos/redemptions";
import { formatMoney } from "../../shared/money";
import { accountBalanceRows, lockedBalanceRows } from "../repos/tokenBalances";
import { lockUserRowForUpdate } from "../repos/users";
import { fromLedgerUnits, keys, reverse, villageId } from "./economy";
import { numberVar, stringVar, boolVar } from "./variables";
import {
  BURN_SOURCE,
  HOLD_SOURCE,
  REDEEMED,
  REDEMPTION_HOLD,
  VOTE_PATH_BUILT,
  canSettleRedemption,
  redemptionMoneyRefusal,
  redemptionRefusal,
  redemptionReleases,
  type RedeemAsk,
  type RedemptionQuote,
  type RedemptionState,
} from "./redemption";

// ── The row ────────────────────────────────────────────────────────────────

export interface RedemptionRow {
  id: string;
  userId: string;
  tokenSlug: string;
  /** MINOR units. */
  amountUnits: number;
  askedFor: string;
  state: RedemptionState;
  confirmedByMode: string;
  heldAccount: string | null;
  holdKey: string | null;
  burnKey: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** 0213, ruling 23: what this was worth the day it was asked for. */
  currency: string | null;
  rateMinor: number | null;
  rateSource: string | null;
  feePct: number | null;
  feeFixedMinor: number | null;
  grossMinor: number | null;
  feeMinor: number | null;
  netMinor: number | null;
  processText: string | null;
}

function rowToRedemption(r: RowDataPacket): RedemptionRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    tokenSlug: String(r.token_slug),
    amountUnits: Number(r.amount),
    askedFor: String(r.asked_for),
    state: String(r.state) as RedemptionState,
    confirmedByMode: String(r.confirmed_by_mode),
    heldAccount: r.held_account ? String(r.held_account) : null,
    holdKey: r.hold_key ? String(r.hold_key) : null,
    burnKey: String(r.burn_key),
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    decisionNote: r.decision_note ? String(r.decision_note) : null,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    // NULL stays NULL. A row from before 0213 was never valued, and zero would
    // say this village valued it at nothing.
    currency: r.currency ? String(r.currency) : null,
    rateMinor: r.rate_minor === null || r.rate_minor === undefined ? null : Number(r.rate_minor),
    rateSource: r.rate_source ? String(r.rate_source) : null,
    feePct: r.fee_pct === null || r.fee_pct === undefined ? null : Number(r.fee_pct),
    feeFixedMinor:
      r.fee_fixed_minor === null || r.fee_fixed_minor === undefined ? null : Number(r.fee_fixed_minor),
    grossMinor: r.gross_minor === null || r.gross_minor === undefined ? null : Number(r.gross_minor),
    feeMinor: r.fee_minor === null || r.fee_minor === undefined ? null : Number(r.fee_minor),
    netMinor: r.net_minor === null || r.net_minor === undefined ? null : Number(r.net_minor),
    processText: r.process_text ? String(r.process_text) : null,
  };
}

export async function redemptionById(pool: Pool, id: string): Promise<RedemptionRow | null> {
  const rows = await redemptionRowsById(pool, id, villageId());
  return rows[0] ? rowToRedemption(rows[0]) : null;
}

/** Everything this member has open. Ordered oldest first. */
export async function openRedemptionsFor(pool: Pool, userId: string): Promise<RedemptionRow[]> {
  const rows = await openRedemptionRows(pool, villageId(), userId);
  return rows.map(rowToRedemption);
}

/**
 * MINOR units held against this member's open redemptions, per token.
 *
 * Read off the ROWS and not off the hold account, because the hold account
 * pools every member's. The two are compared by `holdReconciliation`.
 */
export async function heldForRedemption(pool: Pool, userId: string): Promise<Record<string, number>> {
  const rows = await heldRowsByToken(pool, villageId(), userId);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.token_slug)] = Number(r.held ?? 0);
  return out;
}

/** How many this member has opened since a moment, for the per-cycle cap. */
export async function redemptionsOpenedSince(pool: Pool, userId: string, since: Date): Promise<number> {
  const rows = await openedSinceRows(pool, villageId(), userId, since);
  return Number(rows[0]?.n ?? 0);
}

/** What a member has ever asked for, newest first. */
export async function redemptionHistory(pool: Pool, userId: string, limit = 20): Promise<RedemptionRow[]> {
  const rows = await historyRows(pool, villageId(), userId, Math.min(100, Math.max(1, limit)));
  return rows.map(rowToRedemption);
}

/** What is waiting on somebody with the key. Oldest first, so nothing rots. */
export async function redemptionQueue(pool: Pool, limit = 100): Promise<RedemptionRow[]> {
  const rows = await queueRows(pool, villageId(), Math.min(500, Math.max(1, limit)));
  return rows.map(rowToRedemption);
}

// ── Asking ─────────────────────────────────────────────────────────────────

/**
 * What the village has decided about money, handed in by the route (ruling 23).
 *
 * The ROUTE resolves the rate, because that needs the exchange's posted price
 * and the daily rate table, and this file reads no other module's tables. What
 * happens HERE is the half that has to be inside the transaction: the two
 * per-cycle totals, the refusal, and the snapshot written with the row.
 */
export interface RedeemMoney {
  /** ISO 4217, already checked against the village's list. */
  currency: string;
  /** Null when this village could not put a number on the request. */
  quote: RedemptionQuote | null;
  /** The village's own words for what happens next, as they read today. */
  processText: string;
  /** Minor units of `currency`. Zero means no cap. */
  minMinor: number;
  maxPerRequestMinor: number;
  memberCapMinor: number;
  villageCapMinor: number;
  feePct: number;
  feeFixed: number;
}

export interface RedeemInput {
  userId: string;
  tokenSlug: string;
  /** MINOR units. */
  amountUnits: number;
  askedFor: string;
  /** True when this member already has a departure open. */
  exitOpen: boolean;
  /** The start of the lunar cycle, for the per-cycle count. */
  cycleStart: Date;
  /**
   * WHO WILL DECIDE THIS ONE, derived by the caller and snapshotted here.
   *
   * `confirmModeFor` reads it off the village's own powers: "steward" when
   * somebody holds `redemption.confirm`, "vote" when nobody does. It arrives as
   * an input because counting holders needs the roles cache and the badge
   * rows, and this file reads neither. Absent means steward, which is what a
   * village with a key-holder has and what every caller before the ruling
   * assumed.
   */
  confirmedBy?: "steward" | "vote";
  /** Absent on a village that has set none of the ruling 23 dials. */
  money?: RedeemMoney;
}

/**
 * Money totals already spoken for this cycle, in the minor units of ONE
 * currency. Rows in another currency are deliberately not converted: a cap is a
 * promise in a currency, and adding a Swiss franc to a colon through a daily
 * rate would make today's cap depend on today's exchange rate. A village that
 * offers two currencies gets one cap per currency, which is the honest reading
 * of "most the village will redeem per cycle".
 */
function totalInCurrency(rows: Array<{ currency?: unknown; total?: unknown; gross_minor?: unknown }>, currency: string): number {
  let sum = 0;
  for (const r of rows) {
    if (String(r.currency ?? "") !== currency) continue;
    sum += Number(r.total ?? r.gross_minor ?? 0);
  }
  return sum;
}

export type RedeemOutcome =
  | { ok: true; row: RedemptionRow }
  | { ok: false; status: number; error: string };

const newId = () => `rdm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** How long a redemption waits, or null when this village lets them wait forever. */
export function expiresAfter(now: Date = new Date()): Date | null {
  const days = numberVar("redemption.expires_after_days");
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Does this village hold the tokens while a redemption is open? */
export function holdsOnPropose(): boolean {
  return boolVar("redemption.holds_on_propose");
}

/**
 * Ask to turn tokens into something real.
 *
 * SERIALIZABLE, with the member's row and their balance locked, for the reason
 * `requestVoiceClaim` gives: a balance read outside the write is a check
 * somebody can stand between. Two requests racing would each be sized against a
 * balance the other has already spoken for.
 *
 * THE HOLD IS POSTED AFTER THE ROW COMMITS, AND A THROW IS TREATED AS A
 * REFUSAL. `postTransfer` rolls back and RETHROWS on a database error, and the
 * row is already committed by then, so an unwrapped throw would leave a
 * `requested` redemption with no hold behind it: a row saying tokens are held
 * while they are still spendable, which is the very gap this module exists to
 * close, reintroduced by the error path. This is `requestVoiceClaim`'s wrapper
 * and its lesson, one module over.
 */
export async function requestRedemption(pool: Pool, input: RedeemInput): Promise<RedeemOutcome> {
  const slug = String(input.tokenSlug ?? "").trim().toLowerCase();
  const def = tokenDef(slug);
  const askedFor = String(input.askedFor ?? "").trim().slice(0, 500);
  const held = await heldForRedemption(pool, input.userId);
  const balanceUnits = def ? await balanceOf(pool, memberAccount(input.userId), slug) : 0;
  const ask: RedeemAsk = {
    slug,
    amountUnits: Number(input.amountUnits),
    balanceUnits,
    heldUnits: held[slug] ?? 0,
    openedThisCycle: await redemptionsOpenedSince(pool, input.userId, input.cycleStart),
    perCycle: numberVar("redemption.per_member_per_cycle"),
    askedFor,
    // DERIVED BY THE CALLER, not read from a dial (Rye, 2026-09-15). See
    // `confirmedBy` on RedeemInput for why the counting happens up there.
    confirmedBy: input.confirmedBy ?? "steward",
    votePathBuilt: VOTE_PATH_BUILT,
    exitOpen: input.exitOpen,
  };
  const refusal = redemptionRefusal(ask);
  if (refusal) return { ok: false, status: 409, error: refusal };

  const hold = holdsOnPropose();
  const id = newId();
  const conn = await pool.getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"); // module-review-ok: a session isolation setting, not a table read. It has no rows and no repo it could live in, and it must run on THIS connection immediately before this transaction opens (the economy.ts precedent).
    await conn.beginTransaction();

    // THE SAME CONNECTION, so this lock is taken inside the transaction opened
    // on the line above and held until the commit or rollback below.
    const who = await lockUserRowForUpdate(conn, input.userId);
    if (!who.length) {
      await conn.rollback();
      return { ok: false, status: 404, error: "no such member" };
    }

    /*
     * RE-COUNT INSIDE THE LOCK, for the reason the balance is re-read below.
     * The count in `ask` was read on the pool, outside this transaction, so N
     * opens arriving together each read the same count and each passed a cap
     * of one. The `users` row locked above serialises every open for this
     * member, so this count sees every open that committed before it.
     */
    const openedRows = await openedSinceRows(conn, villageId(), input.userId, input.cycleStart);
    const capRefusal = redemptionRefusal({ ...ask, openedThisCycle: Number(openedRows[0]?.n ?? 0) });
    if (capRefusal) {
      await conn.rollback();
      return { ok: false, status: 409, error: capRefusal };
    }

    /*
     * RE-READ THE BALANCE INSIDE THE LOCK. The check above decides what to SAY;
     * this one decides what happens. Two redemptions opened in the same instant
     * would otherwise each pass against the same balance and hold twice what
     * the member has, and the second hold posting would then be refused by the
     * ledger, leaving a row with nothing behind it.
     */
    const bal = await lockedBalanceRows(conn, memberAccount(input.userId), slug);
    const lockedUnits = Number(bal[0]?.balance ?? 0);
    if (ask.amountUnits > lockedUnits) {
      await conn.rollback();
      // HUMAN in the sentence, minor in the comparison above. Same rule as
      // `redemptionRefusal`'s own conversion.
      const free = fromLedgerUnits(slug, lockedUnits);
      return { ok: false, status: 409, error: `You hold ${free} ${def?.name ?? slug}, and that is what there is to redeem` };
    }

    /*
     * THE MONEY CAPS, INSIDE THE LOCK, AND THE VILLAGE-WIDE ONE LOCKED ITSELF.
     *
     * The per-member totals are safe on this connection because the `users` row
     * above serialises this member's asks. The village total is not: two
     * members asking in the same instant have no row in common, so
     * `villageMoneyAskedSinceRowsForUpdate` takes a range lock over the cycle's
     * rows and the second ask waits for the first to commit before it reads.
     * Read it BEFORE the insert, so the lock is held across the write.
     */
    const money = input.money;
    if (money) {
      const memberRows = await moneyAskedSinceRows(conn, villageId(), input.userId, input.cycleStart);
      const villageRows = money.villageCapMinor > 0
        ? await villageMoneyAskedSinceRowsForUpdate(conn, villageId(), input.cycleStart)
        : [];
      const memberSoFar = totalInCurrency(memberRows as any[], money.currency);
      const villageSoFar = totalInCurrency(villageRows as any[], money.currency);
      const say = (minor: number) => formatMoney(minor, money.currency);
      const capsSet =
        money.minMinor > 0 ||
        money.maxPerRequestMinor > 0 ||
        money.memberCapMinor > 0 ||
        money.villageCapMinor > 0;
      const moneyRefusal = redemptionMoneyRefusal({
        valued: !!money.quote,
        capsSet,
        grossMinor: money.quote?.grossMinor ?? 0,
        minMinor: money.minMinor,
        maxPerRequestMinor: money.maxPerRequestMinor,
        memberSoFarMinor: memberSoFar,
        memberCapMinor: money.memberCapMinor,
        villageSoFarMinor: villageSoFar,
        villageCapMinor: money.villageCapMinor,
        grossText: say(money.quote?.grossMinor ?? 0),
        minText: say(money.minMinor),
        maxText: say(money.maxPerRequestMinor),
        memberLeftText: say(Math.max(0, money.memberCapMinor - memberSoFar)),
        villageLeftText: say(Math.max(0, money.villageCapMinor - villageSoFar)),
      });
      if (moneyRefusal) {
        await conn.rollback();
        return { ok: false, status: 409, error: moneyRefusal };
      }
    }

    const expires = expiresAfter();
    await insertRedemptionRow(conn, {
      id,
      villageId: villageId(),
      userId: input.userId,
      tokenSlug: slug,
      amountUnits: ask.amountUnits,
      askedFor,
      confirmedByMode: ask.confirmedBy,
      heldAccount: hold ? REDEMPTION_HOLD : null,
      holdKey: hold ? keys.redemptionHold(villageId(), id) : null,
      burnKey: keys.redemptionBurn(villageId(), id),
      expiresAt: expires,
      // 0213: what this was worth today, written once and never updated.
      currency: money?.quote ? money.quote.currency : null,
      rateMinor: money?.quote ? money.quote.ratePerTokenMinor : null,
      rateSource: money?.quote ? money.quote.rateSource : null,
      feePct: money ? money.feePct : null,
      feeFixedMinor: money?.quote ? money.quote.feeFixedMinor : null,
      grossMinor: money?.quote ? money.quote.grossMinor : null,
      feeMinor: money?.quote ? money.quote.feeMinor : null,
      netMinor: money?.quote ? money.quote.netMinor : null,
      processText: money && money.processText.trim() ? money.processText : null,
    });
    await conn.commit();
  } catch (err: any) {
    try {
      await conn.rollback();
    } catch {
      /* the connection is already gone */
    }
    return { ok: false, status: 500, error: String(err?.message ?? err) };
  } finally {
    conn.release();
  }

  if (hold) {
    let res: { ok: boolean; duplicate: boolean; error?: string };
    try {
      res = await postTransfer(pool, {
        from: memberAccount(input.userId),
        to: REDEMPTION_HOLD,
        tokenType: slug,
        // ALREADY MINOR. DO NOT CONVERT. `ask.amountUnits` arrives minor from
        // the route boundary and is compared against `token_balances`.`balance`,
        // which is minor, in the locked read above. Nothing between there and
        // here multiplies or divides it.
        //
        // Third call site of this shape. `sweepBalances` in server/lib/exit.ts
        // and `requestVoiceClaim` in server/lib/voiceClaim.ts each carry the
        // same comment naming the other; this one names both. Wrapping it in
        // `toLedgerUnits` would take a hundred times the member's tokens at the
        // two decimals every credit token now carries, and would be invisible
        // at 0.
        amount: ask.amountUnits,
        source: HOLD_SOURCE,
        sourceRef: id,
        description: "Held against an open redemption",
        idempotencyKey: keys.redemptionHold(villageId(), id),
      });
    } catch (err: any) {
      res = { ok: false, duplicate: false, error: String(err?.message ?? err) };
    }
    if (!res.ok && !res.duplicate) {
      /*
       * The row exists and the hold does not. MARKED, never deleted: a
       * redemption with no hold behind it is repairable and one that vanished
       * is not even findable. `refused` releases, and reversing a hold that
       * never posted is a no-op, so this cannot hand back tokens.
       */
      await markHoldRefused(pool, "the ledger refused the hold", id);
      return { ok: false, status: 500, error: res.error ?? "the ledger refused the hold" };
    }
  }

  const row = await redemptionById(pool, id);
  if (!row) return { ok: false, status: 500, error: "the redemption was written and could not be read back" };
  return { ok: true, row };
}

// ── Ending one ─────────────────────────────────────────────────────────────

export type SettleFailure = "missing" | "terminal" | "raced" | "burn-failed" | "release-failed";

export interface SettleInput {
  id: string;
  to: RedemptionState;
  /** Whoever decided. Null for the reaper. */
  actorUserId: string | null;
  note: string;
}

/**
 * Send the held tokens where they can never come back from.
 *
 * A FUNCTION RATHER THAN FOUR LINES INSIDE `settleRedemption`, for two reasons
 * that both matter. The FROM account is read off the ROW and never computed
 * from the live dial, so a village that turned the hold off while this was open
 * still burns from the account the tokens are actually in; taking the row as a
 * parameter is what makes that impossible to get wrong from a caller. And the
 * economics document's key reader follows a key rooted in a PARAMETER and
 * refuses one rooted in a local, so this shape is also what keeps
 * `scripts/check-economics-doc.mjs` able to read the site at all.
 */
async function postBurn(pool: Pool, row: RedemptionRow) {
  return postTransfer(pool, {
    from: row.heldAccount ?? memberAccount(row.userId),
    to: REDEEMED,
    tokenType: row.tokenSlug,
    // ALREADY MINOR. DO NOT CONVERT. `redemptions`.`amount` is `bigint` of
    // minor units, written once from the route boundary's single conversion.
    // Same shape as the hold above, as `sweepBalances` in server/lib/exit.ts
    // and as `requestVoiceClaim` in server/lib/voiceClaim.ts.
    amount: row.amountUnits,
    source: BURN_SOURCE,
    sourceRef: row.id,
    description: `Redeemed and retired: ${row.id}`,
    // THE ROW OWNS THE KEY, derived at INSERT and stored. `token_ledger`'s
    // `idempotency_key` is UNIQUE, so a second confirmation that somehow raced
    // past the compare-and-set writes no second ledger row and comes back as a
    // duplicate. This is `admin_mint:req:<id>` with a different prefix.
    idempotencyKey: row.burnKey,
  });
}

/**
 * End a redemption: destroy the tokens, or give them back.
 *
 * THE STATE MOVES FIRST, AS A COMPARE-AND-SET, AND THE POSTING FOLLOWS IT.
 * `settleVoiceClaim` states the reason and it transfers exactly: a withdrawal
 * and a confirmation can arrive at the same instant from two directions. If the
 * posting went first, both would read `requested`, the withdrawal would hand the
 * tokens back and the confirmation would then win the row, leaving somebody
 * refunded here AND paid off the platform. Only the caller whose UPDATE actually
 * changed a row is allowed to post.
 *
 * A CONFIRMATION BURNS OUT OF THE HOLD ACCOUNT, not out of the member. That is
 * the `settleVoiceClaim` confirm branch exactly, and it is what makes the hold
 * account reconcilable: its balance is the sum of open redemptions and nothing
 * else.
 *
 * IF THE POSTING FAILS AFTER THE CLAIM SUCCEEDED, THE CLAIM GOES BACK. A
 * confirmed redemption with no burn behind it is a lie in the direction that
 * costs the village; a `requested` one somebody has to press again is annoying.
 * That is `server/index.ts`'s rollback in the mint co-sign approve door, and it
 * is the reason the release path does NOT roll back the same way: a release
 * that failed leaves the tokens at the hold account with the row terminal, and
 * re-entering through this function cannot fix it because the state machine is
 * right to refuse moving a terminal row. `retryRelease` is the repair.
 */
export async function settleRedemption(
  pool: Pool,
  input: SettleInput,
): Promise<{ ok: true; released: boolean; row: RedemptionRow } | { ok: false; reason: SettleFailure; error: string }> {
  const row = await redemptionById(pool, input.id);
  if (!row) return { ok: false, reason: "missing", error: "no such redemption" };

  const verdict = canSettleRedemption(row.state, input.to);
  if (!verdict.ok) {
    return { ok: false, reason: "terminal", error: verdict.error ?? "that redemption cannot move" };
  }

  const upd = await claimRedemptionState(pool, {
    to: input.to,
    decidedBy: input.actorUserId,
    note: input.note.slice(0, 500),
    id: input.id,
    villageId: villageId(),
    fromState: row.state,
  });
  if (upd.affectedRows !== 1) {
    return {
      ok: false,
      reason: "raced",
      error: "This redemption has just been decided by somebody else",
    };
  }

  if (!redemptionReleases(input.to)) {
    /*
     * A confirmation. The member has been paid off the platform and the tokens
     * go where they can never come back from.
     *
     * The FROM account is read off the ROW and never computed from the live
     * dial. A village that turned the hold off while this was open would
     * otherwise have the burn try to take tokens out of an account that is
     * empty, or out of a member who has already been debited, depending on
     * which way somebody turned it.
     *
     * ── THE HOLD MUST ACTUALLY BE THERE, AND THIS IS NOT PARANOIA ───────────
     *
     * `sys:redemption-hold` POOLS every open redemption in the village, and the
     * burn takes `row.amountUnits` out of it. So a row that SAYS it holds
     * tokens and does not would burn somebody else's, silently: conservation
     * would still be zero, the ledger invariants would report nothing, and one
     * member would find their held tokens gone against a redemption they never
     * made. `holdReconciliation` would show the drift afterwards, which is a
     * record of a loss and not a guard against one.
     *
     * The window is narrow and it is real. `requestRedemption` commits the row
     * and posts the hold immediately after, because `postTransfer` opens its
     * own transaction and cannot join the one that wrote the row. A thrown post
     * is caught there and marks the row `refused`; a process that dies between
     * the commit and the post is not, and leaves exactly this shape.
     *
     * So the confirm door asks the LEDGER, not the row: does the posting this
     * row names exist. It is one indexed read on a UNIQUE column, it runs once
     * per confirmation, and it turns a silent theft into a refusal somebody can
     * act on. The claim is rolled back so a repaired row can be confirmed
     * later.
     */
    if (row.heldAccount && row.holdKey && !(await ledgerEntryExists(pool, row.holdKey))) {
      await unclaimConfirmation(pool, input.id, villageId());
      return {
        ok: false,
        reason: "burn-failed",
        error:
          "nothing was destroyed: this redemption says its tokens are held and the ledger has no " +
          "posting that took them, so confirming it would destroy somebody else's",
      };
    }
    let burn: { ok: boolean; duplicate: boolean; error?: string };
    try {
      burn = await postBurn(pool, row);
    } catch (err: any) {
      burn = { ok: false, duplicate: false, error: String(err?.message ?? err) };
    }
    if (!burn.ok && !burn.duplicate) {
      /*
       * A THROW IS NOT PROOF NOTHING POSTED. `postTransfer` commits and then
       * rethrows whatever the driver says, so a connection lost after the
       * COMMIT reached the server reports a burn that happened as a failure.
       * Un-claiming that row would let a withdrawal reverse a hold that is
       * already destroyed, out of a hold account every member's redemption
       * shares. So the ledger is asked first, on the row's own key, and a burn
       * that is there completes the confirmation. If this read itself throws,
       * the row stays confirmed, the direction `holdReconciliation` can see.
       */
      if (await ledgerEntryExists(pool, row.burnKey)) {
        const posted = await redemptionById(pool, input.id);
        return { ok: true, released: false, row: posted ?? row };
      }
      await unclaimConfirmation(pool, input.id, villageId());
      return { ok: false, reason: "burn-failed", error: `nothing was destroyed: ${burn.error}` };
    }
    const after = await redemptionById(pool, input.id);
    return { ok: true, released: false, row: after ?? row };
  }

  const back = await releaseHold(pool, row, input.to);
  if (!back.ok) {
    await pool
      .query("UPDATE `redemptions` SET `decision_note` = ? WHERE `id` = ? AND `village_id` = ?", [
        `release failed, the tokens are still held: ${String(back.error).slice(0, 200)}`,
        input.id,
        villageId(),
      ])
      .catch(() => {
        /* the note is a courtesy; `holdReconciliation` is the real record */
      });
    return {
      ok: false,
      reason: "release-failed",
      error: `the redemption closed and the tokens did not come back: ${back.error}`,
    };
  }
  const after = await redemptionById(pool, input.id);
  return { ok: true, released: true, row: after ?? row };
}

/**
 * Give the tokens back by REVERSING the hold, never by posting fresh.
 *
 * `reverse` derives the mirror from the stored row: same token, same size,
 * accounts swapped, and nothing the caller passes can change any of them. It
 * carries its own mirror key so a double release writes one mirror, it refuses
 * to reverse a reversal, and it refuses a posting already reversed. A release
 * that posted fresh would inherit none of that and would be a way to make the
 * token it claims to return. This is 0072's law and it is this module's.
 *
 * A row with no `hold_key` was opened while the village had the hold turned
 * off. Nothing was taken, so nothing comes back, and that is a success.
 */
async function releaseHold(
  pool: Pool,
  row: RedemptionRow,
  to: RedemptionState,
): Promise<{ ok: boolean; duplicate: boolean; error?: string }> {
  if (!row.holdKey) return { ok: true, duplicate: false };
  const res = await reverse(pool, row.holdKey, {
    from: REDEMPTION_HOLD,
    to: memberAccount(row.userId),
    tokenSlug: row.tokenSlug,
    // ALREADY MINOR, and an ASSERTION rather than an instruction. `reverse`
    // never posts this number: it reads the original row out of `token_ledger`
    // and mirrors THAT. This value is compared against the row's minor amount,
    // so it has to be minor, and it is the one place a registry rescale done
    // without rescaling `token_ledger` surfaces as a failure somebody can read.
    amount: row.amountUnits,
    note: `Redemption ${to}: ${row.id}`,
  }).catch((err: any) => ({ ok: false, duplicate: false, error: String(err?.message ?? err) }));
  return { ok: res.ok, duplicate: Boolean((res as any).duplicate), error: (res as any).error };
}

/**
 * Give back tokens a released redemption closed over without releasing.
 *
 * The repair path for `release-failed`. It deliberately does NOT go through
 * `canSettleRedemption`, because the row is already in the state it should be
 * in and the state machine is right to refuse moving it. What failed was the
 * posting.
 *
 * Safe to run against any released redemption at any time: `reverse` is
 * idempotent on its mirror key, so one already released is a no-op and one
 * never released is repaired. That makes it the right thing for a poller, an
 * admin button, or an operator to call blindly over `holdReconciliation`.
 */
export async function retryRelease(
  pool: Pool,
  id: string,
): Promise<{ ok: true; released: boolean } | { ok: false; error: string }> {
  const row = await redemptionById(pool, id);
  if (!row) return { ok: false, error: "no such redemption" };
  if (!redemptionReleases(row.state)) {
    return { ok: false, error: `a ${row.state} redemption is not owed anything back` };
  }
  const back = await releaseHold(pool, row, row.state);
  if (!back.ok) return { ok: false, error: back.error ?? "the release failed again" };
  return { ok: true, released: !back.duplicate };
}

/**
 * Release and close every redemption that ran out of time.
 *
 * Follows `reconcileSwapOrders`: it takes the rows it finds and settles each
 * through the same door a human would, so an expiry cannot become a second way
 * to move value. `expires_at` is NULL for a village that lets them wait
 * forever, and a NULL is never past.
 *
 * DELIBERATELY BLIND TO THE MODULE LIFECYCLE, and the `redemption-reap` job in
 * server/index.ts calls it with no lifecycle test. `openStateCheck` refuses to
 * switch the module off while anything is open, so in the ordinary case there
 * is nothing here to expire once it is off. The module can still be SERVED off
 * with rows open: `quarantineModule` takes a module off without touching its
 * stored lifecycle, and a hand-edited `module_settings` row skips the check.
 * An expiry that waited for the module to come back would hold those tokens
 * for as long as it stayed off. The same reasoning as `seat-fee-settle`.
 */
export async function expireRedemptions(pool: Pool, now: Date = new Date()): Promise<number> {
  const rows = await expiredIdRows(pool, villageId(), now);
  let closed = 0;
  for (const r of rows) {
    const res = await settleRedemption(pool, {
      id: String(r.id),
      to: "expired",
      actorUserId: null,
      note: "Nobody answered this before it ran out of time, so the tokens came back",
    });
    if (res.ok) closed += 1;
  }
  return closed;
}

// ── The two figures somebody has to be able to read ────────────────────────

/**
 * What the hold account is holding, and what the rows say it should be.
 *
 * The invariant, per token:
 *
 *   balance(sys:redemption-hold, token) == SUM(amount WHERE state='requested' AND held_account IS NOT NULL)
 *
 * All three existing escrows in this codebase have one of these, and each was
 * written because a holding account whose balance nobody compares to anything
 * is a place value goes to be lost quietly. A stranded row, a release that
 * failed, a hold posted against a redemption then abandoned: each breaks this
 * equality and none of them breaks conservation on its own, which is why
 * conservation alone was never going to catch them.
 *
 * EVERY FIGURE HERE IS MINOR UNITS, and the field names say so. The voice
 * bridge's equivalent returns `held`, `owed` and `drift` in minor units beside
 * a module of human ones, and its own comment calls that a trap that has not
 * been sprung yet. This one springs it in the names instead.
 */
export async function holdReconciliation(
  pool: Pool,
): Promise<Array<{ token: string; heldUnits: number; owedUnits: number; driftUnits: number; openCount: number }>> {
  const balances = await accountBalanceRows(pool, REDEMPTION_HOLD);
  const owed = await owedRowsByToken(pool, villageId());
  const owedBySlug = new Map(owed.map((r) => [String(r.token_slug), { n: Number(r.n), total: Number(r.total) }]));
  const slugs = new Set<string>([
    ...balances.map((r) => String(r.token_type)),
    ...Array.from(owedBySlug.keys()),
  ]);
  return Array.from(slugs)
    .sort()
    .map((token) => {
      const heldUnits = Number(balances.find((b) => String(b.token_type) === token)?.balance ?? 0);
      const o = owedBySlug.get(token) ?? { n: 0, total: 0 };
      return { token, heldUnits, owedUnits: o.total, driftUnits: heldUnits - o.total, openCount: o.n };
    });
}

/**
 * How much of each token this village has retired, in MINOR units.
 *
 * The balance of `sys:redeemed`, which only ever rises. This is the number the
 * admin token panel prints beside issuance, and the sentence that has to go
 * with it is that ISSUED SUPPLY DOES NOT FALL when a redemption is confirmed:
 * the burn touches no faucet, so every faucet's negative balance still says
 * exactly what it said before, which is what has been released to date.
 *
 * `GET /api/economy/supply` publishes `circulating` as issued minus waned and
 * does NOT yet subtract this. That is one term wider on one line in
 * `publicSupply`, and it is left to the lane that owns that function rather
 * than done here while it is being edited. Until it lands, the public feed's
 * `circulating` overstates by whatever this returns, and this comment is the
 * record of it.
 */
export async function retiredSupply(pool: Pool): Promise<Record<string, number>> {
  const rows = await accountBalanceRows(pool, REDEEMED);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.token_type)] = Number(r.balance ?? 0);
  return out;
}

/**
 * A one-line read for the exit desk: does this member have redemptions open?
 *
 * Exposed so `exitOpenState` can enumerate an open redemption as a blocking
 * domain in one call, the way an unsettled library loan blocks resolve. A
 * member should not be able to leave with tokens held against a request nobody
 * has answered: resolution anonymises them and vacates their seats, and the
 * hold would be left pointing at somebody who is gone.
 *
 * WIRED: `exitOpenState` (server/lib/exit.ts) enumerates it as the blocking
 * `redemptions` domain, and `sweepBalances` refuses to settle while it is above
 * zero, so tokens handed back after a sweep cannot land where nothing sweeps.
 */
export async function openRedemptionCount(pool: Pool, userId: string): Promise<number> {
  const rows = await openCountRows(pool, villageId(), userId);
  return Number(rows[0]?.n ?? 0);
}

/**
 * The redemption module's open state (economy invariant #13): every request
 * still waiting on an answer, village-wide.
 *
 * Held or not. A request opened with the hold turned off holds nothing, and it
 * is still a member waiting on a decision the village owes them, which a
 * module switched off would 404.
 */
export async function redemptionOpenState(pool: Pool): Promise<{ count: number; description: string }> {
  const rows = await openCountAllRows(pool, villageId());
  const n = Number(rows[0]?.n ?? 0);
  return {
    count: n,
    description: `${n} redemption(s) still waiting on an answer. Each is confirmed, refused or withdrawn, or runs out of time`,
  };
}
