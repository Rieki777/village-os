/**
 * `saberra_outbox` (0261): every statement that touches what would cross to
 * the organisational memory service.
 *
 * ── ONE READER OF ANOTHER TABLE, NAMED SO IT STAYS FINDABLE ──────────────
 *
 * `upsertJournalItemIfShared` reads `journal_entries` inside its INSERT, as
 * the gate on the write: the row lands only while the entry exists, belongs
 * to the member named, and is not private, all decided in the same statement
 * as the write. Two statements would leave a gap in which an entry turned
 * private after its check and before its insert, and a private entry's words
 * would sit in this table as "would cross". The read carries `user_id = ?`,
 * as every read of that table does (server/repos/journal.ts).
 *
 * ── THE ADMIN LISTING NEVER NAMES THE PAYLOAD ────────────────────────────
 *
 * `listingRows` selects the kind, the period, the code-name, the length and
 * the status, and not `payload`. That is the structural half of "an admin
 * cannot read a member's journal through this": the words never leave the
 * database on that road, so no mapper downstream can forget to strip them.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ───────────────────────────────────────
 *
 * Every read goes to the database when asked.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Queryable = Pool | PoolConnection;

/** One journal entry as it would cross, ready to write. */
export interface JournalItemRow {
  id: string;
  sourceRef: string;
  codeName: string;
  period: string;
  payload: string;
  textChars: number;
  /** The entry's `updated_at`, in milliseconds. */
  sourceVersion: number;
}

/**
 * Queue (or refresh) one journal entry, gated on the entry itself.
 *
 * THE GATE. `INSERT ... SELECT ... FROM journal_entries WHERE id AND user_id
 * AND privacy <> 'private'`: a private or deleted entry selects no row, so
 * nothing is written, whatever the caller believed a moment ago.
 *
 * THE REFRESH. The unique key on `source_ref` turns a second write for the
 * same entry into an update of its one row, so no entry is ever queued twice.
 * It replaces the payload only when this version is newer than the stored
 * one, or the same version on a row that has not been sent: a slower write of
 * an older version never replaces a newer one, and the same version already
 * sent is not queued again. `status` and `source_version` are assigned last,
 * because MySQL reads a column assigned earlier in the clause at its new
 * value.
 */
export async function upsertJournalItemIfShared(
  db: Queryable,
  item: JournalItemRow,
  entryId: string,
  userId: string,
): Promise<number> {
  const v = item.sourceVersion;
  const fresh = "(? > `source_version` OR (? = `source_version` AND `status` <> 'sent'))";
  const set = (col: string, value: unknown, params: unknown[]) => {
    params.push(v, v, value);
    return `\`${col}\` = IF(${fresh}, ?, \`${col}\`)`;
  };
  const params: unknown[] = [
    item.id,
    item.sourceRef,
    item.codeName,
    item.period,
    item.payload,
    item.textChars,
    v,
    entryId,
    userId,
  ];
  const updates = [
    set("payload", item.payload, params),
    set("text_chars", item.textChars, params),
    set("code_name", item.codeName, params),
    set("period", item.period, params),
    set("last_error", null, params),
    set("attempts", 0, params),
    set("status", "queued", params),
  ];
  params.push(v);
  const [r]: any = await db.query(
    "INSERT INTO `saberra_outbox` " +
      "(`id`, `kind`, `source_ref`, `code_name`, `period`, `payload`, `text_chars`, `source_version`, `status`, `attempts`) " +
      "SELECT ?, 'journal_entry', ?, ?, ?, ?, ?, ?, 'queued', 0 FROM `journal_entries` " +
      "WHERE `id` = ? AND `user_id` = ? AND `privacy` <> 'private' " +
      `ON DUPLICATE KEY UPDATE ${updates.join(", ")}, \`source_version\` = GREATEST(\`source_version\`, ?)`,
    params,
  );
  return Number(r?.affectedRows ?? 0);
}

/** A team signal, once per week: a second write for the same week is a no-op. */
export async function insertTeamSignalIfAbsent(
  db: Queryable,
  item: { id: string; sourceRef: string; period: string; payload: string },
): Promise<number> {
  const [r]: any = await db.query(
    "INSERT IGNORE INTO `saberra_outbox` (`id`, `kind`, `source_ref`, `code_name`, `period`, `payload`, `status`) " +
      "VALUES (?, 'team_signal', ?, NULL, ?, ?, 'queued')",
    [item.id, item.sourceRef, item.period, item.payload],
  );
  return Number(r?.affectedRows ?? 0);
}

/**
 * Withdraw one item: the payload is cleared and it is held. A row already
 * sent keeps saying `sent`, because it did cross; its copy here is cleared
 * all the same.
 */
