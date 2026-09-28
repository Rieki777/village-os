/**
 * A MEMBER'S NOTEBOOK AND THE RESOURCE PICKS: every statement that touches
 * `village_documents`, `village_document_files` and `canvas_resource_picks`
 * (0226), and the one read of the export's audit row.
 *
 * ALL of the SQL for these tables lives here. The raw-SQL burn-down register
 * is at its ceiling, so the route and the libraries hold none, and this file
 * is exempt from that register by living in server/repos.
 *
 * ── PRIVATE BY DEFAULT, AND ONE STATEMENT SHARES ───────────────────────────
 *
 * Every insert writes `shared_with_village = 0`. The ONE statement that sets
 * it to 1 is `markDocumentShared`, and it is called only when the village's
 * pen adopts the owner's "Share with the village" suggestion
 * (server/routes/canvasFrames.ts). It also asks, in its WHERE, that the
 * document still belongs to the member who asked, so a suggestion naming
 * somebody else's document cannot share it.
 *
 * ── TIMES ARE READ AS UNIX_TIMESTAMP ───────────────────────────────────────
 *
 * The pairing server/repos/canvasReadings.ts uses: the column DEFAULT writes
 * in the session's zone and `UNIX_TIMESTAMP` reads in that same zone, which is
 * right whatever zone a pool is pinned to. `shared_at` and the consent stamp
 * are written with `NOW()` for the same reason.
 *
 * No cache sits above these tables. A document added a moment ago is on the
 * next load.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isDocumentKind, type DocumentKind, type StoredDocumentKind, type TextDocumentInput } from "../../shared/villageDocuments";

export interface DocumentRow {
  id: number;
  ownerId: string;
  /** The owner's name as the users table holds it, or null if the account is gone. */
  ownerName: string | null;
  title: string;
  kind: DocumentKind;
  /** The text, on a text kind when it was asked for; null otherwise. */
  body: string | null;
  /** Characters of text on a text kind, bytes of file on a stored kind. */
  size: number;
  fileName: string | null;
  shared: boolean;
  sharedAt: string | null;
  modelConsentTo: string | null;
  createdAt: string;
}

const iso = (epoch: unknown): string | null =>
  epoch === null || epoch === undefined ? null : new Date(Number(epoch) * 1000).toISOString();

function toRow(r: RowDataPacket, withBody: boolean): DocumentRow | null {
  const kind = String(r.kind);
  if (!isDocumentKind(kind)) return null;
  return {
    id: Number(r.id),
    ownerId: String(r.owner_user_id),
    ownerName: r.owner_name === null || r.owner_name === undefined ? null : String(r.owner_name),
    title: String(r.title),
    kind,
    body: withBody && r.body !== null && r.body !== undefined ? String(r.body) : null,
    size: Number(r.size ?? 0),
    fileName: r.file_name === null || r.file_name === undefined ? null : String(r.file_name),
    shared: Number(r.shared_with_village) === 1,
    sharedAt: iso(r.shared_epoch),
    modelConsentTo: r.model_consent_to === null || r.model_consent_to === undefined ? null : String(r.model_consent_to),
    createdAt: iso(r.created_epoch) ?? new Date(0).toISOString(),
  };
}

const LIST_COLUMNS =
  "d.id, d.owner_user_id, d.title, d.kind, d.file_name, d.shared_with_village, d.model_consent_to, " +
  "COALESCE(CHAR_LENGTH(d.body), d.file_size, 0) AS size, " +
  "UNIX_TIMESTAMP(d.created_at) AS created_epoch, UNIX_TIMESTAMP(d.shared_at) AS shared_epoch, u.name AS owner_name";
const BODY_COLUMNS = `${LIST_COLUMNS}, d.body`;
const FROM = "FROM village_documents d LEFT JOIN users u ON u.id = d.owner_user_id";

