/**
 * `seat_applications` (0240) and the reads the member door makes beside it.
 *
 * Every statement the door runs lives here, so the table's readers and writers
 * stay enumerable: the route (server/routes/seatApplications.ts), the closer
 * (server/lib/seatApplicationCloser.ts) and the erasure step call these and
 * hold no SQL of their own.
 *
 * WHAT IS WRITTEN AFTER INSERT. `setStatus` writes `status` and the adoption
 * columns, guarded on the status it expects to find, so two doors racing on
 * one application cannot both win. `eraseApplicationWords` nulls the member's
 * own words. Nothing else touches a stored row: the settings, the seats and
 * the term are what the village decided on, and they never change under it.
 *
 * THE CAPACITY READ LOCKS. `seatsForUpdate` and `liveSeatingsOf` take row
 * locks when handed a transaction's connection, so a second adoption of the
 * same seat waits for the first to commit and then counts its seating. The
 * re-check at landing is only worth anything if it cannot be raced.
 *
 * Raw SQL only, never `dbCollection`: its `replaceAll` resets every column a
 * caller leaves out.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SeatSettings } from "../../shared/seatSettings";
import type { ApplicationStatus } from "../../shared/seatApplications";

type Db = Pool | PoolConnection;

export interface StoredApplication {
  id: string;
  candidateUserId: string;
  proposedBy: string;
  seatIds: string[];
  note: string | null;
  deliverables: string | null;
  settings: SeatSettings;
  settingsHash: string;
  termEndsAt: Date;
  termSeasonId: string | null;
  termFollowsSeason: boolean;
  startsAt: Date | null;
  status: ApplicationStatus;
  adoptedVia: "holder" | "ballot" | null;
  adoptedRef: string | null;
  authorityRef: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const COLUMNS =
  "id, candidate_user_id, proposed_by, seat_ids, note, deliverables, settings_json, settings_hash, " +
  "term_ends_at, term_season_id, term_follows_season, starts_at, status, adopted_via, adopted_ref, " +
  "authority_ref, decided_at, created_at";

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

function rowToApplication(r: any): StoredApplication {
  return {
    id: String(r.id),
    candidateUserId: String(r.candidate_user_id),
    proposedBy: String(r.proposed_by),
    seatIds: json<unknown[]>(r.seat_ids, []).map(String),
    note: r.note ?? null,
    deliverables: r.deliverables ?? null,
    settings: json<SeatSettings>(r.settings_json, { v: 1 }),
    settingsHash: String(r.settings_hash),
    termEndsAt: instant(r.term_ends_at) as Date,
    termSeasonId: r.term_season_id ?? null,
    termFollowsSeason: Number(r.term_follows_season) === 1,
    startsAt: instant(r.starts_at),
    status: String(r.status) as ApplicationStatus,
    adoptedVia: r.adopted_via === "holder" || r.adopted_via === "ballot" ? r.adopted_via : null,
    adoptedRef: r.adopted_ref ?? null,
    authorityRef: r.authority_ref ?? null,
    decidedAt: instant(r.decided_at),
    createdAt: instant(r.created_at) as Date,
  };
}

export interface NewApplication {
  id: string;
  candidateUserId: string;
  proposedBy: string;
  seatIds: string[];
  note: string | null;
  deliverables: string | null;
  settings: SeatSettings;
  settingsHash: string;
  termEndsAt: Date;
  termSeasonId: string | null;
  termFollowsSeason: boolean;
  startsAt: Date | null;
  status: ApplicationStatus;
}

export async function insertApplication(db: Db, a: NewApplication): Promise<void> {
  await db.query(
    "INSERT INTO seat_applications (id, candidate_user_id, proposed_by, seat_ids, note, deliverables, settings_json, " +
      "settings_hash, term_ends_at, term_season_id, term_follows_season, starts_at, status) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      a.id,
      a.candidateUserId,
      a.proposedBy,
      JSON.stringify(a.seatIds),
      a.note,
      a.deliverables,
      JSON.stringify(a.settings),
      a.settingsHash,
      a.termEndsAt,
      a.termSeasonId,
      a.termFollowsSeason ? 1 : 0,
      a.startsAt,
      a.status,
    ],
  );
}

/** One application, or null. Pass a transaction's connection and `lock` to hold its row until commit. */
export async function readApplication(db: Db, id: string, lock = false): Promise<StoredApplication | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM seat_applications WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? rowToApplication(rows[0]) : null;
}

/** Every application, newest first. A village holds tens of these a season, never thousands. */
export async function listApplications(db: Db, limit = 500): Promise<StoredApplication[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM seat_applications ORDER BY created_at DESC, id DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToApplication);
}

/** A member's applications still waiting on somebody's decision. */
export async function openApplicationsOf(db: Db, candidateUserId: string): Promise<StoredApplication[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM seat_applications WHERE candidate_user_id = ? AND status IN ('awaiting-holder','voting')`,
    [candidateUserId],
  );
  return rows.map(rowToApplication);
}

/**
 * The applications whose term sits in one season, oldest first. Season plans
 * (RC1) list a member's seat choices this way, by `candidate_user_id` and
 * `term_season_id`: a plan keeps no second store of them. Pass a member to
 * read only theirs.
 */
export async function applicationsInSeason(db: Db, seasonId: string, candidateUserId?: string): Promise<StoredApplication[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM seat_applications WHERE term_season_id = ?${candidateUserId ? " AND candidate_user_id = ?" : ""} ORDER BY created_at, id`,
    candidateUserId ? [seasonId, candidateUserId] : [seasonId],
  );
  return rows.map(rowToApplication);
}

