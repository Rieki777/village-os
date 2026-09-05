/**
 * Every query the character-portrait feature makes (0158).
 *
 * All of it is here because the module contract refuses raw SQL outside
 * `server/repos`, and because one file holding every read of a table is the
 * only way the privacy rule and the file sweep can be shown to agree about
 * which files are live.
 *
 * camelCase at the interface, snake_case in the table, the same shape
 * `server/repos/placePhotos.ts` uses.
 *
 * ── NOTHING HERE JOINS `users` OR `player_characters` ────────────────────
 *
 * `server/db/collation.ts` records what those joins cost: 0069 pinned a charset
 * on `player_characters`, MySQL 8 read the character set's default collation
 * instead of the database's, and the join died on every deployment whose
 * default was not utf8mb4_0900_ai_ci. Portraits are read by user id and merged
 * with the party in TypeScript, keyed on the archetype key, so this feature
 * cannot be on the wrong side of that boundary whatever a fork's default is.
 */
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import {
  MOON_GRANT_CEILING,
  SETUP_GRANTS,
  spendOne,
  type GrantCounters,
  type PortraitSource,
} from "../../shared/characterPortraits";

const toIso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * One member's portrait for one class, as the row holds it.
 *
 * `fileName` and `candidateFileName` are FILENAMES and never addresses. The
 * caller builds the address, which is the half that keeps a stored string from
 * ever being something a browser follows on its own.
 */
export interface PortraitRow {
  id: string;
  archetypeKey: string;
  fileName: string | null;
  candidateFileName: string | null;
  candidateAt: string | null;
  source: PortraitSource;
  publishedAt: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  updatedAt: string | null;
}

const COLUMNS =
  "`id`, `archetype_key`, `file_name`, `candidate_file_name`, `candidate_at`, " +
  "`source`, `published_at`, `width`, `height`, `bytes`, `updated_at`";

function rowToPortrait(r: any): PortraitRow {
  return {
    id: String(r.id),
    archetypeKey: String(r.archetype_key),
    fileName: r.file_name ? String(r.file_name) : null,
    candidateFileName: r.candidate_file_name ? String(r.candidate_file_name) : null,
    candidateAt: toIso(r.candidate_at),
    // The column is an enum, so anything else means a hand-edited row. An
    // upload is the honest fallback: it is the source that costs nothing and
    // claims nothing about a provider having run.
    source: (String(r.source) === "forged" ? "forged" : "uploaded") as PortraitSource,
    publishedAt: toIso(r.published_at),
    width: num(r.width),
    height: num(r.height),
    bytes: num(r.bytes),
    updatedAt: toIso(r.updated_at),
  };
}

/**
 * Every portrait one member holds, whatever its state.
 *
 * THIS FUNCTION HAS NO PRIVACY OPINION AND MUST NOT GROW ONE. It answers for
 * an owner. The published-only read below is a separate function with a
 * separate name, so a caller has to say which one it wants and cannot get the
 * private set by forgetting an argument. See `server/lib/characterPortraits.ts`
 * for where the two are chosen between.
 */
export async function portraitsOwnedBy(
  pool: Pool,
  villageId: string,
  userId: string,
): Promise<PortraitRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`character_portraits\` ` +
      "WHERE `village_id` = ? AND `user_id` = ? ORDER BY `archetype_key`",
    [villageId, userId],
  );
  return rows.map(rowToPortrait);
}

/**
 * Only what this member has published, and only rows that actually hold a
 * picture.
 *
 * `published_at IS NOT NULL` is the whole visibility rule and it is enforced in
 * SQL, so a stranger's payload cannot carry an unpublished filename even by
 * accident: the bytes never leave the database. A filter applied after the read
 * would put the private filename in the process's memory next to the response
 * it is building, one spread operator away from shipping.
 *
 * `file_name IS NOT NULL` is here too, so a row holding only an unaccepted
 * candidate reads as no portrait at all.
 */
export async function publishedPortraitsOf(
  pool: Pool,
  villageId: string,
  userId: string,
): Promise<PortraitRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`character_portraits\` ` +
      "WHERE `village_id` = ? AND `user_id` = ? AND `published_at` IS NOT NULL " +
      "AND `file_name` IS NOT NULL ORDER BY `archetype_key`",
    [villageId, userId],
  );
  return rows.map(rowToPortrait);
}

/** One member's portrait for one class, in any state. Null when there is none. */
export async function portraitFor(
  pool: Pool,
  villageId: string,
  userId: string,
  archetypeKey: string,
): Promise<PortraitRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`character_portraits\` ` +
      "WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ? LIMIT 1",
    [villageId, userId, archetypeKey],
  );
  return rows[0] ? rowToPortrait(rows[0]) : null;
}

