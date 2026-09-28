/**
 * THE CANVAS RESOURCES SHELF: every statement against `canvas_resources` (0224).
 *
 * All of the SQL for the table lives here, because the raw-SQL burn-down
 * register is at its ceiling and a repo is where new statements go. The
 * nightly read (server/lib/canvasResourcesSync.ts) writes through
 * `writeShelf`; the page reads through `liveResources`; the canvas pen's
 * placing goes through `setVillagePlacing`; the link check through
 * `recordLinkCheck`.
 *
 * ── A ROW IS NEVER DELETED ─────────────────────────────────────────────────
 *
 * There is no DELETE here and there must never be one. A resource that is
 * gone upstream gets `withdrawn_at`, and gets it cleared if it comes back, so
 * a village's own placing of it survives a night the sheet was half edited.
 *
 * ── WHAT A READ OF THE DATABASE NEVER TOUCHES ──────────────────────────────
 *
 * `tags_local`, `tags_local_by` and `tags_local_at` are the village's, and no
 * statement in `writeShelf` names them. `link_status` is reset to `unchecked`
 * only when a row's address changes, and that assignment comes BEFORE `url`
 * in the update list: MySQL and MariaDB assign left to right, so after `url`
 * had taken the new value the comparison would always say "unchanged".
 *
 * ── TIMES ARE READ AS UNIX_TIMESTAMP ───────────────────────────────────────
 *
 * Every datetime is written by `NOW()` or the column default, in the
 * session's zone, and read back as `UNIX_TIMESTAMP(...)`, which MySQL
 * evaluates in that same zone (server/repos/canvasReadings.ts says why).
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { CanvasBlockId } from "../../shared/governanceCanvas";
import type { ResourceLinkState } from "../../shared/canvasResources";
import type { SuggestedBlock } from "../../shared/canvasResourceTags";

/** One resource as the shelf stores it, ready to write. */
export interface ShelfRow {
  resourceKey: string;
  nameSlug: string;
  name: string;
  type: string;
  authors: string;
  description: string;
  keywords: string[];
  url: string | null;
  linkPending: boolean;
  tagsSuggested: SuggestedBlock[];
  tagsConfirmed: readonly CanvasBlockId[] | null;
}

/** One resource as the shelf holds it. */
export interface StoredResource extends ShelfRow {
  /** The village's own placing, or null when it has none. An empty list is a placing. */
  tagsLocal: string[] | null;
  source: "database" | "snapshot";
  link: ResourceLinkState;
  /** ISO instant, or null when the address was never checked. */
  linkCheckedAt: string | null;
  /** ISO instant the row was last seen upstream (or loaded from the snapshot). */
  lastSeenAt: string;
  /** ISO instant the row went missing upstream, or null while the database lists it. */
  withdrawnAt: string | null;
}

const LINK_STATES: readonly ResourceLinkState[] = ["unchecked", "ok", "broken", "refused"];

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const iso = (seconds: unknown): string | null => {
  const n = Number(seconds);
  return seconds == null || !Number.isFinite(n) ? null : new Date(n * 1000).toISOString();
};

/** Whether the shelf holds no row at all, withdrawn or not. A village's first read loads the snapshot then. */
export async function shelfIsEmpty(pool: Pool): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT 1 FROM canvas_resources LIMIT 1");
  return rows.length === 0;
}

/**
 * Write one full read of the database, in ONE transaction: every row upserted
 * on its key, and, when `withdrawOthers`, every row this read did not carry
 * marked withdrawn. The snapshot passes `false`: it only ever loads an empty
 * shelf, and a copy taken on an earlier day has no business withdrawing what
 * a later read found. Returns how many rows the read withdrew.
 */
