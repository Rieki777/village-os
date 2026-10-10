/**
 * What the path, member and joining journeys read about one person, for their
 * skip and stop rules (server/lib/comms/pathConditions.ts, the comms build
 * spec 5.11). Read-only, ONE query per rule, over the tables the rest of the
 * village already writes: `submissions` (0001), `housing_reservations` (0077),
 * `investor_path_facts` (0156), `member_ventures` (0157),
 * `org_role_assignments` (0049), `quest_claims` (0001), `event_attendance`
 * (0245) and `users`.
 *
 * WHO "THE PERSON" IS. A journey knows a contact: an address, and a user id
 * when the address belongs to an account. Every rule matches on whichever of
 * the two the row it reads can carry. A form's address is free text, so it is
 * compared lowercased and trimmed against the contact's key, which is the
 * address lowercased and trimmed (shared/comms/address.ts). An account's rows
 * are matched by user id only: an address typed into a form never stands in
 * for an account, the rule server/lib/comms/backfill.ts writes down.
 *
 * Seeded example rows never count: a standing example in an empty village must
 * never move a real person on.
 *
 * Raw SQL lives here and nowhere else. No cache sits above these reads.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

const VILLAGE = "local";

/** The person a rule asks about. */
export interface PathPerson {
  /** The contact's key: the address, lowercased and trimmed. */
  emailKey: string;
  userId: string | null;
}

/** A submission's address, read the way every rule here compares it. */
const FORM_EMAIL = "LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(data, '$.email'))))";

/** One yes-or-no answer from a statement that selects `hit`. */
async function hit(pool: Pool, sql: string, params: unknown[]): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params); // module-review-ok: the one runner for the yes-or-no reads below, each written out in full here
  return Number(rows[0]?.hit ?? 0) === 1;
}

/** A submission of one of these types from this person: their address on the form, or their account. */
function submissionFrom(types: readonly string[], status: string | null): string {
  const kinds = types.map(() => "?").join(", ");
  return (
    `SELECT 1 FROM submissions WHERE type IN (${kinds})` +
    (status ? " AND status = ?" : "") +
    ` AND (${FORM_EMAIL} = ? OR (? IS NOT NULL AND user_id = ?))`
  );
}

const submissionParams = (types: readonly string[], status: string | null, p: PathPerson): unknown[] => [
  ...types,
  ...(status ? [status] : []),
  p.emailKey,
  p.userId,
  p.userId,
];

/** Resident, first step: a housing request, or a visit inquiry. */
export function hasHousingRequest(pool: Pool, p: PathPerson): Promise<boolean> {
  return hit(
    pool,
    // module-review-ok: one person's housing requests and visit inquiries, as one EXISTS pair
    "SELECT (EXISTS(SELECT 1 FROM housing_reservations WHERE village_id = ? AND (LOWER(TRIM(email)) = ? OR (? IS NOT NULL AND user_id = ?))) " +
      `OR EXISTS(${submissionFrom(["visit-inquiry"], null)})) AS hit`,
    [VILLAGE, p.emailKey, p.userId, p.userId, ...submissionParams(["visit-inquiry"], null, p)],
  );
}

/** Resident, the goal: a housing reservation that reached `reserved`. */
export function housingReserved(pool: Pool, p: PathPerson): Promise<boolean> {
  return hit(
    pool,
    // module-review-ok: one person's reservations, by address or account
    "SELECT EXISTS(SELECT 1 FROM housing_reservations WHERE village_id = ? AND status = 'reserved' " +
      "AND (LOWER(TRIM(email)) = ? OR (? IS NOT NULL AND user_id = ?))) AS hit",
    [VILLAGE, p.emailKey, p.userId, p.userId],
  );
}

/** Investor, first step: the investor packet was requested. */
export function packetRequested(pool: Pool, p: PathPerson): Promise<boolean> {
  const types = ["investor-doc-request"];
  return hit(pool, `SELECT EXISTS(${submissionFrom(types, null)}) AS hit`, submissionParams(types, null, p)); // module-review-ok: one person's packet requests
}

/**
 * Investor, the goal: an agreement signed (`investor_path_facts`, live), or
 * until that has a writer, an investor call request that was accepted.
 */
export function investorCommitted(pool: Pool, p: PathPerson): Promise<boolean> {
  const types = ["investor-call"];
  return hit(
    pool,
    // module-review-ok: one member's live agreement fact, or one person's accepted call request
    "SELECT (EXISTS(SELECT 1 FROM investor_path_facts WHERE village_id = ? AND ? IS NOT NULL AND user_id = ? " +
      "AND fact = 'agreement_signed' AND ended_at IS NULL AND is_example = 0) " +
      `OR EXISTS(${submissionFrom(types, "accepted")})) AS hit`,
    [VILLAGE, p.userId, p.userId, ...submissionParams(types, "accepted", p)],
  );
}

