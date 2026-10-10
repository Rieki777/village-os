/**
 * `season_plans` (0241) and the one quest read the plan page makes beside it.
 *
 * Every statement season plans run lives here, so the table's readers and
 * writers stay enumerable: the route (server/routes/seasonPlans.ts), the notice
 * job, the profile export and the erasure step call these and hold no SQL.
 *
 * WHAT IS WRITTEN AFTER INSERT. A save inserts version n+1 and stamps
 * `superseded_at` on the versions before it, in one transaction. Filing stamps
 * `filed_at` on the newest version. `eraseSeasonPlanWords` nulls the member's
 * own words. Nothing else touches a stored row.
 *
 * Raw SQL only, never `dbCollection`: its `replaceAll` resets every column a
 * caller leaves out.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { PlanCommitments, PlanInput } from "../../shared/seasonPlans";

type Db = Pool | PoolConnection;

export interface StoredPlan {
  id: string;
  userId: string;
  seasonId: string;
  version: number;
  aim: string | null;
  servesGoal: string | null;
  commitments: PlanCommitments;
  handingBack: string[];
  filedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
}

const COLUMNS = "id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back, filed_at, superseded_at, created_at";

/** MySQL hands JSON back parsed on some drivers and as text on others. */
function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

const instant = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(`${String(v).replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

function rowToPlan(r: any): StoredPlan {
  const back = json<unknown>(r.handing_back, []);
  return {
    id: String(r.id),
    userId: String(r.user_id),
    seasonId: String(r.season_id),
    version: Number(r.version),
    aim: r.aim ?? null,
    servesGoal: r.serves_goal ?? null,
    commitments: json<PlanCommitments>(r.commitments_json, {}) ?? {},
    handingBack: Array.isArray(back) ? back.map(String) : [],
    filedAt: instant(r.filed_at),
    supersededAt: instant(r.superseded_at),
    createdAt: instant(r.created_at) as Date,
  };
}

/**
 * Save a plan as the member's next version, and stand the earlier ones down.
 *
 * The version is read under a lock inside the transaction, and the unique key
 * on (user, season, version) refuses a second writer that raced past it, so two
 * saves at once can never both become version n+1.
 */
export async function insertPlanVersion(pool: Pool, userId: string, seasonId: string, plan: PlanInput): Promise<StoredPlan> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT COALESCE(MAX(version), 0) AS v FROM season_plans WHERE user_id = ? AND season_id = ? FOR UPDATE",
      [userId, seasonId],
    );
    const version = Number(rows[0]?.v ?? 0) + 1;
    const id = `sp-${crypto.randomBytes(8).toString("hex")}`;
    await conn.query(
      "INSERT INTO season_plans (id, user_id, season_id, version, aim, serves_goal, commitments_json, handing_back) VALUES (?,?,?,?,?,?,?,?)",
      [id, userId, seasonId, version, plan.aim, plan.servesGoal, JSON.stringify(plan.commitments ?? {}), JSON.stringify(plan.handingBack ?? [])],
    );
    await conn.query(
      "UPDATE season_plans SET superseded_at = UTC_TIMESTAMP() WHERE user_id = ? AND season_id = ? AND version < ? AND superseded_at IS NULL",
      [userId, seasonId, version],
    );
    await conn.commit();
    const [back] = await pool.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM season_plans WHERE id = ?`, [id]);
    return rowToPlan(back[0]);
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

/** Every version of one member's plan for one season, oldest first. */
export async function planVersions(db: Db, userId: string, seasonId: string): Promise<StoredPlan[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM season_plans WHERE user_id = ? AND season_id = ? ORDER BY version`,
    [userId, seasonId],
  );
  return rows.map(rowToPlan);
}

/**
 * File the newest version. False when there is nothing to file: no plan yet,
 * or the newest version is filed already.
 */
export async function fileNewestVersion(db: Db, userId: string, seasonId: string): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE season_plans SET filed_at = UTC_TIMESTAMP() WHERE user_id = ? AND season_id = ? AND superseded_at IS NULL AND filed_at IS NULL",
    [userId, seasonId],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** Every version in a season, for the village page. A village holds tens of members, never thousands. */
export async function plansInSeason(db: Db, seasonId: string): Promise<StoredPlan[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM season_plans WHERE season_id = ? ORDER BY user_id, version`,
    [seasonId],
  );
  return rows.map(rowToPlan);
}

/** The members who have filed a plan for this season, for the reminder sweep. */
export async function filedMembers(db: Db, seasonId: string): Promise<Set<string>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT DISTINCT user_id FROM season_plans WHERE season_id = ? AND filed_at IS NOT NULL",
    [seasonId],
  );
  return new Set(rows.map((r) => String(r.user_id)));
}

/** Everything a member's plans hold, for `GET /api/profile/export`. */
export async function plansOfMember(db: Db, userId: string): Promise<StoredPlan[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM season_plans WHERE user_id = ? ORDER BY season_id, version`,
    [userId],
  );
  return rows.map(rowToPlan);
}

/** A member's own words go when they ask to be forgotten. The seats they handed back stay, as the village's record. */
export async function eraseSeasonPlanWords(db: Db, userId: string): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE season_plans SET aim = NULL, serves_goal = NULL, commitments_json = NULL WHERE user_id = ?",
    [userId],
  );
  return Number(r?.affectedRows ?? 0);
}

/**
 * QUESTS CONSENTED INSIDE ONE MOON, per member, in one grouped read.
 *
 * The plan's pips count only claims consented inside `[from, to)`: a quest
 * claimed this moon and consented last moon, or still waiting, is not this
 * moon's work done.
 */
export async function consentedBetween(db: Db, from: Date, to: Date): Promise<Map<string, number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT user_id, COUNT(*) AS n FROM quest_claims WHERE status = 'consented' AND consented_at >= ? AND consented_at < ? GROUP BY user_id",
    [from, to],
  );
  return new Map(rows.map((r) => [String(r.user_id), Number(r.n)]));
}
