/**
 * `application_steps`, `application_interviews`, `application_scores` and
 * `application_recusals`: the review of an application (role journey L5).
 *
 * Every statement the review runs lives here, so the tables' readers and
 * writers stay enumerable. The rules are shared/applicationReview.ts and the
 * work is server/lib/applicationReview.ts. Raw SQL only.
 *
 * Instants are written from Node's clock and read back with UNIX_TIMESTAMP, so
 * the database's own zone never moves one.
 *
 * NOTHING HERE IS READ BY A COMPANION. The scores are private to the people the
 * rule names (`mayReadScorecards`), and no tool the guide or a companion holds
 * reads these tables: server/lib/applicationReview.refusal.test.ts scans for it.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { InterviewState, ScoreEntry, ScoreLevel, StepKind } from "../../shared/applicationReview";

type Db = Pool | PoolConnection;

const fromSeconds = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(Number(v) * 1000));
const json = (v: unknown): any => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
};

// ── Steps ───────────────────────────────────────────────────────────────────

export interface StoredStep {
  ref: string;
  kind: StepKind;
  subject: string;
  at: Date;
  actorUserId: string | null;
  detail: any;
}

/** Stamp a step once. `subject` is "" for a step with no subject, or the interview position. True when this call wrote it. */
export async function stampStep(db: Db, s: { ref: string; kind: StepKind; subject?: string; at: Date; actorUserId?: string | null; detail?: unknown }): Promise<boolean> {
  const [r] = await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO application_steps (application_ref, kind, subject, stamped_at, actor_user_id, detail_json) VALUES (?,?,?,?,?,?)",
    [s.ref, s.kind, s.subject ?? "", s.at, s.actorUserId ?? null, s.detail === undefined ? null : JSON.stringify(s.detail)],
  );
  return Number(r.affectedRows ?? 0) === 1;
}

export async function stepsOf(db: Db, ref: string): Promise<StoredStep[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT application_ref, kind, subject, UNIX_TIMESTAMP(stamped_at) AS at_s, actor_user_id, detail_json FROM application_steps WHERE application_ref = ? ORDER BY stamped_at, id",
    [ref],
  );
  return rows.map((r: any) => ({ ref: String(r.application_ref), kind: r.kind, subject: String(r.subject ?? ""), at: fromSeconds(r.at_s) as Date, actorUserId: r.actor_user_id ?? null, detail: json(r.detail_json) }));
}

/** Refs that were confirmed and have not been decided, with their confirmation time and the latest step time. */
export async function openReviews(db: Db): Promise<Array<{ ref: string; confirmedAt: Date; lastAt: Date; firstReplyAt: Date | null }>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT c.application_ref, UNIX_TIMESTAMP(c.stamped_at) AS confirmed_s, " +
      "(SELECT UNIX_TIMESTAMP(MAX(s.stamped_at)) FROM application_steps s WHERE s.application_ref = c.application_ref) AS last_s, " +
      "(SELECT UNIX_TIMESTAMP(MIN(s.stamped_at)) FROM application_steps s WHERE s.application_ref = c.application_ref AND s.kind = 'first_reply') AS reply_s " +
      "FROM application_steps c WHERE c.kind = 'confirmed' " +
      "AND NOT EXISTS (SELECT 1 FROM application_steps d WHERE d.application_ref = c.application_ref AND d.kind = 'decided') LIMIT 500",
  );
  return rows.map((r: any) => ({ ref: String(r.application_ref), confirmedAt: fromSeconds(r.confirmed_s) as Date, lastAt: fromSeconds(r.last_s) as Date, firstReplyAt: fromSeconds(r.reply_s) }));
}

// ── Interviews ──────────────────────────────────────────────────────────────

export interface StoredInterview {
  id: number;
  ref: string;
  position: number;
  roleId: string;
  minutes: number;
  final: boolean;
  state: InterviewState;
  scorerUserId: string | null;
  openedAt: Date | null;
  bookedAt: Date | null;
  heldAt: Date | null;
  scoredAt: Date | null;
}

