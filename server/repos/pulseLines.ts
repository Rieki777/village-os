/**
 * THE PUBLIC PULSE LINES THAT NAME A MEMBER, for the erasure's
 * "pulse-lines-naming-after-tombstone" step (server/lib/erasure.ts).
 *
 * WHY THE ACTOR WAS NOT ENOUGH. "public-health-events" deletes every public
 * line whose ACTOR is the member. Four producers in server/index.ts write a
 * public line that names somebody who is not its actor:
 *
 *   gratitude      "Ann appreciated Wren"                     actor the sender
 *   a vote seats   "Wren sits in Steward, by a vote of ..."   actor the closer
 *   a vote unseats "Wren no longer sits in Steward, by ..."   actor the closer
 *   an appointment "Wren joined the Stewards"                 actor the appointer
 *
 * `GET /api/game/pulse` serves every public line to a signed-out visitor, so
 * each of those kept the departed member's first name in front of anybody
 * after they were gone, and ARCHITECTURE.md said the opposite.
 *
 * A LINE FOUND IS REWRITTEN IN PLACE, NEVER DELETED. Its actor is a living
 * member, and three readers count lines by actor and by kind
 * (`countActiveMembers` in server/repos/mapStats.ts, the season retrospective's
 * events per holder, the weekly health counts). Deleting Ann's gratitude line
 * would take Ann out of the active count for that cycle. So the row, its
 * actor, its kind and its time all stay, and only the departed member's name
 * goes: "Ann appreciated a departed member", "A departed member joined the
 * Stewards". `at = at` holds the time where it was, because `at` is the
 * table's first TIMESTAMP column (drizzle/0013) and a rewrite must never move
 * a line to the top of the pulse.
 *
 * TWO WAYS TO FIND A LINE.
 *
 *   1. FROM NOW ON, the line records its subject. Gratitude always recorded the
 *      recipient as the line's entity (`entity_type = 'user'`), and the three
 *      role producers now do the same with the member they seat, unseat or
 *      appoint. No reader of a PUBLIC line reads its entity (the pulse and the
 *      feed read text; the admin audit view and the org journal read other
 *      rows), and the admin audit row each vote writes still names the role.
 *
 *   2. LINES ALREADY WRITTEN by the role producers name the role as their
 *      entity and carry nothing that points at the member, so:
 *        - a vote's line is found through the admin audit row the same close
 *          wrote beside it (`role:seated-by-ballot:<role>:<member>:<ballot>`,
 *          and `unseated`): same role, within a minute of it, and opening with
 *          the member's first name, which tells two seats filled by one
 *          landing apart;
 *        - an appointment wrote nothing beside its line, so only its words find
 *          it, "<first name> joined the <role>". That is rewritten only when no
 *          other living member has the same first name. A namesake's own line
 *          reads exactly the same, and calling a living member departed on the
 *          village's public record is the worse mistake of the two. What that
 *          leaves standing is a first name a living member also carries, and
 *          the step's answer counts it (`appointmentLinesLeft`).
 *
 * WHAT THIS DOES NOT REACH. The ballot openings ("The village is deciding
 * whether Wren sits in Steward") record the ballot as their entity, and the
 * ballot's subject is the member; those go with the ballots about the member,
 * which is a different step's work.
 *
 * Every statement is a DELETE keyed on the member or an UPDATE whose result is
 * the same however many times it runs (the rewritten text matches its own
 * pattern and rewrites to itself), so a resume may run this any number of
 * times.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** The departed member, as a line names them. */
const DEPARTED = "A departed member";

/** A line about a departed member whose words this file has no rule for. None exists today; a new producer lands here. */
export const UNRECOGNISED_LINE = "This line named a member who has since left.";

/** Escape a value for use inside a LIKE pattern with the default escape character. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A first name the way every producer writes one: the first word of the name. */
const firstWordOf = (name: string | null | undefined): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** The tail every vote line ends with (server/index.ts, the role_seat and role_unseat closers). */
const BY_A_VOTE = ", by a vote of the whole village.";

/**
 * The words that follow the subject in each role line, longest first, so the
 * unseat line is never read as the seat line it contains.
 */
const SUBJECT_FIRST_MARKERS = [" no longer sits in ", " sits in ", " joined the "] as const;

/** What the three role producers' public lines record, for the audit-backed match below. */
const VOTE_LINES = [
  { audit: "role:seated-by-ballot:", marker: " sits in " },
  { audit: "role:unseated-by-ballot:", marker: " no longer sits in " },
] as const;

export interface PulseForgetCounts {
  /** Their own lines, written as actor after the first pass and before their sessions died. */
  ownLines: number;
  /** Lines recording them as the subject, gratitude to them and every role line from now on. */
  aboutLines: number;
  /** Older vote lines, found through the audit row beside each. */
  voteLines: number;
  /** Older appointment lines, found by their words. */
  appointmentLines: number;
  /** Older appointment lines left standing because a living member shares the first name. */
  appointmentLinesLeft: number;
}

/**
 * The text a line about them becomes, as one SQL expression over `text`.
 *
 * Gratitude names its subject last; every role line names it first, as one
 * word followed by a fixed phrase. Anything else falls through to a constant.
 */
