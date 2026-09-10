/**
 * `ballots`, THE LANDING PLANE: every statement that reads or writes the
 * columns that decide when a carried decision happens and who stopped it.
 *
 * ── WHY A SECOND MODULE OVER ONE TABLE, AND WHY THAT IS NOT A SPLIT HOME ───
 *
 * `ballots` carries two column families that are written by two different
 * routines at two different moments, and only one of them is here.
 *
 *   THE VOTE: `opens_at`, `closes_at`, `method`, `weight_mode`, `unity_pct`,
 *   `quorum_pct`, `total_weight`, `electorate_count`, `status`, the document.
 *   Written when a ballot opens and frozen from then on. `server/lib/ballots.ts`
 *   owns those, calls itself the ballot tables' enumerable home in nine
 *   `module-review-ok:` lines, and is measured for the rest in the burn-down
 *   register. Nothing here touches them.
 *
 *   THE LANDING: `lands_at`, `veto_closes_at`, `landing_status`, `veto_locked`,
 *   `vetoed_at`, `vetoed_by`, `veto_reason`, `late_settled_at`,
 *   `late_settled_reason`, `stall_reopens`. Written AFTER the vote is over, by
 *   `server/lib/applyDue.ts` and by nothing else in the tree: thirteen of the
 *   fourteen `UPDATE ballots` statements outside the test files were in that
 *   one file, and every one of them moved here.
 *
 * The house already has two repo modules over one table where the concerns are
 * genuinely two: `server/repos/pathLadders.ts` and `server/repos/seatHoldings.ts`
 * both read `org_role_assignments`, each named for what it answers rather than
 * for the table it reads. This is that shape. The register's promise is that a
 * table's readers stay ENUMERABLE, and the way this file keeps that promise is
 * by naming, below, every writer of these columns that is not in it.
 *
 * ── THE TWO WRITERS OF THESE COLUMNS THAT ARE NOT HERE ─────────────────────
 *
 * Written down rather than left to be greped for, because an enumerable home
 * that is silently incomplete is worse than no home at all: a reader who finds
 * this file and believes it exhaustive stops looking.
 *
 *   - `server/lib/stewardship.ts` carries two `UPDATE ballots` statements on
 *     the veto columns (the steward's own record and the redaction door). It is
 *     a file another lane is burning down in this same wave and it owns the
 *     seat, the reason and the act; its statements did not move here because
 *     moving another lane's file from this one is how two lanes silently
 *     overwrite each other.
 *   - `server/lib/moonDigest.ts` reads `landing_status` and the veto columns to
 *     compose "what changed this moon". Reads only, and in the same wave.
 *
 * ── NO CACHE SITS ABOVE THIS TABLE ─────────────────────────────────────────
 *
 * Worth saying out loud, because the other half of the burn-down rule is about
 * caches staying correct and there is nothing here to invalidate. Every read
 * below goes to the database at the moment it is asked, which is what the
 * election in `claimDueRow` depends on: "read the status, then write it" loses
 * that race, and a cached status would lose it every time.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE ──────────────────────────
 *
 * Nothing below holds a policy. Every function is one statement, and the rules
 * they serve stayed in `server/lib/applyDue.ts` where they can be read beside
 * the sentences that argue them:
 *
 *   - WHEN a decision lands. `landingOf` computes it from the ballot's frozen
 *     `closes_at`; this module writes whatever instant it is handed.
 *   - WHETHER a veto is in time, whether the row is locked, whether an override
 *     stands. All of that is decided before `recordVetoOnBallot` is called, and
 *     the statement's own WHERE clause is the last guard rather than the rule.
 *   - HOW LONG a note or a reason may be. The callers clip with `.slice`, at the
 *     call site, where the column width is argued. A repo that clipped would own
 *     a second opinion about a limit it cannot see the schema for.
 *
 * ── THE CLIPPING IS THE CALLER'S AND THE ORDER IS THE CALLER'S ─────────────
 *
 * `dueBallotIds` and `expiryCandidates` both carry `ORDER BY lands_at ASC,
 * id ASC` in the statement rather than sorting after the read. That order is
 * the TOTAL ORDER the landing path's header states and calls the one thing a
 * later lane must not reorder: two servers reading the same table have to apply
 * the same rows in the same sequence, and a sort applied after the rows arrive
 * is a second copy of a rule that only reads correctly in one place.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { timingOf, type ProposalTiming } from "../../shared/governanceKinds";

/**
 * THE INSTANT FORMAT, AND WHY IT LIVES IN A REPO RATHER THAN BESIDE THE RULES.
 *
 * Whole-second UTC, from Node, written out as MySQL wants it. It moved here
 * with the statements that bind it, and the warning moved with it:
 *
 *   NEVER `NOW()`. Everything in the landing path stamps a UTC instant from
 *   Node; `NOW()` is the DATABASE server's local time. Mixing the two put
 *   `claimed_at` seven hours below the bound on a developer box at UTC-7, so
 *   the claim query always matched and the defect was invisible there while
 *   failing on a UTC runner.
 *
 * Exported, and the two neighbouring landing repos import it from here rather
 * than keeping a second copy. One definition is the whole point: a second one
 * drifts the day somebody decides seconds are not enough, and the two files
 * would then stamp the same decision with two different instants.
 */
