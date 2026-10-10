/**
 * `seat_applications` (0248) and the reads the member door makes beside it.
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
  /** The alignment text this application's words live in (0250), null before PR5. */
  textId: string | null;
  textHash: string | null;
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
  "id, candidate_user_id, proposed_by, seat_ids, note, deliverables, settings_json, settings_hash, text_id, text_hash, " +
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
    textId: r.text_id ?? null,
    textHash: r.text_hash ?? null,
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
  /** The alignment text written in the same transaction (PR5). */
  textId?: string | null;
  textHash?: string | null;
  termEndsAt: Date;
  termSeasonId: string | null;
  termFollowsSeason: boolean;
  startsAt: Date | null;
  status: ApplicationStatus;
}

export async function insertApplication(db: Db, a: NewApplication): Promise<void> {
  await db.query(
    "INSERT INTO seat_applications (id, candidate_user_id, proposed_by, seat_ids, note, deliverables, settings_json, " +
      "settings_hash, text_id, text_hash, term_ends_at, term_season_id, term_follows_season, starts_at, status) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      a.id,
      a.candidateUserId,
      a.proposedBy,
      JSON.stringify(a.seatIds),
      a.note,
      a.deliverables,
      JSON.stringify(a.settings),
      a.settingsHash,
      a.textId ?? null,
      a.textHash ?? null,
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

/** Several applications by id, in one read (red team D8). */
export async function readApplications(db: Db, ids: readonly string[]): Promise<StoredApplication[]> {
  if (ids.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM seat_applications WHERE id IN (${ids.map(() => "?").join(",")})`, [...ids]);
  return rows.map(rowToApplication);
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

/**
 * An application written before the alignment store (PR5) gains its text when
 * the candidate first aligns with it, or when the village adopts it. Written
 * once: a row that already names a text is left alone, and false says so.
 */
export async function setApplicationText(db: Db, id: string, textId: string, textHash: string): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE seat_applications SET text_id = ?, text_hash = ? WHERE id = ? AND text_id IS NULL",
    [textId, textHash, id],
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

/**
 * A departed member's applications that no seating took up are withdrawn, so
 * the season turn never seats somebody who has gone (red team G2). Adopted
 * applications already seated keep their status: they are the record.
 */
export async function withdrawUnseatedOf(db: Db, candidateUserId: string): Promise<number> {
  const [r]: any = await db.query(
    "UPDATE seat_applications a SET status = 'withdrawn', decided_at = COALESCE(decided_at, UTC_TIMESTAMP()) WHERE candidate_user_id = ? " +
      "AND (status IN ('awaiting-holder','voting','held-full') OR (status = 'adopted' AND NOT EXISTS (SELECT 1 FROM org_role_assignments s WHERE s.application_id = a.id)))",
    [candidateUserId],
  );
  return Number(r?.affectedRows ?? 0);
}

// ── Terms on offer, for the erasure step ───────────────────────────────────

const likeOf = (phrase: string) => `%${phrase.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Seats whose terms on offer mention a phrase, with who published each. The
 * LIKE is a wide net (it ignores case); the erasure step decides, case by
 * case, what in the words is the member.
 */
export async function offersMentioning(db: Db, phrase: string): Promise<Array<{ id: string; termsOffer: unknown; by: string | null }>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, terms_offer, terms_offer_by FROM org_roles WHERE terms_offer IS NOT NULL AND CAST(terms_offer AS CHAR) LIKE ?",
    [likeOf(phrase)],
  );
  return rows.map((r: any) => ({ id: String(r.id), termsOffer: json<unknown>(r.terms_offer, null), by: r.terms_offer_by ?? null }));
}

/** Seats whose terms on offer a member published, for the erasure step. */
export async function offersBy(db: Db, userId: string): Promise<Array<{ id: string; termsOffer: unknown; by: string | null }>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, terms_offer, terms_offer_by FROM org_roles WHERE terms_offer IS NOT NULL AND terms_offer_by = ?", [userId]);
  return rows.map((r: any) => ({ id: String(r.id), termsOffer: json<unknown>(r.terms_offer, null), by: r.terms_offer_by ?? null }));
}

export interface ApplicationWords {
  id: string;
  candidateUserId: string;
  note: string | null;
  deliverables: string | null;
  settings: unknown;
}

const wordsOf = (r: any): ApplicationWords => ({
  id: String(r.id),
  candidateUserId: String(r.candidate_user_id),
  note: r.note ?? null,
  deliverables: r.deliverables ?? null,
  settings: json<unknown>(r.settings_json, null),
});

/** A member's own applications' words and terms, for the erasure step. */
export async function applicationWordsOf(db: Db, candidateUserId: string): Promise<ApplicationWords[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, candidate_user_id, note, deliverables, settings_json FROM seat_applications WHERE candidate_user_id = ?",
    [candidateUserId],
  );
  return rows.map(wordsOf);
}

/** Other members' applications whose words or terms mention a phrase (a wide, case-blind net), for the erasure step. */
export async function applicationsMentioning(db: Db, phrase: string): Promise<ApplicationWords[]> {
  const like = likeOf(phrase);
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, candidate_user_id, note, deliverables, settings_json FROM seat_applications " +
      "WHERE note LIKE ? OR deliverables LIKE ? OR CAST(settings_json AS CHAR) LIKE ?",
    [like, like, like],
  );
  return rows.map(wordsOf);
}

