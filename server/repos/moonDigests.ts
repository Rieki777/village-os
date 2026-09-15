/**
 * `governance_moon_digests`: one row per cycle, and the row IS the claim.
 *
 * ── WHY THE INSERT IS THE INTERESTING STATEMENT ────────────────────────────
 *
 * The table is keyed on the cycle id (0177), and `server/lib/moonDigest.ts`
 * builds its whole idempotence on that: whoever's INSERT succeeds composes the
 * digest and posts the feed item, and every other caller for that cycle reads
 * the duplicate-key error and posts nothing. Two ticks at one boundary, two
 * servers, a human closing the cycle in the same second — one digest, one feed
 * item.
 *
 * That makes `ER_DUP_ENTRY` a RESULT and not a failure, and it is why
 * `claimDigest` returns a boolean rather than letting the error out. A caller
 * that has to catch a driver error code to learn whether it won a race is a
 * caller that will one day be written without the catch, and the second digest
 * that follows is invisible: it looks exactly like the first one.
 *
 * Every other error still throws. `e.code !== "ER_DUP_ENTRY"` is the whole
 * test, so a table that is missing, a body too long for `mediumtext`, a
 * connection that dropped — all of those reach the caller as themselves.
 *
 * ── WHY THE ROW IS WRITTEN BEFORE THE TEXT IS POSTED ───────────────────────
 *
 * The caller's own header states the ordering and the reason: the row is the
 * claim and the feed item comes after, so a throw between the two leaves a row
 * saying the digest exists and no feed item. That is the safe direction — a
 * missing feed item is visible on the page, a duplicate one is not — and
 * `posted_at` staying NULL is what a human greps for to find it. This module
 * keeps the two statements that make that possible separate (`claimDigest`,
 * then `markDigestPosted`) rather than folding them into one call that would
 * quietly make them a single act.
 *
 * ── NO CACHE, AND ONE READER ───────────────────────────────────────────────
 *
 * `digestRow` is the page's read and there is nothing in front of it. A digest
 * is written once and never edited, so a cache would buy a round trip per moon
 * and cost the ability to see, immediately, that this cycle's digest exists.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** What the page renders. `ended_at` and `posted_at` have no reader today. */
const DIGEST_COLUMNS = "cycle_id, body, composed_at";

/** One composed digest, as the page reads it. */
export interface MoonDigestRow {
  cycleId: string;
  body: string;
  /** ISO, normalised here so the caller never sees a driver-dependent type. */
  composedAt: string;
}

/**
 * Claim the digest for one cycle, and say whether this call won.
 *
 * True means the row was inserted by THIS call and the caller owes the feed
 * item. False means a digest for that cycle already exists and this call must
 * post nothing at all.
 *
 * The instants arrive as strings the caller formatted for the connection, the
 * same way `sentencesAppliedBetween` takes its bounds. One opinion about how a
 * `Date` becomes a MySQL datetime, held in the file that composes the digest.
 */
export async function claimDigest(
  pool: Pool,
  input: { cycleId: string; endedAt: string; composedAt: string; body: string },
): Promise<boolean> {
  try {
    const [res] = await pool.query<ResultSetHeader>(
      "INSERT INTO governance_moon_digests (cycle_id, ended_at, composed_at, body) VALUES (?,?,?,?)",
      [input.cycleId, input.endedAt, input.composedAt, input.body],
    );
    return Number(res.affectedRows) === 1;
  } catch (e: unknown) {
    // The one error code that is an ANSWER: somebody else composed this cycle's
    // digest first. Everything else is a fault and travels on untouched.
    if ((e as { code?: string } | null)?.code !== "ER_DUP_ENTRY") throw e;
    return false;
  }
}

/**
 * Stamp the digest as posted, after the feed item exists.
 *
 * Unconditional, and it does not report whether a row moved. A digest is
 * written once by the caller that just won the claim above, so "no row matched"
 * is not a state this statement can reach without the claim having lied, and a
 * boolean here would invite a caller to branch on something that never varies.
 */
export async function markDigestPosted(pool: Pool, cycleId: string, postedAt: string): Promise<void> {
  await pool.query("UPDATE governance_moon_digests SET posted_at = ? WHERE cycle_id = ?", [
    postedAt,
    cycleId,
  ]);
}

/**
 * One composed digest, or null when that cycle has none.
 *
 * Null is the honest answer for both "the cycle has not ended" and "the digest
 * never ran", and this module cannot tell those apart — nor should it try. The
 * caller's header is emphatic that "no digest composed" is not "the digest was
 * empty", and it is the caller that holds the words for saying which.
 *
 * `composed_at` is normalised through `Date` so the page always gets an ISO
 * instant, whether the driver handed back a `Date` or a string.
 */
export async function digestRow(pool: Pool, cycleId: string): Promise<MoonDigestRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${DIGEST_COLUMNS} FROM governance_moon_digests WHERE cycle_id = ?`,
    [cycleId],
  );
  const r = rows[0];
  if (!r) return null;
  const at = r.composed_at instanceof Date ? r.composed_at : new Date(String(r.composed_at));
  return { cycleId: String(r.cycle_id), body: String(r.body), composedAt: at.toISOString() };
}
