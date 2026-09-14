/**
 * The objections table: every statement that touches it, in one file.
 *
 * ── WHY THIS TABLE IN PARTICULAR ───────────────────────────────────────────
 *
 * `server/lib/objectionLineageShape.test.ts` already polices this table across
 * the whole server tree, and it does so by parsing every `.query(...)` call it
 * can find and REFUSING to pass when it meets a mention it cannot place inside
 * one. That guard exists because an objection is one member's contribution to
 * one decision, and the afternoon somebody groups these rows by member it
 * becomes a score against a person. The guard is tree-wide and stays tree-wide;
 * what it could not give anybody was a place to LOOK. Six statements lived in
 * `server/lib/ballots.ts` between the vote path, the objection path and the
 * ruling path, and answering "what can happen to an objection row" meant
 * reading a 1300-line file to find them.
 *
 * So this file is the enumerable home the guard was always assuming. The rule
 * it inherits is the guard's own and it is worth restating where a later reader
 * will hit it: in `server/**`, the table's name belongs in a COMMENT or inside
 * a query call and nowhere else. A `const TABLE = ...` here would fail that
 * test, correctly, so every statement below carries its SQL inline.
 *
 * ── THE INVERSION THAT MUST NOT BE HELPFULLY FIXED ─────────────────────────
 *
 * `standingObjectionCount` counts `open` AND `integrated` as blocking.
 * `integrated` means the objection STANDS and the proposal has to change,
 * which is the inverse of the everyday reading of the word, and the next
 * person to read it will see "integrated" as "resolved" and take it out of the
 * set. Consent would then carry decisions the village had objected to. There is
 * a source-level pin on that exact string in `objectionLineageShape.test.ts`
 * and a behavioural one in `objectionLineage.test.ts`; the pin follows this
 * file now, which is why it names this path.
 *
 * ── WHAT DELIBERATELY DID NOT MOVE ─────────────────────────────────────────
 *
 * The POLICY. Which rulings exist, that a ruling carries a note, that an
 * objection carries its reasoning, that objections come from a consent
 * ballot's own electorate: all of that stayed in `server/lib/ballots.ts`
 * beside the sentences a member reads when it refuses them. `ruleOpenObjection`
 * below hands back a row count and holds no opinion about what zero means,
 * because "already ruled, or does not exist" is a sentence and not a fact
 * about a table.
 *
 * The LINEAGE statements in `server/index.ts` did not move either, and they are
 * named here so this list is not silently read as complete: `led_to_ballot_id`
 * is written and read there, always joined to `ballots`, and moving half a
 * two-table statement into a one-table repo would leave a caller assembling an
 * answer from two modules with nothing saying the halves agree. The shape test
 * sees them wherever they live, which is the property that actually matters.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ObjectionRuling } from "../lib/ballots";

/**
 * A timestamp as this file's callers have always read it.
 *
 * Copied from `server/lib/ballots.ts` rather than imported, because importing a
 * value from the lib would make the type-only dependency above a runtime one
 * and put a cycle between the two modules. It is three tokens and the shape of
 * the answer is the thing worth keeping identical: a `Date` becomes an ISO
 * instant and anything else is handed on as its own string, unguessed.
 */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/** One objection, as the decision page and the ruling route already read it. */
export interface BallotObjectionRow {
  id: string;
  userId: string;
  text: string;
  /** `open` until somebody rules; then whichever ruling they gave. */
  status: "open" | ObjectionRuling;
  ruledBy: string | null;
  ruledAt: string | null;
  rulingNote: string | null;
  createdAt: string;
}

/**
 * How many objections stand between this ballot and passing.
 *
 * `open` is the unruled and `integrated` is the upheld, and BOTH block. See the
 * header: `integrated` means the proposal must change, so the ballot closes as
 * failed and the subject goes back to staging for a fresh one. A concern is
 * recorded and does not block; a withdrawal is a retraction.
 *
 * It counts rows and names no member, which is the one arithmetic this table is
 * never allowed to do the other way round.
 */
export async function standingObjectionCount(pool: Pool, ballotId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>(
    "SELECT COUNT(*) AS n FROM ballot_objections WHERE ballot_id = ? AND status IN ('open','integrated')",
    [ballotId],
  );
  return Number(row.n);
}

