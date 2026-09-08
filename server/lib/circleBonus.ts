/**
 * PAYING A CIRCLE FOR ROOM IT DID NOT USE.
 *
 * `shared/circleBonus.ts` holds the shape, the refusals and the arithmetic,
 * and its header holds the reasoning. This file holds the two things that need
 * a database: reading whether a steward set the completion decision aside, and
 * posting the tokens.
 *
 * ── THE VETO IS READ HERE BECAUSE THE GATE DOES NOT CARRY IT ───────────────
 *
 * Rye ruled that completion and bonus are ONE vote and that a steward's veto
 * sets the whole thing aside, the completion finding included. The completion
 * gate cannot say so today: `VoteComponent` in shared/circleBonusGate.ts has
 * no member for it, and `voteStateOf` in server/lib/circleBonusGate.ts builds
 * the state from `ballots.status` alone, which a veto never changes. A vetoed
 * completion ballot still reads `said_yes` through that reading.
 *
 * So the fact is read from its own home instead of being assumed absent.
 * `drizzle/0172` put `vetoed_at` on `ballots` and made it the gate every apply
 * checks; `ballot_vetoes` holds the steward's act that produced it. Both are
 * read, because they are two representations of one decision and either
 * standing alone means the decision is set aside: the act row is what a
 * steward wrote, and `vetoed_at` is what the landing loop reads.
 *
 * THIS IS NOT THE GATE GROWING A FEATURE HERE. The day `VoteComponent` gains a
 * `vetoed` state, `vetoVerdictFor` is deleted and the verdict is filled from
 * the reading, and no arithmetic in shared/circleBonus.ts moves. The parameter
 * exists so the omission is visible instead of being papered over with a
 * default of "no veto".
 *
 * ── THE BONUS IS ISSUANCE, AND IT IS NOT A HAND MINT ───────────────────────
 *
 * The posting leaves `sys:mint`, so it creates tokens, so `mintCapGuard` binds
 * it exactly as it binds a hand mint or a treasury funding. A village whose
 * lunation is already spent cannot pay a bonus until the next one, and the
 * refusal is the cap's own sentence.
 *
 * IT IS DELIBERATELY NOT IN `HAND_MINT_SOURCES`, and the reason is what that
 * list is for. `capRefusal` subtracts those sources to tell a founder how much
 * of the lunation was issued by a door no admin opened by hand. A bonus is
 * issued because the VILLAGE voted a circle's work complete, which is exactly
 * such a door: a founder refused a hand mint should be told their room went on
 * circle bonuses. Adding it to the list would hide that from the sentence
 * written to reveal it.
 *
 * ── THE ATTRIBUTION KEY IS ITS OWN, FOR THE REASON 0181 GIVES ──────────────
 *
 * `circle:<id>` is the CAP meter's key and rows carrying it that leave a
 * faucet count as issuance the circle made against its cap. A bonus is paid
 * AFTER the period it is about, so a bonus wearing that key would be spent
 * against the NEXT period's cap, and a circle would be punished next season
 * for having been rewarded for this one. `circle-treasury:<id>` is the
 * treasury funding's key and a bonus is a different decision by a different
 * body, so it takes `circle-bonus:<id>` and the three namespaces never meet.
 *
 * ONE CONSEQUENCE, NAMED RATHER THAN DISCOVERED LATER. `circleFundingSince` in
 * server/lib/circleTreasury.ts matches `circle-treasury:%`, so the clause it
 * builds under a cap refusal names treasury fundings and does not name
 * bonuses. That is a gap in a sentence and never in the arithmetic: the cap
 * itself counts every row out of the faucet, so a bonus spends the room it
 * used whether or not the refusal names it.
 */
import type { Pool } from "mysql2/promise";
import { vetoesFor } from "./stewardship";
import { MINT_FAUCET, postTransfer } from "./ledger";
import { mintCapGuard } from "./mintCap";
import {
  circleTreasuryAccount,
  ensureTreasuryAccount,
  treasuryAccountProblem,
  treasuryTokenFor,
  type TreasuryMoveResult,
  type TreasuryPermit,
} from "./circleTreasury";
import { completionRefProblem } from "./circleBonusGate";
import type { CircleStatus } from "../../shared/draftKinds";
import type { BonusAward, VetoVerdict } from "../../shared/circleBonus";

