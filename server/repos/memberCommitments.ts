/**
 * WHAT A MEMBER SAYS THEY CAN GIVE, as a dated history (0383, lane E1).
 *
 * APPEND ONLY. A member changes their word by saying a new one, which is a
 * new row; no statement here updates a row. The history is what keeps the
 * difference between "gave 80 this season" and "gives 40 now", and the lead
 * asked for exactly that: people move this from season to season, moon to
 * moon, week to week. `commitmentBoundary.test.ts` holds the file to it.
 *
 * Private to the member. Nothing that pays reads it (shared/commitment.ts).
 * It goes when the member is erased (`forgetCommitments`, server/lib/erasure.ts).
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Queryable } from "./memberTasks";
import { commitmentOn, readCommitmentPeriod, storedCommitmentPct, type CommitmentInput, type MemberCommitment } from "../../shared/commitment";

/** The most a history read returns; a member who changes weekly fills it in about four years. */
export const HISTORY_LIMIT = 200;

function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

function rowToCommitment(r: RowDataPacket): MemberCommitment | null {
  const pct = storedCommitmentPct(r.pct);
  const period = readCommitmentPeriod(r.period_kind);
  if (pct === null || !period.ok) return null;
  return {
    id: Number(r.id),
    pct,
    fromDate: ymd(r.from_date),
    period: period.value,
    note: r.note == null || String(r.note).trim() === "" ? null : String(r.note),
    saidAt: r.created_at == null ? null : r.created_at instanceof Date ? r.created_at.toISOString() : new Date(String(r.created_at)).toISOString(),
  };
}

/** Say a new commitment. Always an INSERT: the earlier word stays in the history. */
export async function recordCommitment(db: Queryable, userId: string, c: CommitmentInput): Promise<number> {
  const [r] = await db.query<ResultSetHeader>(
    "INSERT INTO `member_commitments` (`user_id`, `pct`, `from_date`, `period_kind`, `note`) VALUES (?, ?, ?, ?, ?)",
    [userId, c.pct, c.fromDate, c.period, c.note],
  );
  return Number(r.insertId);
}

/** The member's history, newest first (later from-date, then later word). */
export async function commitmentHistory(db: Queryable, userId: string): Promise<MemberCommitment[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `pct`, `from_date`, `period_kind`, `note`, `created_at` FROM `member_commitments` WHERE `user_id` = ? ORDER BY `from_date` DESC, `id` DESC LIMIT ?",
    [userId, HISTORY_LIMIT],
  );
  return rows.map(rowToCommitment).filter((c): c is MemberCommitment => c !== null);
}

/** The word that holds on `today` (year-month-day), or null when none does yet. */
export async function commitmentNow(db: Queryable, userId: string, today: string): Promise<MemberCommitment | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `pct`, `from_date`, `period_kind`, `note`, `created_at` FROM `member_commitments` WHERE `user_id` = ? AND `from_date` <= ? ORDER BY `from_date` DESC, `id` DESC LIMIT 1",
    [userId, today],
  );
  const read = rows.map(rowToCommitment).filter((c): c is MemberCommitment => c !== null);
  return commitmentOn(read, today);
}

/** Erasure: the member's whole history goes with them. */
export async function forgetCommitments(db: Queryable, userId: string): Promise<void> {
  await db.query("DELETE FROM `member_commitments` WHERE `user_id` = ?", [userId]);
}
