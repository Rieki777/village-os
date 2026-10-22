/**
 * THE CIRCLE CARD'S OWN READS: the circle's charter row and the record of
 * which published org drafts wrote its words.
 *
 * The roles and their holders are read the way `/api/org` reads them
 * (`listOrgRoles`, `listOrgAssignments`), in server/lib/circleCardData.ts, so
 * a role on this card is the same seat object it is everywhere else.
 *
 * Nothing here decides who may see what. That is the route's tier.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CharterRow } from "../../shared/circleCharter";

/** The `circle_charters` row, or null when no draft has written one yet. */
export async function readCharterRow(pool: Pool, circleId: string): Promise<CharterRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT exists_while, accountabilities, domains, authorities, responsibilities, stewardship, tools, checks, " +
      "succession, circle_values, living_agreement FROM circle_charters WHERE circle_id = ? LIMIT 1",
    [circleId],
  );
  return rows[0] ? (rows[0] as CharterRow) : null;
}

export interface AdoptionRow {
  draftId: string;
  /** Seconds since the epoch, read with UNIX_TIMESTAMP so no zone moves it. */
  publishedAt: number;
  byVote: boolean;
  created: boolean;
}

/**
 * Every published draft that wrote this circle's words: the one that created
 * it (`create_circle`, which carries the first purpose) and every
 * `update_circle` since. A reverted or withdrawn draft is not an adoption.
 *
 * `byVote` is true when the draft was published by the village's ballot: the
 * vote closer records the ballot as `published_by` (server/lib/orgDraftDecide.ts).
 */
export async function readCircleAdoptions(pool: Pool, circleId: string): Promise<AdoptionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT d.id AS draft_id, UNIX_TIMESTAMP(d.published_at) AS published_at, " +
      "MAX(c.op = 'create_circle') AS created, MAX(b.id IS NOT NULL) AS by_vote " +
      "FROM org_drafts d JOIN org_draft_changes c ON c.draft_id = d.id " +
      "LEFT JOIN ballots b ON b.id = d.published_by AND b.subject_type = 'org_draft' AND b.subject_ref = d.id " +
      "WHERE d.status = 'published' AND d.published_at IS NOT NULL AND c.org_role_id = ? " +
      "AND c.op IN ('create_circle', 'update_circle') " +
      "GROUP BY d.id, d.published_at ORDER BY d.published_at DESC LIMIT 50",
    [`circle:${circleId}`],
  );
  return rows.map((r) => ({
    draftId: String(r.draft_id),
    publishedAt: Number(r.published_at),
    byVote: Number(r.by_vote) === 1,
    created: Number(r.created) === 1,
  }));
}

/** The reader holds a live role in this circle, as a member (examples left out). */
export async function holdsRoleInCircle(pool: Pool, userId: string, circleId: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.user_id = ? AND a.ended_at IS NULL AND a.holder_kind = 'member' AND a.is_example = 0 " +
      "AND r.circle_id = ? AND r.active = 1 AND r.is_example = 0 LIMIT 1",
    [userId, circleId],
  );
  return rows.length > 0;
}

/** The payloads of every open draft that would change this circle's words. */
export async function openCircleWordPayloads(pool: Pool, circleId: string): Promise<unknown[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT c.payload FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
      "WHERE d.status = 'open' AND c.op = 'update_circle' AND c.org_role_id = ?",
    [`circle:${circleId}`],
  );
  return rows.map((r) => (typeof r.payload === "string" ? safeJson(r.payload) : r.payload));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