export interface NewPortrait {
  id: string;
  villageId: string;
  userId: string;
  archetypeKey: string;
  fileName: string;
  source: PortraitSource;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

/**
 * Store an uploaded portrait, replacing whatever that class held.
 *
 * ON DUPLICATE KEY against `character_portraits_one_per_class`, so a second
 * upload for the same class updates the one row instead of failing or growing
 * a second. Every column the insert sets is named, because a DEFAULT is not a
 * substitute for saying what is being written.
 *
 * `published_at` IS NOT TOUCHED HERE, in either half of the statement, and that
 * is the load-bearing omission. On an insert it takes the schema's NULL, so a
 * new portrait is private. On a replacement it keeps whatever the member had
 * already chosen, so somebody swapping the picture on a portrait they had
 * published does not silently un-publish it, and somebody swapping a private
 * one does not silently publish it. Neither direction is a surprise.
 *
 * The candidate columns ARE cleared: an upload is the member deciding, and a
 * forged candidate they never accepted has been answered by that decision.
 * The caller unlinks the file it returns.
 */
export async function upsertPortrait(pool: Pool, row: NewPortrait): Promise<void> {
  await pool.query(
    "INSERT INTO `character_portraits` " +
      "(`id`, `village_id`, `user_id`, `archetype_key`, `file_name`, `candidate_file_name`, " +
      "`candidate_at`, `source`, `width`, `height`, `bytes`) " +
      "VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `file_name` = VALUES(`file_name`), `source` = VALUES(`source`), " +
      "`width` = VALUES(`width`), `height` = VALUES(`height`), `bytes` = VALUES(`bytes`), " +
      "`candidate_file_name` = NULL, `candidate_at` = NULL",
    [
      row.id, row.villageId, row.userId, row.archetypeKey, row.fileName,
      row.source, row.width, row.height, row.bytes,
    ],
  );
}

/**
 * Park a forged candidate on the row without touching the live portrait.
 *
 * The member has not said yes yet, so `file_name`, `source` and `published_at`
 * all stay exactly as they were. A discard is then one UPDATE clearing two
 * columns, and it cannot disturb a picture somebody is already showing.
 */
export async function stageCandidate(
  pool: Pool,
  row: { id: string; villageId: string; userId: string; archetypeKey: string; fileName: string },
): Promise<void> {
  await pool.query(
    "INSERT INTO `character_portraits` " +
      "(`id`, `village_id`, `user_id`, `archetype_key`, `file_name`, `candidate_file_name`, " +
      "`candidate_at`, `source`, `width`, `height`, `bytes`) " +
      "VALUES (?,?,?,?,NULL,?,CURRENT_TIMESTAMP,'uploaded',NULL,NULL,NULL) " +
      "ON DUPLICATE KEY UPDATE `candidate_file_name` = VALUES(`candidate_file_name`), " +
      "`candidate_at` = CURRENT_TIMESTAMP",
    [row.id, row.villageId, row.userId, row.archetypeKey, row.fileName],
  );
}

/**
 * Accept the candidate: it becomes the portrait, and the row records that a
 * forge made it.
 *
 * One statement, and the WHERE clause is the guard: the row has to belong to
 * this member in this village and has to still hold a candidate. Two taps on
 * "Keep" therefore land once, and the second affects nothing.
 *
 * `published_at` is untouched for the same reason as `upsertPortrait`.
 */
export async function keepCandidate(
  pool: Pool,
  villageId: string,
  userId: string,
  archetypeKey: string,
  size: { width: number | null; height: number | null; bytes: number | null },
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE `character_portraits` SET `file_name` = `candidate_file_name`, `source` = 'forged', " +
      "`width` = ?, `height` = ?, `bytes` = ?, `candidate_file_name` = NULL, `candidate_at` = NULL " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ? AND `candidate_file_name` IS NOT NULL",
    [size.width, size.height, size.bytes, villageId, userId, archetypeKey],
  );
  return r.affectedRows > 0;
}

/** Drop the candidate. The grant it cost stays spent, which is the whole rule. */
export async function clearCandidate(
  pool: Pool,
  villageId: string,
  userId: string,
  archetypeKey: string,
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE `character_portraits` SET `candidate_file_name` = NULL, `candidate_at` = NULL " +
      "WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ? AND `candidate_file_name` IS NOT NULL",
    [villageId, userId, archetypeKey],
  );
  return r.affectedRows > 0;
}