export async function holdBySourceRef(db: Queryable, sourceRef: string): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE `saberra_outbox` SET `payload` = NULL, `text_chars` = 0, " +
      "`status` = IF(`status` = 'sent', 'sent', 'held') WHERE `source_ref` = ?",
    [sourceRef],
  );
  return Number(r?.affectedRows ?? 0);
}

/** The same, by row id, for the drain's last look before a send. */
export async function holdById(db: Queryable, id: string): Promise<void> {
  await db.query(
    "UPDATE `saberra_outbox` SET `payload` = NULL, `text_chars` = 0, " +
      "`status` = IF(`status` = 'sent', 'sent', 'held') WHERE `id` = ?",
    [id],
  );
}

/**
 * The erasure's scrub: every row filed under these code-names loses its
 * payload. Constant writes keyed on the code-names, so a resume that runs it
 * again matches the same rows and writes the same values.
 */
export async function scrubCodeNames(db: Queryable, codeNames: readonly string[]): Promise<number> {
  if (codeNames.length === 0) return 0;
  const [r]: any = await db.query(
    "UPDATE `saberra_outbox` SET `payload` = NULL, `text_chars` = 0, " +
      "`status` = IF(`status` = 'sent', 'sent', 'held') " +
      `WHERE \`code_name\` IN (${codeNames.map(() => "?").join(",")})`,
    codeNames as string[],
  );
  return Number(r?.affectedRows ?? 0);
}

/** Which of these source refs already have a row, whatever its status. */
export async function existingSourceRefs(db: Queryable, refs: readonly string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT \`source_ref\` FROM \`saberra_outbox\` WHERE \`source_ref\` IN (${refs.map(() => "?").join(",")})`,
    refs as string[],
  );
  return new Set(rows.map((r) => String(r.source_ref)));
}

/** How many rows of each kind sit in each status. */
export async function statusCounts(db: Queryable): Promise<Array<{ kind: string; status: string; n: number }>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `kind`, `status`, COUNT(*) AS n FROM `saberra_outbox` GROUP BY `kind`, `status`",
  );
  return rows.map((r) => ({ kind: String(r.kind), status: String(r.status), n: Number(r.n) }));
}

/**
 * The admin listing, newest first. NEVER NAMES `payload`: see the header.
 * `limit` is clamped here, with the statement it bounds.
 */
export async function listingRows(db: Queryable, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `kind`, `code_name`, `period`, `text_chars`, `status`, `attempts`, `created_at` " +
      "FROM `saberra_outbox` ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
    [Math.max(1, Math.min(200, Math.trunc(limit) || 1))],
  );
  return rows;
}

/** What a send would take next: queued or failed, with a payload, oldest first. */
export async function dueRows(db: Queryable, limit: number): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `kind`, `source_ref`, `code_name`, `payload`, `attempts`, `source_version` FROM `saberra_outbox` " +
      "WHERE `status` IN ('queued', 'failed') AND `payload` IS NOT NULL ORDER BY `created_at`, `id` LIMIT ?",
    [Math.max(1, Math.min(500, Math.trunc(limit) || 1))],
  );
  return rows;
}

/**
 * Landed. Only while the row still carries the version that was sent: an edit
 * that refreshed it during the send leaves it queued, so the newer words go
 * next time.
 */
export async function markSentRow(db: Queryable, id: string, sourceVersion: number): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE `saberra_outbox` SET `status` = 'sent', `sent_at` = NOW(), `attempts` = `attempts` + 1, `last_error` = NULL " +
      "WHERE `id` = ? AND `source_version` = ? AND `status` IN ('queued', 'failed')",
    [id, sourceVersion],
  );
  return Number(r?.affectedRows ?? 0);
}

/** Did not land. Kept for the next try, with the reason clipped to the column. */
export async function markFailedRow(db: Queryable, id: string, error: string): Promise<void> {
  await db.query(
    "UPDATE `saberra_outbox` SET `status` = 'failed', `attempts` = `attempts` + 1, `last_error` = ? " +
      "WHERE `id` = ? AND `status` IN ('queued', 'failed')",
    [String(error ?? "").slice(0, 300), id],
  );
}

/** One row, whole, by its source. The drain's and the tests' read. */
export async function rowBySourceRef(db: Queryable, sourceRef: string): Promise<RowDataPacket | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `kind`, `source_ref`, `code_name`, `period`, `payload`, `text_chars`, `source_version`, " +
      "`status`, `attempts`, `last_error`, `sent_at` FROM `saberra_outbox` WHERE `source_ref` = ? LIMIT 1",
    [sourceRef],
  );
  return rows[0] ?? null;
}

/** Every payload still held, for a test that scans what would cross. */
export async function allPayloads(db: Queryable): Promise<Array<{ sourceRef: string; payload: string }>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `source_ref`, `payload` FROM `saberra_outbox` WHERE `payload` IS NOT NULL ORDER BY `created_at`, `id`",
  );
  return rows.map((r) => ({ sourceRef: String(r.source_ref), payload: String(r.payload) }));
}
