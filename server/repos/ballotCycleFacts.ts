/**
 * `ballots`, asked what happened inside ONE WINDOW OF TIME.
 *
 * ── WHAT THIS FILE IS AND, MORE IMPORTANTLY, WHAT IT IS NOT ────────────────
 *
 * It is not the `ballots` table's home. That table is the governance loop's
 * spine and the great majority of its traffic — opening, voting, closing,
 * settling, the landing election that `0172` describes as an UPDATE competing
 * for a row — lives in `server/lib/ballots.ts` and `server/lib/applyDue.ts`,
 * where the rules those statements enforce are written down beside them. None
 * of that moved here and it should not move here piecemeal.
 *
 * What is here is one COHERENT QUESTION that was being asked from a lib file
 * with no home of its own: given the instant a cycle began and the instant it
 * ended, what did this table record in between? Five statements, all read-only,
 * all half-open on the same bounds, all scoped by a different date column. They
 * belong together because the thing that can go wrong with them is a thing that
 * only shows up when they are read TOGETHER.
 *
 * ── THE FIVE DATE COLUMNS ARE FIVE DIFFERENT QUESTIONS ─────────────────────
 *
 * This is the whole reason the file earns its existence. `ballots` carries at
 * least four instants that a digest could plausibly window on, and they mean
 * different things:
 *
 *   `opens_at`   when the village was ASKED
 *   `closes_at`  when the asking finished
 *   `lands_at`   when the answer was due to take effect
 *   `vetoed_at`  when a steward stopped it
 *
 * A decision opened in one moon, closed in the next and landed in a third is
 * ordinary, not exotic — 19F's bundles wait for a boundary by design. So each
 * function below names the column it windows on in its own name and in its own
 * doc comment, because "what happened this moon" is four different answers and
 * a caller that picked the wrong one would get a plausible number every time.
 *
 * ── HALF-OPEN BOUNDS, EVERY TIME ───────────────────────────────────────────
 *
 * `>= from` and `< to`, in all five. The next cycle's window begins at exactly
 * `to`, so an inclusive upper bound would report a ballot that closed on the
 * boundary in two consecutive digests. Written the same way five times rather
 * than through a shared fragment: a helper that built the WHERE clause would
 * make the one property worth checking harder to check, not easier.
 *
 * The bounds arrive as strings the caller has already formatted for the
 * connection. This module holds no opinion about how a `Date` becomes a MySQL
 * datetime; `server/lib/moonDigest.ts` holds exactly one, and that is why the
 * five windows here can never disagree with each other.
 *
 * ── NO CACHE ───────────────────────────────────────────────────────────────
 *
 * Nothing sits above these reads. They run once per cycle boundary, inside the
 * landing job, against rows that are settled by the time they are asked about.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** The subject types that MOVE TOKENS, which is what "paid" means in a digest. */
const PAYING_SUBJECTS = "('token_send','quest_payout','founding_allocation')";

/** The three closed states. `withdrawn` is not one: nobody answered it. */
const CLOSED_STATUSES = "('passed','failed','no_quorum')";

/** One stopped decision, with the steward's words if any were recorded. */
export interface VetoedBallot {
  title: string;
  reason: string | null;
}

/** How many decisions were held back, by the reason they were held. */
export interface HeldCounts {
  stalled: number;
  expired: number;
}

/**
 * The titles of decisions that PAID, windowed on `closes_at`.
 *
 * Three conditions, and each is load-bearing. `landing_status = 'applied'`
 * because a passed payment that has not landed has paid nobody yet.
 * `status = 'passed'` because `landing_status` alone would let a row through
 * whose vote failed. And the subject list, because a digest's "what was paid"
 * section is about tokens leaving the commons, not about every decision that
 * happened to land.
 *
 * Ordered by `closes_at` then `id`, so two payments closed in the same second
 * come back in a stable order — `closes_at` is a `datetime` with second
 * resolution and a digest read twice must read the same both times.
 */
export async function paidTitlesClosedBetween(pool: Pool, from: string, to: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT title FROM ballots WHERE landing_status = 'applied' AND status = 'passed' " +
      `AND subject_type IN ${PAYING_SUBJECTS} ` +
      "AND closes_at >= ? AND closes_at < ? ORDER BY closes_at ASC, id ASC",
    [from, to],
  );
  return rows.map((r) => String(r.title));
}

/**
 * The decisions a steward STOPPED, windowed on `vetoed_at`.
 *
 * Windowed on the veto and not on the ballot's own dates on purpose: a veto
 * lands in the moon the steward acted, which is often not the moon the vote
 * closed in, and a village reading "what was stopped this moon" means the act.
 *
 * `veto_reason` comes back as null when it was never recorded, and the caller
 * says so in words rather than hiding the row. A veto with no reason is itself
 * worth a village noticing.
 */
export async function vetoedBetween(pool: Pool, from: string, to: string): Promise<VetoedBallot[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT title, veto_reason FROM ballots WHERE vetoed_at >= ? AND vetoed_at < ? ORDER BY vetoed_at ASC, id ASC",
    [from, to],
  );
  return rows.map((r) => ({
    title: String(r.title),
    reason: r.veto_reason === null || r.veto_reason === undefined ? null : String(r.veto_reason),
  }));
}

/**
 * How many ballots OPENED in the window, windowed on `opens_at`.
 *
 * Every status counts, withdrawn included. The question is how often the
 * village was asked something, and a proposal withdrawn after two days was
 * still asked.
 */
export async function openedCountBetween(pool: Pool, from: string, to: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE opens_at >= ? AND opens_at < ?",
    [from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * How many ballots CLOSED in the window, windowed on `closes_at`.
 *
 * `withdrawn` is deliberately outside the list: a withdrawal is the proposer
 * taking the question away, not the village answering it, and counting it here
 * would let a digest report more answers than were given.
 */
export async function closedCountBetween(pool: Pool, from: string, to: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ballots WHERE status IN ${CLOSED_STATUSES} AND closes_at >= ? AND closes_at < ?`,
    [from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The decisions that came due and did NOT land, windowed on `lands_at`.
 *
 * Two states, counted in one round trip because they are two halves of one
 * sentence a village reads together: `stalled` is a decision that came due
 * while landing was switched off, `expired` is one that waited too long and was
 * closed (both from 0177). Grouped in the database rather than fetched and
 * counted here, which is what the raw statement did.
 *
 * A state the GROUP BY returns that this shape has no field for is dropped, and
 * a state it does not return reads as zero. That is the same direction the raw
 * code took, and it is the right one for a digest: a landing state added later
 * makes a sentence go quiet, never wrong.
 */
export async function heldCountsDueBetween(pool: Pool, from: string, to: string): Promise<HeldCounts> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT landing_status AS s, COUNT(*) AS n FROM ballots WHERE landing_status IN ('stalled','expired') " +
      "AND lands_at >= ? AND lands_at < ? GROUP BY landing_status",
    [from, to],
  );
  const countOf = (name: string): number => Number(rows.find((r) => String(r.s) === name)?.n ?? 0);
  return { stalled: countOf("stalled"), expired: countOf("expired") };
}