/**
 * Publish or withdraw one portrait.
 *
 * `file_name IS NOT NULL` in the WHERE clause, so a row holding only a
 * candidate cannot be published into visibility. Withdrawing has no such
 * condition, because taking something back must always be allowed to work.
 */
export async function setPublished(
  pool: Pool,
  villageId: string,
  userId: string,
  archetypeKey: string,
  published: boolean,
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    published
      ? "UPDATE `character_portraits` SET `published_at` = CURRENT_TIMESTAMP " +
          "WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ? AND `file_name` IS NOT NULL"
      : "UPDATE `character_portraits` SET `published_at` = NULL " +
          "WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ?",
    [villageId, userId, archetypeKey],
  );
  return r.affectedRows > 0;
}

/**
 * Remove a member's portrait for one class entirely.
 *
 * Returns the filenames the row held so the caller can unlink them. The row
 * goes, because there is no tombstone worth keeping: nobody reports a portrait
 * that only its owner could ever see.
 */
export async function deletePortrait(
  pool: Pool,
  villageId: string,
  userId: string,
  archetypeKey: string,
): Promise<string[]> {
  const existing = await portraitFor(pool, villageId, userId, archetypeKey);
  if (!existing) return [];
  await pool.query(
    "DELETE FROM `character_portraits` WHERE `village_id` = ? AND `user_id` = ? AND `archetype_key` = ?",
    [villageId, userId, archetypeKey],
  );
  return [existing.fileName, existing.candidateFileName].filter((f): f is string => !!f);
}

/**
 * Every filename any portrait row still points at.
 *
 * The uploads sweep asks this before unlinking anything on the volume, the same
 * belt `placePhotos.liveFilenames` provides. Candidates are included: a picture
 * a member has not decided on yet is still a file somebody is about to look at.
 */
export async function livePortraitFiles(pool: Pool): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `file_name`, `candidate_file_name` FROM `character_portraits`",
  );
  const out = new Set<string>();
  for (const r of rows) {
    for (const v of [r.file_name, r.candidate_file_name]) {
      const s = v == null ? "" : String(v);
      if (s) out.add(s.slice(s.lastIndexOf("/") + 1));
    }
  }
  return out;
}

// ── The budget ─────────────────────────────────────────────────────────────

/**
 * This member's counters, creating the row on first sight.
 *
 * The INSERT IGNORE is the profile-setup grant: the row is born holding
 * SETUP_GRANTS and it is born exactly once, so a member who never saw the new
 * setup flow still gets their three the first time they open the studio. Every
 * column is named, and the two that decide the whole budget are passed as
 * parameters from `shared/characterPortraits.ts` rather than left to the
 * column DEFAULT, so the schema and the constant cannot drift apart in silence.
 */
export async function loadCounters(pool: Pool, villageId: string, userId: string): Promise<GrantCounters> {
  await pool.query(
    "INSERT IGNORE INTO `portrait_grants` " +
      "(`village_id`, `user_id`, `setup_remaining`, `moon_remaining`, `moon_cycle`, `spent`) " +
      "VALUES (?,?,?,?,NULL,0)",
    [villageId, userId, SETUP_GRANTS, 0],
  );
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `setup_remaining`, `moon_remaining`, `moon_cycle`, `spent` FROM `portrait_grants` " +
      "WHERE `village_id` = ? AND `user_id` = ? LIMIT 1",
    [villageId, userId],
  );
  const r = rows[0];
  return {
    setupRemaining: Number(r?.setup_remaining ?? SETUP_GRANTS),
    moonRemaining: Number(r?.moon_remaining ?? 0),
    moonCycle: r?.moon_cycle == null ? null : Number(r.moon_cycle),
    spent: Number(r?.spent ?? 0),
  };
}

/**
 * Write an accrual, and only when the lunation really has advanced.
 *
 * `moon_cycle < ?` in the WHERE clause is what makes this safe under more than
 * one process: two readers that both compute the same accrual apply it once,
 * because the second one's condition is already false. `IS NULL` is the other
 * half, for the first read of a member's life.
 *
 * The value written is the CEILING-CLAMPED one the caller computed, so the cap
 * is applied to the number that lands in the column and never merely to the
 * number that was displayed.
 */
