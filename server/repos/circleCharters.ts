/**
 * THE WRITES TO A CIRCLE'S WORDS, each one a step inside the publish or revert
 * transaction of an org draft (`update_circle`, server/lib/circleWordsDraft.ts).
 *
 * Every function takes the transaction's own connection, never a pool: a
 * draft's changes commit together or not at all, and a step that opened its
 * own connection could not be rolled back with the rest.
 *
 * The purpose lives on `circles`, which the circles store caches; a write to
 * it bumps `collection_versions` in the same transaction, as `move_circle`
 * does, so a writer holding an older snapshot rebases instead of writing the
 * old purpose back. The charter words live in `circle_charters` (0270), which
 * no cache holds.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { CHARTER_COLUMNS, type CharterField, type CharterRow } from "../../shared/circleCharter";

/** What a circle's words were before a draft wrote them: the purpose, and the charter row or null. */
export interface CircleWordsBefore {
  exists: boolean;
  isExample: boolean;
  purpose: string | null;
  charter: CharterRow | null;
}

const CHARTER_SELECT = Object.values(CHARTER_COLUMNS).join(", ");

export async function readCircleWords(conn: PoolConnection, circleId: string): Promise<CircleWordsBefore> {
  const [[circle]] = await conn.query<RowDataPacket[]>("SELECT purpose, is_example FROM circles WHERE id = ?", [circleId]);
  const [[charter]] = await conn.query<RowDataPacket[]>(`SELECT ${CHARTER_SELECT} FROM circle_charters WHERE circle_id = ?`, [circleId]);
  return {
    exists: !!circle,
    isExample: !!circle && Number(circle.is_example) === 1,
    purpose: circle?.purpose ?? null,
    charter: charter ? (charter as CharterRow) : null,
  };
}

/** Write the purpose on `circles`, and bump the circles cache's version in the same transaction. */
export async function writeCirclePurpose(conn: PoolConnection, circleId: string, purpose: string | null): Promise<void> {
  await conn.query("UPDATE circles SET purpose = ? WHERE id = ? AND is_example = 0", [purpose, circleId]);
  await conn.query("UPDATE collection_versions SET version = version + 1 WHERE collection = 'circles'");
}

/**
 * Write the named charter fields, creating the row on the first adoption.
 * `values` maps field to the stored value: text, a list or pairs (written as
 * JSON), or null to clear. Column names come from the fixed `CHARTER_COLUMNS`
 * map, never from a payload key.
 */
export async function writeCharterFields(
  conn: PoolConnection,
  circleId: string,
  values: Partial<Record<CharterField, unknown>>,
  draftId: string | null,
): Promise<void> {
  const fields = Object.keys(values) as CharterField[];
  if (!fields.length) return;
  const cols = fields.map((f) => CHARTER_COLUMNS[f]);
  const stored = fields.map((f) => {
    const v = values[f];
    if (v === null || v === undefined) return null;
    return f === "existsWhile" ? String(v) : JSON.stringify(v);
  });
  const now = new Date();
  await conn.query(
    `INSERT INTO circle_charters (circle_id, ${cols.join(", ")}, last_draft_id, updated_at) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?) ` +
      `ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(", ")}, last_draft_id = VALUES(last_draft_id), updated_at = VALUES(updated_at)`,
    [circleId, ...stored, draftId, now],
  );
}
