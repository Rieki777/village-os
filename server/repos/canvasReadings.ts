/**
 * THE CANVAS READINGS: every level a village has given a governance canvas
 * block, and the sentence that came with it (0222).
 *
 * ALL of the SQL for `canvas_readings` lives here. The raw-SQL burn-down
 * register is at its ceiling, so the route module and server/index.ts hold
 * none, and this file is exempt from that register by living in
 * server/repos.
 *
 * ── APPEND-ONLY ────────────────────────────────────────────────────────────
 *
 * Two statements and no more: one INSERT, one SELECT. There is no update and
 * no delete, because a reading is a record of what the village said on a day,
 * and the answer to a wrong one is a newer one. Adding a third statement here
 * that changes a row would turn the history the Baseline view shows into a
 * history somebody can edit.
 *
 * ── TIMES ARE READ AS UNIX_TIMESTAMP ───────────────────────────────────────
 *
 * `created_at` is written by the column DEFAULT, in the session's zone, and
 * read back as `UNIX_TIMESTAMP(created_at)`, which MySQL evaluates in that
 * same zone. That pairing is correct whatever zone a pool is pinned to; the
 * driver's own parse of a datetime is only correct on a pool pinned to UTC
 * (server/db/sessionZone.ts has the measurement).
 *
 * No cache sits above this table. The page reads the database when it is
 * asked, so a reading recorded a moment ago is on the next load.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  CANVAS_BLOCK_IDS,
  isCanvasBlockId,
  isCanvasLevel,
  isCanvasMoment,
  type CanvasBlockId,
  type CanvasLevel,
  type CanvasMoment,
  type CanvasReadingInput,
} from "../../shared/governanceCanvas";

export interface CanvasReadingRow {
  id: number;
  blockId: CanvasBlockId;
  level: CanvasLevel;
  sentence: string;
  moment: CanvasMoment;
  recordedBy: string;
  /** The recorder's name as the users table holds it, or null if the account is gone. */
  recorderName: string | null;
  /** ISO instant. */
  recordedAt: string;
}

/**
 * Write one reading. The caller has already validated it with
 * `parseCanvasReading`; the CHECK on `level` is the second lock.
 * Returns the new row's id.
 */
export async function recordCanvasReading(
  pool: Pool,
  input: CanvasReadingInput & { recordedBy: string },
): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO canvas_readings (block_id, level, sentence, recorded_by, moment) VALUES (?,?,?,?,?)",
    [input.blockId, input.level, input.sentence, input.recordedBy, input.moment],
  );
  return Number(result.insertId);
}

/**
 * Every reading, NEWEST FIRST, with the recorder's name.
 *
 * `LEFT JOIN`, because a reading outlives the account that wrote it and must
 * still render. Ordered by `created_at` then `id`, both descending, so two
 * readings of one block in the same second still have a newest.
 *
 * A row whose block id or level the registry no longer recognises is left
 * out rather than rendered as a card nobody can read: a fork that removed a
 * block keeps its rows, and they come back if the block does.
 */
export async function allCanvasReadings(pool: Pool): Promise<CanvasReadingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT r.id, r.block_id, r.level, r.sentence, r.moment, r.recorded_by, " +
      "UNIX_TIMESTAMP(r.created_at) AS recorded_epoch, u.name AS recorder_name " +
      "FROM canvas_readings r LEFT JOIN users u ON u.id = r.recorded_by " +
      "ORDER BY r.created_at DESC, r.id DESC",
  );
  const out: CanvasReadingRow[] = [];
  for (const r of rows) {
    const blockId = String(r.block_id);
    const level = Number(r.level);
    const moment = String(r.moment);
    if (!isCanvasBlockId(blockId) || !isCanvasLevel(level) || !isCanvasMoment(moment)) continue;
    out.push({
      id: Number(r.id),
      blockId,
      level,
      sentence: String(r.sentence),
      moment,
      recordedBy: String(r.recorded_by),
      recorderName: r.recorder_name === null || r.recorder_name === undefined ? null : String(r.recorder_name),
      recordedAt: new Date(Number(r.recorded_epoch) * 1000).toISOString(),
    });
  }
  return out;
}

/**
 * Each block's readings, newest first, in canvas order. A block nobody has
 * read yet is present with an empty list, so every consumer walks twelve
 * entries and none of them has to invent the missing ones.
 *
 * Pure, and it keeps the newest-first order it is given. The newest reading of
 * a block is simply the first entry of its list.
 */
export function readingsByBlock(rows: readonly CanvasReadingRow[]): Array<{ blockId: CanvasBlockId; readings: CanvasReadingRow[] }> {
  return CANVAS_BLOCK_IDS.map((blockId) => ({ blockId, readings: rows.filter((r) => r.blockId === blockId) }));
}
