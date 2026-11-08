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

const signedKey = (requestId: string) => `signing-key-rotation-signed:${requestId}`;

/**
 * Claim the second signature on one rotation request (server/lib/signingKeyCosign.ts).
 * INSERT IGNORE on the request's own key: of two co-signers pressing at once, one
 * gets true and replaces the key, the other gets false and replaces nothing.
 */
export async function claimRotationCosign(pool: Pool, requestId: string, by: string): Promise<boolean> {
  const [r] = await pool.query<any>("INSERT IGNORE INTO app_config (config_key, value) VALUES (?, ?)", [
    signedKey(requestId),
    JSON.stringify({ by, at: new Date().toISOString() }),
  ]);
  return Number(r?.affectedRows ?? 0) === 1;
}

/** Give the claim back: only when the replacement itself failed, so the request can be signed again. */
export async function releaseRotationCosign(pool: Pool, requestId: string): Promise<void> {
  await pool.query("DELETE FROM app_config WHERE config_key = ?", [signedKey(requestId)]);
}
