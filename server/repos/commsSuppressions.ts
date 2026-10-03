/**
 * The readers and writers for `comms_suppressions` (drizzle/0228): the
 * addresses that receive nothing but essential mail.
 *
 * ONE ROW PER ADDRESS, keyed by `(village_id, email_key)`. An address that is
 * suppressed for a second reason keeps ONE row, and the row says the
 * strongest reason it has, because that is the one a person lifting it has to
 * be shown. The order, weakest first:
 *
 *   manual            an admin chose it.
 *   unsubscribed_all  the person asked to stop everything. Their own word
 *                     outranks an admin's.
 *   bounced           the address does not take mail.
 *   complained        the person marked an email as spam. Lifting it asks
 *                     for a reason (the comms build spec 5.3).
 *   erased            the person asked to be forgotten.
 *
 * THE WEAKER REASON NEVER OVERWRITES THE STRONGER ONE, and that is decided in
 * the statement itself, so two reports landing at the same moment cannot race
 * each other into the weaker answer.
 *
 * Raw SQL lives here and nowhere else (the comms build spec section 1,
 * rule 6). No cache sits above this table.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { SUPPRESSION_REASONS, type SuppressionReason } from "../../shared/comms/kinds";

const VILLAGE = "local";

/** Weakest first. A reason's rank is its position here, plus one. */
export const SUPPRESSION_STRENGTH: readonly SuppressionReason[] = ["manual", "unsubscribed_all", "bounced", "complained", "erased"];

// Every reason has a rank, so a reason added to the vocabulary without one is
// a failure at import rather than a reason that silently ranks below manual.
for (const r of SUPPRESSION_REASONS) {
  if (!SUPPRESSION_STRENGTH.includes(r)) throw new Error(`comms_suppressions: "${r}" has no strength`);
}

/** The FIELD() list the statements rank by, built from the one array above. */
const RANKED = SUPPRESSION_STRENGTH.map((r) => `'${r}'`).join(", ");

export interface SuppressionRow {
  emailKey: string;
  reason: string;
  detail: string | null;
  createdBy: string | null;
  /** Epoch seconds, read through UNIX_TIMESTAMP. */
  createdAt: number;
}

const toRow = (r: RowDataPacket): SuppressionRow => ({
  emailKey: String(r.email_key),
  reason: String(r.reason),
  detail: r.detail == null ? null : String(r.detail),
  createdBy: r.created_by == null ? null : String(r.created_by),
  createdAt: Number(r.created_at),
});

const COLUMNS = "email_key, reason, detail, created_by, UNIX_TIMESTAMP(created_at) AS created_at";

/** The suppression on one address, or null. */
export async function suppressionByKey(pool: Pool, emailKey: string): Promise<SuppressionRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the suppression list's one table, read by its key
    `SELECT ${COLUMNS} FROM comms_suppressions WHERE village_id = ? AND email_key = ? LIMIT 1`,
    [VILLAGE, emailKey],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * Suppress an address, or strengthen the reason it is already suppressed for.
 *
 * The assignments run left to right and each one sees the columns as the ones
 * before it left them, so the reason is written LAST: every other column is
 * decided against the reason the row held when the statement started.
 */
export async function upsertSuppression(
  pool: Pool,
  input: { emailKey: string; reason: SuppressionReason; detail: string | null; createdBy: string | null },
): Promise<void> {
  const stronger = `FIELD(VALUES(reason), ${RANKED}) > FIELD(reason, ${RANKED})`;
  await pool.query( // module-review-ok: the suppression list's one writer, one row, no cache above it
    "INSERT INTO comms_suppressions (village_id, email_key, reason, detail, created_by) VALUES (?, ?, ?, ?, ?) " +
      `ON DUPLICATE KEY UPDATE detail = IF(${stronger}, VALUES(detail), detail), ` +
      `created_by = IF(${stronger}, VALUES(created_by), created_by), ` +
      `created_at = IF(${stronger}, CURRENT_TIMESTAMP, created_at), ` +
      `reason = IF(${stronger}, VALUES(reason), reason)`,
    [
      VILLAGE,
      input.emailKey.slice(0, 191),
      input.reason,
      input.detail ? input.detail.slice(0, 500) : null,
      input.createdBy ? input.createdBy.slice(0, 64) : null,
    ],
  );
}

/** Lift the suppression on one address. True when there was one to lift. */
export async function deleteSuppression(pool: Pool, emailKey: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>( // module-review-ok: the suppression list, one row by its key
    "DELETE FROM comms_suppressions WHERE village_id = ? AND email_key = ?",
    [VILLAGE, emailKey],
  );
  return res.affectedRows > 0;
}

/**
 * A page of suppressions, newest first, with the total that matches. A search
 * is a part of an address; `%` and `_` in it are matched as themselves.
 */
export async function suppressionRows(
  pool: Pool,
  opts: { reason?: SuppressionReason | null; search?: string | null; limit: number; offset: number },
): Promise<{ rows: SuppressionRow[]; total: number }> {
  const where = ["village_id = ?"];
  const params: unknown[] = [VILLAGE];
  if (opts.reason) {
    where.push("reason = ?");
    params.push(opts.reason);
  }
  const search = String(opts.search ?? "").trim().toLowerCase();
  if (search) {
    // `!` and never a backslash as the escape, because what a backslash means
    // inside a string literal depends on the server's sql_mode.
    where.push("email_key LIKE ? ESCAPE '!'");
    params.push(`%${search.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  const clause = where.join(" AND ");
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: the suppression list, a filtered page for the admin
    `SELECT ${COLUMNS} FROM comms_suppressions WHERE ${clause} ORDER BY created_at DESC, email_key LIMIT ? OFFSET ?`,
    [...params, Math.max(1, Math.min(500, Math.trunc(opts.limit))), Math.max(0, Math.trunc(opts.offset))],
  );
  const [count] = await pool.query<RowDataPacket[]>( // module-review-ok: the suppression list, counted under the same filter
    `SELECT COUNT(*) AS n FROM comms_suppressions WHERE ${clause}`,
    params,
  );
  return { rows: rows.map(toRow), total: Number(count[0]?.n ?? 0) };
}