/**
 * The one open objection this member already has on this ballot, or null.
 *
 * `LIMIT 1` is the vote path's guarantee rather than a way of picking one of
 * several: casting `no` twice in consent mode updates the standing objection
 * instead of stacking a second, so at most one open row per (ballot, member)
 * ever comes from that path. Null means there is none, and the caller's next
 * move is to file one.
 */
export async function openObjectionIdFor(
  pool: Pool,
  ballotId: string,
  userId: string,
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ballot_objections WHERE ballot_id = ? AND user_id = ? AND status = 'open' LIMIT 1",
    [ballotId, userId],
  );
  return rows.length ? String(rows[0].id) : null;
}

/**
 * Replace the reasoning on an objection already on the record.
 *
 * Addressed by primary key and scoped to nothing else, because the caller has
 * just read the id out of `openObjectionIdFor` and the status it read it under
 * is the status it is acting on. The text arrives already trimmed and clipped:
 * the 2000-character bound lives with the sentence that explains it.
 */
export async function updateObjectionText(pool: Pool, objectionId: string, text: string): Promise<void> {
  await pool.query("UPDATE ballot_objections SET text = ? WHERE id = ?", [text, objectionId]);
}

/**
 * File a new objection, open.
 *
 * The id is minted by the caller, in the same shape the rest of the governance
 * engine mints ids, so this file holds no second opinion about what an id looks
 * like. `status` is written as the literal `open` rather than left to a column
 * default, because that is what the statement has always done and a default a
 * caller cannot see is a fact about the schema and not about the act.
 */
export async function insertObjection(
  pool: Pool,
  input: { id: string; ballotId: string; userId: string; text: string },
): Promise<void> {
  await pool.query(
    "INSERT INTO ballot_objections (id, ballot_id, user_id, text, status) VALUES (?,?,?,?,'open')",
    [input.id, input.ballotId, input.userId, input.text],
  );
}

/**
 * Rule an objection, and report how many rows that reached.
 *
 * `WHERE ... AND status = 'open'` is the guard, not a filter: only an unruled
 * objection takes a ruling, so ruling twice reaches nothing and two
 * facilitators pressing together cannot both succeed. Zero is therefore an
 * ordinary answer and this function says nothing about what it MEANS; the
 * caller owns that sentence, because "already ruled" and "no such objection"
 * are the same row count and only the caller has words for either.
 *
 * `ruled_at` is `NOW()`, the database's clock, which is what it has always
 * been. Every reader of this column renders it and none compares it against a
 * clock in this process, so there is nothing here for a zone to break.
 */
export async function ruleOpenObjection(
  pool: Pool,
  input: { objectionId: string; ruling: string; ruledBy: string; note: string },
): Promise<number> {
  const [result] = await pool.query<any>(
    "UPDATE ballot_objections SET status = ?, ruled_by = ?, ruled_at = NOW(), ruling_note = ? " +
      "WHERE id = ? AND status = 'open'",
    [input.ruling, input.ruledBy, input.note, input.objectionId],
  );
  return Number(result.affectedRows);
}

/**
 * Every objection on one ballot, oldest first.
 *
 * `SELECT *` and a narrower mapping, which is on purpose and is the shape the
 * lineage rule needs: `led_to_ballot_id` is on the row and is NOT read here,
 * so the decision page cannot render an edge it has no business rendering, and
 * the route that does serve the lineage asks for it by name and joins for the
 * successor's title. Naming the columns here instead would be an improvement to
 * the statement and a change to nothing else; it is left as it was.
 *
 * Ordered by `created_at` then `id`, so two objections filed in the same second
 * still come back in a stable order rather than in whatever order the primary
 * key happens to give.
 */
export async function objectionsForBallot(pool: Pool, ballotId: string): Promise<BallotObjectionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM ballot_objections WHERE ballot_id = ? ORDER BY created_at, id",
    [ballotId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    text: String(r.text),
    status: String(r.status) as "open" | ObjectionRuling,
    ruledBy: r.ruled_by ?? null,
    ruledAt: r.ruled_at ? iso(r.ruled_at) : null,
    rulingNote: r.ruling_note ?? null,
    createdAt: iso(r.created_at),
  }));
}