const IV_COLUMNS =
  "id, application_ref, position, interviewer_role_id, minutes, is_final, state, scorer_user_id, UNIX_TIMESTAMP(opened_at) AS opened_s, UNIX_TIMESTAMP(booked_at) AS booked_s, UNIX_TIMESTAMP(held_at) AS held_s, UNIX_TIMESTAMP(scored_at) AS scored_s";

const ivOf = (r: any): StoredInterview => ({
  id: Number(r.id),
  ref: String(r.application_ref),
  position: Number(r.position),
  roleId: String(r.interviewer_role_id),
  minutes: Number(r.minutes),
  final: Number(r.is_final) === 1,
  state: r.state,
  scorerUserId: r.scorer_user_id ?? null,
  openedAt: fromSeconds(r.opened_s),
  bookedAt: fromSeconds(r.booked_s),
  heldAt: fromSeconds(r.held_s),
  scoredAt: fromSeconds(r.scored_s),
});

/** Write the ordered interviews; the first opens now, the rest wait. Idempotent on (ref, position). */
export async function insertInterviews(db: Db, ref: string, list: ReadonlyArray<{ roleId: string; minutes: number; final: boolean }>, at: Date): Promise<void> {
  for (let i = 0; i < list.length; i++) {
    await db.query(
      "INSERT IGNORE INTO application_interviews (application_ref, position, interviewer_role_id, minutes, is_final, state, opened_at) VALUES (?,?,?,?,?,?,?)",
      [ref, i + 1, list[i].roleId, list[i].minutes, list[i].final ? 1 : 0, i === 0 ? "open" : "waiting", i === 0 ? at : null],
    );
  }
}

export async function interviewsOf(db: Db, ref: string, lock = false): Promise<StoredInterview[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${IV_COLUMNS} FROM application_interviews WHERE application_ref = ? ORDER BY position${lock ? " FOR UPDATE" : ""}`, [ref]);
  return rows.map(ivOf);
}

export async function interviewById(db: Db, id: number): Promise<StoredInterview | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${IV_COLUMNS} FROM application_interviews WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? ivOf(rows[0]) : null;
}

/** Interviews that name one of these roles and are open now, across applications. */
export async function openInterviewsForRoles(db: Db, roleIds: readonly string[]): Promise<StoredInterview[]> {
  if (!roleIds.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${IV_COLUMNS} FROM application_interviews WHERE state = 'open' AND interviewer_role_id IN (?) ORDER BY opened_at, id`, [[...roleIds]]);
  return rows.map(ivOf);
}

/** Open the next interview, only if it is still waiting. True when this call did. */
export async function openInterview(db: Db, id: number, at: Date): Promise<boolean> {
  const [r] = await db.query<ResultSetHeader>("UPDATE application_interviews SET state = 'open', opened_at = ? WHERE id = ? AND state = 'waiting'", [at, id]);
  return Number(r.affectedRows ?? 0) === 1;
}

/** Close an interview as scored, only if it is open: of two scorers at once exactly one wins. */
export async function closeInterviewScored(db: Db, id: number, scorer: string, at: Date): Promise<boolean> {
  const [r] = await db.query<ResultSetHeader>("UPDATE application_interviews SET state = 'scored', scorer_user_id = ?, scored_at = ? WHERE id = ? AND state = 'open'", [scorer, at, id]);
  return Number(r.affectedRows ?? 0) === 1;
}

export async function skipInterview(db: Db, id: number): Promise<boolean> {
  const [r] = await db.query<ResultSetHeader>("UPDATE application_interviews SET state = 'skipped' WHERE id = ? AND state IN ('open','waiting')", [id]);
  return Number(r.affectedRows ?? 0) === 1;
}

export async function markBooked(db: Db, id: number, at: Date): Promise<void> {
  await db.query("UPDATE application_interviews SET booked_at = COALESCE(booked_at, ?) WHERE id = ?", [at, id]);
}

export async function markHeld(db: Db, id: number, at: Date): Promise<void> {
  await db.query("UPDATE application_interviews SET held_at = COALESCE(held_at, ?) WHERE id = ?", [at, id]);
}

