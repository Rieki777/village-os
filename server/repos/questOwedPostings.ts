/**
 * What a consent owes, recorded in the consent's own commit and paid after it
 * (`quest_owed_postings`, drizzle/0210).
 *
 * THE SHAPE OF THE REPAIR. The consent route prices what a claim is owed with
 * `owedForClaim` on the consent's own connection and records the rows with
 * `recordOwed` before that transaction commits, so the obligation exists
 * exactly when the consent does. After the commit, and whenever a steward asks
 * again, `settleOwedPosting` pays one row in its own transaction: it locks the
 * row, posts it through `postOwedOn`, and marks it posted in the same commit.
 *
 * WHY NOTHING PAYS TWICE, three ways, any one of which would be enough:
 *  - the primary key is the ledger's occurrence key, so recording the same
 *    consent twice inserts nothing new;
 *  - a posting and the row that says it happened commit together, so a row
 *    never reads owed after its posting landed, and never reads posted before;
 *  - the ledger's unique key answers a replay as `duplicate` and moves nothing,
 *    which also covers a posting that landed on the old direct path.
 *
 * WHAT A REFUSAL DOES. `postOwedOn` leaves a refusal for its caller to roll back.
 * `not_launched` (and `issuance_cap`, which nothing produces yet) leave the row
 * owed, because the condition can change. `key_clash` and `rule` mark it
 * refused, because no retry can succeed. The reason and the ledger's own
 * sentence are kept either way. A thrown error, a lost connection or a
 * deadlock past three attempts writes nothing, and the row stays owed.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { postOwedOn, type OwedPosting, type OwedRefusalReason } from "../lib/economy";
import { withDeadlockRetry } from "./quests";

export type OwedState = "owed" | "posted" | "refused";

export interface OwedPostingRow extends OwedPosting {
  claimId: string;
  state: OwedState;
  refusalReason: OwedRefusalReason | null;
  lastError: string | null;
  attempts: number;
  /** Seconds since the epoch, read through UNIX_TIMESTAMP so the database host's zone cannot shift it. */
  createdAt: number;
  settledAt: number | null;
}

/** What one attempt to pay one row did. */
export type SettleOutcome =
  | { key: string; outcome: "posted"; row: OwedPostingRow }
  /** The ledger already held this posting, so nothing moved, and the row now reads posted. */
  | { key: string; outcome: "duplicate"; row: OwedPostingRow }
  /** Refused for a reason that can change. The row is still owed. */
  | { key: string; outcome: "still_owed"; reason: OwedRefusalReason; message: string; row: OwedPostingRow }
  /** Refused for a reason no retry can change. The row is refused. */
  | { key: string; outcome: "refused"; reason: OwedRefusalReason; message: string; row: OwedPostingRow }
  /** Nothing to pay: no such row, or it was already posted or refused when the lock was taken. */
  | { key: string; outcome: "not_owed" };

/** What the locked transaction found and did, before a refusal is written down. */
type Attempt =
  | { kind: "not_owed" }
  | { kind: "posted"; row: OwedPostingRow }
  | { kind: "duplicate"; row: OwedPostingRow }
  | { kind: "refused"; reason: OwedRefusalReason; message: string; row: OwedPostingRow };

const FINAL_REFUSALS: ReadonlySet<OwedRefusalReason> = new Set<OwedRefusalReason>(["key_clash", "rule"]);

const COLUMNS =
  "`idempotency_key`, `claim_id`, `to_user_id`, `token_slug`, `units`, `decimals`, `from_account`, " +
  "`source`, `source_ref`, `description`, `state`, `refusal_reason`, `last_error`, `attempts`, " +
  "UNIX_TIMESTAMP(`created_at`) AS `created_s`, UNIX_TIMESTAMP(`settled_at`) AS `settled_s`";

/** The widths drizzle/0210 stores these in. */
const clip = (s: string, width: number): string => (s.length > width ? s.slice(0, width) : s);

function toRow(r: RowDataPacket): OwedPostingRow {
  return {
    // Handed on exactly as stored. This key was written by the pricing and is only
    // read back here, and scripts/generate-economics-doc.mjs, which reads every
    // `idempotencyKey` under server/ as a key being written, counts a value taken
    // straight from a parameter as forwarded.
    idempotencyKey: r.idempotency_key,
    claimId: String(r.claim_id),
    toUserId: String(r.to_user_id),
    tokenSlug: String(r.token_slug),
    units: Number(r.units),
    decimals: Number(r.decimals),
    from: String(r.from_account),
    source: String(r.source),
    sourceRef: String(r.source_ref),
    description: String(r.description),
    state: String(r.state) as OwedState,
    refusalReason: r.refusal_reason == null ? null : (String(r.refusal_reason) as OwedRefusalReason),
    lastError: r.last_error == null ? null : String(r.last_error),
    attempts: Number(r.attempts),
    createdAt: Number(r.created_s),
    settledAt: r.settled_s == null ? null : Number(r.settled_s),
  };
}

