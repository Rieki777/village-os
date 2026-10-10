/**
 * The alignment store (0250): `alignment_texts`, `alignment_parties`,
 * `alignments` and `alignment_seals`. INSERT ONLY.
 *
 * Every statement this store runs lives here, and none of them is an UPDATE or
 * a DELETE. A text's words, a party list, an act of aligning and a seal are
 * each written once and read forever. The one exception the feature allows is
 * the erasure step in server/lib/alignmentErasure.ts, and a grep test
 * (server/lib/alignments.store.test.ts) fails on any other file that names one
 * of these tables beside an UPDATE, a DELETE, a TRUNCATE, a REPLACE or an
 * upsert, this one included.
 *
 * A repeated insert of a party, an alignment or a seal is answered by the
 * UNIQUE key: `INSERT IGNORE` keeps the first row and reports whether this one
 * landed, so a double click aligns once and a second sweep seals nothing.
 *
 * Raw SQL only, never `dbCollection`: its `replaceAll` rewrites every row.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SeatSettings } from "../../shared/seatSettings";

type Db = Pool | PoolConnection;

export interface StoredText {
  id: string;
  subjectType: string;
  subjectRef: string;
  version: number;
  title: string;
  body: string;
  settings: SeatSettings | null;
  salt: string;
  contentHash: string;
  supersedesId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string;
  createdAt: Date;
  redactedAt: Date | null;
}

export interface StoredParty {
  textId: string;
  partyKey: string;
  userId: string | null;
  capacity: string;
  required: boolean;
}

export interface StoredAlignment {
  id: string;
  textId: string;
  partyKey: string;
  userId: string | null;
  contentHash: string;
  intentText: string;
  method: "click" | "holder" | "ballot";
  authorityRef: string | null;
  at: Date;
}

export interface StoredSeal {
  textId: string;
  receipt: Record<string, any>;
  at: Date;
}

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

/** A DATE column, as YYYY-MM-DD whatever the driver hands back. */
const civil = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const TEXT_COLUMNS =
  "id, subject_type, subject_ref, version, title, body, settings_json, salt, content_hash, supersedes_id, " +
  "effective_from, effective_to, created_by, created_at, redacted_at";

function rowToText(r: any): StoredText {
  return {
    id: String(r.id),
    subjectType: String(r.subject_type),
    subjectRef: String(r.subject_ref),
    version: Number(r.version),
    title: String(r.title),
    body: String(r.body ?? ""),
    settings: json<SeatSettings | null>(r.settings_json, null),
    salt: String(r.salt),
    contentHash: String(r.content_hash),
    supersedesId: r.supersedes_id ?? null,
    effectiveFrom: civil(r.effective_from),
    effectiveTo: civil(r.effective_to),
    createdBy: String(r.created_by),
    createdAt: instant(r.created_at) as Date,
    redactedAt: instant(r.redacted_at),
  };
}

const rowToParty = (r: any): StoredParty => ({
  textId: String(r.text_id),
  partyKey: String(r.party_key),
  userId: r.user_id ? String(r.user_id) : null,
  capacity: String(r.capacity),
  required: Number(r.required) === 1,
});

const rowToAlignment = (r: any): StoredAlignment => ({
  id: String(r.id),
  textId: String(r.text_id),
  partyKey: String(r.party_key),
  userId: r.user_id ? String(r.user_id) : null,
  contentHash: String(r.content_hash),
  intentText: String(r.intent_text),
  method: r.method === "holder" || r.method === "ballot" ? r.method : "click",
  authorityRef: r.authority_ref ?? null,
  at: instant(r.at) as Date,
});

// ── Inserts ──────────────────────────────────────────────────────────────────

export interface NewText {
  id: string;
  subjectType: string;
  subjectRef: string;
  version: number;
  title: string;
  body: string;
  settings: SeatSettings | null;
  salt: string;
  contentHash: string;
  supersedesId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string;
}

export async function insertText(db: Db, t: NewText): Promise<void> {
  await db.query(
    "INSERT INTO alignment_texts (id, subject_type, subject_ref, version, title, body, settings_json, salt, content_hash, " +
      "supersedes_id, effective_from, effective_to, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())",
    [
      t.id,
      t.subjectType,
      t.subjectRef,
      t.version,
      t.title,
      t.body,
      t.settings === null ? null : JSON.stringify(t.settings),
      t.salt,
      t.contentHash,
      t.supersedesId,
      t.effectiveFrom,
      t.effectiveTo,
      t.createdBy,
    ],
  );
}

export async function insertParty(db: Db, p: StoredParty): Promise<void> {
  await db.query(
    "INSERT INTO alignment_parties (text_id, party_key, user_id, capacity, required) VALUES (?,?,?,?,?)",
    [p.textId, p.partyKey, p.userId, p.capacity, p.required ? 1 : 0],
  );
}

export interface NewAlignment {
  id: string;
  textId: string;
  partyKey: string;
  userId: string | null;
  contentHash: string;
  intentText: string;
  method: "click" | "holder" | "ballot";
  authorityRef: string | null;
}

