/**
 * THE PLAYER CARD'S READS, every table once, for any number of people.
 *
 * `readCardRows(pool, userIds)` is one batch. Each table is read exactly once
 * with `IN (...)` over the people asked about, so a card for someone holding
 * six roles costs the same number of queries as a card for someone holding
 * one (`playerCardData.queries.test.ts` counts them). The roles a person holds
 * are named by one subquery, `HELD`, that every read shares, so no read waits
 * on another and none of them loops.
 *
 * `readSignTables(pool, tables, since, seasonId)` is the village-wide half: the
 * rows the sign counters read (shared/roleSigns.ts), each table once and only
 * when a sign that needs it is not already memoised.
 *
 * Nothing here decides who may see what. That is the route's tier, applied in
 * server/lib/playerCardData.ts.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { ASSIGN_COLS, ROLE_COLS } from "../lib/orgChart";
import type { SignRows } from "../../shared/roleSigns";

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** The live roles any of these people hold as members, examples left out. */
const HELD = (n: number) =>
  "SELECT org_role_id FROM org_role_assignments WHERE ended_at IS NULL AND holder_kind = 'member' " +
  `AND is_example = 0 AND user_id IN (${marks(n)})`;

export interface CardRows {
  users: RowDataPacket[];
  /** Every live seating on a held role, every holder, so a role's holder count is read here too. */
  seatings: RowDataPacket[];
  roles: RowDataPacket[];
  roleNames: RowDataPacket[];
  circles: RowDataPacket[];
  relations: RowDataPacket[];
  relationTypes: RowDataPacket[];
  grants: RowDataPacket[];
  /**
   * Every application a held seating came through, for its terms. The
   * people's own applications are read by `applicationsOfCandidates`
   * (server/repos/seatApplications.ts), the read the `?candidate=` list makes.
   */
  applications: RowDataPacket[];
  plans: RowDataPacket[];
  tasks: RowDataPacket[];
  taskEvents: RowDataPacket[];
  circleDecisions: RowDataPacket[];
  pending: RowDataPacket[];
}

/**
 * One batch for these people. `moonFrom` starts this moon (tasks done this
 * moon and their events); `threeMoonsFrom` starts the window decisions are
 * counted over.
 */
export async function readCardRows(
  pool: Pool,
  userIds: readonly string[],
  window: { moonFrom: Date; threeMoonsFrom: Date },
): Promise<CardRows> {
  const ids = [...userIds];
  const n = ids.length;
  const held = HELD(n);
  const q = async (sql: string, args: unknown[]) => (await pool.query<RowDataPacket[]>(sql, args))[0];
  const [
    users, seatings, roles, roleNames, circles, relations, relationTypes, grants,
    applications, plans, tasks, taskEvents, circleDecisions, pending,
  ] = await Promise.all([
    q(`SELECT id, name FROM users WHERE id IN (${marks(n)})`, ids),
    q(`SELECT ${ASSIGN_COLS} FROM org_role_assignments WHERE ended_at IS NULL AND org_role_id IN (${held}) ORDER BY started_at, id`, ids),
    q(`SELECT ${ROLE_COLS}, archetypes_suggested FROM org_roles WHERE id IN (${held}) ORDER BY sort_order, name`, ids),
    q("SELECT id, name FROM org_roles", []),
    q(`SELECT id, name FROM circles WHERE id IN (SELECT circle_id FROM org_roles WHERE id IN (${held}))`, ids),
    q(
      "SELECT r.id, r.type_id, r.from_kind, r.from_id, r.to_kind, r.to_id, r.note, r.is_example " +
        `FROM org_relations r WHERE r.from_id IN (${held}) OR r.to_id IN (${held})`,
      [...ids, ...ids],
    ),
    q("SELECT id, label, inverse_label, symmetric, is_cover, sort_order, is_example FROM org_relation_types", []),
    q(`SELECT capability, holder_role_id FROM capability_holding WHERE holder_role_id IN (${held})`, ids),
    q(
      "SELECT id, candidate_user_id, seat_ids, status, settings_json, created_at, decided_at, term_season_id, starts_at, term_ends_at " +
        "FROM seat_applications WHERE id IN (" +
        `SELECT application_id FROM org_role_assignments WHERE ended_at IS NULL AND application_id IS NOT NULL AND user_id IN (${marks(n)}))`,
      ids,
    ),
    q(
      "SELECT user_id, season_id, version, aim, serves_goal, serves_goals_json, seasonal_goals_json, filed_at, superseded_at, created_at " +
        `FROM season_plans WHERE user_id IN (${marks(n)}) ORDER BY created_at, version`,
      ids,
    ),
    q(
      "SELECT s.entry_id, s.status, s.owner_seat_id, s.done_at, e.text FROM live_session_task_state s " +
        "JOIN live_session_entries e ON e.id = s.entry_id " +
        `WHERE s.owner_seat_id IN (${held}) AND (s.status = 'open' OR (s.status = 'done' AND (s.done_at IS NULL OR s.done_at >= ?)))`,
      [...ids, window.moonFrom],
    ),
    q(
      "SELECT entry_id, status, created_at FROM live_session_task_events " +
        `WHERE owner_seat_id IN (${held}) AND created_at >= ? ORDER BY id`,
      [...ids, window.moonFrom],
    ),
    q(
      "SELECT s.circle_id, COUNT(*) AS n FROM live_session_entries e JOIN live_sessions s ON s.id = e.session_id " +
        `WHERE e.kind = 'decision' AND e.status = 'done' AND e.created_at >= ? AND s.circle_id IN (SELECT circle_id FROM org_roles WHERE id IN (${held})) ` +
        "GROUP BY s.circle_id",
      [window.threeMoonsFrom, ...ids],
    ),
    q(
      "SELECT c.org_role_id, c.payload, c.draft_id, UNIX_TIMESTAMP(d.created_at) AS created_at FROM org_draft_changes c JOIN org_drafts d ON d.id = c.draft_id " +
        `WHERE d.status = 'open' AND c.op = 'update_seat' AND c.org_role_id IN (${held})`,
      ids,
    ),
  ]);
  return {
    users, seatings, roles, roleNames, circles, relations, relationTypes, grants,
    applications, plans, tasks, taskEvents, circleDecisions, pending,
  };
}