/** Erasure only: another member's own words with a departed member's name taken out. */
export async function rewriteApplicationWords(db: Db, id: string, note: string | null, deliverables: string | null): Promise<void> {
  await db.query("UPDATE seat_applications SET note = ?, deliverables = ? WHERE id = ?", [note, deliverables, id]);
}

/**
 * THE ONE WRITE TO `settings_json` AFTER INSERT: erasure, scrubbing a departed
 * member's name out of the words in the terms (a pay note, a measure). The
 * figures and the shape stay; `settings_hash` stays as the record of what was
 * applied for, and the alignment text's own hash is what binds the parties.
 */
export async function rewriteApplicationSettings(db: Db, id: string, settings: unknown): Promise<void> {
  await db.query("UPDATE seat_applications SET settings_json = ? WHERE id = ?", [JSON.stringify(settings), id]);
}

/** Rewrite a seat's terms on offer, with a departed member's name scrubbed out. */
export async function rewriteTermsOffer(db: Db, id: string, termsOffer: unknown): Promise<void> {
  await db.query("UPDATE org_roles SET terms_offer = ? WHERE id = ?", [JSON.stringify(termsOffer), id]);
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
  focus?: string | null;
  note?: string | null;
}

/** The live seatings on these seats, locked when handed a transaction's connection. */
export async function liveSeatingsOf(db: Db, seatIds: readonly string[], lock = false): Promise<LiveSeating[]> {
  if (seatIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, org_role_id, user_id, season_id, term_ends_at, started_at, application_id, focus, note FROM org_role_assignments " +
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
    focus: r.focus ?? null,
    note: r.note ?? null,
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

/**
 * A RENEWAL ENDS THE SEATING IT REPLACES (red team G1). A member already
 * seated who is adopted again is seated afresh on the new application's
 * terms, and the old seating ends here, inside the adoption's transaction.
 * The old seating keeps its own application id, so the earlier terms read
 * as ended (their seating ended) and the history of which terms the member
 * held, and when, stays on the rows. Overwriting the id instead lost it, and
 * left the season and the term's end as they were, so a lapsed seating
 * stayed lapsed under terms that read in force.
 */
export async function endSeatingForRenewal(db: Db, assignmentId: string, applicationId: string): Promise<boolean> {
  const [r]: any = await db.query(
    "UPDATE org_role_assignments SET ended_at = NOW(), ended_reason = ? WHERE id = ? AND ended_at IS NULL",
    [`Renewed on the terms of ${applicationId}.`.slice(0, 255), assignmentId],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** How many seatings, open or ended, ever held an application's terms. Zero means it was never seated. */
export async function seatingsEverHolding(db: Db, applicationId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM org_role_assignments WHERE application_id = ?", [applicationId]);
  return Number(rows[0]?.n ?? 0);
}

/** The statuses that hold a seat for a member's application: a second one for the same seat waits. */
export const HOLDING_STATUSES = ["awaiting-holder", "voting", "held-full"] as const;

/**
 * Lock the seats, then read the member's applications still holding any of
 * them (red team G6). Inside the transaction that writes the new
 * application: the seat rows are locked in id order first, so two applies
 * for the same seat queue on the lock, and the second reads the first's row
 * with a locking read once it commits. An application adopted and not yet
 * seated holds its seats too.
 */
export async function holdingApplicationsLocked(conn: PoolConnection, candidateUserId: string, seatIds: readonly string[]): Promise<StoredApplication[]> {
  if (seatIds.length > 0) {
    const sorted = [...seatIds].sort();
    await conn.query(`SELECT id FROM org_roles WHERE id IN (${sorted.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, sorted);
  }
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM seat_applications a WHERE candidate_user_id = ? AND (status IN (${HOLDING_STATUSES.map(() => "?").join(",")}) ` +
      "OR (status = 'adopted' AND NOT EXISTS (SELECT 1 FROM org_role_assignments s WHERE s.application_id = a.id))) FOR UPDATE",
    [candidateUserId, ...HOLDING_STATUSES],
  );
  return rows.map(rowToApplication).filter((a) => a.seatIds.some((sid) => seatIds.includes(sid)));
}

/**
 * The applications the season turn may seat (red team G2): adopted and never
 * seated, with their first day reached or unset, and every one held because
 * a seat was full.
 */
export async function applicationsToSeat(db: Db, now: Date): Promise<StoredApplication[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM seat_applications a WHERE (status = 'held-full' OR (status = 'adopted' AND (starts_at IS NULL OR starts_at <= ?))) ` +
      "AND NOT EXISTS (SELECT 1 FROM org_role_assignments s WHERE s.application_id = a.id) ORDER BY created_at, id LIMIT 500",
    [now],
  );
  return rows.map(rowToApplication);
}

/** Applications waiting on a vote, for the sweep that finds one whose vote already ended (red team D4). */
export async function votingApplications(db: Db): Promise<StoredApplication[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM seat_applications WHERE status = 'voting' ORDER BY created_at, id LIMIT 500`);
  return rows.map(rowToApplication);
}

/** The newest ballot on an application, in any state. */
export interface ApplicationBallot {
  id: string;
  applicationId: string;
  status: string;
  landingStatus: string | null;
  landsAt: Date | null;
}

/** The newest `role_application` ballot on each of these applications, in any state (red team U1, D4, D8). */
export async function latestBallotsFor(db: Db, applicationIds: readonly string[]): Promise<Map<string, ApplicationBallot>> {
  const out = new Map<string, ApplicationBallot>();
  if (applicationIds.length === 0) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, subject_ref, status, landing_status, lands_at FROM ballots WHERE subject_type = 'role_application' " +
      `AND subject_ref IN (${applicationIds.map(() => "?").join(",")}) ORDER BY opens_at, id`,
    [...applicationIds],
  );
  // Oldest first, so the newest of each wins.
  for (const r of rows as any[]) {
    out.set(String(r.subject_ref), {
      id: String(r.id),
      applicationId: String(r.subject_ref),
      status: String(r.status),
      landingStatus: r.landing_status === null || r.landing_status === undefined ? null : String(r.landing_status),
      landsAt: instant(r.lands_at),
    });
  }
  return out;
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