/** What a bonus posting writes as its source. One word, auditable. */
export const CIRCLE_BONUS_SOURCE = "circle_cap_bonus";

/** Where a bonus is attributed. See the header for why it is not the other two. */
export const BONUS_REF_PREFIX = "circle-bonus:";

/**
 * The attribution key. 13 characters plus a `circles.id` of at most 64 is 77,
 * and `token_ledger.source_ref` is varchar(120), measured on drizzle/0005.
 * MariaDB here runs STRICT_TRANS_TABLES, so an over-width value would be a
 * LOST ROW instead of a truncated one, which for a payment is money that
 * silently never moved.
 */
export function bonusRef(circleId: string): string {
  return `${BONUS_REF_PREFIX}${circleId}`;
}

/**
 * ONE BONUS PER COMMITMENT RECORD PER UNIT, AND THE UNIT IS WHY IT IS NOT JUST
 * THE RECORD.
 *
 * A commitment record covers one circle and one period, which is what makes it
 * the ballot's subject. A circle can hold budgets in two units in that same
 * period, and both can finish under their caps, so two bonuses are two real
 * payments and a key naming only the record would silently pay one of them.
 *
 * `token_ledger.idempotency_key` is varchar(191) (drizzle/0009), and the worst
 * case here is 13 + 64 + 1 + 37 = 115.
 */
export function bonusIdempotencyKey(recordId: string, unit: string): string {
  return `${BONUS_REF_PREFIX}${recordId}:${unit}`;
}

/**
 * WHETHER A STEWARD SET THIS DECISION ASIDE.
 *
 * Null ballot id answers `none` and never `unknown`: there is no vote, so
 * there is nothing that could have been vetoed, and the gate refuses on the
 * missing vote with its own sentence. Answering `unknown` there would replace
 * an accurate refusal with a vaguer one.
 *
 * Any error reading either representation answers `unknown`, which refuses the
 * payment. A veto this function could not read is not a veto it has shown to
 * be absent.
 */
export async function vetoVerdictFor(
  pool: Pool,
  ballotId: string | null,
  now: Date = new Date(),
): Promise<VetoVerdict> {
  if (!ballotId) return "none";
  try {
    const acts = await vetoesFor(pool, ballotId);
    if (acts.some((a) => a.act === "veto")) return "vetoed";
    const [rows] = await pool.query<any[]>( // module-review-ok: one column of the ballots row, read beside the gate because `BallotRow` in server/lib/ballots.ts does not carry `vetoed_at`; adding a reader to server/repos would be a second home for a ballot
      "SELECT vetoed_at, veto_closes_at FROM ballots WHERE id = ?",
      [ballotId],
    );
    if (rows.length === 0) return "unknown";
    if (rows[0]?.vetoed_at) return "vetoed";
    /*
     * NO VETO YET IS NOT NO VETO. Rye's ruling, 2026-09-08: a decision should
     * never pass until the veto window expires or every steward who can stop it
     * has said yes.
     *
     * `veto_closes_at` is computed from the ballot's FROZEN `closes_at`
     * (drizzle/0172), so this is the promise a steward was actually made and
     * not a window whoever pressed close chose the length of. While it is in
     * the future the absence of a veto says only that nobody has cast one, and
     * paying on that spends money a steward still has the right to stop.
     *
     * A row with no `veto_closes_at` has no window to wait for, which is a real
     * answer and not a missing one: an advisory vote or a decision that landed
     * at its close never had a stoppable moment.
     */
    const closesAt = rows[0]?.veto_closes_at;
    if (closesAt) {
      const at = closesAt instanceof Date ? closesAt : new Date(String(closesAt));
      if (!Number.isNaN(at.getTime()) && at.getTime() > now.getTime()) return "window_open";
    }
    return "none";
  } catch {
    return "unknown";
  }
}