export interface StatusChange {
  adoptedVia?: "holder" | "ballot" | null;
  adoptedRef?: string | null;
  authorityRef?: string | null;
  /** Stamp `decided_at` now. */
  decided?: boolean;
}

/**
 * Move an application from one of `from` to `to`. False when it was not in
 * any of `from`, which is how a second door learns the first one won.
 */
export async function setStatus(
  db: Db,
  id: string,
  from: readonly ApplicationStatus[],
  to: ApplicationStatus,
  change: StatusChange = {},
): Promise<boolean> {
  if (from.length === 0) return false;
  const sets = ["status = ?"];
  const args: unknown[] = [to];
  if (change.adoptedVia !== undefined) {
    sets.push("adopted_via = ?");
    args.push(change.adoptedVia);
  }
  if (change.adoptedRef !== undefined) {
    sets.push("adopted_ref = ?");
    args.push(change.adoptedRef);
  }
  if (change.authorityRef !== undefined) {
    sets.push("authority_ref = ?");
    args.push(change.authorityRef);
  }
  if (change.decided) sets.push("decided_at = UTC_TIMESTAMP()");
  const [r]: any = await db.query(
    `UPDATE seat_applications SET ${sets.join(", ")} WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
    [...args, id, ...from],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** The member's own words go when they ask to be forgotten. The terms and the decision stay, de-attributed. */
export async function eraseApplicationWords(db: Db, candidateUserId: string): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE seat_applications SET note = NULL, deliverables = NULL WHERE candidate_user_id = ?",
    [candidateUserId],
  );
  return Number(r?.affectedRows ?? 0);
}

// ── The seats, read for the capacity check ──────────────────────────────────

export interface SeatForCapacity {
  id: string;
  name: string;
  aim: string | null;
  seats: number;
  active: boolean;
  isExample: boolean;
  expiresEachSeason: boolean | null;
}

/** The seats an application names, locked when handed a transaction's connection. */
export async function seatsForUpdate(db: Db, seatIds: readonly string[], lock = false): Promise<SeatForCapacity[]> {
  if (seatIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, name, aim, seats, active, is_example, expires_each_season FROM org_roles WHERE id IN (${seatIds.map(() => "?").join(",")})${lock ? " FOR UPDATE" : ""}`,
    [...seatIds],
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    name: String(r.name ?? r.id),
    aim: r.aim ?? null,
    seats: Number(r.seats ?? 1),
    active: !!r.active,
    isExample: !!r.is_example,
    expiresEachSeason: r.expires_each_season === null || r.expires_each_season === undefined ? null : !!r.expires_each_season,
  }));
}

export interface LiveSeating {
  id: string;
  orgRoleId: string;
  userId: string | null;
  seasonId: string | null;
  termEndsAt: Date | null;
  startedAt: Date | null;
  applicationId: string | null;
}

/** The live seatings on these seats, locked when handed a transaction's connection. */
export async function liveSeatingsOf(db: Db, seatIds: readonly string[], lock = false): Promise<LiveSeating[]> {
  if (seatIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, org_role_id, user_id, season_id, term_ends_at, started_at, application_id FROM org_role_assignments " +
      `WHERE ended_at IS NULL AND org_role_id IN (${seatIds.map(() => "?").join(",")})${lock ? " FOR UPDATE" : ""}`,
    [...seatIds],
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    orgRoleId: String(r.org_role_id),
    userId: r.user_id ? String(r.user_id) : null,
    seasonId: r.season_id ?? null,
    termEndsAt: instant(r.term_ends_at),
    startedAt: instant(r.started_at),
    applicationId: r.application_id ?? null,
  }));
}

/** The seatings that hold an application's terms. */
export async function seatingsHolding(db: Db, applicationId: string): Promise<LiveSeating[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, org_role_id, user_id, season_id, term_ends_at, started_at, application_id FROM org_role_assignments WHERE application_id = ? AND ended_at IS NULL",
    [applicationId],
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    orgRoleId: String(r.org_role_id),
    userId: r.user_id ? String(r.user_id) : null,
    seasonId: r.season_id ?? null,
    termEndsAt: instant(r.term_ends_at),
    startedAt: instant(r.started_at),
    applicationId: r.application_id ?? null,
  }));
}

/** A member already seated takes the application's terms on their existing seating. */
export async function linkSeating(db: Db, assignmentId: string, applicationId: string): Promise<void> {
  await db.query("UPDATE org_role_assignments SET application_id = ? WHERE id = ? AND ended_at IS NULL", [applicationId, assignmentId]);
}

/** Run `work` inside one transaction on one connection: commit when it returns, roll back when it throws. */
export async function inApplicationTransaction<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await work(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}
