/**
 * The thing a prosperity creator creates (0157), and the dates that let a
 * ladder position be derived from it.
 *
 * ── PLATFORM, NOT A MODULE. SETTLED, NOT OBSERVED. ───────────────────────
 * The profile copy this replaces promised that venture details "arrive with
 * the prosperity module". There is no prosperity module, `shared/modules.ts`
 * is THE registry and none of its ids is this one, and Rye ruled on
 * 2026-09-04 that there will not be one. So this is a decision to build
 * against and not a gap somebody should feel invited to fill: a later session
 * finding "no prosperity module" in the registry is looking at the intended
 * state. The full argument for keeping it platform lives in the head of
 * drizzle/0157. The short form is
 * that all four paths are identity in `GAME_CONFIG.paths`, a non-core module
 * ships OFF so one path would go missing on a profile that promises four, and
 * `profiles` is core and cannot be disabled, which makes it the right owner.
 *
 * ── DATES, NEVER A STAGE COLUMN ──────────────────────────────────────────
 * The obvious shape here is `stage: idea | trading | established`, and the
 * schema refuses it. A stored position has to be maintained, it outlives the
 * fact that justified it, and a stale one is indistinguishable from a true
 * one. So three dates carry the whole story and a position is computed from
 * which of them are set:
 *
 *   opened_at   never null. A venture that has not started is not a venture.
 *   listed_at   null until it is published to the village. Publishing is a
 *               separate act from opening, so it gets its own date.
 *   closed_at   null while it runs. This is the column a rung falls on.
 *
 * That is the same discipline `computeStage` uses for the Path of Growth,
 * which reads quests, membership and training on every call and stores no
 * stage anywhere.
 *
 * History survives a close because the row does, carrying its dates and its
 * reason. That is why there is no separate crossing-event table beside this
 * one: the interval columns already hold what such a log would hold, and a
 * log would have to write down a rung.
 *
 * ── NO MONEY ─────────────────────────────────────────────────────────────
 * No revenue, no valuation, no figure about what a venture is worth. Those
 * belong to whatever system actually holds them, and a member-editable number
 * about value rendered on a profile is a claim the platform cannot stand
 * behind. Same reasoning as server/repos/investorPath.ts, one domain over.
 *
 * ── EVERY MUTATION IS SCOPED TO THE OWNER ────────────────────────────────
 * The write functions all take a user id and put it in the WHERE clause, so
 * an id guessed or copied from somewhere else matches no row and answers
 * false. Ownership is settled in the statement, never by a check the caller
 * is trusted to have made first.
 */
import { randomUUID } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

/** Single-village build, matching server/lib/housing.ts. */
const VILLAGE = "local";

export interface VentureRow {
  id: string;
  userId: string;
  name: string;
  summary: string | null;
  kind: string | null;
  link: string | null;
  openedAt: string;
  /** Null means the village has not been told about it. */
  listedAt: string | null;
  /** Null means it is running. This is what makes a rung fall. */
  closedAt: string | null;
  closedReason: string | null;
  isExample: boolean;
}

const COLUMNS =
  "id, user_id, name, summary, kind, link, opened_at, listed_at, closed_at, closed_reason, is_example";

const toRow = (r: RowDataPacket): VentureRow => ({
  id: String(r.id),
  userId: String(r.user_id),
  name: String(r.name),
  summary: r.summary == null ? null : String(r.summary),
  kind: r.kind == null ? null : String(r.kind),
  link: r.link == null ? null : String(r.link),
  openedAt: String(r.opened_at),
  listedAt: r.listed_at == null ? null : String(r.listed_at),
  closedAt: r.closed_at == null ? null : String(r.closed_at),
  closedReason: r.closed_reason == null ? null : String(r.closed_reason),
  isExample: Number(r.is_example) === 1,
});

export interface OpenVentureInput {
  userId: string;
  name: string;
  summary?: string | null;
  kind?: string | null;
  link?: string | null;
  /** Publish to the village in the same act. Defaults to keeping it private. */
  listed?: boolean;
}

/**
 * Open a venture.
 *
 * `fresh: false` means this member already runs a live venture under that
 * name and nothing was written. The unique key on (village_id,
 * active_venture_key) decides it in the database, so a double-pressed button
 * cannot list the same venture twice. The key goes NULL when a venture
 * closes, so the same name may be opened again later without colliding with
 * the member's own history.
 *
 * ON A DUPLICATE IT RETURNS THE ID OF THE VENTURE THAT IS ACTUALLY OPEN, one
 * extra SELECT and worth it: the id of a failed INSERT names no row, and a
 * caller that linked to it would point at nothing with nothing reporting it.
 *
 * Twelve hex characters of id, the reason server/lib/notify.ts gives: a
 * PRIMARY key collision would arrive as the same ER_DUP_ENTRY the catch reads
 * as "already open", so a short id would drop real rows as clean dedupes.
 */