export const sqlInstant = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

/**
 * The landing columns, read as one row.
 *
 * `status` is the VOTE's column and is read here anyway, because every refusal
 * the veto route gives is phrased from the pair: a `failed` decision has
 * nothing to stop, and an `applied` one has already happened. Splitting that
 * read in two would leave the route assembling one answer from two round trips
 * with nothing saying the halves agree.
 */
const LANDING_COLUMNS =
  "id, subject_type, subject_ref, lands_at, vetoed_at, vetoed_by, veto_reason, landing_status, status, timing, " +
  "veto_locked, late_settled_at";

/** One decision's landing, as the landing path and the veto route read it. */
export interface LandingRow {
  ballotId: string;
  subjectType: string;
  subjectRef: string;
  landsAt: Date | null;
  vetoedAt: Date | null;
  vetoedBy: string | null;
  vetoReason: string | null;
  landingStatus: string;
  status: string;
  timing: ProposalTiming;
  /** True when no steward may stop this one, window or no window. */
  vetoLocked: boolean;
  /** Set when the row reached passed with its instant already behind it. */
  lateSettledAt: Date | null;
}

/**
 * Kept exactly as the landing path wrote it: null passes through, a `Date` from
 * the driver passes through, and anything else is re-read from its string. A
 * stricter conversion here would turn an unreadable stamp into a different
 * failure miles from the row that holds it.
 */
const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

