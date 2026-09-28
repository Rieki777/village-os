/**
 * ONE STORED DOCUMENT, READ BY KEY, off a pool rather than off a boot cache.
 *
 * `app_config` holds the village's own documents: the brand overlay, the
 * season calendar, the launch state. Almost everything reads them through
 * `dbDocument` (server/repos/store-db.ts), which caches at boot and answers
 * synchronously, and that is the right door for anything on a render path.
 *
 * THIS IS FOR THE OTHER CASE: a reader that has a pool and no cache, because
 * it runs outside the process that loaded one. `server/lib/launch.ts` is the
 * one today. Its checks used to arrive as closures from `server/index.ts`,
 * which is where the caches live, and that file cannot take another line: its
 * ratchet sits at exactly its baseline, and the gate's own message is that the
 * one big file may only ever get smaller.
 *
 * The canvas season (`canvas-season`, server/routes/canvasSeason.ts) is the
 * second, and the first to WRITE through here: nothing caches that key, so
 * its writer and remover sit beside the reader and stay exact.
 *
 * The conflict agreement (server/lib/conflictAgreement.ts) uses three keys,
 * and they follow the same cache rule two different ways:
 *
 *   conflict-agreement           CACHED as a `dbDocument` in server/index.ts,
 *                                because the exit policy reads through it on
 *                                every synchronous read. So it is WRITTEN only
 *                                through that handle. The launch checklist,
 *                                which has a pool and no cache, READS it here.
 *   conflict-agreement-proposal:<ballot id>
 *                                what one agreement ballot would adopt, one
 *                                key per ballot so a carried change waiting
 *                                for its landing keeps its own words. Nothing
 *                                caches it. Written here INSIDE the
 *                                transaction that opens the ballot, which is
 *                                why the writer takes a connection too.
 *   ombuds-asks                  the ombuds door's pointers. Nothing caches it,
 *                                and it only grows, by `appendToConfigList`.
 *
 * IT LIVES IN `server/repos/` BECAUSE THE STATEMENT DOES. Raw SQL outside this
 * directory is counted by a register that is also at its ceiling, and a query
 * written into a lib to save a file would spend somebody else's allowance. The
 * statement is the same one `dbDocument.load()` issues, against the same table
 * and the same column.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/**
 * The parsed document stored under `key`, or null when there is no row.
 *
 * Null and an empty document are DIFFERENT answers and both are real: a
 * village that has never saved its seasons has no row, and one that saved and
 * cleared them has a row holding an empty list. A caller that cannot tell them
 * apart will eventually guess wrong, so this never invents an object.
 *
 * A row whose value is not a JSON object reads as null rather than throwing.
 * The column is written by this platform alone, so that shape is a corruption
 * rather than a case; a checklist item that says "not answered" is a better
 * failure than a launch page that will not render.
 */
export async function readConfigDocument<T = Record<string, unknown>>(
  pool: Pool,
  key: string,
): Promise<T | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT value FROM app_config WHERE config_key = ?",
    [key],
  );
  if (!rows[0]) return null;
  let value: unknown = rows[0].value;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : null;
}

/**
 * Store `doc` under `key`, replacing whatever was there: the same statement
 * `dbDocument.put()` issues.
 *
 * ONLY FOR A KEY NOTHING CACHES. A key some `dbDocument` loaded at boot keeps
 * serving its cached copy after this writes, until the process restarts, so
 * a document read through `dbDocument` must be written through the same
 * handle. A key read only through `readConfigDocument` above, such as
 * `canvas-season`, has no cache to go stale.
 */
export async function writeConfigDocument(pool: Pool | PoolConnection, key: string, doc: Record<string, unknown>): Promise<void> {
  await pool.query(
    "INSERT INTO app_config (config_key, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [key, JSON.stringify(doc)],
  );
}

/**
 * Remove the document stored under `key`, so a read answers null again: the
 * village has no such document, which is a different answer from an empty
 * one (see `readConfigDocument`). Returns whether a row was there to remove.
 * The same cache rule applies as for the writer above.
 */
export async function deleteConfigDocument(pool: Pool, key: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>("DELETE FROM app_config WHERE config_key = ?", [key]);
  return Number(result.affectedRows) > 0;
}

/**
 * Append `item` to the list at `doc[field]` under `key`, creating the
 * document when there is none, in ONE statement.
 *
 * A read, a push and a write would lose an item whenever two requests landed
 * together, and a record that silently drops a row is worse than none. So the
 * database does the append: `JSON_ARRAY_APPEND` on an existing row, a fresh
 * `{ field: [item] }` otherwise, under the row's own key. MySQL and MariaDB
 * both take this form.
 *
 * Only for a key whose document is a list this function owns: it assumes
 * `doc[field]` is an array. The same cache rule applies as for the writer.
 */
export async function appendToConfigList(
  pool: Pool,
  key: string,
  field: string,
  item: Record<string, unknown>,
): Promise<void> {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) throw new Error(`appendToConfigList: "${field}" is not a plain field name`);
  const json = JSON.stringify(item);
  await pool.query(
    "INSERT INTO app_config (config_key, value) VALUES (?, JSON_OBJECT(?, JSON_ARRAY(JSON_EXTRACT(?, '$')))) " +
      `ON DUPLICATE KEY UPDATE value = JSON_ARRAY_APPEND(value, '$.${field}', JSON_EXTRACT(?, '$'))`,
    [key, field, json, json],
  );
}