export async function applyAccrual(
  pool: Pool,
  villageId: string,
  userId: string,
  moonRemaining: number,
  moonCycle: number,
): Promise<boolean> {
  const [r] = await pool.query<ResultSetHeader>(
    "UPDATE `portrait_grants` SET `moon_remaining` = ?, `moon_cycle` = ? " +
      "WHERE `village_id` = ? AND `user_id` = ? AND (`moon_cycle` IS NULL OR `moon_cycle` < ?)",
    [Math.min(MOON_GRANT_CEILING, Math.max(0, moonRemaining)), moonCycle, villageId, userId, moonCycle],
  );
  return r.affectedRows > 0;
}

/**
 * Take one grant, and say whether there was one to take.
 *
 * ── A ROW LOCK, AND THE ONE-STATEMENT VERSION THAT WAS WRONG ────────────
 *
 * The first version of this was a single UPDATE that chose the counter to
 * decrement inside two CASE expressions:
 *
 *   SET moon_remaining  = CASE WHEN moon_remaining > 0 THEN moon_remaining - 1 ... END,
 *       setup_remaining = CASE WHEN moon_remaining > 0 THEN setup_remaining ... END
 *
 * MySQL evaluates the assignments in a single-table UPDATE LEFT TO RIGHT, and
 * a later assignment sees the value an earlier one has ALREADY WRITTEN. So on a
 * member holding exactly one moon grant, the first clause set `moon_remaining`
 * to 0, and the second clause then read that fresh 0, took the ELSE branch, and
 * decremented the setup half as well. One press, two gifts gone.
 *
 * It is worth recording how close that came to shipping. It passed
 * `pnpm check`, passed all thirty gates, and passed the test written beside it,
 * because that test set the moon half to TWO. At two the first clause leaves a
 * 1 behind, the second clause reads the 1, and the bug is invisible. The
 * measurement and the code were written by the same hand in the same hour and
 * shared the same blind spot. The test below now spends from a moon half of
 * exactly ONE, which is the only value that shows it.
 *
 * So the rule is not restated in SQL at all any more. The row is locked, the
 * decision is made by `spendOne` in `shared/characterPortraits.ts`, which is
 * the same function the pure tests exercise, and the UPDATE writes literal
 * numbers with no expression in it to get an order wrong.
 *
 * SELECT ... FOR UPDATE is what makes it safe when two forge requests arrive
 * together: the second waits for the first to commit and then reads the
 * decremented row, so one grant buys one picture. A forge is a once-in-a-moon
 * action, so a transaction here costs nothing anybody can perceive.
 */
export async function spendGrant(pool: Pool, villageId: string, userId: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT `setup_remaining`, `moon_remaining`, `moon_cycle`, `spent` FROM `portrait_grants` " +
        "WHERE `village_id` = ? AND `user_id` = ? FOR UPDATE",
      [villageId, userId],
    );
    const held = rows[0];
    if (!held) {
      await conn.rollback();
      return false;
    }
    const after = spendOne({
      setupRemaining: Number(held.setup_remaining ?? 0),
      moonRemaining: Number(held.moon_remaining ?? 0),
      moonCycle: held.moon_cycle == null ? null : Number(held.moon_cycle),
      spent: Number(held.spent ?? 0),
    });
    if (!after) {
      await conn.rollback();
      return false;
    }
    await conn.query(
      "UPDATE `portrait_grants` SET `setup_remaining` = ?, `moon_remaining` = ?, `spent` = ? " +
        "WHERE `village_id` = ? AND `user_id` = ?",
      [after.setupRemaining, after.moonRemaining, after.spent, villageId, userId],
    );
    await conn.commit();
    return true;
  } catch {
    try {
      await conn.rollback();
    } catch {
      /* already gone */
    }
    return false;
  } finally {
    conn.release();
  }
}

/**
 * Put a grant back, for the one case that is not a spend: the forge could not
 * run at all.
 *
 * A DISCARD IS NOT THIS. A member who saw a picture and said no has spent their
 * grant, and that is stated before they commit. This is for a provider that was
 * absent or that failed, where nothing was ever generated and the member has
 * seen nothing. Charging for that would be charging for our own outage.
 *
 * It returns to the SETUP half, which is deliberate and slightly generous: the
 * setup half has no ceiling, so a refund can never evaporate against one. A
 * refund into the moon half of a member sitting at three would vanish.
 */
export async function refundGrant(pool: Pool, villageId: string, userId: string): Promise<void> {
  await pool.query(
    "UPDATE `portrait_grants` SET `setup_remaining` = `setup_remaining` + 1, " +
      "`spent` = CASE WHEN `spent` > 0 THEN `spent` - 1 ELSE 0 END " +
      "WHERE `village_id` = ? AND `user_id` = ?",
    [villageId, userId],
  );
}
