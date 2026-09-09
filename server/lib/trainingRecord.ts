/**
 * THE TRAINING RECORD, WHICH THE SERVER OWNS.
 *
 * Rye, 2026-09-06, asked which kind of thing the training rung is: an
 * honour-system checkbox or a gate. "Make it a real gate the server owns."
 *
 * ── WHAT WAS WRONG, AND WHAT PART OF IT A SERVER CAN ACTUALLY FIX ──────────
 *
 * `POST /api/game/journey/sync` stored whatever list of ids a member sent, and
 * `trainingComplete` asked only whether every real module id was in that list.
 * The ids are public by design, so the whole exploit was one unauthenticated
 * request to read them and one authenticated request to post them back, and the
 * member crossed a stage.
 *
 * No server can know whether somebody read a document. A design claiming
 * otherwise would move the lie rather than remove it. What a server CAN own is
 * everything else, and the difference between the two lists is the whole fix:
 *
 *   the SET of modules that exist, so an invented id is refused;
 *   the INSTANT of each completion, stamped here and never accepted;
 *   ONE AT A TIME, so there is no bulk self-promotion in a single request;
 *   APPEND-ONLY, so no write can rewrite a member's history.
 *
 * A member still says "I have done this one", which is inherent to marking
 * anything as read. What they can no longer do is say it about all of them at
 * once, in a field they overwrite, with an id nobody checked.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/** A UTC instant in the shape MySQL DATETIME wants. Never the database's clock. */
const sqlInstant = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

/**
 * Record that a member completed one module. Idempotent.
 *
 * The caller has already checked the id names a real module; this refuses
 * nothing and knows nothing about the catalogue, so a change to what a module
 * IS cannot reach in here. `completed_at` is written from Node in UTC, like
 * every other instant in this codebase, and the first completion wins: marking
 * a module twice does not move the date on which it was first done.
 */
export async function recordCompletion(pool: Pool, userId: string, moduleId: string): Promise<void> {
  await pool.query( // module-review-ok: one table, one row, no cache above it; a repo here would be a repo of one statement
    "INSERT INTO training_completions (user_id, module_id, completed_at) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE user_id = user_id",
    [userId, moduleId, sqlInstant(new Date())],
  );
}

/** The module ids this member has completed, as the server recorded them. */
export async function completionsFor(pool: Pool, userId: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    "SELECT module_id FROM training_completions WHERE user_id = ? ORDER BY module_id",
    [userId],
  );
  return rows.map((r) => String(r.module_id));
}

/**
 * The same, for many members in one query.
 *
 * The players list computes a stage per member in a loop, and it already
 * batch-fetches the consented-quest count for exactly this reason. A per-member
 * query inside that loop would be the N+1 the existing code went out of its way
 * to avoid, so this exists before anybody is tempted.
 *
 * An empty list of ids returns an empty map without asking the database, which
 * matters because `IN ()` is a syntax error rather than an empty result.
 */
export async function completionsForMany(
  pool: Pool,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one table, no cache above it
    `SELECT user_id, module_id FROM training_completions WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
    [...userIds],
  );
  for (const r of rows) {
    const id = String(r.user_id);
    const list = out.get(id) ?? [];
    list.push(String(r.module_id));
    out.set(id, list);
  }
  return out;
}

/**
 * Has this member finished every module the village currently offers?
 *
 * PURE, and it takes both sets, because `computeStage` is pure and synchronous
 * on purpose: the callers that already hold their counts pay nothing extra, and
 * the one that loops over every member batch-fetches instead of querying inside
 * the loop.
 *
 * A village with NO modules answers false, which is the shape the old code had
 * and is worth keeping deliberately: "there is nothing to complete" must not
 * read as "everybody has completed everything", because that would hand the
 * rung to the whole village the moment an admin emptied the catalogue.
 */
export function trainingIsComplete(
  moduleIds: readonly string[],
  completed: readonly string[],
): boolean {
  if (moduleIds.length === 0) return false;
  const done = new Set(completed);
  return moduleIds.every((id) => done.has(id));
}

/**
 * THE OLD DOOR, REFUSED BY NAME.
 *
 * `POST /api/game/journey/sync` stores whatever list it is handed. That is
 * right for a journey that gates nothing and was a stage promotion for the one
 * that does, because `trainingComplete` asked only whether every real module id
 * appeared in it and the ids are public by design.
 *
 * The route keeps working for every other journey. Only `training` is refused,
 * and it is refused BY NAME with the door that replaced it: a silent drop would
 * leave an old client believing it had saved, which is a worse failure than a
 * loud one and is the shape this codebase keeps finding.
 */
export function serverOwnedJourneyRefusal(journeyId: unknown): { error: string; code: string } | null {
  if (String(journeyId) !== "training") return null;
  return {
    error:
      "Training progress is recorded by the server now, one module at a time. " +
      "POST /api/game/training/<moduleId>/complete instead.",
    code: "training_is_server_owned",
  };
}