export interface PayBonusInput {
  circleId: string;
  /** The circle's own name, for the account label. */
  circleName: string;
  circleStatus: CircleStatus;
  tokenSlug: string;
  /** The award computed by `bonusFor`. Never a figure this file derives. */
  award: BonusAward;
  /** The commitment record the completion vote pointed at. The idempotency key. */
  recordId: string;
  actorId: string | null;
  /** The village's own words for why. */
  note: string;
  permit: TreasuryPermit;
}

/**
 * PAY IT. THE VERDICT IS SOMEBODY ELSE'S AND THE AMOUNT IS `bonusFor`'S.
 *
 * This function refuses on six things and computes none of them: a circle id
 * too wide for the account column, a permission the seam denies, a dormant
 * circle, an amount at or below zero, a record id too wide for the key, and an
 * award measured in a different unit from the token being posted. Everything
 * else is the ledger's own arithmetic and the cap's own guard.
 *
 * A DORMANT CIRCLE IS REFUSED for the mechanical reason `fundTreasury`
 * records: going dormant EMPTIES the account, so a payment landing afterwards
 * would put tokens into an account the sweep has already passed over and they
 * would sit there until somebody noticed. A circle that finished its work and
 * then went dormant is a real case, and the answer is to make it active, take
 * the bonus, and let the sweep carry it wherever the village sends it.
 */
export async function payCircleBonus(pool: Pool, input: PayBonusInput): Promise<TreasuryMoveResult> {
  const problem = treasuryAccountProblem(input.circleId);
  if (problem) return { ok: false, error: problem };

  const refused = await input.permit("fund", input.circleId);
  if (refused) return { ok: false, error: refused };

  if (input.circleStatus === "dormant") {
    return {
      ok: false,
      error:
        "This circle is dormant and its account was emptied when it went dormant. Set the " +
        "circle active first, then pay the bonus: a bonus is a new mint, and a new mint meets " +
        "the village's issuance cap for this cycle",
    };
  }

  const units = Math.trunc(Number(input.award.amountMinor) || 0);
  if (units <= 0) return { ok: false, error: "A bonus is a positive number of minor units" };

  /*
   * THE KEY HAS TO FIT, AND A KEY THAT DOES NOT IS A PAYMENT THAT SILENTLY
   * NEVER HAPPENED.
   *
   * `completionRefProblem` already refuses a record id too wide for
   * `ballots.subject_ref`, so anything that reached a completion VOTE has
   * passed it. This function is exported and a caller can reach it without
   * one, and MariaDB here runs STRICT_TRANS_TABLES, so an over-width
   * `idempotency_key` is a LOST ROW instead of a truncated one. The same
   * reader is asked again rather than a second width being invented here.
   */
  const refProblem = completionRefProblem(input.recordId);
  if (refProblem) return { ok: false, error: refProblem };

  /*
   * AND THE AWARD HAS TO BE ABOUT THE TOKEN BEING POSTED. The key names the
   * award's unit and the posting names the caller's slug, so a mismatch would
   * key one token's payment under another token's name and let both be paid.
   */
  if (treasuryTokenFor(input.award.unit) !== input.tokenSlug) {
    return {
      ok: false,
      error:
        `This bonus was measured in ${input.award.unit} and is being paid in ` +
        `${input.tokenSlug}, which are two different units`,
    };
  }

  await ensureTreasuryAccount(pool, input.circleId, input.circleName);

  const r = await postTransfer(
    pool,
    {
      from: MINT_FAUCET,
      to: circleTreasuryAccount(input.circleId),
      tokenType: input.tokenSlug,
      amount: units,
      source: CIRCLE_BONUS_SOURCE,
      sourceRef: bonusRef(input.circleId),
      description: String(input.note ?? "").trim().slice(0, 500),
      idempotencyKey: bonusIdempotencyKey(input.recordId, input.award.unit),
    },
    mintCapGuard(input.tokenSlug, units),
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, duplicate: r.duplicate, balanceMinor: r.toBalance };
}