const rows = (list: RowDataPacket[], withBody: boolean): DocumentRow[] =>
  list.map((r) => toRow(r, withBody)).filter((r): r is DocumentRow => r !== null);

/** Write a text document, private. Returns its id. */
export async function insertTextDocument(pool: Pool, ownerId: string, doc: TextDocumentInput): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO village_documents (owner_user_id, title, kind, body, shared_with_village) VALUES (?,?,?,?,0)",
    [ownerId, doc.title, doc.kind, doc.body],
  );
  return Number(result.insertId);
}

/**
 * Write a stored document and its bytes, private, in one transaction, so a
 * row never exists without its file or a file without its row. Returns its id.
 */
export async function insertStoredDocument(
  pool: Pool,
  ownerId: string,
  doc: { title: string; kind: StoredDocumentKind; fileName: string; mime: string; bytes: Buffer },
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query<ResultSetHeader>(
      "INSERT INTO village_documents (owner_user_id, title, kind, body, file_name, file_size, shared_with_village) VALUES (?,?,?,NULL,?,?,0)",
      [ownerId, doc.title, doc.kind, doc.fileName.slice(0, 255), doc.bytes.length],
    );
    const id = Number(result.insertId);
    await conn.query("INSERT INTO village_document_files (document_id, mime, bytes) VALUES (?,?,?)", [id, doc.mime, doc.bytes]);
    await conn.commit();
    return id;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** How many documents a member keeps. */
export async function countDocumentsOwnedBy(pool: Pool, ownerId: string): Promise<number> {
  const [r] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM village_documents WHERE owner_user_id = ?", [ownerId]);
  return Number(r[0]?.n ?? 0);
}

/** One document with its text, whoever owns it. The route decides who may read it. */
export async function documentById(pool: Pool, id: number): Promise<DocumentRow | null> {
  const [r] = await pool.query<RowDataPacket[]>(`SELECT ${BODY_COLUMNS} ${FROM} WHERE d.id = ?`, [id]);
  return r[0] ? toRow(r[0], true) : null;
}

/** A stored document's bytes, or null when it has none. */
export async function documentFile(pool: Pool, id: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const [r] = await pool.query<RowDataPacket[]>("SELECT mime, bytes FROM village_document_files WHERE document_id = ?", [id]);
  if (!r[0]) return null;
  const bytes = r[0].bytes;
  return { mime: String(r[0].mime), bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []) };
}

/** A member's own documents, newest first, without their text. */
export async function documentsOwnedBy(pool: Pool, ownerId: string): Promise<DocumentRow[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    `SELECT ${LIST_COLUMNS} ${FROM} WHERE d.owner_user_id = ? ORDER BY d.created_at DESC, d.id DESC`,
    [ownerId],
  );
  return rows(r, false);
}

/** Every document the village's pen adopted, newest share first, without their text. */
export async function sharedDocuments(pool: Pool): Promise<DocumentRow[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    `SELECT ${LIST_COLUMNS} ${FROM} WHERE d.shared_with_village = 1 ORDER BY d.shared_at DESC, d.id DESC`,
  );
  return rows(r, false);
}

/** Documents by id, without their text: the ones waiting on a share decision. */
export async function documentsByIds(pool: Pool, ids: readonly number[]): Promise<DocumentRow[]> {
  if (!ids.length) return [];
  const [r] = await pool.query<RowDataPacket[]>(`SELECT ${LIST_COLUMNS} ${FROM} WHERE d.id IN (?) ORDER BY d.created_at DESC`, [ids]);
  return rows(r, false);
}

/**
 * The text documents one member may search and take away: every shared one,
 * and their own. WITH the text. Never another member's private document: the
 * WHERE says so, and the route test holds it to that.
 */
export async function textDocumentsReadableBy(pool: Pool, userId: string): Promise<DocumentRow[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    `SELECT ${BODY_COLUMNS} ${FROM} WHERE d.kind IN ('md','txt','paste') AND (d.shared_with_village = 1 OR d.owner_user_id = ?) ` +
      "ORDER BY d.shared_with_village DESC, d.created_at DESC, d.id DESC",
    [userId],
  );
  return rows(r, true);
}