/**
 * Record what a consent owes, on the consent's own connection and inside its
 * transaction. A row already recorded under the same key is left exactly as
 * it is, whatever state it has reached.
 */
export async function recordOwed(conn: PoolConnection, claimId: string, owed: OwedPosting[]): Promise<void> {
  for (const o of owed) {
    await conn.query(
      "INSERT INTO `quest_owed_postings` (`idempotency_key`, `claim_id`, `to_user_id`, `token_slug`, `units`, " +
        "`decimals`, `from_account`, `source`, `source_ref`, `description`) VALUES (?,?,?,?,?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE `idempotency_key` = `idempotency_key`",
      [
        o.idempotencyKey,
        claimId,
        o.toUserId,
        o.tokenSlug,
        o.units,
        o.decimals,
        o.from,
        o.source,
        clip(o.sourceRef, 120),
        clip(o.description, 500),
      ],
    );
  }
}

/** Pay one owed row, in its own transaction. The header says why this cannot pay twice. */
export async function settleOwedPosting(pool: Pool, key: string): Promise<SettleOutcome> {
  const attempt = await withDeadlockRetry<Attempt>(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ${COLUMNS} FROM \`quest_owed_postings\` WHERE \`idempotency_key\` = ? FOR UPDATE`,
        [key],
      );
      const found = rows[0] ? toRow(rows[0]) : null;
      if (!found || found.state !== "owed") {
        await conn.rollback();
        return { kind: "not_owed" };
      }
      const res = await postOwedOn(conn, found);
      if (res.outcome === "refused") {
        // A refusal is the caller's to roll back, and whatever the post began goes with it.
        await conn.rollback();
        return { kind: "refused", reason: res.reason, message: res.message, row: found };
      }
      await conn.query(
        "UPDATE `quest_owed_postings` SET `state` = 'posted', `refusal_reason` = NULL, `last_error` = NULL, " +
          "`attempts` = `attempts` + 1, `settled_at` = CURRENT_TIMESTAMP WHERE `idempotency_key` = ?",
        [key],
      );
      await conn.commit();
      const row: OwedPostingRow = { ...found, state: "posted", refusalReason: null, lastError: null, attempts: found.attempts + 1 };
      return res.outcome === "posted" ? { kind: "posted", row } : { kind: "duplicate", row };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  });

  if (attempt.kind === "not_owed") return { key, outcome: "not_owed" };
  if (attempt.kind === "posted") return { key, outcome: "posted", row: attempt.row };
  if (attempt.kind === "duplicate") return { key, outcome: "duplicate", row: attempt.row };

  // The refusal is written after the rollback, and only over a row that is
  // still owed, so a posting another attempt landed meanwhile is never undone.
  const final = FINAL_REFUSALS.has(attempt.reason);
  const lastError = clip(attempt.message, 500);
  await pool.query(
    "UPDATE `quest_owed_postings` SET `state` = ?, `refusal_reason` = ?, `last_error` = ?, " +
      "`attempts` = `attempts` + 1, `settled_at` = " +
      (final ? "CURRENT_TIMESTAMP" : "NULL") +
      " WHERE `idempotency_key` = ? AND `state` = 'owed'",
    [final ? "refused" : "owed", attempt.reason, lastError, key],
  );
  const row: OwedPostingRow = {
    ...attempt.row,
    state: final ? "refused" : "owed",
    refusalReason: attempt.reason,
    lastError,
    attempts: attempt.row.attempts + 1,
  };
  return final
    ? { key, outcome: "refused", reason: attempt.reason, message: attempt.message, row }
    : { key, outcome: "still_owed", reason: attempt.reason, message: attempt.message, row };
}

/** Pay every row one claim still owes, one transaction each, in key order. */
export async function settleOwedForClaim(pool: Pool, claimId: string): Promise<SettleOutcome[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `idempotency_key` FROM `quest_owed_postings` WHERE `claim_id` = ? AND `state` = 'owed' ORDER BY `idempotency_key`",
    [claimId],
  );
  const out: SettleOutcome[] = [];
  for (const r of rows) out.push(await settleOwedPosting(pool, String(r.idempotency_key)));
  return out;
}

/** Every row a claim owes or owed, in key order. */
export async function owedPostingsFor(pool: Pool, claimId: string): Promise<OwedPostingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`quest_owed_postings\` WHERE \`claim_id\` = ? ORDER BY \`idempotency_key\``,
    [claimId],
  );
  return rows.map(toRow);
}

/** Every row not yet posted, oldest first, which is what a steward's repair list shows. */
export async function unsettledOwedPostings(pool: Pool, limit = 200): Promise<OwedPostingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`quest_owed_postings\` WHERE \`state\` <> 'posted' ORDER BY \`created_at\`, \`idempotency_key\` LIMIT ?`,
    [Math.max(1, Math.min(1000, Math.floor(limit)))],
  );
  return rows.map(toRow);
}
