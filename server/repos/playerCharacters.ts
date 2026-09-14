/**
 * `player_characters`, for the two doors that are about the PERSON rather than
 * the game: the file a member downloads, and the sweep that erases them.
 *
 * ── WHY THIS IS NOT THE TABLE'S ONLY HOME, AND SAYS SO ───────────────────
 *
 * `server/lib/characters.ts` holds the gameplay statements (choosing a class,
 * setting a primary, dropping one) and it is in the raw-SQL burn-down
 * register with them. It did not move here: relocating twelve live statements
 * to add two would be a rewrite of somebody else's file inside a data-rights
 * change, and the burn-down's own header calls moving queries between files
 * without lowering the total the thing it cannot see.
 *
 * Writing that down matters more than usual. `server/repos/subjectRefs.ts`
 * names its one outside reader for the same reason: a reader who finds this
 * file and believes it exhaustive is worse off than one who greps. So, plainly
 * THE GAMEPLAY STATEMENTS AGAINST THIS TABLE ARE IN
 * `server/lib/characters.ts`. This file holds the export read and the erasure
 * write, and nothing else.
 *
 * ── NOTHING HERE JOINS `users` ───────────────────────────────────────────
 *
 * The same boundary `server/repos/characterPortraits.ts` keeps, and for the
 * same recorded cost: 0069 pinned a charset on `player_characters`, MySQL 8
 * read the character set's default collation instead of the database's, and
 * every cross-era join died off the deployment that minted them
 * (`server/db/collation.ts`). Both statements below are keyed on `user_id`
 * alone. The one UPDATE that names `users` touches only its own row by primary
 * key, which is not a join and cannot land on the wrong side of that boundary.
 */
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

const toIso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/**
 * One character as the member's own file should read it.
 *
 * `presentation` and `tone` are in here because they are the point: they are
 * what a person chose their body to look like, which is about as personal as a
 * row in this database gets, and the export that promises "everything the
 * village holds about me" had never carried them.
 */
export interface CharacterRow {
  id: string;
  villageId: string;
  archetypeKey: string;
  presentation: string | null;
  tone: string | null;
  chosenAt: string | null;
}

/**
 * Every character one member holds, in every village this deployment runs.
 *
 * No village filter, deliberately. An export and an erasure are about a
 * PERSON, and a village-scoped read of either would answer completely for one
 * scope and silently omit the rest, which is the shape of partial answer both
 * of those promises exist to rule out.
 */
export async function charactersForMember(pool: Pool, userId: string): Promise<CharacterRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `village_id`, `archetype_key`, `presentation`, `tone`, `chosen_at` " +
      "FROM `player_characters` WHERE `user_id` = ? ORDER BY `chosen_at`, `id`",
    [userId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    villageId: String(r.village_id),
    archetypeKey: String(r.archetype_key),
    presentation: r.presentation == null ? null : String(r.presentation),
    tone: r.tone == null ? null : String(r.tone),
    chosenAt: toIso(r.chosen_at),
  }));
}

/**
 * Drop every character a departing member chose, and let go of the pointer.
 *
 * WHY THE ROWS GO RATHER THAN BEING DE-ATTRIBUTED. A character is not a record
 * of something that happened to the village; it is a description of a person's
 * chosen body, and `users.primary_character_id` publishes it. Two live readers
 * JOIN it straight back to the user row (the roster read in `server/index.ts`
 * and the voices read in `server/lib/gratitudeVoices.ts`), so a tombstone with
 * a character still attached keeps republishing a departed member's face under
 * the name "A departed member". Nulling `user_id` is not available either: the
 * column is NOT NULL and the row means nothing without it.
 *
 * THE ORDER IS THE SAFE ONE. The pointer is cleared FIRST. A death between the
 * two statements then leaves characters with no pointer at them, which reads
 * as a member who has walked away from every path, the state
 * `removeCharacter` already produces and every reader already handles. The
 * other order would leave `primary_character_id` naming a row that no longer
 * exists, which is a dangling reference nothing checks for.
 *
 * IDEMPOTENT, because the erasure sequence may re-run it: both statements
 * match nothing on a second pass and report zero.
 */
export async function forgetCharactersForMember(pool: Pool, userId: string): Promise<number> {
  await pool.query("UPDATE `users` SET `primary_character_id` = NULL WHERE `id` = ?", [userId]);
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM `player_characters` WHERE `user_id` = ?",
    [userId],
  );
  return Number(res?.affectedRows ?? 0);
}
