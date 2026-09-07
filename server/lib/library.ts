/**
 * The material library (S41-S46): the village's shared tools and goods, on
 * library credits — a real platform token, non-transferable, never listed
 * on the exchange. ZERO ledger DDL; four seeded accounts:
 *
 *   intake award:  sys:library-mint  -> donor      (library_intake, capped)
 *   loan escrow:   member            -> sys:library-escrow  (loan:{id}:escrow)
 *   usage fee:     sys:library-escrow -> sys:library-pool   (loan:{id}:settle:pool)
 *   deposit back:  sys:library-escrow -> member             (loan:{id}:settle:release)
 *   admin grant:   sys:library-mint  -> member     (library_manual)
 *   credit burn:   member            -> sys:library-sink    (library_burn)
 *
 * NOT-deferrable invariants this file owns:
 *   - settleLoan is the SINGLE terminal for every loan ending (closed,
 *     expired, cancelled, disputed): an atomic claim (UPDATE ... WHERE
 *     settled_at IS NULL) decides ONE outcome forever, then the keyed legs
 *     post. A re-settle on a settled loan only REPAIRS: it re-posts the
 *     stored legs (idempotent keys make that a no-op unless a crash left
 *     them missing) and changes nothing else.
 *   - Escrow reconciliation: balance(sys:library-escrow) must equal the sum
 *     of unsettled loans' escrow_credits TO THE CREDIT. Boot refuses a
 *     mismatch — a drained or double-released escrow must never normalize.
 *   - Intake is capped (award <= appraisal x pct, per-member per-cycle cap,
 *     dual sign-off above the line) because intake is a MINT: the door
 *     where junk could become currency gets the guards.
 *   - No non-negative account goes negative here: nothing library-side
 *     passes allowNegative. Insufficient credits is a refusal, not a debt.
 *
 * UNITS. Two of them, and the line between them runs at the ledger's door.
 *
 *   CREDITS (whole, human) is what this module thinks in: every Library game
 *   variable declares `unit: "credits"`, and every money column here holds
 *   one. `library_items.credit_value` is an appraisal a steward typed.
 *   `library_loans.escrow_credits`, `wear_fee` and `damage_fee` are the same
 *   number a member is quoted. Those columns STAY human. The decision is
 *   deliberate and it is the reason 0184 needed no backfill on this module's
 *   tables when library credits went to two decimals: nothing here mirrors the
 *   ledger's scale.
 *
 *   MINOR UNITS is what `token_ledger.amount` holds, at whatever scale the
 *   registry says the token carries. Every one of the five posting legs
 *   converts with `toLedgerUnits(LIBRARY_CREDIT, ...)` on the way in, and the
 *   two readers that quote a ledger figure to a person or compare one against
 *   a steward's number (`intakeMintedThisCycle`, `supplyVsBacking`) convert
 *   back with `fromLedgerUnits`. `escrowReconciliation` is the one place that
 *   goes the other way, converting the stored column UP so the invariant
 *   compares integers.
 *
 *   The conversions are exact in both directions here, because every credit
 *   figure in this file is a whole number: `toLedgerUnits` is then a
 *   multiplication by a power of ten, so a sum converted once equals the sum
 *   of the conversions and escrow always drains to zero.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { balanceOf, ledgerEntryExists, memberAccount, MINT_FAUCET, postTransfer, registerToken, tokenDef, TREASURY } from "./ledger";
import { holdingFor, lockedShortfall, type TokenHolding } from "./holdings";
import { fromLedgerUnits, toLedgerUnits } from "./economy";
import { CURRENCY_DECIMALS } from "../../shared/tokenScale";
import { numberVar } from "./variables";
import { cycleIdFor, currentCycle } from "./gratitude-cycles";
import { recordEvent } from "./events";

export const LIBRARY_CREDIT = "library-credit";
export const LIBRARY_MINT = "sys:library-mint";
export const LIBRARY_ESCROW = "sys:library-escrow";
export const LIBRARY_POOL = "sys:library-pool";
export const LIBRARY_SINK = "sys:library-sink";

/** Boot registration, unconditional and re-asserted: non-transferable policy. */
export async function ensureLibraryToken(pool: Pool): Promise<void> {
  const existing = tokenDef(LIBRARY_CREDIT);
  if (existing && existing.transferable === false) return;
  await registerToken(pool, {
    slug: LIBRARY_CREDIT,
    name: "Library Credits",
    kind: "credit",
    governance: "platform",
    transferable: false,
    /*
     * A CREDIT TOKEN IS CURRENCY-LIKE, so it carries the currency scale from
     * the day it is created. This is stated here and not left to
     * `registerToken`'s whole-unit default because a FRESH village would
     * otherwise create this token at 0 while a migrated one holds 2, and
     * `registerToken` leaves `decimals` out of its upsert on purpose, so
     * nothing would ever reconcile the two. The migration that rescaled the
     * existing rows is the other half of this line.
     */
    decimals: CURRENCY_DECIMALS,
  });
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface LibraryItem {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  photoUrl: string | null;
  status: "intake_pending" | "available" | "checked_out" | "written_off";
  healthBp: number;
  creditValue: number;
  minStage: string | null;
  requiresRole: string | null;
  donorUserId: string | null;
  intakeSignedBy: string | null;
  /**
   * A standing example. The read is `SELECT *`, so the row always carried it
   * and this mapper always dropped it — which left the admin shelf table
   * mixing seeded items with the village's own donations under no marker.
   */
  isExample: boolean;
}

export interface LibraryLoan {
  id: string;
  itemId: string;
  userId: string;
  status: "reserved" | "pickup_pending" | "active" | "return_pending" | "closed" | "expired" | "cancelled" | "disputed";
  escrowCredits: number;
  dueOn: string | null;
  wearFee: number | null;
  damageFee: number | null;
  settledCycleId: string | null;
  settledAt: string | null;
}

const LIVE_LOAN_STATUSES = ["reserved", "pickup_pending", "active", "return_pending"] as const;

function rowToItem(r: RowDataPacket): LibraryItem {
  return {
    id: String(r.id), name: String(r.name), description: r.description ?? null,
    categoryId: r.category_id ?? null, photoUrl: r.photo_url ?? null,
    status: r.status, healthBp: Number(r.health_bp ?? 10000), creditValue: Number(r.credit_value ?? 0),
    minStage: r.min_stage ?? null, requiresRole: r.requires_role ?? null,
    donorUserId: r.donor_user_id ?? null, intakeSignedBy: r.intake_signed_by ?? null,
    isExample: Number(r.is_example ?? 0) === 1,
  };
}

function rowToLoan(r: RowDataPacket): LibraryLoan {
  return {
    id: String(r.id), itemId: String(r.item_id), userId: String(r.user_id), status: r.status,
    escrowCredits: Number(r.escrow_credits ?? 0),
    dueOn: r.due_on ? new Date(r.due_on).toISOString().slice(0, 10) : null,
    wearFee: r.wear_fee == null ? null : Number(r.wear_fee),
    damageFee: r.damage_fee == null ? null : Number(r.damage_fee),
    settledCycleId: r.settled_cycle_id ?? null,
    settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
  };
}

export async function libraryItems(pool: Pool): Promise<LibraryItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM library_items ORDER BY name");
  return rows.map(rowToItem);
}

