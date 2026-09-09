/**
 * The readers and one writer for `member_vouches`.
 *
 * Under `server/repos` because that is where a table's readers live, so they
 * stay ENUMERABLE: findable by looking in one known directory rather than by
 * knowing which lib happened to own the subject.
 *
 * THERE IS NO DELETE AND NO UPDATE IN THIS FILE, and that is the point rather
 * than an omission. A vouch, once given, stands (Rye, 2026-09-08). Withdrawal
 * would drop somebody out of a membership they already hold and hand every
 * member a demotion button over a neighbour.
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
 * `ON DUPLICATE KEY UPDATE voucher_user_id = voucher_user_id` makes a repeated
 * press a no-op rather than an error, and the unique key is what makes "three
 * vouches" mean three people. The caller has already refused the cases that
 * deserve a sentence (`refuseVouch`); this refuses the race.
 */
export async function recordVouch(
  pool: Pool,
  input: { id: string; voucherUserId: string; vouchedUserId: string; kind: string; note?: string | null },
): Promise<void> {
  await pool.query( // module-review-ok: one table, one row, no cache above it
    "INSERT INTO member_vouches (id, village_id, voucher_user_id, vouched_user_id, kind, note) VALUES (?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE voucher_user_id = voucher_user_id",
    [input.id, VILLAGE, input.voucherUserId, input.vouchedUserId, input.kind, input.note ?? null],
  );
}
