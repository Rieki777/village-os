/**
 * The village's masterplan record: one document in `app_config`.
 *
 * NO TABLE AND NO MIGRATION. A village has one masterplan at a time, the
 * record is a handful of fields, and the file itself lives in the uploads
 * volume like every other document a founder hands the platform. That is the
 * shape `app_config` documents exist for (config plane 4 in CLAUDE.md).
 *
 * READ FRESH EVERY TIME. `dbDocument` caches, and a cache is only safe when
 * every writer goes through the same object. A document is built per call
 * here and loaded before it is read, so the record a reader sees is the one
 * in the database. It is read when a founder opens the blank map or an agent
 * asks for its brief, which is rarely enough that the one indexed SELECT
 * costs nothing worth keeping a cache for.
 *
 * The uploads sweep reads every text column of every table before it calls a
 * file an orphan (server/repos/uploadRefs.ts), and `app_config.value` is one
 * of them, so a kept masterplan is never swept from under its record.
 */
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "mysql2/promise";
import { dbDocument } from "../repos/store-db";
import { MASTERPLAN_DOC, readMasterplan, type MasterplanRecord } from "../../shared/mapFromMasterplan";

const doc = (pool: Pool) => dbDocument<Record<string, unknown>>(pool, MASTERPLAN_DOC, {});

/** The masterplan this village keeps, or null when it keeps none. */
export async function currentMasterplan(pool: Pool): Promise<MasterplanRecord | null> {
  const d = doc(pool);
  await d.load();
  return d.exists() ? readMasterplan(d.get()) : null;
}

export async function keepMasterplan(pool: Pool, record: MasterplanRecord): Promise<void> {
  await doc(pool).put({ ...record });
}

/** An empty record reads as none (`readMasterplan`), which is what removal means. */
export async function forgetMasterplan(pool: Pool): Promise<void> {
  await doc(pool).put({});
}

/**
 * Take a superseded masterplan's file off the volume.
 *
 * A founder who replaces or removes their plan means it is gone, and a plan
 * can be the one document in a village that says where everything is going
 * to be built. So the file goes at once and is not left for the sweep's grace
 * window. Only a file this door minted (`masterplan-` and the stamp), sitting
 * directly in the volume, is ever removed: anything else a stored record
 * names was put there by somebody else and is not this function's to delete.
 */
export function unlinkMasterplanFile(uploadsDir: string, record: MasterplanRecord | null): boolean {
  if (!record) return false;
  const name = path.basename(record.filename);
  if (name !== record.filename || !/^masterplan-\d{13}-[a-z0-9]+\.[a-z0-9]+$/.test(name)) return false;
  const full = path.join(uploadsDir, name);
  if (path.dirname(path.resolve(full)) !== path.resolve(uploadsDir)) return false;
  try {
    fs.unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}