/**
 * Each person's characters, and which one fronts their sheet, for the card's
 * portrait. Two statements for any number of people, and no join across
 * `users` and `player_characters` (server/db/collation.ts records what that
 * join has cost): the primary is matched by id in TypeScript.
 */
export async function readCharacters(
  pool: Pool,
  villageId: string,
  userIds: readonly string[],
): Promise<{ primary: Map<string, string | null>; characters: Array<{ id: string; userId: string; archetypeKey: string; presentation: string; tone: string }> }> {
  const ids = [...userIds];
  if (!ids.length) return { primary: new Map(), characters: [] };
  const q = async (sql: string, args: unknown[]) => (await pool.query<RowDataPacket[]>(sql, args))[0];
  const [users, chars] = await Promise.all([
    q(`SELECT id, primary_character_id FROM users WHERE id IN (${marks(ids.length)})`, ids),
    q(
      "SELECT id, user_id, archetype_key, presentation, tone FROM player_characters " +
        `WHERE village_id = ? AND user_id IN (${marks(ids.length)}) ORDER BY chosen_at, id`,
      [villageId, ...ids],
    ),
  ]);
  return {
    primary: new Map(users.map((u) => [String(u.id), u.primary_character_id == null ? null : String(u.primary_character_id)])),
    characters: chars.map((c) => ({
      id: String(c.id),
      userId: String(c.user_id),
      archetypeKey: String(c.archetype_key),
      presentation: String(c.presentation),
      tone: String(c.tone),
    })),
  };
}

/** What a role application's card reads about the roles it names. */
export interface ProposalRows {
  roles: RowDataPacket[];
  /** Live seatings on those roles, every holder, for the holder count only. */
  seatings: RowDataPacket[];
  circles: RowDataPacket[];
  relations: RowDataPacket[];
  grants: RowDataPacket[];
}

/**
 * The roles some applications name, for proposal cards: five reads with
 * `IN (...)` over every role every application in the batch names, so a
 * person applying for five roles costs what one role costs.
 */
export async function readProposalRows(pool: Pool, roleIds: readonly string[]): Promise<ProposalRows> {
  const ids = Array.from(new Set(roleIds));
  if (!ids.length) return { roles: [], seatings: [], circles: [], relations: [], grants: [] };
  const n = ids.length;
  const q = async (sql: string, args: unknown[]) => (await pool.query<RowDataPacket[]>(sql, args))[0];
  const [roles, seatings, circles, relations, grants] = await Promise.all([
    q(`SELECT ${ROLE_COLS}, archetypes_suggested FROM org_roles WHERE id IN (${marks(n)}) ORDER BY sort_order, name`, ids),
    q(`SELECT ${ASSIGN_COLS} FROM org_role_assignments WHERE ended_at IS NULL AND org_role_id IN (${marks(n)}) ORDER BY started_at, id`, ids),
    q(`SELECT id, name FROM circles WHERE id IN (SELECT circle_id FROM org_roles WHERE id IN (${marks(n)}))`, ids),
    q(
      "SELECT r.id, r.type_id, r.from_kind, r.from_id, r.to_kind, r.to_id, r.note, r.is_example " +
        `FROM org_relations r WHERE r.from_id IN (${marks(n)}) OR r.to_id IN (${marks(n)})`,
      [...ids, ...ids],
    ),
    q(`SELECT capability, holder_role_id FROM capability_holding WHERE holder_role_id IN (${marks(n)})`, ids),
  ]);
  return { roles, seatings, circles, relations, grants };
}

