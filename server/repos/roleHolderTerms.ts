/**
 * `role_holder_terms`: every term a seat has ever held, append-only.
 *
 * ── WHY THE TABLE EXISTS IS ARGUED IN THE MIGRATION, NOT HERE ───────────────
 *
 * Migration 0176 argues it at length and repeating that here would give the
 * repository two versions of one argument that drift apart. The short of it:
 * `role_holders` carries UNIQUE (role_id, user_id) from 0002, so it can hold
 * the CURRENT term and no other. Seat somebody, let the term lapse, seat them
 * again next season, and the second seating overwrites the first with nothing
 * left to read. This table is where the first one survives.
 *
 * What belongs in THIS header is the half the burn-down rule cares about, and
 * for this table it is not bookkeeping.
 *
 * ── THIS TABLE IS THE RECORD, NOT THE AUTHORITY ─────────────────────────────
 *
 * Nothing here is read by the capability gate, and that has to stay true.
 * `roleCapabilitiesFor` reads `role_holders` and `holdingHasLapsed`, which is
 * the permission plane, and a permission plane with two sources of truth is
 * the defect this whole build exists to remove. 0176 says it in its own words
 * and it is repeated here because THIS is the file a future reader will be
 * sitting in when they think of adding a gate read: the temptation is real,
 * because this table has the nicer history, and the answer is no.
 *
 * The enumerability that buys is worth naming. The term is the only backstop
 * on a seat that can veto a decision the village already carried, and a
 * backstop nobody can audit is not a backstop. "Which code decides when a
 * mandate ended" has to be a question somebody answers by opening one file.
 * Today the whole answer is this file plus `server/lib/stewardship.ts`.
 *
 * ── AN OPEN TERM IS THE ONE WITH NO `ended_at`, AND THAT IS A RULE ──────────
 *
 * Not "the newest", not "the one whose `term_ends_at` is in the future". A
 * term that reached its date and has not been closed is still OPEN here, and
 * that is deliberate: `role_holders` decides whether the POWERS are live, and
 * this table records when somebody actually wrote the mandate down as finished.
 * The two are different facts and a village reads them a year apart.
 *
 * That is also what makes `recordTermStarted` idempotent: a retried close
 * finds the term it already opened and writes nothing, rather than growing a
 * second row for one mandate.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ──────────────────────────────────────────
 *
 * Nothing to invalidate; every read below goes to the database when it is
 * asked. Worth stating rather than inferring, because the other half of the
 * burn-down rule is about caches and the two sibling tables in this lane
 * (`roles` and `role_holders`) both have one. This one does not, precisely
 * because it is not the authority.
 *
 * ── TIMESTAMPS ──────────────────────────────────────────────────────────────
 *
 * The four instants come back as ISO strings, unlike the sibling repos, and
 * the difference is not an inconsistency. `TermRow` is a rendered shape: every
 * field on it goes to a surface that prints a history, and nothing derives a
 * decision from it. `server/repos/permissionHoldings.ts` hands its timestamps
 * over raw because a lapse verdict is computed from them, and one interpreter
 * has to own that.
 *
 * ── INDEXES ─────────────────────────────────────────────────────────────────
 *
 * `role_holder_terms_seat_idx (role_id, user_id, term_started_at)` from 0176
 * covers both reads below, filter and leading sort key. The UPDATE is by
 * primary key.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { TermRow } from "../lib/stewardship";

/** Every column on the table. Both reads take all of them; `TermRow` is one shape. */
const COLUMNS = "id, role_id, user_id, term_started_at, term_ends_at, season_id, ended_at, ended_by";

/**
 * A timestamp as an ISO instant, or null.
 *
 * mysql2 runs with `timezone: "Z"` and no `dateStrings`, so a `timestamp`
 * column normally arrives as a Date already read as UTC. `String(v)` is the
 * fallback for a connection configured otherwise; it hands the value on
 * unchanged rather than guessing at a zone.
 */
const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * One term, mapped to the shape the history surface reads.
 *
 * `termStartedAt` falls back to the empty string and the other three stay
 * nullable, which mirrors the columns: `term_started_at` is NOT NULL with a
 * default, so a row that exists always has one, while a null `term_ends_at`
 * means a holding written before 0176 and a null `ended_at` means the term is
 * still running. Those nulls are answers and must not be flattened.
 *
 * `ended_by` stays null-preserved for the distinction the whole table is for:
 * null means the DATE ended the term and nobody did, and an id means somebody
 * cut it short. The two must never render alike.
 */