/** True when this row landed; false when the party had already aligned. The time is the server's. */
export async function insertAlignment(db: Db, a: NewAlignment): Promise<boolean> {
  const [r]: any = await db.query(
    "INSERT IGNORE INTO alignments (id, text_id, party_key, user_id, content_hash, intent_text, method, authority_ref, at) " +
      "VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",
    [a.id, a.textId, a.partyKey, a.userId, a.contentHash, a.intentText, a.method, a.authorityRef],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/** True when this seal landed; false when the text was already sealed. */
export async function insertSeal(db: Db, textId: string, receipt: Record<string, any>): Promise<boolean> {
  const [r]: any = await db.query(
    "INSERT IGNORE INTO alignment_seals (text_id, receipt_json, at) VALUES (?,?,UTC_TIMESTAMP())",
    [textId, JSON.stringify(receipt)],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function readText(db: Db, id: string): Promise<StoredText | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TEXT_COLUMNS} FROM alignment_texts WHERE id = ?`, [id]);
  return rows[0] ? rowToText(rows[0]) : null;
}

/** Several texts by id, in one read. */
export async function readTexts(db: Db, ids: readonly string[]): Promise<StoredText[]> {
  if (ids.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TEXT_COLUMNS} FROM alignment_texts WHERE id IN (${ids.map(() => "?").join(",")})`, [...ids]);
  return rows.map(rowToText);
}

/** Every version of a subject's text, oldest first. */
export async function textsForSubject(db: Db, subjectType: string, subjectRef: string): Promise<StoredText[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TEXT_COLUMNS} FROM alignment_texts WHERE subject_type = ? AND subject_ref = ? ORDER BY version`,
    [subjectType, subjectRef],
  );
  return rows.map(rowToText);
}

/** The texts a member is a party to, newest first. */
export async function textsForParty(db: Db, userId: string): Promise<StoredText[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TEXT_COLUMNS.split(", ").map((c) => `t.${c}`).join(", ")} FROM alignment_texts t ` +
      "JOIN alignment_parties p ON p.text_id = t.id WHERE p.user_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 500",
    [userId],
  );
  return rows.map(rowToText);
}

/** Texts whose words carry a phrase, for the erasure step's search. */
export async function textsMentioning(db: Db, phrase: string): Promise<StoredText[]> {
  const like = `%${phrase.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TEXT_COLUMNS} FROM alignment_texts WHERE body LIKE ? OR CAST(settings_json AS CHAR) LIKE ? LIMIT 5000`,
    [like, like],
  );
  return rows.map(rowToText);
}

export async function partiesOf(db: Db, textIds: readonly string[]): Promise<StoredParty[]> {
  if (textIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT text_id, party_key, user_id, capacity, required FROM alignment_parties WHERE text_id IN (${textIds.map(() => "?").join(",")})`,
    [...textIds],
  );
  return rows.map(rowToParty);
}

export async function alignmentsOf(db: Db, textIds: readonly string[]): Promise<StoredAlignment[]> {
  if (textIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, text_id, party_key, user_id, content_hash, intent_text, method, authority_ref, at FROM alignments " +
      `WHERE text_id IN (${textIds.map(() => "?").join(",")}) ORDER BY at, id`,
    [...textIds],
  );
  return rows.map(rowToAlignment);
}

/** A member's own alignment rows, for their export. */
export async function alignmentsByUser(db: Db, userId: string): Promise<StoredAlignment[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, text_id, party_key, user_id, content_hash, intent_text, method, authority_ref, at FROM alignments WHERE user_id = ? ORDER BY at, id",
    [userId],
  );
  return rows.map(rowToAlignment);
}

export async function sealsOf(db: Db, textIds: readonly string[]): Promise<StoredSeal[]> {
  if (textIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT text_id, receipt_json, at FROM alignment_seals WHERE text_id IN (${textIds.map(() => "?").join(",")})`,
    [...textIds],
  );
  return rows.map((r: any) => ({ textId: String(r.text_id), receipt: json<Record<string, any>>(r.receipt_json, {}), at: instant(r.at) as Date }));
}

/**
 * Texts that may still need a seal or an in-force notice: every text with no
 * seal yet, and every sealed text from the last `recentDays`. A village holds
 * tens of these a season.
 */
export async function textsToSettle(db: Db, recentDays = 400): Promise<string[]> {
  // A text whose application was withdrawn or not adopted can never be sealed
  // or come into force, so the sweep does not read it again (red team D9).
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT t.id FROM alignment_texts t LEFT JOIN alignment_seals s ON s.text_id = t.id " +
      "LEFT JOIN seat_applications a ON t.subject_type = 'seat_terms' AND a.id = t.subject_ref " +
      "WHERE (a.id IS NULL OR a.status NOT IN ('withdrawn','not-adopted')) " +
      "AND (s.text_id IS NULL OR t.created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY) ORDER BY t.created_at LIMIT 2000",
    [recentDays],
  );
  return rows.map((r: any) => String(r.id));
}

export interface SeatingFacts {
  open: number;
  total: number;
  /** The latest term end among the open seatings, which moves when a season-following term moves. */
  openEndsAt: Date | null;
}

/** Every seating, open or ended, that carries each application's terms: one grouped read (red team D8). */
export async function seatingFacts(db: Db, applicationIds: readonly string[]): Promise<Map<string, SeatingFacts>> {
  const out = new Map<string, SeatingFacts>();
  if (applicationIds.length === 0) return out;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT application_id, COUNT(*) AS total, SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open, " +
      "MAX(CASE WHEN ended_at IS NULL THEN term_ends_at ELSE NULL END) AS open_ends FROM org_role_assignments " +
      `WHERE application_id IN (${applicationIds.map(() => "?").join(",")}) GROUP BY application_id`,
    [...applicationIds],
  );
  for (const r of rows as any[]) {
    out.set(String(r.application_id), { open: Number(r.open ?? 0), total: Number(r.total ?? 0), openEndsAt: instant(r.open_ends) });
  }
  return out;
}

/** Every seating, open or ended, that carries an application's terms. */
export async function seatingCounts(db: Db, applicationId: string): Promise<{ open: number; total: number }> {
  const f = (await seatingFacts(db, [applicationId])).get(applicationId);
  return { open: f?.open ?? 0, total: f?.total ?? 0 };
}
