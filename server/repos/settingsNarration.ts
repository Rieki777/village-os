/**
 * The pulse lines an old release wrote about a game variable, read and
 * rewritten for the boot scrub (server/lib/credentialScrub.ts).
 *
 * Until 2026-08-12 the variables route wrote
 * `A game rule changed: <key> is now <value>` into `health_events`, which the
 * home page reads to strangers, and on Amora that published an Alchemy key.
 * The route stopped narrating values that day and Amora's one row was fixed by
 * hand, by id. Every other village that set an endpoint before then still has
 * its line. This is the lookup that finds them, and the WHERE is the exact
 * shape that route wrote: its kind, its entity, its sentence.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** One narrated line: which dial it names and what it says. */
export interface SettingsNarration {
  id: string;
  dial: string;
  text: string;
}

/** The sentence the old route wrote, up to the value. */
export const NARRATION_PREFIX = "A game rule changed: ";

export async function narratedSettingsLines(pool: Pool): Promise<SettingsNarration[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, entity_ref, text FROM health_events " +
      "WHERE kind = 'settings' AND entity_type = 'variable' AND entity_ref IS NOT NULL " +
      "AND text LIKE 'A game rule changed: % is now %'",
  );
  return rows.map((r) => ({ id: String(r.id), dial: String(r.entity_ref), text: String(r.text) }));
}

/** Rewrite one line by id, only while it still says what was read. True when it changed. */
export async function rewriteNarration(pool: Pool, before: SettingsNarration, text: string): Promise<boolean> {
  const [res] = await pool.query<any>(
    "UPDATE health_events SET text = ? WHERE id = ? AND kind = 'settings' AND text = ?",
    [text, before.id, before.text],
  );
  return Number(res?.affectedRows ?? 0) > 0;
}
