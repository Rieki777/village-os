/**
 * The readers and writers for `comms_templates`: a village's own words for
 * each email, every version it has ever saved (drizzle/0228).
 *
 * ONE LIVE ROW PER KEY, held here because the table cannot hold it: the
 * primary key is (village, key, version) and `state` is a plain column, so two
 * saves racing could each retire the other's row and leave none live, or none
 * retired and two live. Every write below runs in one transaction that LOCKS
 * every row of its key first (`FOR UPDATE`), then retires, then inserts or
 * revives. A second writer waits on the lock and then sees the first one's
 * result, so the next version number and the live row are always decided by
 * one writer at a time.
 *
 * A LOST RACE IS RETRIED. Two first saves of a key that has no rows yet both
 * lock an empty range, and InnoDB settles that with a deadlock or a duplicate
 * version; either way the loser runs again and lands one version later.
 *
 * NOTHING IS DELETED. Restoring an old version makes it live again and retires
 * the current one, so the history of what a village said, and when, is never
 * rewritten. `comms_messages.template_version` names a version that still
 * exists.
 *
 * Raw SQL lives here and nowhere else. No cache sits above this table: every
 * read is the database's answer, so a save is visible to the next render at
 * once.
 */
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

export interface TemplateRow {
  templateKey: string;
  version: number;
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: string;
  /** The platform default this copy came from, or null for words with no platform default. */
  platformVersion: number | null;
  state: "live" | "retired";
  editedBy: string | null;
  /** The editor's name, when the reader asked for it and the account still exists. */
  editedByName: string | null;
  /** Epoch seconds. */
  createdAt: number;
}

const COLS =
  "t.template_key, t.version, t.subject, t.preheader, t.body_md, t.layout, t.platform_version, t.state, " +
  "t.edited_by, UNIX_TIMESTAMP(t.created_at) AS created_at";

function toRow(r: RowDataPacket): TemplateRow {
  return {
    templateKey: String(r.template_key),
    version: Number(r.version),
    subject: String(r.subject),
    preheader: r.preheader == null ? null : String(r.preheader),
    bodyMd: String(r.body_md),
    layout: String(r.layout),
    platformVersion: r.platform_version == null ? null : Number(r.platform_version),
    state: String(r.state) === "live" ? "live" : "retired",
    editedBy: r.edited_by == null ? null : String(r.edited_by),
    editedByName: r.edited_by_name == null ? null : String(r.edited_by_name),
    createdAt: Number(r.created_at),
  };
}

/** A village's live words for one key, or null when it holds none. */
export async function liveTemplateRow(pool: Pool, templateKey: string): Promise<TemplateRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_templates, the live row of one key
    `SELECT ${COLS} FROM comms_templates t WHERE t.village_id = ? AND t.template_key = ? AND t.state = 'live' ` +
      "ORDER BY t.version DESC LIMIT 1",
    [VILLAGE, templateKey],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Every key's live row, for the Words list. */
export async function liveTemplateRows(pool: Pool): Promise<TemplateRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_templates, the live row of every key
    `SELECT ${COLS} FROM comms_templates t WHERE t.village_id = ? AND t.state = 'live' ORDER BY t.template_key`,
    [VILLAGE],
  );
  return rows.map(toRow);
}

/** Every version of one key, newest first, each with its editor's name when the account exists. */
export async function templateVersionRows(pool: Pool, templateKey: string): Promise<TemplateRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_templates, one key's history with the editor's name
    `SELECT ${COLS}, u.name AS edited_by_name FROM comms_templates t ` +
      "LEFT JOIN users u ON u.id = t.edited_by " +
      "WHERE t.village_id = ? AND t.template_key = ? ORDER BY t.version DESC",
    [VILLAGE, templateKey],
  );
  return rows.map(toRow);
}

/** One version of one key, or null. */
export async function templateVersionRow(pool: Pool, templateKey: string, version: number): Promise<TemplateRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: comms_templates, one version by its key
    `SELECT ${COLS} FROM comms_templates t WHERE t.village_id = ? AND t.template_key = ? AND t.version = ? LIMIT 1`,
    [VILLAGE, templateKey, version],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** A version to write. The last of a batch becomes live; any before it are written retired. */
export interface NewTemplateVersion {
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: string;
  platformVersion: number | null;
  editedBy: string | null;
}