function toTermRow(r: RowDataPacket): TermRow {
  return {
    id: String(r.id),
    roleId: String(r.role_id),
    userId: String(r.user_id),
    termStartedAt: iso(r.term_started_at) ?? "",
    termEndsAt: iso(r.term_ends_at),
    seasonId: r.season_id === null || r.season_id === undefined ? null : String(r.season_id),
    endedAt: iso(r.ended_at),
    endedBy: r.ended_by === null || r.ended_by === undefined ? null : String(r.ended_by),
  };
}

/**
 * Open one term. Append-only: this never closes or moves another row.
 *
 * No `ON DUPLICATE KEY` clause and none is wanted. The primary key is a minted
 * id, so a duplicate is impossible by construction, and the idempotence that
 * matters — one row per mandate rather than one per attempt — comes from the
 * caller asking `openTermRow` first. Putting that check in SQL would need a
 * unique key this table deliberately does not have: the same seat legitimately
 * holds many terms over the years, which is the entire reason the table exists.
 *
 * The id is minted by the caller, the way `server/repos/subjectRefs.ts` leaves
 * the mint with the lib that owns what an id looks like.
 *
 * `startedAt` and `termEndsAt` are Dates and never ISO strings: MySQL refuses
 * `2026-12-01T00:00:00.000Z` for a `timestamp` column outright. The types here
 * are what stop that recurring; it once made every seating throw.
 */
export async function insertTerm(
  pool: Pool,
  input: {
    id: string;
    roleId: string;
    userId: string;
    startedAt: Date;
    termEndsAt: Date | null;
    seasonId: string | null;
  },
): Promise<void> {
  await pool.query(
    "INSERT INTO role_holder_terms (id, role_id, user_id, term_started_at, term_ends_at, season_id) VALUES (?,?,?,?,?,?)",
    [input.id, input.roleId, input.userId, input.startedAt, input.termEndsAt, input.seasonId],
  );
}

/**
 * The term on this seat that has not been closed, or null.
 *
 * Newest first, so a table that somehow holds two open rows for one seat hands
 * back the current one rather than the oldest. That is a defence and not a
 * design: `recordTermStarted` is what keeps there being only one, and if it
 * ever fails the honest failure is a duplicate row somebody can see, not a
 * caller quietly reading a mandate from years ago as though it were live.
 * `id DESC` breaks a tie so two rows written in the same second cannot swap
 * places between reads.
 */
export async function openTermRow(pool: Pool, roleId: string, userId: string): Promise<TermRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM role_holder_terms WHERE role_id = ? AND user_id = ? AND ended_at IS NULL ` +
      "ORDER BY term_started_at DESC, id DESC",
    [roleId, userId],
  );
  return rows[0] ? toTermRow(rows[0]) : null;
}

/**
 * Every term this seat has ever held, oldest first.
 *
 * The opposite ordering to `openTermRow` and both are deliberate: this one is
 * a history a person reads top to bottom, and history runs forwards. Stated in
 * the statement rather than left to the table's physical order, which is not a
 * promise MySQL makes.
 *
 * Uncapped. A seat accumulates one row per mandate — a handful per decade —
 * and a cap here would silently shorten the record that exists to be complete.
 */
export async function termRowsFor(pool: Pool, roleId: string, userId: string): Promise<TermRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM role_holder_terms WHERE role_id = ? AND user_id = ? ORDER BY term_started_at, id`,
    [roleId, userId],
  );
  return rows.map(toTermRow);
}

/**
 * Close one term.
 *
 * `ended_at IS NULL` in the WHERE is the guard, not a filter: it makes closing
 * twice a no-op rather than a second write that moves the instant. A term's
 * end date is the fact a village reads a year later, and a retried job that
 * dragged it forward would quietly rewrite when somebody's mandate finished.
 *
 * `endedBy` null means the DATE ended it and nobody did; an id means a ballot
 * or a person cut it short. Both are written through here and the caller
 * decides which, because that distinction is a governance fact and not a
 * storage one.
 *
 * Reports nothing. The caller has already read the open term and knows whether
 * there was one to close; an UPDATE that matched nothing here means somebody
 * else closed it in between, and the answer to that is still "it is closed".
 */
export async function closeTerm(
  pool: Pool,
  termId: string,
  endedAt: Date,
  endedBy: string | null,
): Promise<void> {
  await pool.query("UPDATE role_holder_terms SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL", [
    endedAt,
    endedBy,
    termId,
  ]);
}
