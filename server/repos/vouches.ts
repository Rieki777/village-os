/**
 * The readers and one writer for `member_vouches`.
 *
 * Under `server/repos` because that is where a table's readers live, so they
 * stay ENUMERABLE: findable by looking in one known directory rather than by
 * knowing which lib happened to own the subject.
 *
 * NO MEMBER CAN WITHDRAW A VOUCH, AND THE ONE MEMBER-FACING UPDATE ONLY
 * RAISES. A vouch, once given, stands (Rye, 2026-09-08). Withdrawal would drop
 * somebody out of a membership they already hold and hand every member a
 * demotion button over a neighbour. The single write a member can make to an
 * existing row turns the same person's ordinary vouch into a super vouch,
 * which strengthens a vouch and can never weaken or remove one.
 *
 * THE ERASURE IS THE ONE EXCEPTION, at the end of this file, and it demotes
 * nobody. The vouches FOR a member who asked to be forgotten go, because they
 * are other people's sentences about that person and the membership they
 * admitted ended with the tombstone. A vouch a departed member GAVE somebody
 * already admitted stays, because it is the record of that admission, and
 * only the words they wrote on it go. A vouch they gave somebody STILL
 * WAITING goes whole: it records no admission yet, and kept, it would count
 * toward one in the name of somebody gone. Removing it demotes nobody, which
 * is the whole reason a vouch otherwise stands.
 *
 * A TOMBSTONE'S VOUCH ADMITS NOBODY, read here as well as swept there. The
 * two doors that admit on a count (the vouch route and the invitation door)
 * count `livingVouchesFor`, so a sweep that stopped between the tombstone and
 * the vouches step, or an erasure that finished before that step existed,
 * still lets nobody in on a departed member's word.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { Vouch } from "../lib/vouches";

const VILLAGE = "local";

const COLUMNS = "id, voucher_user_id, vouched_user_id, kind, note, created_at";

const toRow = (r: RowDataPacket): Vouch & { id: string; note: string | null } => ({
  id: String(r.id),
  voucherUserId: String(r.voucher_user_id),
  vouchedUserId: String(r.vouched_user_id),
  kind: String(r.kind),
  note: r.note == null ? null : String(r.note),
  createdAt: r.created_at,
});

/** Every vouch this member has received, oldest first. */
export async function vouchesFor(pool: Pool, userId: string): Promise<Array<Vouch & { id: string; note: string | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    `SELECT ${COLUMNS} FROM member_vouches WHERE village_id = ? AND vouched_user_id = ? ORDER BY created_at, id`,
    [VILLAGE, userId],
  );
  return rows.map(toRow);
}

/**
 * The vouches this member has received from somebody still here: every one
 * whose voucher is not a tombstone, oldest first. What the admission count
 * reads (see the header). A voucher with no member row at all still counts,
 * as it always has; only the tombstone address, the one mark a member who
 * asked to be forgotten carries, takes a vouch out of the count.
 */
export async function livingVouchesFor(pool: Pool, userId: string): Promise<Array<Vouch & { id: string; note: string | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: member_vouches read beside the voucher's users row, the tombstone test oauthAccounts.ts makes
    "SELECT v.id, v.voucher_user_id, v.vouched_user_id, v.kind, v.note, v.created_at FROM member_vouches v " +
      "LEFT JOIN users u ON u.id = v.voucher_user_id " +
      "WHERE v.village_id = ? AND v.vouched_user_id = ? AND (u.email IS NULL OR LOWER(u.email) NOT LIKE '%@anonymized.invalid') " +
      "ORDER BY v.created_at, v.id",
    [VILLAGE, userId],
  );
  return rows.map(toRow);
}

/** Every vouch this member has GIVEN, for the reputation mechanic to come. */
export async function vouchesBy(pool: Pool, userId: string): Promise<Array<Vouch & { id: string; note: string | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    `SELECT ${COLUMNS} FROM member_vouches WHERE village_id = ? AND voucher_user_id = ? ORDER BY created_at, id`,
    [VILLAGE, userId],
  );
  return rows.map(toRow);
}