/** The role, when this person holds it live as a member, examples left out. */
export async function roleHeldBy(pool: Pool, userId: string, roleId: string): Promise<{ id: string; name: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT r.id, r.name FROM org_roles r WHERE r.id = ? AND r.is_example = 0 AND r.id IN (" +
      "SELECT org_role_id FROM org_role_assignments WHERE ended_at IS NULL AND holder_kind = 'member' AND is_example = 0 AND user_id = ?) LIMIT 1",
    [roleId, userId],
  );
  return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
}

/** The tables a sign may read, named the way `SignRows` names them. */
export type SignTable = Exclude<keyof SignRows, "season_id" | "circle_id">;

/**
 * The village-wide rows the sign counters read, each named table once.
 * `since` starts the previous moon, so both windows a trend compares are in.
 */
export async function readSignTables(
  pool: Pool,
  tables: ReadonlySet<SignTable>,
  since: Date,
  seasonId: string | null,
): Promise<{ rows: SignRows; names: Map<string, string> }> {
  const q = async (sql: string, args: unknown[]) => (await pool.query<RowDataPacket[]>(sql, args))[0] as any[];
  const want = (t: SignTable) => tables.has(t);
  const [apps, plans, users, claims, roles, seatings, drafts, sessions, people, entries] = await Promise.all([
    want("seat_applications")
      ? q("SELECT id, status, created_at, decided_at, candidate_user_id FROM seat_applications WHERE created_at >= ?", [since])
      : null,
    want("season_plans") && seasonId
      ? q("SELECT user_id, season_id, filed_at, superseded_at FROM season_plans WHERE season_id = ?", [seasonId])
      : null,
    // Always read when any sign is: it is also where a sheet's first names come from.
    tables.size ? q("SELECT id, name, joined_at FROM users WHERE is_example = 0", []) : null,
    want("quest_claims")
      ? q("SELECT user_id, status, claimed_at, consented_at FROM quest_claims WHERE claimed_at >= ? OR consented_at >= ?", [since, since])
      : null,
    want("org_roles") ? q("SELECT id, name, active, aim, domain, accountabilities FROM org_roles WHERE is_example = 0", []) : null,
    want("org_role_assignments")
      ? q(
          "SELECT org_role_id, user_id, started_at, ended_at, term_ends_at FROM org_role_assignments " +
            "WHERE is_example = 0 AND (ended_at IS NULL OR started_at >= ?)",
          [since],
        )
      : null,
    want("org_drafts") ? q("SELECT id, status, created_at, published_at FROM org_drafts WHERE created_at >= ?", [since]) : null,
    want("live_sessions") ? q("SELECT id, circle_id, created_at FROM live_sessions WHERE created_at >= ?", [since]) : null,
    want("live_session_people")
      ? q(
          "SELECT session_id, member_no FROM live_session_people WHERE session_id IN (SELECT id FROM live_sessions WHERE created_at >= ?)",
          [since],
        )
      : null,
    want("live_session_entries")
      ? q("SELECT session_id, kind, status, created_at FROM live_session_entries WHERE kind = 'decision' AND status = 'done' AND created_at >= ?", [since])
      : null,
  ]);
  const rows: SignRows = {};
  if (apps) rows.seat_applications = apps.map((r) => ({ ...r, id: String(r.id), candidate_user_id: String(r.candidate_user_id) }));
  if (plans) rows.season_plans = plans;
  if (seasonId) rows.season_id = seasonId;
  if (users && (want("users") || want("season_plans"))) rows.users = users.map((u) => ({ id: String(u.id), joined_at: u.joined_at }));
  if (claims) rows.quest_claims = claims;
  if (roles) rows.org_roles = roles.map((r) => ({ ...r, id: String(r.id), name: String(r.name ?? "") }));
  if (seatings) rows.org_role_assignments = seatings;
  if (drafts) rows.org_drafts = drafts;
  if (sessions) rows.live_sessions = sessions.map((s) => ({ ...s, id: Number(s.id) }));
  if (people) rows.live_session_people = people.map((p) => ({ session_id: Number(p.session_id), member_no: Number(p.member_no) }));
  if (entries) rows.live_session_entries = entries.map((e) => ({ ...e, session_id: Number(e.session_id) }));
  const names = new Map<string, string>((users ?? []).map((u) => [String(u.id), String(u.name ?? "")]));
  return { rows, names };
}