/**
 * Take a document away, with its bytes, in one transaction. Only its owner's
 * id matches, so a call on somebody else's document changes nothing. True when
 * a row went.
 */
export async function deleteOwnDocument(pool: Pool, id: number, ownerId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [owned] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM village_documents WHERE id = ? AND owner_user_id = ? FOR UPDATE",
      [id, ownerId],
    );
    if (!owned[0]) {
      await conn.rollback();
      return false;
    }
    await conn.query("DELETE FROM village_document_files WHERE document_id = ?", [id]);
    await conn.query("DELETE FROM village_documents WHERE id = ? AND owner_user_id = ?", [id, ownerId]);
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * THE ONE STATEMENT THAT SHARES A DOCUMENT. It moves only a private document
 * that still belongs to the member who asked. True when this call shared it.
 */
export async function markDocumentShared(pool: Pool, id: number, ownerId: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE village_documents SET shared_with_village = 1, shared_at = NOW() WHERE id = ? AND owner_user_id = ? AND shared_with_village = 0",
    [id, ownerId],
  );
  return result.affectedRows === 1;
}

/** Record the disclosure the owner said yes to before this document's text first went to a model. */
export async function recordModelConsent(pool: Pool, id: number, ownerId: string, to: string): Promise<void> {
  await pool.query(
    "UPDATE village_documents SET model_consent_to = ?, model_consent_at = NOW() WHERE id = ? AND owner_user_id = ?",
    [to.slice(0, 255), id, ownerId],
  );
}

/**
 * A LEAVER'S NOTEBOOK, for the erasure sweep (server/lib/erasure.ts). Their
 * PRIVATE documents go with their bytes, and so do their own resource picks.
 * A document the village adopted stays: it is the village's material now, and
 * its owner reads as "a departed member" once the account is a tombstone.
 * Idempotent: every statement is a DELETE keyed on the member.
 */
export async function forgetNotebookForMember(pool: Pool, userId: string): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "DELETE f FROM village_document_files f JOIN village_documents d ON d.id = f.document_id " +
        "WHERE d.owner_user_id = ? AND d.shared_with_village = 0",
      [userId],
    );
    await conn.query("DELETE FROM village_documents WHERE owner_user_id = ? AND shared_with_village = 0", [userId]);
    // The empty string is the village's own pick and is never a member's.
    if (userId) await conn.query("DELETE FROM canvas_resource_picks WHERE user_id = ?", [userId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** What a member's notebook still holds, for the erasure test and nothing else. */
export async function notebookRowsRemaining(pool: Pool, userId: string): Promise<{ private: number; shared: number; files: number; picks: number }> {
  const [d] = await pool.query<RowDataPacket[]>(
    "SELECT SUM(shared_with_village = 0) AS priv, SUM(shared_with_village = 1) AS shared FROM village_documents WHERE owner_user_id = ?",
    [userId],
  );
  const [f] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM village_document_files f JOIN village_documents d ON d.id = f.document_id WHERE d.owner_user_id = ?",
    [userId],
  );
  const [p] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM canvas_resource_picks WHERE user_id = ?", [userId]);
  return {
    private: Number(d[0]?.priv ?? 0),
    shared: Number(d[0]?.shared ?? 0),
    files: Number(f[0]?.n ?? 0),
    picks: Number(p[0]?.n ?? 0),
  };
}

/* ── Resource picks ─────────────────────────────────────────────────────── */

/** The village's own pick is keyed by the empty string. */
export const VILLAGE_PICK = "";

/** Keep a resource on a list. A second pick of the same one is a no-op. True when a row was added. */
export async function addResourcePick(pool: Pool, userId: string, resourceKey: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT IGNORE INTO canvas_resource_picks (user_id, resource_key) VALUES (?,?)",
    [userId, resourceKey],
  );
  return result.affectedRows === 1;
}

