/**
 * The one `app_config` row holding the village's signing keypair, read and
 * minted by `ensureSigningKey` in server/lib/villageExport.ts.
 *
 * Only rotation writes through here (readiness R069). First boot still mints
 * through that file's INSERT IGNORE, which is what settles two concurrent
 * first boots on one key; this replaces the document in place, so the row and
 * its key name never move.
 */
import type { Pool } from "mysql2/promise";

export async function replaceSigningKeyDoc(pool: Pool, docJson: string): Promise<void> {
  await pool.query("UPDATE app_config SET value = ? WHERE config_key = 'village-signing-key'", [docJson]);
}