// ── Scores ──────────────────────────────────────────────────────────────────

export interface StoredScore {
  interviewId: number;
  scorerUserId: string;
  criterionId: string;
  level: ScoreLevel;
  evidence: string;
  submittedAt: Date;
}

export async function insertScores(db: Db, ref: string, interviewId: number, scorer: string, entries: readonly ScoreEntry[], at: Date): Promise<void> {
  for (const e of entries) {
    await db.query(
      "INSERT INTO application_scores (application_ref, interview_id, scorer_user_id, criterion_id, level, evidence, submitted_at) VALUES (?,?,?,?,?,?,?)",
      [ref, interviewId, scorer, e.criterionId, e.level, e.evidence, at],
    );
  }
}

export async function scoresOf(db: Db, ref: string): Promise<StoredScore[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT interview_id, scorer_user_id, criterion_id, level, evidence, UNIX_TIMESTAMP(submitted_at) AS at_s FROM application_scores WHERE application_ref = ? ORDER BY interview_id, id",
    [ref],
  );
  return rows.map((r: any) => ({ interviewId: Number(r.interview_id), scorerUserId: String(r.scorer_user_id), criterionId: String(r.criterion_id), level: r.level, evidence: String(r.evidence), submittedAt: fromSeconds(r.at_s) as Date }));
}

/** Whether this person has submitted any scorecard on the application. */
export async function hasScored(db: Db, ref: string, userId: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM application_scores WHERE application_ref = ? AND scorer_user_id = ? LIMIT 1", [ref, userId]);
  return rows.length > 0;
}

// ── Recusals ────────────────────────────────────────────────────────────────

export async function insertRecusal(db: Db, r: { ref: string; userId: string; interviewId: number | null; reason: string | null; at: Date }): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT IGNORE INTO application_recusals (application_ref, user_id, interview_id, reason, stepped_out_at) VALUES (?,?,?,?,?)",
    [r.ref, r.userId, r.interviewId, r.reason, r.at],
  );
  return Number(res.affectedRows ?? 0) === 1;
}

export async function recusedUsers(db: Db, ref: string): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT user_id FROM application_recusals WHERE application_ref = ?", [ref]);
  return rows.map((r: any) => String(r.user_id));
}

// ── Holders of a role, live ─────────────────────────────────────────────────

/** The members holding a role now. Examples and documented holders left out. */
export async function liveHoldersOfRole(db: Db, roleId: string): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT DISTINCT user_id FROM org_role_assignments WHERE org_role_id = ? AND ended_at IS NULL AND holder_kind = 'member' AND is_example = 0 AND user_id IS NOT NULL",
    [roleId],
  );
  return rows.map((r: any) => String(r.user_id));
}

/** The role ids a person holds now. */
export async function rolesHeldBy(db: Db, userId: string): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT DISTINCT org_role_id FROM org_role_assignments WHERE user_id = ? AND ended_at IS NULL AND holder_kind = 'member' AND is_example = 0",
    [userId],
  );
  return rows.map((r: any) => String(r.org_role_id));
}

/** A role's review setup from `org_roles`, when the columns exist (they arrive with the listing lane's migration). */
export async function roleSetup(db: Db, roleId: string): Promise<{ interviewerRoles: unknown; criteria: unknown }> {
  const [cols] = await db.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_roles' AND COLUMN_NAME IN ('interviewer_roles','selection_criteria')",
  );
  const have = new Set(cols.map((c: any) => String(c.c)));
  const pick = [have.has("interviewer_roles") ? "interviewer_roles" : "NULL AS interviewer_roles", have.has("selection_criteria") ? "selection_criteria" : "NULL AS selection_criteria"];
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${pick.join(", ")} FROM org_roles WHERE id = ? LIMIT 1`, [roleId]);
  return { interviewerRoles: rows[0]?.interviewer_roles ?? null, criteria: rows[0]?.selection_criteria ?? null };
}

export async function roleNamesById(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, name FROM org_roles WHERE id IN (?)", [[...ids]]);
  return new Map(rows.map((r: any) => [String(r.id), String(r.name ?? r.id)]));
}