/** The errors a lost race raises, on MySQL and on MariaDB. */
const RACE_CODES = new Set(["ER_LOCK_DEADLOCK", "ER_DUP_ENTRY", "ER_LOCK_WAIT_TIMEOUT", "ER_CHECKREAD"]);
const RACE_ERRNOS = new Set([1213, 1062, 1205, 1020]);

function lostRace(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | null;
  return Boolean(e && ((e.code && RACE_CODES.has(e.code)) || (e.errno && RACE_ERRNOS.has(e.errno))));
}

/** Run `work` in a transaction on its own connection, again when it loses a race, at most three times. */
async function inTransaction<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      if (attempt >= 3 || !lostRace(err)) throw err;
    } finally {
      conn.release();
    }
  }
}

/** Lock every row of one key and answer the highest version, 0 when there are none. */
async function lockKey(conn: PoolConnection, templateKey: string): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>( // module-review-ok: comms_templates, locking one key's rows before a write
    "SELECT version FROM comms_templates WHERE village_id = ? AND template_key = ? FOR UPDATE",
    [VILLAGE, templateKey],
  );
  return rows.reduce((max, r) => Math.max(max, Number(r.version)), 0);
}

/**
 * Write new versions of one key and make the last of them live, retiring
 * whatever was live. Answers the version numbers written, in order.
 *
 * A first save writes two at once: the platform words the village starts
 * from, then the edit, so the history always shows where a village's words
 * began and restoring the first version brings the platform's words back.
 */
export async function appendTemplateVersions(pool: Pool, templateKey: string, versions: NewTemplateVersion[]): Promise<number[]> {
  if (!versions.length) return [];
  return inTransaction(pool, async (conn) => {
    let next = (await lockKey(conn, templateKey)) + 1;
    await conn.query( // module-review-ok: comms_templates, retiring the live row of one locked key
      "UPDATE comms_templates SET state = 'retired' WHERE village_id = ? AND template_key = ? AND state = 'live'",
      [VILLAGE, templateKey],
    );
    const written: number[] = [];
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      await conn.query( // module-review-ok: comms_templates, one new version of one locked key
        "INSERT INTO comms_templates " +
          "(village_id, template_key, version, subject, preheader, body_md, layout, platform_version, state, edited_by) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          VILLAGE,
          templateKey,
          next,
          v.subject,
          v.preheader,
          v.bodyMd,
          v.layout,
          v.platformVersion,
          i === versions.length - 1 ? "live" : "retired",
          v.editedBy,
        ],
      );
      written.push(next);
      next += 1;
    }
    return written;
  });
}

/**
 * Write a first version only when the key has none, for adopting the platform
 * words as a journey is turned on. Answers whether it wrote one; a key that
 * already has words of its own is left exactly as it is.
 */
export async function insertFirstVersion(pool: Pool, templateKey: string, version: NewTemplateVersion): Promise<boolean> {
  return inTransaction(pool, async (conn) => {
    if ((await lockKey(conn, templateKey)) > 0) return false;
    await conn.query( // module-review-ok: comms_templates, the first version of a key that had none
      "INSERT INTO comms_templates " +
        "(village_id, template_key, version, subject, preheader, body_md, layout, platform_version, state, edited_by) " +
        "VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'live', ?)",
      [VILLAGE, templateKey, version.subject, version.preheader, version.bodyMd, version.layout, version.platformVersion, version.editedBy],
    );
    return true;
  });
}

/**
 * Make one old version live again and retire the current one. Answers false,
 * changing nothing, when the version does not exist.
 */
export async function makeVersionLive(pool: Pool, templateKey: string, version: number): Promise<boolean> {
  return inTransaction(pool, async (conn) => {
    await lockKey(conn, templateKey);
    const [rows] = await conn.query<RowDataPacket[]>( // module-review-ok: comms_templates, the version being restored, under the key's lock
      "SELECT version FROM comms_templates WHERE village_id = ? AND template_key = ? AND version = ?",
      [VILLAGE, templateKey, version],
    );
    if (!rows[0]) return false;
    await conn.query( // module-review-ok: comms_templates, retiring the live row of one locked key
      "UPDATE comms_templates SET state = 'retired' WHERE village_id = ? AND template_key = ? AND state = 'live'",
      [VILLAGE, templateKey],
    );
    await conn.query( // module-review-ok: comms_templates, reviving one version of one locked key
      "UPDATE comms_templates SET state = 'live' WHERE village_id = ? AND template_key = ? AND version = ?",
      [VILLAGE, templateKey, version],
    );
    return true;
  });
}