/** Steward, first step: a hand raised for a seat or a power. Only a member can raise one. */
export function raisedHand(pool: Pool, p: PathPerson): Promise<boolean> {
  return hit(
    pool,
    // module-review-ok: one member's raised hands
    "SELECT EXISTS(SELECT 1 FROM submissions WHERE type IN ('role-application', 'power-application') " +
      "AND ? IS NOT NULL AND user_id = ?) AS hit",
    [p.userId, p.userId],
  );
}

/** Steward, the goal: seated in a role now. */
export function seatedInRole(pool: Pool, p: PathPerson): Promise<boolean> {
  return hit(
    pool,
    // module-review-ok: one member's live seatings
    "SELECT EXISTS(SELECT 1 FROM org_role_assignments WHERE ? IS NOT NULL AND user_id = ? AND holder_kind = 'member' " +
      "AND ended_at IS NULL AND is_example = 0) AS hit",
    [p.userId, p.userId],
  );
}

/** Prosperity creator, first step: a Work With Us proposal. */
export function sentProposal(pool: Pool, p: PathPerson): Promise<boolean> {
  const types = ["work-with-us"];
  return hit(pool, `SELECT EXISTS(${submissionFrom(types, null)}) AS hit`, submissionParams(types, null, p)); // module-review-ok: one person's Work With Us proposals
}

/**
 * Prosperity creator, the goal: a venture listed and still running, or until
 * that has a writer for everybody, a Work With Us proposal accepted.
 */
export function prosperityGoal(pool: Pool, p: PathPerson): Promise<boolean> {
  const types = ["work-with-us"];
  return hit(
    pool,
    // module-review-ok: one member's listed ventures, or one person's accepted proposal
    "SELECT (EXISTS(SELECT 1 FROM member_ventures WHERE village_id = ? AND ? IS NOT NULL AND user_id = ? " +
      "AND listed_at IS NOT NULL AND closed_at IS NULL AND is_example = 0) " +
      `OR EXISTS(${submissionFrom(types, "accepted")})) AS hit`,
    [VILLAGE, p.userId, p.userId, ...submissionParams(types, "accepted", p)],
  );
}

/** Joining, the goal: an account at this address that has been admitted. */
export function admitted(pool: Pool, p: PathPerson): Promise<boolean> {
  return hit(
    pool,
    // module-review-ok: the account at one address, or the contact's own account
    "SELECT EXISTS(SELECT 1 FROM users WHERE membership_granted = 1 AND is_example = 0 " +
      "AND (LOWER(TRIM(email)) = ? OR (? IS NOT NULL AND id = ?))) AS hit",
    [p.emailKey, p.userId, p.userId],
  );
}

/** Joining, the other end: the request itself was declined. */
export function requestDeclined(pool: Pool, submissionId: string): Promise<boolean> {
  return hit(pool, "SELECT EXISTS(SELECT 1 FROM submissions WHERE id = ? AND status = 'declined') AS hit", [submissionId]); // module-review-ok: one submission by id
}

/** A new member, first step: any quest claimed. */
export function claimedFirstQuest(pool: Pool, userId: string): Promise<boolean> {
  return hit(pool, "SELECT EXISTS(SELECT 1 FROM quest_claims WHERE user_id = ?) AS hit", [userId]); // module-review-ok: one member's claims
}

/** A new member, the goal: a quest consented, or marked as having come to a gathering. */
export function tookPart(pool: Pool, userId: string): Promise<boolean> {
  return hit(
    pool,
    // module-review-ok: one member's consented claims and attendance marks
    "SELECT (EXISTS(SELECT 1 FROM quest_claims WHERE user_id = ? AND status = 'consented') " +
      "OR EXISTS(SELECT 1 FROM event_attendance WHERE person_key = ? AND status = 'came')) AS hit",
    [userId, userId],
  );
}

/** What a trigger about a submission needs to know of it: its type, its address and its account. */
export async function submissionPerson(
  pool: Pool,
  submissionId: string,
): Promise<{ type: string; status: string; email: string | null; name: string | null; userId: string | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: one submission by id
    "SELECT type, status, user_id, JSON_UNQUOTE(JSON_EXTRACT(data, '$.email')) AS email, " +
      "JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) AS name FROM submissions WHERE id = ? LIMIT 1",
    [submissionId],
  );
  const r = rows[0];
  if (!r) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() && v !== "null" ? v.trim() : null);
  return { type: String(r.type), status: String(r.status), email: text(r.email), name: text(r.name), userId: text(r.user_id) };
}