export async function writeShelf(
  pool: Pool,
  rows: readonly ShelfRow[],
  source: "database" | "snapshot",
  withdrawOthers: boolean,
): Promise<{ withdrawn: number }> {
  if (!rows.length) return { withdrawn: 0 };
  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const values = rows.map((r) => [
      r.resourceKey,
      r.nameSlug,
      r.name,
      r.type,
      r.authors,
      r.description,
      JSON.stringify(r.keywords),
      r.url,
      r.linkPending ? 1 : 0,
      JSON.stringify(r.tagsSuggested),
      r.tagsConfirmed ? JSON.stringify(r.tagsConfirmed) : null,
      source,
    ]);
    await conn.query(
      "INSERT INTO canvas_resources " +
        "(resource_key, name_slug, name, type, authors, description, keywords, url, link_pending, tags_suggested, tags_confirmed, source) " +
        "VALUES ? " +
        "ON DUPLICATE KEY UPDATE " +
        // Before `url` changes: an address that moved has not been checked.
        "link_status = IF(url <=> VALUES(url), link_status, 'unchecked'), " +
        "link_checked_at = IF(url <=> VALUES(url), link_checked_at, NULL), " +
        "name_slug = VALUES(name_slug), name = VALUES(name), type = VALUES(type), authors = VALUES(authors), " +
        "description = VALUES(description), keywords = VALUES(keywords), url = VALUES(url), " +
        "link_pending = VALUES(link_pending), tags_suggested = VALUES(tags_suggested), " +
        "tags_confirmed = VALUES(tags_confirmed), source = VALUES(source), " +
        "last_seen_at = NOW(), withdrawn_at = NULL",
      [values],
    );
    let withdrawn = 0;
    if (withdrawOthers) {
      const [result] = await conn.query<ResultSetHeader>(
        "UPDATE canvas_resources SET withdrawn_at = NOW() WHERE withdrawn_at IS NULL AND resource_key NOT IN (?)",
        [rows.map((r) => r.resourceKey)],
      );
      withdrawn = Number(result.affectedRows);
    }
    await conn.commit();
    return { withdrawn };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

const SELECT =
  "SELECT resource_key, name_slug, name, type, authors, description, keywords, url, link_pending, " +
  "tags_suggested, tags_confirmed, tags_local, source, link_status, " +
  "UNIX_TIMESTAMP(link_checked_at) AS link_checked_ts, UNIX_TIMESTAMP(last_seen_at) AS last_seen_ts, " +
  "UNIX_TIMESTAMP(withdrawn_at) AS withdrawn_ts " +
  "FROM canvas_resources";

function toStored(r: RowDataPacket): StoredResource {
  const link = LINK_STATES.includes(r.link_status) ? (r.link_status as ResourceLinkState) : "unchecked";
  return {
    resourceKey: String(r.resource_key),
    nameSlug: String(r.name_slug),
    name: String(r.name),
    type: String(r.type ?? ""),
    authors: String(r.authors ?? ""),
    description: String(r.description ?? ""),
    keywords: parseJson<string[]>(r.keywords, []),
    url: r.url == null ? null : String(r.url),
    linkPending: Number(r.link_pending) === 1,
    tagsSuggested: parseJson<SuggestedBlock[]>(r.tags_suggested, []),
    tagsConfirmed: parseJson<CanvasBlockId[] | null>(r.tags_confirmed, null),
    tagsLocal: parseJson<string[] | null>(r.tags_local, null),
    source: r.source === "snapshot" ? "snapshot" : "database",
    link,
    linkCheckedAt: iso(r.link_checked_ts),
    lastSeenAt: iso(r.last_seen_ts) ?? new Date(0).toISOString(),
    withdrawnAt: iso(r.withdrawn_ts),
  };
}

/** Every resource the database still lists, by name. Withdrawn rows are left out. */
export async function liveResources(pool: Pool): Promise<StoredResource[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT} WHERE withdrawn_at IS NULL ORDER BY name, resource_key`);
  return rows.map(toStored);
}

/** Every row, withdrawn ones included. For tests and the record. */
export async function everyResource(pool: Pool): Promise<StoredResource[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT} ORDER BY name, resource_key`);
  return rows.map(toStored);
}

/** One resource by key, withdrawn or not, or null. */
export async function resourceByKey(pool: Pool, key: string): Promise<StoredResource | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT} WHERE resource_key = ?`, [key]);
  return rows[0] ? toStored(rows[0]) : null;
}

/**
 * The village's own placing of one resource: a list of block ids (empty means
 * shown under no block), or null to hand the placing back to the platform.
 * Records who placed it and when. Returns whether the row exists.
 */
export async function setVillagePlacing(
  pool: Pool,
  key: string,
  blocks: readonly CanvasBlockId[] | null,
  by: string,
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE canvas_resources SET tags_local = ?, tags_local_by = ?, tags_local_at = NOW() WHERE resource_key = ?",
    [blocks ? JSON.stringify(blocks) : null, blocks ? by : null, key],
  );
  return Number(result.affectedRows) > 0;
}

/** Every live resource with an address, for the link check. */
export async function linkCheckTargets(pool: Pool): Promise<Array<{ resourceKey: string; url: string }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT resource_key, url FROM canvas_resources WHERE withdrawn_at IS NULL AND url IS NOT NULL ORDER BY resource_key",
  );
  return rows.map((r) => ({ resourceKey: String(r.resource_key), url: String(r.url) }));
}

/** What one link check found. */
export async function recordLinkCheck(pool: Pool, key: string, state: Exclude<ResourceLinkState, "unchecked">): Promise<void> {
  await pool.query("UPDATE canvas_resources SET link_status = ?, link_checked_at = NOW() WHERE resource_key = ?", [state, key]);
}
