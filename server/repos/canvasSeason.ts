/**
 * THE VILLAGE'S CHOSEN SEASON, stored as the `canvas-season` document in
 * `app_config` (2026-09-26). The format and its validator are
 * shared/canvasSeason.ts; the routes are server/routes/canvasSeason.ts.
 *
 * No migration: `app_config` is the key-value table for exactly this kind of
 * village document, and the season is one document the pen replaces whole.
 * Written through `writeConfigDocument` and read through `readConfigDocument`
 * (server/repos/appConfigDocs.ts), and NEVER through a `dbDocument`, so no
 * boot cache holds a copy that could outlive a write.
 *
 * ── A STORED SEASON IS CHECKED AGAIN ON EVERY READ ─────────────────────────
 *
 * The PUT validates before it writes. The read validates again, because the
 * row is only as good as the last thing that wrote it: an older release, a
 * restore from backup, or a hand edit in a database console. A stored season
 * that no longer passes is reported as unreadable, with the validator's own
 * sentence, and the Canvas view falls back to canvas order. It is never
 * rendered half-checked.
 *
 * ── WHO LOADED IT ──────────────────────────────────────────────────────────
 *
 * The document keeps the loader's account id and nothing else about them. The
 * name is looked up when the season is read, the way canvas readings name
 * their recorder, so an account that is erased stops being named here too.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  CANVAS_SEASON_KEY,
  parseCanvasSeason,
  type CanvasSeason,
  type StoredCanvasSeason,
} from "../../shared/canvasSeason";
import { deleteConfigDocument, readConfigDocument, writeConfigDocument } from "./appConfigDocs";

export type CanvasSeasonRead =
  | { state: "none" }
  | { state: "unreadable"; problem: string }
  | {
      state: "stored";
      season: CanvasSeason;
      savedBy: string;
      /** The loader's name as the users table holds it now, or null when the account is gone. */
      savedByName: string | null;
      savedAt: string | null;
    };

export async function readCanvasSeason(pool: Pool): Promise<CanvasSeasonRead> {
  const doc = await readConfigDocument<Partial<StoredCanvasSeason>>(pool, CANVAS_SEASON_KEY);
  if (!doc) return { state: "none" };
  const parsed = parseCanvasSeason(doc.season);
  if (!parsed.ok) return { state: "unreadable", problem: parsed.errors[0] ?? "The stored season could not be read." };
  const savedBy = typeof doc.savedBy === "string" ? doc.savedBy : "";
  let savedByName: string | null = null;
  if (savedBy) {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT name FROM users WHERE id = ?", [savedBy]);
    const name = rows[0]?.name;
    savedByName = name === null || name === undefined ? null : String(name);
  }
  return {
    state: "stored",
    season: parsed.season,
    savedBy,
    savedByName,
    savedAt: typeof doc.savedAt === "string" ? doc.savedAt : null,
  };
}

/** Store a season the caller has already validated, replacing any before it. */
export async function saveCanvasSeason(pool: Pool, season: CanvasSeason, savedBy: string): Promise<StoredCanvasSeason> {
  const doc: StoredCanvasSeason = { season, savedBy, savedAt: new Date().toISOString() };
  await writeConfigDocument(pool, CANVAS_SEASON_KEY, { ...doc });
  return doc;
}

/** Take the season off. The Canvas view goes back to canvas order. */
export async function removeCanvasSeason(pool: Pool): Promise<boolean> {
  return deleteConfigDocument(pool, CANVAS_SEASON_KEY);
}