/** One ballot's landing, or null when there is no such ballot. */
export async function landingRowOf(pool: Pool, ballotId: string): Promise<LandingRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${LANDING_COLUMNS} FROM ballots WHERE id = ?`,
    [ballotId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ballotId: String(r.id),
    subjectType: String(r.subject_type),
    subjectRef: String(r.subject_ref),
    landsAt: asDate(r.lands_at),
    vetoedAt: asDate(r.vetoed_at),
    vetoedBy: r.vetoed_by === null || r.vetoed_by === undefined ? null : String(r.vetoed_by),
    vetoReason: r.veto_reason === null || r.veto_reason === undefined ? null : String(r.veto_reason),
    landingStatus: String(r.landing_status),
    status: String(r.status),
    timing: timingOf(r.timing),
    vetoLocked: Number(r.veto_locked ?? 0) === 1,
    lateSettledAt: asDate(r.late_settled_at),
  };
}

/**
 * Write the landing instant and the window onto the ballot.
 *
 * `landsAt` null is the advisory and the executes-at-close shape: the two
 * instant columns take NULL together, because a row with one of them set and
 * the other clear is a countdown nobody can read.
 */
export async function stampBallotLanding(
  pool: Pool,
  input: { ballotId: string; landsAt: Date | null; landingStatus: string; vetoLocked: 0 | 1 },
): Promise<void> {
  const at = input.landsAt ? sqlInstant(input.landsAt) : null;
  await pool.query(
    "UPDATE ballots SET lands_at = ?, veto_closes_at = ?, landing_status = ?, veto_locked = ? WHERE id = ?",
    [at, at, input.landingStatus, input.vetoLocked, input.ballotId],
  );
}

/** A row that never lands: an advisory vote, a failed vote, a withdrawn one. */
export async function markLandingNotApplicable(pool: Pool, ballotId: string): Promise<void> {
  await pool.query("UPDATE ballots SET landing_status = 'not_applicable' WHERE id = ?", [ballotId]);
}

/**
 * Stop a decision inside its window, and answer whether a row actually moved.
 *
 * The WHERE is the last guard and not the rule: every reason a veto can be
 * refused is decided before this is called and phrased for the steward there.
 * What these two clauses stop is the pair that only a race can produce, a
 * second veto and a veto landing on a row the apply job has already claimed.
 * Zero means one of those happened.
 */
export async function recordVetoOnBallot(
  pool: Pool,
  input: { ballotId: string; at: Date; stewardId: string; reason: string },
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET vetoed_at = ?, vetoed_by = ?, veto_reason = ?, landing_status = 'vetoed' " +
      "WHERE id = ? AND vetoed_at IS NULL AND landing_status = 'pending'",
    [sqlInstant(input.at), input.stewardId, input.reason, input.ballotId],
  );
  return Number(res.affectedRows);
}

/**
 * The newest ballot held on a subject, when a steward stopped it.
 *
 * `ORDER BY opens_at DESC, id DESC LIMIT 1` is the whole answer: the veto
 * columns live on the ballot, so a proposal that was stopped, returned to its
 * proposer and passed again reads as standing, because the NEWEST ballot on it
 * carries no veto while the old one keeps its veto on the record.
 */
export async function newestBallotVeto(
  pool: Pool,
  subjectType: string,
  subjectRef: string,
): Promise<{ vetoedAt: string; vetoedBy: string | null; reason: string | null; ballotId: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, vetoed_at, vetoed_by, veto_reason FROM ballots " +
      "WHERE subject_type = ? AND subject_ref = ? ORDER BY opens_at DESC, id DESC LIMIT 1",
    [subjectType, subjectRef],
  );
  const r = rows[0];
  if (!r || !r.vetoed_at) return null;
  const at = r.vetoed_at instanceof Date ? r.vetoed_at : new Date(String(r.vetoed_at));
  return {
    ballotId: String(r.id),
    vetoedAt: at.toISOString(),
    vetoedBy: r.vetoed_by === null || r.vetoed_by === undefined ? null : String(r.vetoed_by),
    reason: r.veto_reason === null || r.veto_reason === undefined ? null : String(r.veto_reason),
  };
}

/**
 * THE ELECTION. `affectedRows` picks the single executor, and this statement is
 * the reason nothing above it may be cached.
 *
 * The predicate is the whole rule: the vote passed, the row is still waiting,
 * its instant has come, and nobody stopped it. Anything that fails any clause
 * belongs to somebody else or to nobody. Returned as the count rather than a
 * boolean so the caller keeps its own reading of "exactly one".
 */
export async function claimDueRow(pool: Pool, ballotId: string, at: Date): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET landing_status = 'applying' " +
      "WHERE id = ? AND status = 'passed' AND landing_status = 'pending' AND lands_at <= ? AND vetoed_at IS NULL",
    [ballotId, sqlInstant(at)],
  );
  return Number(res.affectedRows);
}

/**
 * Every row whose instant has come, IN THE ORDER THEY MUST BE APPLIED.
 *
 * `lands_at` ascending, then `id`, which is unique, so no two rows can tie and
 * two servers reading this table apply them in the same sequence. The landing
 * path's header argues that order at length; this statement is where it is
 * actually spent, and a later lane reordering it there without changing it here
 * would leave the argument true and the behaviour different.
 */
export async function dueBallotIds(pool: Pool, at: Date): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ballots WHERE status = 'passed' AND landing_status IN ('pending','stalled') " +
      "AND lands_at IS NOT NULL AND lands_at <= ? AND vetoed_at IS NULL ORDER BY lands_at ASC, id ASC",
    [sqlInstant(at)],
  );
  return rows.map((r) => String(r.id));
}

/**
 * Mark a row that came due while applying was switched off.
 *
 * `AND landing_status = 'pending'` is what makes a second sweep over the same
 * backlog a no-op rather than a re-stall, so the count the job reports is rows
 * that changed and not rows it looked at.
 */
export async function markStalled(pool: Pool, ballotId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET landing_status = 'stalled' WHERE id = ? AND landing_status = 'pending'",
    [ballotId],
  );
  return Number(res.affectedRows);
}

/**
 * Hand a stalled row its window back, ONCE.
 *
 * `stall_reopens < 1` in the WHERE is the once, and it is in the statement
 * rather than in a read-then-write for the same reason the claim is: a window
 * handed back on every tick of a brake that keeps going off is a decision that
 * never lands and never fails, and a member watching it reads a countdown that
 * resets. Zero means this row has had its window back already.
 */
export async function reopenStalledWindow(pool: Pool, ballotId: string, reopened: Date): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET lands_at = ?, veto_closes_at = ?, landing_status = 'pending', " +
      "stall_reopens = stall_reopens + 1 WHERE id = ? AND landing_status = 'stalled' AND stall_reopens < 1",
    [sqlInstant(reopened), sqlInstant(reopened), ballotId],
  );
  return Number(res.affectedRows);
}

/** The decision happened. Unconditional on purpose: the claim already elected this executor. */
export async function markApplied(pool: Pool, ballotId: string): Promise<void> {
  await pool.query("UPDATE ballots SET landing_status = 'applied' WHERE id = ?", [ballotId]);
}

/**
 * Put a claimed row back so the next tick tries again.
 *
 * `AND landing_status = 'applying'` keeps a throw from un-vetoing a row a
 * steward stopped in the same seconds the executor was running.
 */
export async function releaseClaimToPending(pool: Pool, ballotId: string): Promise<void> {
  await pool.query("UPDATE ballots SET landing_status = 'pending' WHERE id = ? AND landing_status = 'applying'", [ballotId]);
}

/** A passed row still waiting, with the two fields the write-off sentence needs. */
export interface ExpiryCandidate {
  id: string;
  title: string;
  landsAt: Date;
}

/**
 * Every passed row whose instant has come and which has not landed.
 *
 * Deliberately WIDER than `dueBallotIds`: it does not exclude a vetoed row,
 * because the write-off is about rows that sat, and it is the caller that
 * decides how many boundaries counts as sat. Same order, for the same reason.
 */
export async function expiryCandidates(pool: Pool, at: Date): Promise<ExpiryCandidate[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, title, lands_at FROM ballots WHERE status = 'passed' AND landing_status IN ('pending','stalled') " +
      "AND lands_at IS NOT NULL AND lands_at <= ? ORDER BY lands_at ASC, id ASC",
    [sqlInstant(at)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    landsAt: r.lands_at instanceof Date ? r.lands_at : new Date(String(r.lands_at)),
  }));
}

/** Close a row that carried and then sat unlanded. Zero means somebody got there first. */
export async function markExpired(pool: Pool, ballotId: string): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "UPDATE ballots SET landing_status = 'expired' WHERE id = ? AND landing_status IN ('pending','stalled')",
    [ballotId],
  );
  return Number(res.affectedRows);
}

/**
 * How many decisions due INSIDE a cycle are still neither applied nor stopped.
 *
 * `< ?` and not `<=`: the bound is the boundary that ENDED the cycle, and a row
 * landing exactly on it belongs to the cycle that just began. The digest holds
 * while this is above zero, because publishing "what changed this moon" with
 * the changes missing is the one page a returning player reads first.
 */
export async function countUnfinishedBefore(pool: Pool, boundary: Date): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE status = 'passed' AND landing_status IN ('pending','applying') " +
      "AND lands_at IS NOT NULL AND lands_at < ?",
    [sqlInstant(boundary)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Is this the row no steward may stop?
 *
 * Read as its own statement rather than taken from a flag beside the caller,
 * and that is the defect it was written for: the notice used to compute the
 * answer separately from the refusal, the two copies drifted, and a steward was
 * offered a door the route was already refusing. One column, one reader.
 */
export async function vetoLockedOn(pool: Pool, ballotId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT veto_locked FROM ballots WHERE id = ?", [ballotId]);
  return Number(rows[0]?.veto_locked ?? 0) === 1;
}

/** A window still open, as the veto watch reads it. */
export interface OpenWindowRow {
  id: string;
  /** Selected because the statement has always selected it. The watch carries its window from `lateSettledAt` when there is one and from the ballot's own frozen close otherwise, and it takes that close off the ballot row it loads for the title. */
  closesAt: unknown;
  landsAt: Date;
  lateSettledAt: Date | null;
}

/** Every decision whose window has not shut yet and which nobody has stopped. */
export async function openVetoWindows(pool: Pool, at: Date): Promise<OpenWindowRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, closes_at, lands_at, late_settled_at FROM ballots " +
      "WHERE status = 'passed' AND landing_status = 'pending' AND lands_at IS NOT NULL AND lands_at > ? AND vetoed_at IS NULL",
    [sqlInstant(at)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    closesAt: r.closes_at,
    landsAt: r.lands_at instanceof Date ? r.lands_at : new Date(String(r.lands_at)),
    lateSettledAt: r.late_settled_at
      ? r.late_settled_at instanceof Date
        ? r.late_settled_at
        : new Date(String(r.late_settled_at))
      : null,
  }));
}

/**
 * A SEATED STEWARD'S NO AT THE CLOSE: the outcome and the veto in one write.
 *
 * `AND status = 'passed'` is the guard. The engine's own read said passed a
 * moment ago; anything that has moved it since is a close that already
 * happened, and this must not overwrite it.
 */
export async function failByStewardNo(
  pool: Pool,
  input: { ballotId: string; outcomeNote: string; at: Date; stewardId: string; reason: string },
): Promise<void> {
  await pool.query(
    "UPDATE ballots SET status = 'failed', outcome_note = ?, vetoed_at = ?, vetoed_by = ?, veto_reason = ?, landing_status = 'vetoed' " +
      "WHERE id = ? AND status = 'passed'",
    [input.outcomeNote, sqlInstant(input.at), input.stewardId, input.reason, input.ballotId],
  );
}

/**
 * The window, counted from now instead, for a row read after its instant.
 *
 * Both the reason and the instant it was read at are stored, because "the
 * window was honoured" and "the window was reopened and here is why" are
 * different sentences and a record that cannot tell them apart is a record
 * nobody can act on.
 */
export async function restampLateSettled(
  pool: Pool,
  input: { ballotId: string; restamped: Date; at: Date; reason: string },
): Promise<void> {
  await pool.query(
    "UPDATE ballots SET lands_at = ?, veto_closes_at = ?, late_settled_at = ?, late_settled_reason = ? WHERE id = ?",
    [sqlInstant(input.restamped), sqlInstant(input.restamped), sqlInstant(input.at), input.reason, input.ballotId],
  );
}

/**
 * Every ballot whose voting window has ended and which is still open.
 *
 * `ORDER BY closes_at, id` and not the landing order: these are closed, not
 * landed, and the sequence that matters is the one they were promised in.
 */
export async function openBallotIdsPastClose(pool: Pool, at: Date): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM ballots WHERE status = 'open' AND closes_at <= ? ORDER BY closes_at, id",
    [sqlInstant(at)],
  );
  return rows.map((r) => String(r.id));
}

/**
 * Two counts over every ballot ever held on one mechanics proposal.
 *
 * One statement rather than two, because the question they answer together is
 * "is this stopped RIGHT NOW", and asking in two round trips lets a landing
 * happen between them and produce an answer that was never true.
 */
export async function vetoAndLandingTally(
  pool: Pool,
  proposalId: string,
): Promise<{ vetoed: number; applied: number }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT SUM(vetoed_at IS NOT NULL) AS vetoed, SUM(landing_status = 'applied') AS applied " +
      "FROM ballots WHERE subject_type = 'mechanics' AND subject_ref = ?",
    [proposalId],
  );
  return { vetoed: Number(rows[0]?.vetoed ?? 0), applied: Number(rows[0]?.applied ?? 0) };
}

/** How many ballots on this proposal a steward ever stopped. A question about HISTORY. */
export async function vetoedBallotCount(pool: Pool, proposalId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM ballots WHERE subject_type = 'mechanics' AND subject_ref = ? AND vetoed_at IS NOT NULL",
    [proposalId],
  );
  return Number(rows[0]?.n ?? 0);
}