/** Take a resource off a list. True when a row went. */
export async function removeResourcePick(pool: Pool, userId: string, resourceKey: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM canvas_resource_picks WHERE user_id = ? AND resource_key = ?",
    [userId, resourceKey],
  );
  return result.affectedRows === 1;
}

/** One list's keys, oldest pick first. `VILLAGE_PICK` reads the village's. */
export async function resourcePicksFor(pool: Pool, userId: string): Promise<string[]> {
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT resource_key FROM canvas_resource_picks WHERE user_id = ? ORDER BY created_at, id",
    [userId],
  );
  return r.map((x) => String(x.resource_key));
}

/** What the canvas resources table says about a pick, when that table exists. */
export interface ResourceFacts {
  key: string;
  name: string;
  type: string;
  url: string | null;
  withdrawn: boolean;
}

/**
 * The canvas resources a list of picks names, read from `canvas_resources`
 * (0224, the canvas-resources lane) by the columns that lane's brief names.
 *
 * NULL, NOT AN EMPTY MAP, when the table or a column is not there: a village a
 * release behind, or this lane's own tree before the two are composed. The
 * export then prints the keys and says the names could not be read, which is
 * the truth, rather than an empty list that looks like no picks.
 */
export async function resourceFactsFor(pool: Pool, keys: readonly string[]): Promise<Map<string, ResourceFacts> | null> {
  if (!keys.length) return new Map();
  try {
    const [r] = await pool.query<RowDataPacket[]>(
      "SELECT resource_key, name, type, url, withdrawn_at FROM canvas_resources WHERE resource_key IN (?)",
      [keys],
    );
    const out = new Map<string, ResourceFacts>();
    for (const x of r) {
      out.set(String(x.resource_key), {
        key: String(x.resource_key),
        name: String(x.name ?? ""),
        type: String(x.type ?? ""),
        url: x.url === null || x.url === undefined || String(x.url) === "" ? null : String(x.url),
        withdrawn: x.withdrawn_at !== null && x.withdrawn_at !== undefined,
      });
    }
    return out;
  } catch (e: any) {
    if (e?.code === "ER_NO_SUCH_TABLE" || e?.code === "ER_BAD_FIELD_ERROR") return null;
    throw e;
  }
}

/* ── The export's audit row ─────────────────────────────────────────────── */

/** The audit row every export writes carries this entity type. */
export const EXPORT_ENTITY = "canvas_export";

/** What the last export recorded, read back from its audit row. */
export interface LastExport {
  at: string;
  /** The pack's content hash, from the row's text (`canvas:export:<hash>`). */
  hash: string | null;
  /** The brain etag at export, from the row's entity ref. */
  brainEtag: string | null;
}

/**
 * This member's newest export. The row is written through `recordEvent`, the
 * one door into `health_events`; this is only its reader, and it asks for the
 * member's own rows and nobody else's.
 */
export async function lastExportBy(pool: Pool, userId: string): Promise<LastExport | null> {
  const [r] = await pool.query<RowDataPacket[]>(
    "SELECT text, entity_ref, UNIX_TIMESTAMP(at) AS at_epoch FROM health_events " +
      "WHERE kind = 'audit' AND entity_type = ? AND actor_user_id = ? ORDER BY at DESC, id DESC LIMIT 1",
    [EXPORT_ENTITY, userId],
  );
  if (!r[0]) return null;
  const text = String(r[0].text ?? "");
  const m = /^canvas:export:([0-9a-f]{16,64})$/.exec(text);
  return {
    at: iso(r[0].at_epoch) ?? new Date(0).toISOString(),
    hash: m ? m[1] : null,
    brainEtag: r[0].entity_ref === null || r[0].entity_ref === undefined ? null : String(r[0].entity_ref),
  };
}
