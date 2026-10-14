/**
 * THE COMMS SETTINGS DOCUMENT'S ONE ROW, `app_config` under `comms-settings`
 * (shared/comms/settings.ts says what it holds and why).
 *
 * READ OFF THE POOL, NO CACHE ABOVE IT. The post office asks for the pause and
 * the rehearsal inbox on every send, and a cache would let a press of Pause all
 * wait for a restart to bite. One primary-key read per question is cheap.
 *
 * WRITTEN AS A MERGE PATCH, IN ONE STATEMENT. `JSON_MERGE_PATCH` (RFC 7396)
 * changes only the keys the patch names and removes a key the patch sets to
 * null, inside the database. A read-edit-write in two statements would let a
 * founder saving the postal address put back a document read a moment before
 * somebody else pressed Pause all, and the pause would be gone with nothing to
 * say so. MySQL 8 and MariaDB both implement the RFC's rules.
 *
 * Raw SQL lives here and nowhere else.
 */
import type { Pool } from "mysql2/promise";
import { COMMS_SETTINGS_KEY } from "../../shared/comms/settings";
import { readConfigDocument } from "./appConfigDocs";

/** The stored document exactly as saved, or null when nothing was ever saved. */
export async function readStoredCommsSettings(pool: Pool): Promise<Record<string, unknown> | null> {
  return readConfigDocument<Record<string, unknown>>(pool, COMMS_SETTINGS_KEY);
}

/** A merge patch with every null taken out, at every depth: what it means when there is nothing to merge into. */
function withoutNulls(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
    if (inner !== null) out[k] = withoutNulls(inner);
  }
  return out;
}

/**
 * Apply one merge patch to the stored document, creating it when there is
 * none. On a first write the patch IS the document, minus every key it sets
 * to null, because removing a key that is not there leaves nothing to remove.
 */
export async function mergeCommsSettings(pool: Pool, patch: Record<string, unknown>): Promise<void> {
  await pool.query( // module-review-ok: the comms-settings document's one writer, a single-statement merge so two saves cannot undo each other
    "INSERT INTO app_config (config_key, value) VALUES (?, ?) " +
      "ON DUPLICATE KEY UPDATE value = JSON_MERGE_PATCH(value, ?)",
    [COMMS_SETTINGS_KEY, JSON.stringify(withoutNulls(patch)), JSON.stringify(patch)],
  );
}