export async function openVenture(
  pool: Pool,
  input: OpenVentureInput,
): Promise<{ id: string; fresh: boolean }> {
  const id = `ven-${randomUUID().slice(0, 12)}`;
  try {
    await pool.query(
      "INSERT INTO member_ventures (id, village_id, user_id, name, summary, kind, link, listed_at) " +
        "VALUES (?,?,?,?,?,?,?,?)",
      [
        id,
        VILLAGE,
        input.userId,
        input.name,
        input.summary ?? null,
        input.kind ?? null,
        input.link ?? null,
        input.listed ? new Date() : null,
      ],
    );
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM member_ventures " +
        "WHERE village_id = ? AND user_id = ? AND name = ? AND closed_at IS NULL LIMIT 1",
      [VILLAGE, input.userId, input.name],
    );
    const open = rows[0];
    // Finding no open row means this was NOT the ordinary already-open case:
    // either the clash was on the PRIMARY key (the id collision notify.ts
    // warns about) or the venture closed between the INSERT failing and this
    // SELECT. Raising covers both, because swallowing either would drop a
    // real venture while reporting a clean dedupe.
    if (!open) throw e;
    return { id: String(open.id), fresh: false };
  }
  return { id, fresh: true };
}

/**
 * Publish a venture to the village, or take it back down.
 *
 * Both directions exist because a ladder that can rise on `listed_at` has to
 * be able to fall on it too, and unlisting is the member's own act. Scoped to
 * a LIVE venture: a closed one is history and is not republished by a stray
 * press.
 */
export async function setVentureListed(
  pool: Pool,
  id: string,
  userId: string,
  listed: boolean,
): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE member_ventures SET listed_at = ? " +
      "WHERE id = ? AND village_id = ? AND user_id = ? AND closed_at IS NULL",
    [listed ? new Date() : null, id, VILLAGE, userId],
  );
  return (r?.affectedRows ?? 0) > 0;
}

/**
 * Close a venture. Nothing is deleted: the row keeps its dates and its
 * reason, so the member's history survives the position falling.
 *
 * `closed_at IS NULL` in the WHERE makes closing twice a no-op that answers
 * false, so the caller can tell a real close from a repeat and only write to
 * a human on the first one.
 */
export async function closeVenture(
  pool: Pool,
  id: string,
  userId: string,
  reason?: string | null,
): Promise<boolean> {
  const [r]: any = await pool.query(
    "UPDATE member_ventures SET closed_at = CURRENT_TIMESTAMP, closed_reason = ? " +
      "WHERE id = ? AND village_id = ? AND user_id = ? AND closed_at IS NULL",
    [reason ?? null, id, VILLAGE, userId],
  );
  return (r?.affectedRows ?? 0) > 0;
}

/**
 * One member's ventures. Live ones only by default, because that is what a
 * ladder reads; `includeClosed` gets the history.
 *
 * Example rows are excluded unless asked for, and a ladder never counts them:
 * a village seeding a standing example must not promote a real member on it.
 */
export async function venturesForMember(
  pool: Pool,
  userId: string,
  opts: { includeClosed?: boolean; includeExamples?: boolean } = {},
): Promise<VentureRow[]> {
  const where = ["village_id = ?", "user_id = ?"];
  if (!opts.includeClosed) where.push("closed_at IS NULL");
  if (!opts.includeExamples) where.push("is_example = 0");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM member_ventures WHERE ${where.join(" AND ")} ` +
      "ORDER BY opened_at DESC, id",
    [VILLAGE, userId],
  );
  return rows.map(toRow);
}

/**
 * What the village can see: every live venture that has been published,
 * newest listing first. Capped the way listReservations is capped.
 *
 * EXAMPLES ARE INCLUDED HERE ON PURPOSE, which is the opposite of what
 * `venturesForMember` does, so the difference is worth stating. A standing
 * example exists to fill a display surface in a village that has no real
 * rows yet, and this is a display surface. A LADDER is not, which is why the
 * per-member read excludes them: an example must never move a real member's
 * position. Every row carries `isExample`, so a caller that needs the other
 * behaviour can tell without a second query.
 */
export async function listedVentures(pool: Pool, limit = 200): Promise<VentureRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM member_ventures ` +
      "WHERE village_id = ? AND listed_at IS NOT NULL AND closed_at IS NULL " +
      "ORDER BY listed_at DESC, id LIMIT ?",
    [VILLAGE, Math.min(500, Math.max(1, limit))],
  );
  return rows.map(toRow);
}
