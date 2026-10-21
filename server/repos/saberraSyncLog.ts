/**
 * Organisational Memory's run log: one `app_config` document, read and written
 * whole.
 *
 * ── WHY A DOCUMENT AND NO NEW TABLE ──────────────────────────────────────
 *
 * The log is twenty entries and one fingerprint, read by one panel and written
 * by one job, and every write happens while the sync's named lock is held
 * (`server/lib/saberraSync.ts`), so two writers never race a read-modify-write
 * here. That is the shape `app_config` documents exist for (config plane 4 in
 * CLAUDE.md), and it costs no migration number.
 *
 * Read off the pool every time, never from a boot cache: the scheduled job and
 * a press of Sync now may run in different processes, and each must see what
 * the other wrote.
 *
 * What may be IN the document is decided one layer up, by `readLog` in
 * `server/lib/saberraPolling.ts`, which rebuilds every run from typed fields on
 * the way out as well as on the way in.
 */
import type { Pool } from "mysql2/promise";
import { readConfigDocument } from "./appConfigDocs";

/** The `app_config` key. */
export const SYNC_LOG_KEY = "saberra-sync-runs";

/** The stored document, unparsed, or null when no sync has written one. */
export async function readSyncLogDocument(pool: Pool): Promise<Record<string, unknown> | null> {
  return readConfigDocument(pool, SYNC_LOG_KEY);
}

/** Replace the stored document whole. */
export async function writeSyncLogDocument(pool: Pool, doc: Record<string, unknown>): Promise<void> {
  await pool.query(
    "INSERT INTO app_config (config_key, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [SYNC_LOG_KEY, JSON.stringify(doc)],
  );
}