/**
 * The same, for many members in one query.
 *
 * The members list would otherwise ask per person inside a loop, which is the
 * N+1 the quest-count and training readers both went out of their way to
 * avoid. An empty list answers without asking, because `IN ()` is a syntax
 * error and not an empty result.
 */
export async function vouchesForMany(
  pool: Pool,
  userIds: readonly string[],
): Promise<Map<string, Vouch[]>> {
  const out = new Map<string, Vouch[]>();
  if (userIds.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    `SELECT ${COLUMNS} FROM member_vouches WHERE village_id = ? AND vouched_user_id IN (${userIds.map(() => "?").join(",")}) ORDER BY created_at, id`,
    [VILLAGE, ...userIds],
  );
  for (const r of rows) {
    const v = toRow(r);
    const list = out.get(v.vouchedUserId);
    if (list) list.push(v);
    else out.set(v.vouchedUserId, [v]);
  }
  return out;
}

/**
 * Record one vouch. Idempotent on the person, never on the row.
 *
 * The unique key is what makes "three vouches" mean three people, so a second
 * vouch from the same person lands on the same row. On that row the ONE change
 * allowed is a raise: a super vouch over the same person's ordinary vouch makes
 * it super, and anything else leaves the row exactly as it was. The caller has
 * already refused the cases that deserve a sentence (`refuseVouch`); this
 * refuses the race, and whatever the race, it can only ever raise.
 *
 * The kind is passed a second time instead of read through `VALUES(kind)`,
 * which MySQL 8 deprecates and MariaDB spells differently. A bound parameter
 * reads the same on both.
 */
export async function recordVouch(
  pool: Pool,
  input: { id: string; voucherUserId: string; vouchedUserId: string; kind: string; note?: string | null },
): Promise<void> {
  await pool.query( // module-review-ok: one table, one row, no cache above it
    "INSERT INTO member_vouches (id, village_id, voucher_user_id, vouched_user_id, kind, note) VALUES (?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE kind = IF(? = 'super', 'super', kind)",
    [input.id, VILLAGE, input.voucherUserId, input.vouchedUserId, input.kind, input.note ?? null, input.kind],
  );
}

/**
 * A member who asked to be forgotten, for the erasure's
 * `vouches-after-tombstone` step (server/lib/erasure.ts). See the header for
 * why the three parts differ: the vouches written about them go whole, the
 * vouches they gave somebody still waiting go whole, and the vouches that
 * admitted somebody stay without their words.
 *
 * "Still waiting" is `membership_granted` off, the same reading the vouch
 * route refuses a vouch on ("They are already a member"), so a row this keeps
 * is one no vouch could still be added beside.
 *
 * Idempotent: two DELETEs keyed on the member and an UPDATE writing NULL, so a
 * second run matches nothing.
 */
export async function forgetVouchesOf(
  pool: Pool,
  userId: string,
): Promise<{ received: number; pendingGiven: number; wordsCleared: number }> {
  const [gone]: any = await pool.query(
    "DELETE FROM member_vouches WHERE village_id = ? AND vouched_user_id = ?",
    [VILLAGE, userId],
  );
  const [pending]: any = await pool.query( // module-review-ok: member_vouches joined to the subject's users row, to tell a waiting candidate from an admitted member
    "DELETE v FROM member_vouches v JOIN users u ON u.id = v.vouched_user_id " +
      "WHERE v.village_id = ? AND v.voucher_user_id = ? AND COALESCE(u.membership_granted, 0) = 0",
    [VILLAGE, userId],
  );
  const [cleared]: any = await pool.query(
    "UPDATE member_vouches SET note = NULL WHERE village_id = ? AND voucher_user_id = ? AND note IS NOT NULL",
    [VILLAGE, userId],
  );
  return {
    received: Number(gone?.affectedRows ?? 0),
    pendingGiven: Number(pending?.affectedRows ?? 0),
    wordsCleared: Number(cleared?.affectedRows ?? 0),
  };
}