const REWRITTEN =
  "CASE " +
  "WHEN kind = 'gratitude' AND LOCATE(' appreciated ', text) > 0 " +
  "THEN CONCAT(SUBSTRING_INDEX(text, ' appreciated ', 1), ' appreciated a departed member') " +
  SUBJECT_FIRST_MARKERS.map(
    (m) => `WHEN LOCATE('${m}', text) > 0 THEN CONCAT('${DEPARTED}', SUBSTRING(text, LOCATE('${m}', text))) `,
  ).join("") +
  "ELSE ? END";

/**
 * Take a departed member's name off every public pulse line that carries it.
 *
 * `name` is the name they had, for the lines that recorded only their name; a
 * caller that no longer knows it passes null, and only the lines found by
 * their id are reached.
 */
export async function forgetPulseLinesNaming(
  pool: Pool,
  who: { userId: string; name: string | null },
): Promise<PulseForgetCounts> {
  const counts: PulseForgetCounts = { ownLines: 0, aboutLines: 0, voteLines: 0, appointmentLines: 0, appointmentLinesLeft: 0 };

  // Their own lines once more, now that nothing can write one: a line written
  // between "public-health-events" and the tombstone is theirs as well.
  const [own] = await pool.query<ResultSetHeader>(
    "DELETE FROM health_events WHERE audience = 'public' AND actor_user_id = ?",
    [who.userId],
  );
  counts.ownLines = Number(own.affectedRows ?? 0);

  const [about] = await pool.query<ResultSetHeader>(
    `UPDATE health_events SET at = at, text = ${REWRITTEN} ` +
      "WHERE audience = 'public' AND entity_type = 'user' AND entity_ref = ? AND (actor_user_id IS NULL OR actor_user_id <> ?)",
    [UNRECOGNISED_LINE, who.userId, who.userId],
  );
  counts.aboutLines = Number(about.changedRows ?? 0);

  const first = firstWordOf(who.name);
  if (!first) return counts;
  const opening = likeEscape(first);

  for (const line of VOTE_LINES) {
    const [audits] = await pool.query<RowDataPacket[]>(
      "SELECT entity_ref, text, UNIX_TIMESTAMP(at) AS t FROM health_events " +
        "WHERE audience = 'admin' AND kind = 'audit' AND entity_type = 'role' AND text LIKE ?",
      [`${likeEscape(line.audit)}%:${likeEscape(who.userId)}:%`],
    );
    for (const a of audits) {
      const roleId = String(a.entity_ref ?? "");
      // The pattern above is loose around the role id; this is the exact shape the closer writes.
      if (!roleId || !String(a.text).startsWith(`${line.audit}${roleId}:${who.userId}:`)) continue;
      const t = Number(a.t);
      const [hit] = await pool.query<ResultSetHeader>(
        "UPDATE health_events SET at = at, text = CONCAT(?, SUBSTRING(text, LOCATE(?, text))) " +
          "WHERE audience = 'public' AND kind = 'governance' AND entity_type = 'role' AND entity_ref = ? AND is_example = 0 " +
          "AND text LIKE ? AND UNIX_TIMESTAMP(at) BETWEEN ? AND ?",
        [DEPARTED, line.marker, roleId, `${opening}${likeEscape(line.marker)}%${likeEscape(BY_A_VOTE)}`, t - 60, t + 60],
      );
      counts.voteLines += Number(hit.changedRows ?? 0);
    }
  }

  const appointment = `${opening}${likeEscape(" joined the ")}%`;
  const namesakes = await livingNamesakes(pool, who.userId, first);
  if (namesakes > 0) {
    const [left] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM health_events " +
        "WHERE audience = 'public' AND kind = 'role' AND entity_type = 'role' AND is_example = 0 AND text LIKE ?",
      [appointment],
    );
    counts.appointmentLinesLeft = Number(left[0]?.n ?? 0);
    return counts;
  }
  const [named] = await pool.query<ResultSetHeader>(
    "UPDATE health_events SET at = at, text = CONCAT(?, SUBSTRING(text, LOCATE(' joined the ', text))) " +
      "WHERE audience = 'public' AND kind = 'role' AND entity_type = 'role' AND is_example = 0 AND text LIKE ?",
    [DEPARTED, appointment],
  );
  counts.appointmentLines = Number(named.changedRows ?? 0);
  return counts;
}

/**
 * How many living members other than this one go by the same first name,
 * compared under the column's collation, which ignores case AND accents
 * (utf8mb4_0900_ai_ci on MySQL 8, uca1400_ai_ci on MariaDB): the same
 * comparison the appointment UPDATE's LIKE makes, so a line that could be
 * theirs is never called departed. Example members do not count: their lines
 * are examples too, and every rewrite here skips those.
 *
 * THE COUNT IS THE DATABASE'S, WITH NO SECOND FILTER (adversarial round 3,
 * finding 1). A re-check in JavaScript stood here and compared lowercased
 * first words exactly, so "María Oak" left the count while the UPDATE's LIKE
 * still matched "María joined the Bakers", and erasing a Maria called a
 * living María departed. Where the two queries could still differ, this one
 * over-counts, which leaves the line standing and counted in
 * `appointmentLinesLeft`: the safe direction.
 */
async function livingNamesakes(pool: Pool, userId: string, first: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM users WHERE id <> ? AND is_example = 0 AND (email IS NULL OR email NOT LIKE '%@anonymized.invalid') AND (TRIM(name) = ? OR TRIM(name) LIKE ?)",
    [userId, first, `${likeEscape(first)} %`],
  );
  return Number(rows[0]?.n ?? 0);
}