export async function libraryItemById(pool: Pool, id: string): Promise<LibraryItem | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM library_items WHERE id = ?", [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function libraryLoanById(pool: Pool, id: string): Promise<LibraryLoan | null> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM library_loans WHERE id = ?", [id]);
  return rows[0] ? rowToLoan(rows[0]) : null;
}

export async function loansForUser(pool: Pool, userId: string): Promise<LibraryLoan[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM library_loans WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(rowToLoan);
}

export async function itemEvent(pool: Pool, itemId: string, kind: string, detail: string | null, actorUserId: string | null): Promise<void> {
  await pool.query(
    "INSERT INTO library_item_events (id, item_id, kind, detail, actor_user_id) VALUES (?,?,?,?,?)",
    [`lie-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, itemId, kind, detail?.slice(0, 500) ?? null, actorUserId],
  );
}

// ── Intake: the mint's front door, guarded ───────────────────────────────────

export interface IntakeInput {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  appraisal: number;
  donorUserId: string;
  minStage?: string | null;
  requiresRole?: string | null;
  recordedBy: string | null;
  /** L6: a picture of the actual item — the column existed since 0024. */
  photoUrl?: string | null;
}

export type IntakeResult =
  | { ok: true; itemId: string; award: number; pendingSecondSignoff: boolean }
  | { ok: false; error: string };

/**
 * What the mint has issued to this member this lunation, via intake, IN
 * CREDITS.
 *
 * The SUM is over `token_ledger.amount`, which is minor units, and every
 * number it meets is a whole credit: `award` off an appraisal, and
 * `library.intake_member_cycle_cap`, whose own unit is "credits"
 * (`shared/gameVariables.ts`). One function feeds four of those meetings (the
 * two cap comparisons and the two refusal strings), so the conversion belongs
 * here, once, rather than at each of them.
 *
 * Today the two units coincide and the mixture is invisible. At 4 decimals it
 * breaks TIGHT, never loose: one 75-credit award leaves the raw sum at 750000
 * against a cap of 500, so the donor's next intake is refused forever and the
 * steward is told "750000 of 500 already granted".
 */
async function intakeMintedThisCycle(pool: Pool, userId: string): Promise<number> {
  const cycle = currentCycle();
  const [[row]] = await pool.query<any[]>(
    "SELECT COALESCE(SUM(amount),0) AS s FROM token_ledger WHERE from_account = ? AND to_account = ? " +
      "AND token_type = ? AND source = 'library_intake' AND at >= ?",
    [LIBRARY_MINT, memberAccount(userId), LIBRARY_CREDIT, new Date(cycle.startsAt)],
  );
  return fromLedgerUnits(LIBRARY_CREDIT, Number(row.s));
}

export async function recordIntake(pool: Pool, input: IntakeInput): Promise<IntakeResult> {
  const appraisal = Math.floor(Number(input.appraisal));
  if (!(appraisal > 0)) return { ok: false, error: "An appraisal in credits is required" };
  const pct = Math.max(0, Math.min(100, numberVar("library.intake_award_pct")));
  const award = Math.floor((appraisal * pct) / 100);
  const cap = numberVar("library.intake_member_cycle_cap");
  if (cap > 0 && award > 0) {
    const already = await intakeMintedThisCycle(pool, input.donorUserId);
    if (already + award > cap) {
      return {
        ok: false,
        error: `This award would exceed the per-member intake cap for this lunation: ${already} of ${cap} already granted (library.intake_member_cycle_cap)`,
      };
    }
  }
  const needsSecond = numberVar("library.intake_dual_signoff_over") > 0 && appraisal > numberVar("library.intake_dual_signoff_over");
  const itemId = `li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pool.query(
    "INSERT INTO library_items (id, name, description, category_id, status, credit_value, min_stage, requires_role, donor_user_id, intake_signed_by, photo_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      itemId, input.name.trim().slice(0, 160), input.description ?? null, input.categoryId ?? null,
      needsSecond ? "intake_pending" : "available", appraisal,
      input.minStage ?? null, input.requiresRole ?? null, input.donorUserId, input.recordedBy,
      input.photoUrl ?? null,
    ],
  );
  await itemEvent(pool, itemId, "intake", `appraised at ${appraisal}, award ${award}${needsSecond ? " (awaiting second sign-off)" : ""}`, input.recordedBy);
  if (!needsSecond && award > 0) {
    const r = await postTransfer(pool, {
      from: LIBRARY_MINT,
      to: memberAccount(input.donorUserId),
      tokenType: LIBRARY_CREDIT,
      // `award` is whole credits (floor of an appraised value times a percent).
      // The ledger takes minor units, so the conversion happens here, at the
      // boundary, and never inside postTransfer.
      amount: toLedgerUnits(LIBRARY_CREDIT, award),
      source: "library_intake",
      sourceRef: itemId,
      description: `Intake: ${input.name.trim().slice(0, 100)}`,
      idempotencyKey: `intake:${itemId}`,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "intake award failed" };
  }
  return { ok: true, itemId, award: needsSecond ? 0 : award, pendingSecondSignoff: needsSecond };
}

/** The SECOND steward clears a high-value intake; the first cannot self-approve. */
export async function approveIntake(pool: Pool, itemId: string, approverId: string): Promise<{ ok: true; award: number } | { ok: false; error: string }> {
  const item = await libraryItemById(pool, itemId);
  if (!item) return { ok: false, error: "No such item" };
  if (item.status !== "intake_pending") return { ok: false, error: `This item is ${item.status}, not awaiting sign-off` };
  if (item.intakeSignedBy && item.intakeSignedBy === approverId) {
    return { ok: false, error: "Dual sign-off means a SECOND steward. You recorded this intake" };
  }
  const pct = Math.max(0, Math.min(100, numberVar("library.intake_award_pct")));
  const award = Math.floor((item.creditValue * pct) / 100);
  const cap = numberVar("library.intake_member_cycle_cap");
  if (item.donorUserId && cap > 0 && award > 0) {
    const already = await intakeMintedThisCycle(pool, item.donorUserId);
    if (already + award > cap) {
      return { ok: false, error: `This award would exceed the per-member intake cap for this lunation (${already} of ${cap})` };
    }
  }
  await pool.query("UPDATE library_items SET status = 'available' WHERE id = ?", [itemId]);
  await itemEvent(pool, itemId, "intake_approved", `second sign-off; award ${award}`, approverId);
  if (item.donorUserId && award > 0) {
    const r = await postTransfer(pool, {
      from: LIBRARY_MINT,
      to: memberAccount(item.donorUserId),
      tokenType: LIBRARY_CREDIT,
      // Whole credits in, minor units out, exactly as the single-signature
      // path above. This is the route every HIGH-VALUE item takes, so leaving
      // it human would underpay the largest awards by the whole scale factor.
      amount: toLedgerUnits(LIBRARY_CREDIT, award),
      source: "library_intake",
      sourceRef: itemId,
      description: `Intake (dual-signed): ${item.name}`,
      idempotencyKey: `intake:${itemId}`,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "intake award failed" };
  }
  return { ok: true, award };
}

// ── Loans ────────────────────────────────────────────────────────────────────

/**
 * WHAT A MEMBER HAS HERE, AND WHAT THEY CAN SPEND HERE.
 *
 * `balance` and `balanceDecimals` are exactly what `GET /api/library` sent
 * before and are kept, so nothing reading the old shape has to move. What is
 * added is the other three quarters of the reading: the deposits locked in
 * items that are out, the total those add up to, and one entry per item saying
 * which item and how to get the credits back.
 *
 * The arithmetic and the sentences live in server/lib/holdings.ts, because the
 * same four numbers are owed on every holdings surface and a second
 * implementation is a second place for them to disagree. This function is the
 * library's window onto it.
 */
export async function libraryHoldingsFor(
  pool: Pool,
  userId: string,
): Promise<TokenHolding & { balance: number; balanceDecimals: number }> {
  const holding = await holdingFor(pool, userId, LIBRARY_CREDIT);
  return { ...holding, balance: holding.spendableUnits, balanceDecimals: holding.decimals };
}

export function escrowFor(creditValue: number): number {
  const pct = Math.max(0, numberVar("library.escrow_pct"));
  // Rounding favors the pool (the village side): ceil what the member locks.
  return Math.ceil((creditValue * pct) / 100);
}

export async function reserveItem(
  pool: Pool,
  input: { itemId: string; userId: string },
): Promise<{ ok: true; loanId: string; escrow: number } | { ok: false; status: number; error: string }> {
  const item = await libraryItemById(pool, input.itemId);
  if (!item) return { ok: false, status: 404, error: "No such item" };
  if (item.status !== "available") {
    return { ok: false, status: 409, error: `"${item.name}" is ${item.status.replace(/_/g, " ")} right now` };
  }
  const escrow = escrowFor(item.creditValue);
  const loanId = `loan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  /*
   * CLAIM THE SHELF FIRST, THEN TAKE THE DEPOSIT.
   *
   * This used to post escrow, then insert the loan, then update the item —
   * three separate autocommits. Two things went wrong with that.
   *
   * The availability check above is a read; the write that acts on it came
   * four statements later. Two members tapping "borrow" on the last hammer
   * both read `available`, both paid escrow, and both got a loan — for one
   * hammer. Claiming the row with a CONDITIONAL update inside a transaction
   * makes exactly one of them win, and the loser never pays.
   *
   * And escrow-first meant a crash before the loan row left the member's
   * credits sitting in `sys:library_escrow` with nothing pointing at them:
   * value gone, no record of why, nothing to refund against. Claiming first
   * inverts the failure — a crash now leaves a visible `reserved` loan whose
   * escrow was never taken, which reads as "this loan is owed a deposit"
   * instead of "these credits vanished". The member is never out of pocket
   * for a step that did not finish.
   */
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [claim]: any = await conn.query(
      "UPDATE library_items SET status = 'checked_out' WHERE id = ? AND status = 'available'",
      [item.id],
    );
    if (!claim.affectedRows) {
      await conn.rollback();
      return { ok: false, status: 409, error: `Someone just borrowed "${item.name}". It is no longer on the shelf` };
    }
    await conn.query(
      "INSERT INTO library_loans (id, item_id, user_id, status, escrow_credits) VALUES (?,?,?,?,?)",
      [loanId, item.id, input.userId, "reserved", escrow],
    );
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* already gone */ }
    throw e;
  } finally {
    conn.release();
  }

  if (escrow > 0) {
    let r;
    try {
      r = await postTransfer(pool, {
        from: memberAccount(input.userId),
        to: LIBRARY_ESCROW,
        tokenType: LIBRARY_CREDIT,
        // `escrow` is whole credits and `library_loans.escrow_credits` stores
        // it that way, four statements above. The COLUMN stays human and the
        // LEDGER goes minor, so `escrowReconciliation` converts the column up
        // rather than either side being read in the other's unit.
        amount: toLedgerUnits(LIBRARY_CREDIT, escrow),
        source: "library_escrow",
        sourceRef: loanId,
        description: `Escrow: ${item.name}`,
        idempotencyKey: `loan:${loanId}:escrow`,
      });
    } catch (e) {
      // A THROWN escrow post (deadlock, lock timeout, dropped connection) is
      // the same failure as a refused one for this loan's purposes: no
      // deposit landed, so the same compensation must run — otherwise the
      // loan row survives expecting credits escrow never received, and boot
      // reconciliation refuses to serve. Compensate, then rethrow the
      // original error (the compensation must not swallow it).
      await pool.query("DELETE FROM library_loans WHERE id = ?", [loanId]);
      await pool.query("UPDATE library_items SET status = 'available' WHERE id = ?", [item.id]);
      throw e;
    }
    if (!r.ok) {
      // They cannot afford it, so hand the item straight back to the shelf.
      // Compensating, not a rollback: the ledger post owns its own
      // transaction and cannot join the one above.
      await pool.query("DELETE FROM library_loans WHERE id = ?", [loanId]);
      await pool.query("UPDATE library_items SET status = 'available' WHERE id = ?", [item.id]);
      /*
       * WHY THEY ARE SHORT, WHEN THE REASON IS SOMETHING THEY ARE HOLDING.
       *
       * A member with seventy credits and fifty locked in a camera has twenty
       * to spend, and the sentence they used to meet said only that they need
       * more. It was true and it was useless: they can remember earning the
       * seventy, the page prints twenty, and nothing anywhere joined the two.
       *
       * `lockedShortfall` returns null when the locks would not have covered
       * this anyway, so a member who is genuinely short still hears the
       * ordinary sentence and is never sent to fetch an item that would not
       * have been enough. This loan's own escrow was compensated above and its
       * row is gone, so the reading below cannot count the deposit it just
       * failed to take.
       */
      const holding = await holdingFor(pool, input.userId, LIBRARY_CREDIT);
      const why = lockedShortfall(holding, toLedgerUnits(LIBRARY_CREDIT, escrow));
      if (why) {
        return {
          ok: false,
          status: 409,
          error: `You need ${escrow} library credit(s) set aside to borrow this and ${holding.spendable} of yours are free. ${why}`,
        };
      }
      return { ok: false, status: 409, error: `You need ${escrow} library credit(s) set aside to borrow this. Earn them by contributing items or work` };
    }
  }
  await itemEvent(pool, item.id, "reserved", `loan ${loanId}, escrow ${escrow}`, input.userId);
  return { ok: true, loanId, escrow };
}

export async function markPickedUp(pool: Pool, loanId: string, actorId: string | null): Promise<{ ok: boolean; error?: string; dueOn?: string }> {
  const loan = await libraryLoanById(pool, loanId);
  if (!loan) return { ok: false, error: "No such loan" };
  if (loan.status !== "reserved" && loan.status !== "pickup_pending") {
    return { ok: false, error: `This loan is ${loan.status}` };
  }
  const days = Math.max(1, numberVar("library.loan_days_default"));
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + days);
  const dueOn = due.toISOString().slice(0, 10);
  await pool.query("UPDATE library_loans SET status = 'active', due_on = ? WHERE id = ?", [dueOn, loanId]);
  await itemEvent(pool, loan.itemId, "picked_up", `due ${dueOn}`, actorId);
  return { ok: true, dueOn };
}

export async function markReturned(pool: Pool, loanId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }> {
  const loan = await libraryLoanById(pool, loanId);
  if (!loan) return { ok: false, error: "No such loan" };
  if (loan.status !== "active") return { ok: false, error: `This loan is ${loan.status}, not active` };
  await pool.query("UPDATE library_loans SET status = 'return_pending' WHERE id = ?", [loanId]);
  await itemEvent(pool, loan.itemId, "returned", null, actorId);
  return { ok: true };
}

export type SettleOutcome = "closed" | "expired" | "cancelled" | "disputed";

export interface SettleLoanResult {
  ok: boolean;
  alreadySettled: boolean;
  outcome?: SettleOutcome;
  wearFee?: number;
  damageFee?: number;
  released?: number;
  error?: string;
}

/**
 * THE single terminal. One atomic claim decides the outcome and fees
 * forever; the keyed legs post after. First path wins: a competing settle
 * (double click, second steward, dispute racer) loses the claim and only
 * REPAIRS — re-posting the stored legs, which the idempotency keys reduce
 * to no-ops unless a crash between claim and legs left money parked in
 * escrow. Nothing here can pay twice or pay two different stories.
 *
 * Default outcomes ride the variables: a settle WITHOUT explicit fees uses
 * the computed wear (usage fee % of item value) and ZERO damage — the same
 * defaults the dispute deadline and return timeout resolve to.
 */
export async function settleLoan(
  pool: Pool,
  input: { loanId: string; outcome: SettleOutcome; wearFee?: number; damageFee?: number },
): Promise<SettleLoanResult> {
  const loan = await libraryLoanById(pool, input.loanId);
  if (!loan) return { ok: false, alreadySettled: false, error: "No such loan" };
  const item = await libraryItemById(pool, loan.itemId);

  // Fee policy: cancelled and expired reservations pay nothing (the item
  // never left); closed pays computed wear by default; disputes default to
  // computed wear + zero damage (the deadline's honest resolution).
  const computedWear = item ? Math.ceil((item.creditValue * Math.max(0, numberVar("library.usage_fee_pct"))) / 100) : 0;
  const zeroFee = input.outcome === "cancelled" || input.outcome === "expired";
  let wearFee = zeroFee ? 0 : Math.max(0, Math.floor(input.wearFee ?? computedWear));
  let damageFee = zeroFee ? 0 : Math.max(0, Math.floor(input.damageFee ?? 0));
  // Escrow is the ceiling: liability beyond it is a human conversation.
  if (wearFee + damageFee > loan.escrowCredits) {
    damageFee = Math.max(0, loan.escrowCredits - wearFee);
    if (wearFee > loan.escrowCredits) { wearFee = loan.escrowCredits; damageFee = 0; }
  }

  // The atomic claim: exactly one settle ever writes the outcome.
  const [claim] = await pool.query<any>(
    "UPDATE library_loans SET status = ?, wear_fee = ?, damage_fee = ?, settled_cycle_id = ?, settled_at = NOW() " +
      "WHERE id = ? AND settled_at IS NULL",
    [input.outcome, wearFee, damageFee, cycleIdFor(new Date()), input.loanId],
  );
  const won = !!(claim as any).affectedRows;
  // Losers repair with the STORED story, never their own.
  const settled = won ? { outcome: input.outcome, wearFee, damageFee } : await (async () => {
    const l = (await libraryLoanById(pool, input.loanId))!;
    return { outcome: l.status as SettleOutcome, wearFee: l.wearFee ?? 0, damageFee: l.damageFee ?? 0 };
  })();

  // The ceiling for what can leave escrow is what provably ARRIVED, not what
  // the loan row expected: a crash between the loan row and its escrow leg
  // leaves escrow_credits = N with nothing deposited, and releasing against
  // that expectation would drive sys:library-escrow negative (refused) or,
  // worse, pay this member from someone else's deposit. Exact idempotency
  // key on purpose — a looser LIKE would normalise away a genuinely drained
  // escrow, the one thing the reconciliation invariant exists to catch.
  const deposited = loan.escrowCredits > 0 && (await ledgerEntryExists(pool, `loan:${input.loanId}:escrow`));
  const escrowHeld = deposited ? loan.escrowCredits : 0;
  const fee = Math.min(escrowHeld, settled.wearFee + settled.damageFee);
  const release = escrowHeld - fee;
  if (fee > 0) {
    const r = await postTransfer(pool, {
      // `fee` and `release` below are both whole credits, both derived from
      // the human `escrow_credits` column, and they sum to exactly what the
      // escrow leg deposited. Converting them SEPARATELY is still exact, so
      // the escrow account drains to zero: toLedgerUnits is a multiplication
      // by a power of ten over integers. Convert one leg and not the other
      // and the account strands a surplus, which is what the boot invariant
      // refuses to serve over.
      from: LIBRARY_ESCROW, to: LIBRARY_POOL, tokenType: LIBRARY_CREDIT, amount: toLedgerUnits(LIBRARY_CREDIT, fee),
      source: "library_fee", sourceRef: input.loanId,
      description: `Loan ${settled.outcome}: wear ${settled.wearFee}, damage ${settled.damageFee}`,
      idempotencyKey: `loan:${input.loanId}:settle:pool`,
    });
    if (!r.ok) return { ok: false, alreadySettled: !won, error: r.error };
  }
  if (release > 0) {
    const r = await postTransfer(pool, {
      from: LIBRARY_ESCROW, to: memberAccount(loan.userId), tokenType: LIBRARY_CREDIT, amount: toLedgerUnits(LIBRARY_CREDIT, release),
      source: "library_release", sourceRef: input.loanId,
      description: `Escrow released (${settled.outcome})`,
      idempotencyKey: `loan:${input.loanId}:settle:release`,
    });
    if (!r.ok) return { ok: false, alreadySettled: !won, error: r.error };
  }
  if (won) {
    // The item returns to circulation unless it was written off separately.
    if (item && item.status === "checked_out") {
      await pool.query("UPDATE library_items SET status = 'available' WHERE id = ? AND status = 'checked_out'", [item.id]);
    }
    await itemEvent(pool, loan.itemId, `settled_${settled.outcome}`, `wear ${settled.wearFee}, damage ${settled.damageFee}, released ${release}`, null);
  }
  return { ok: true, alreadySettled: !won, outcome: settled.outcome, wearFee: settled.wearFee, damageFee: settled.damageFee, released: release };
}

// ── Wave 1: the deadline sweep and the stall watch ───────────────────────────

export interface DeadlineSettled {
  loanId: string;
  userId: string;
  itemName: string;
  wearFee: number;
  released: number;
}

/**
 * L10: the dispute deadline, finally enforced. A return sitting in
 * return_pending is a contested (or merely un-clicked) close, and
 * library.dispute_deadline_days was published as policy while nothing ran
 * it. Past the deadline, the loan settles with the DEFAULT resolution the
 * variable always promised — computed wear, zero damage, escrow released —
 * through settleLoan, the same single terminal every human settle uses.
 * Idempotent by construction: settleLoan's atomic claim makes a re-run a
 * repair, never a second payment.
 */
export async function sweepReturnDeadlines(pool: Pool): Promise<DeadlineSettled[]> {
  const days = Math.max(1, numberVar("library.dispute_deadline_days"));
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.id, l.user_id, i.name FROM library_loans l JOIN library_items i ON i.id = l.item_id " +
      "WHERE l.status = 'return_pending' AND l.settled_at IS NULL AND l.updated_at < (NOW() - INTERVAL ? DAY)",
    [days],
  );
  const settled: DeadlineSettled[] = [];
  for (const r of rows) {
    const s = await settleLoan(pool, { loanId: String(r.id), outcome: "closed" });
    if (s.ok && !s.alreadySettled) {
      settled.push({
        loanId: String(r.id), userId: String(r.user_id), itemName: String(r.name),
        wearFee: s.wearFee ?? 0, released: s.released ?? 0,
      });
    }
  }
  return settled;
}

export interface OverdueLoan {
  loanId: string;
  userId: string;
  itemName: string;
  dueOn: string;
  daysOver: number;
}

/** L12: active loans past their due date — the digest's raw material. */
export async function overdueLoans(pool: Pool): Promise<OverdueLoan[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.id, l.user_id, l.due_on, i.name, DATEDIFF(CURDATE(), l.due_on) AS days_over " +
      "FROM library_loans l JOIN library_items i ON i.id = l.item_id " +
      "WHERE l.status = 'active' AND l.due_on IS NOT NULL AND l.due_on < CURDATE() ORDER BY l.due_on",
  );
  return rows.map((r) => ({
    loanId: String(r.id), userId: String(r.user_id), itemName: String(r.name),
    dueOn: String(r.due_on), daysOver: Number(r.days_over),
  }));
}

export interface StalledIntake {
  itemId: string;
  name: string;
  daysWaiting: number;
}

/**
 * L19: intakes waiting for a second sign-off with nobody moving. A donor
 * already handed over the item and is owed their credits; silence here is
 * a single point of failure that today fails silently.
 */
export async function stalledIntakes(pool: Pool, days: number): Promise<StalledIntake[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, DATEDIFF(NOW(), created_at) AS waiting FROM library_items " +
      "WHERE status = 'intake_pending' AND created_at < (NOW() - INTERVAL ? DAY) ORDER BY created_at",
    [Math.max(1, days)],
  );
  return rows.map((r) => ({ itemId: String(r.id), name: String(r.name), daysWaiting: Number(r.waiting) }));
}

// ── Invariants, strikes, red flags ───────────────────────────────────────────

/**
 * balance(sys:library-escrow) === SUM(unsettled escrow). To the credit.
 *
 * BOTH NUMBERS ARE MINOR UNITS. `library_loans.escrow_credits` stores whole
 * credits (the steward's unit, and the unit every Library game variable
 * declares), so the stored side is converted UP to meet the ledger rather than
 * the ledger being divided down to meet it. Two reasons for that direction:
 * the comparison stays integer, so a one-unit drift can never round away, and
 * the finest thing the escrow can actually hold is a minor unit.
 *
 * A SUM converted once equals the sum of the conversions, because every stored
 * escrow is a whole number and toLedgerUnits multiplies by a power of ten.
 *
 * `decimals` rides along because both figures leave this process. The admin
 * panel spreads this object straight into its payload, and a number in minor
 * units with no scale beside it is the shape that has already been printed raw
 * to a member twice. Shipping the scale with the amount is the house pattern
 * (`balanceDecimals` on the wallet, `t.decimals` on `publicSupply`), and it
 * means the render site needs nothing from the route to divide correctly.
 */
export async function escrowReconciliation(pool: Pool): Promise<{ ok: boolean; expected: number; actual: number; decimals: number }> {
  const [[row]] = await pool.query<any[]>(
    `SELECT COALESCE(SUM(escrow_credits),0) AS s FROM library_loans WHERE settled_at IS NULL AND status IN (${LIVE_LOAN_STATUSES.map(() => "?").join(",")})`,
    [...LIVE_LOAN_STATUSES],
  );
  const expected = toLedgerUnits(LIBRARY_CREDIT, Number(row.s));
  const actual = await balanceOf(pool, LIBRARY_ESCROW, LIBRARY_CREDIT);
  return { ok: expected === actual, expected, actual, decimals: tokenDef(LIBRARY_CREDIT)?.decimals ?? 0 };
}

export async function assertLibraryInvariants(pool: Pool): Promise<void> {
  // Repair PROVABLE orphans before asserting: a crash between the loan row
  // and its escrow leg leaves a live loan whose deposit never landed, which
  // would wedge boot forever (reconciliation expects credits escrow never
  // received) with nothing an admin can click. Only a provably absent leg
  // qualifies — exact idempotency key, never a pattern — so a genuinely
  // drained escrow (leg present, balance short) still refuses to serve.
  const [candidates] = await pool.query<RowDataPacket[]>(
    `SELECT id, item_id, user_id, escrow_credits FROM library_loans WHERE settled_at IS NULL AND escrow_credits > 0 AND status IN (${LIVE_LOAN_STATUSES.map(() => "?").join(",")})`,
    [...LIVE_LOAN_STATUSES],
  );
  for (const o of candidates) {
    if (await ledgerEntryExists(pool, `loan:${o.id}:escrow`)) continue;
    // Zero the expectation in the same statement that settles, so the
    // single-terminal invariant stays honest: this loan's stored story is
    // "cancelled, nothing ever escrowed" — never a release of phantom credits.
    const [claim]: any = await pool.query(
      "UPDATE library_loans SET status = 'cancelled', escrow_credits = 0, wear_fee = 0, damage_fee = 0, settled_at = NOW() WHERE id = ? AND settled_at IS NULL",
      [o.id],
    );
    if (!claim.affectedRows) continue;
    await pool.query("UPDATE library_items SET status = 'available' WHERE id = ? AND status = 'checked_out'", [o.item_id]);
    // Loud on purpose: this cancels a member's reservation and reshelves the
    // item. A silent repair would be a lost reservation nobody can explain.
    console.error(
      `[library] repaired orphan loan ${o.id}: escrow leg loan:${o.id}:escrow never posted; ` +
        `cancelled the reservation (member ${o.user_id}, expected ${o.escrow_credits} credit(s)) and reshelved item ${o.item_id}`,
    );
    await recordEvent(pool, {
      kind: "library_repair",
      text: "A reservation was cancelled at boot: its escrow deposit never landed, so the item went back on the shelf",
      entityType: "library_loan",
      entityRef: String(o.id),
      audience: "admin",
    });
  }
  const rec = await escrowReconciliation(pool);
  if (!rec.ok) {
    // The comparison is in minor units and the sentence is in credits: this is
    // read by an operator under pressure while boot is refused, and a number in
    // hundredths is the last thing that surface should hand them. The
    // minor figures ride along in parentheses so the two can be reconciled
    // against the raw rows without a calculator.
    throw new Error(
      `library escrow reconciliation failed: account holds ${fromLedgerUnits(LIBRARY_CREDIT, rec.actual)} credit(s) ` +
        `but open loans expect ${fromLedgerUnits(LIBRARY_CREDIT, rec.expected)} ` +
        `(${rec.actual} vs ${rec.expected} in minor units), refusing to serve`,
    );
  }
}

/** No-show strikes are DERIVED (counted), never stored counters. */
export async function noShowStrikes(pool: Pool, userId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM library_loans WHERE user_id = ? AND status = 'expired'",
    [userId],
  );
  return Number(row.n);
}

/**
 * The supply-vs-backing red flag: outstanding credits (what the mint has
 * issued and not reclaimed) against the replacement value still on the
 * shelves. Credits above backing = the intake door leaked.
 *
 * EVERY NUMBER OUT OF HERE IS WHOLE CREDITS. `balanceOf` answers in minor
 * units and `SUM(library_items.credit_value)` is an appraisal a steward typed,
 * so the two sides of `flagged` were being compared across a scale that only
 * happens to be 1 today. At 4 decimals the raw comparison is true forever and
 * the mint's own over-issuance alarm goes permanently red, which is the same
 * as having no alarm.
 *
 * The division happens ONCE, on the minor totals, so `outstanding` is exactly
 * the ledger's own figure over the token's scale and cannot drift from it by
 * an accumulated rounding.
 */
export async function supplyVsBacking(pool: Pool): Promise<{ outstanding: number; backing: number; flagged: boolean; shelfBacked: number; sold: number }> {
  // Two provenances of circulating credit: what the intake door minted
  // (sys:library-mint) AND what the exchange sold for money once the L9 card
  // was accepted (sys:mint → sys:treasury → buyers). The old read saw only
  // the first, so sold credits never counted against the shelves and the
  // red flag stayed grey however many were sold. Treasury stock still
  // sitting unsold is subtracted — inventory is not circulation.
  const shelfBackedUnits = -(await balanceOf(pool, LIBRARY_MINT, LIBRARY_CREDIT));
  const soldUnits = Math.max(
    0,
    -(await balanceOf(pool, MINT_FAUCET, LIBRARY_CREDIT)) - (await balanceOf(pool, TREASURY, LIBRARY_CREDIT)),
  );
  const shelfBacked = fromLedgerUnits(LIBRARY_CREDIT, shelfBackedUnits);
  const sold = fromLedgerUnits(LIBRARY_CREDIT, soldUnits);
  const outstanding = fromLedgerUnits(LIBRARY_CREDIT, shelfBackedUnits + soldUnits);
  const [[row]] = await pool.query<any[]>(
    // Example items are not on any shelf, so counting their appraisals as
    // backing would hold the over-issuance flag grey while real circulating
    // credits outran the real goods.
    "SELECT COALESCE(SUM(credit_value),0) AS s FROM library_items WHERE status <> 'written_off' AND is_example = 0",
  );
  const backing = Number(row.s);
  return { outstanding, backing, flagged: outstanding > backing, shelfBacked, sold };
}

/** Open economic state (invariant #13): every unsettled loan blocks off. */
export async function libraryOpenState(pool: Pool): Promise<{ count: number; description: string }> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM library_loans WHERE settled_at IS NULL",
  );
  return { count: Number(row.n), description: `${row.n} open loan(s)` };
}
