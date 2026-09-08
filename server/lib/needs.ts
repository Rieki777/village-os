/**
 * The needs scope: what this village says it is for, and what meets it.
 *
 * Reads and writes `village_needs` and `need_links` (0186). The taxonomy it
 * validates against is shared/needs.ts, which is platform copy.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO, and it is the load-bearing half.
 * A need link is a DESCRIPTION, never a gate. A quest tagged to Play pays what
 * its mint rule says, and an untagged quest pays too. Nothing here imports
 * server/lib/economy.ts, server/lib/ledger.ts or server/lib/spending.ts, and
 * nothing here can move a token or refuse a claim. The one place a display tag
 * was allowed near a claim is `quests.archetypes`, and server/lib/characters.ts
 * holds it away from the money in its own words: "a class guides what you are
 * shown and never what you may claim". A needs tag that gated a payout would
 * be a second capability system nobody voted for.
 *
 * Where the scope DOES reach the economy is the report: the test run and the
 * health snapshot, both of which read from here and neither of which is built
 * in this lane. That is the founder's own framing, that setting the goal up
 * front helps orient the scope and the scale.
 *
 * THE POOL IS PASSED IN, never imported, so every function here is testable
 * against a scratch schema and none of them owns a connection.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
/**
 * THE ONE CYCLE ID, and this import is the whole of why it is spelled right.
 *
 * The design points at `cycleKeyFor` (server/lib/economy.ts:256). That is a
 * one-line delegate to this function, and importing economy.ts here would drag
 * the ledger, the mint and the settlement into a file whose header promises
 * none of them are reachable from it. gratitude-cycles.ts imports shared/lunar
 * and nothing else, and its own header calls `cycleIdFor` the only function
 * allowed to make one of these strings.
 */
import { cycleIdFor } from "./gratitude-cycles";
/*
 * THE THREE DIALS THIS FILE ACTS ON, read through the same accessor every
 * other server file uses. server/lib/variables.ts imports mysql2's types and
 * the registry and nothing else, so it drags neither the ledger nor the mint
 * behind it and the header's promise above still holds.
 */
import { numberVar, stringVar } from "./variables";
import {
  CUSTOM_NEED_PREFIX,
  depthAtLeast,
  HUMAN_NEEDS_BY_ID,
  isCustomNeedKey,
  isNeedDepth,
  isNeedSubject,
  isNeedWeight,
  needKeyProblem,
  needLabelFor,
  NEED_DEPTHS,
  type NeedDepth,
  type NeedSubject,
  type NeedWeight,
} from "../../shared/needs";

/** One need this village has taken on. `active` is derived, never stored. */
export interface NeedScopeRow {
  id: string;
  needKey: string;
  label: string;
  isCustom: boolean;
  depthTarget: NeedDepth;
  breadthTargetPct: number;
  note: string | null;
  sortOrder: number;
  adoptedAt: Date;
  retiredAt: Date | null;
  /**
   * DERIVED from `retiredAt`, so the two can never disagree.
   *
   * There is no `active` column. org_roles states the same rule about vacancy
   * in its own migration: a hand-set status column outlives the moment
   * somebody meant it, and then a row is active and retired at once.
   */
  active: boolean;
}

/** One tag joining a need to a thing that meets it. */
export interface NeedLinkRow {
  id: string;
  needId: string;
  subjectType: NeedSubject;
  subjectRef: string;
  weight: NeedWeight;
  createdBy: string | null;
  createdAt: Date;
}

/** What a scope write may carry. Everything but the key has a default. */
export interface ScopeInput {
  needKey: string;
  label?: string | null;
  depthTarget?: NeedDepth;
  breadthTargetPct?: number;
  note?: string | null;
  sortOrder?: number;
}

export interface LinkInput {
  needKey: string;
  subjectType: NeedSubject;
  subjectRef: string;
  weight?: NeedWeight;
  createdBy?: string | null;
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

const NEED_ID_PREFIX = "vneed";
const LINK_ID_PREFIX = "nlink";

/* -------------------------------------------------------------------------- *
 * Pure functions. Everything here is a decision about inputs, so it is
 * testable without a database and is exported for the route to reuse.
 * -------------------------------------------------------------------------- */

/**
 * Why this scope write may not land, or null when it may.
 *
 * `needKeyProblem` carries the custom-versus-platform rule. This adds the
 * numbers, and it CLIPS nothing: a value out of range is refused by name
 * rather than quietly rounded, because a founder who typed 400 meant
 * something and a silently stored 100 tells them nothing.
 */
export function scopeProblem(input: Partial<ScopeInput>): string | null {
  const keyProblem = needKeyProblem(input.needKey);
  if (keyProblem) return keyProblem;
  if (input.depthTarget !== undefined && !isNeedDepth(input.depthTarget)) {
    return "A depth is one of Deprived, Unmet, Alive, Satisfied or Thriving.";
  }
  if (input.breadthTargetPct !== undefined) {
    const pct = Number(input.breadthTargetPct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      return "A breadth is a whole number of percent, from 0 to 100.";
    }
  }
  if (input.sortOrder !== undefined && !Number.isInteger(Number(input.sortOrder))) {
    return "A sort order is a whole number.";
  }
  const custom = typeof input.needKey === "string" && isCustomNeedKey(input.needKey);
  const label = String(input.label ?? "").trim();
  if (custom && !label) {
    return "A need this list does not name needs a label of its own.";
  }
  return null;
}

/** Why this link may not land, or null when it may. */
export function linkProblem(input: Partial<LinkInput>): string | null {
  if (!isNeedSubject(input.subjectType)) {
    return "A link is onto a quest, a role, a sink, a stay, an event or a place.";
  }
  const ref = String(input.subjectRef ?? "").trim();
  if (!ref) return "A link needs to name the thing it is onto.";
  if (ref.length > 120) return "That reference is too long. 120 characters is the limit.";
  if (input.weight !== undefined && !isNeedWeight(input.weight)) {
    return "A weight is primary or partial.";
  }
  return null;
}

/**
 * The sentence the summary screen says, built from the scope alone.
 *
 * AN EMPTY SCOPE AND A SCOPE OF ZERO ARE DIFFERENT FACTS and this function
 * keeps them apart. A village with no rows has not answered yet;
 * a village that took on no needs has answered "none". The caller gets
 * `answered: false` for the first and a count of 0 for the second, so a screen
 * can say "you have not said yet" instead of printing a confident zero.
 */
export function scopeSummary(rows: NeedScopeRow[]): {
  answered: boolean;
  adopted: number;
  platformAdopted: number;
  customAdopted: number;
  retired: number;
  deepestTarget: NeedDepth | null;
} {
  const live = rows.filter((r) => r.active);
  // The ladder comes from shared/needs.ts and is never restated here. A second
  // copy of the order is how one screen comes to think Alive outranks
  // Satisfied.
  let deepest: NeedDepth | null = null;
  for (const r of live) {
    if (deepest === null || NEED_DEPTHS.indexOf(r.depthTarget) > NEED_DEPTHS.indexOf(deepest)) {
      deepest = r.depthTarget;
    }
  }
  return {
    answered: rows.length > 0,
    adopted: live.length,
    platformAdopted: live.filter((r) => !r.isCustom).length,
    customAdopted: live.filter((r) => r.isCustom).length,
    retired: rows.length - live.length,
    deepestTarget: deepest,
  };
}

/* -------------------------------------------------------------------------- *
 * Reads.
 * -------------------------------------------------------------------------- */

function toScopeRow(r: RowDataPacket): NeedScopeRow {
  const retiredAt = r.retired_at ? new Date(r.retired_at) : null;
  return {
    id: String(r.id),
    needKey: String(r.need_key),
    label: String(r.label),
    isCustom: Number(r.is_custom) === 1,
    depthTarget: String(r.depth_target) as NeedDepth,
    breadthTargetPct: Number(r.breadth_target_pct),
    note: r.note === null || r.note === undefined ? null : String(r.note),
    sortOrder: Number(r.sort_order),
    adoptedAt: new Date(r.adopted_at),
    retiredAt,
    active: retiredAt === null,
  };
}

function toLinkRow(r: RowDataPacket): NeedLinkRow {
  return {
    id: String(r.id),
    needId: String(r.need_id),
    subjectType: String(r.subject_type) as NeedSubject,
    subjectRef: String(r.subject_ref),
    weight: String(r.weight) as NeedWeight,
    createdBy: r.created_by === null || r.created_by === undefined ? null : String(r.created_by),
    createdAt: new Date(r.created_at),
  };
}

/**
 * The scope. Retired needs are EXCLUDED by default and asked for by name.
 *
 * A caller that wants the whole history says so, which keeps the ordinary read
 * honest: a screen listing the scope should not have to remember to filter.
 */
export async function readScope(
  pool: Pool,
  opts: { includeRetired?: boolean } = {},
): Promise<NeedScopeRow[]> {
  const where = opts.includeRetired ? "" : "WHERE `retired_at` IS NULL ";
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `need_key`, `label`, `is_custom`, `depth_target`, `breadth_target_pct`, `note`, " +
      "`sort_order`, `adopted_at`, `retired_at` FROM `village_needs` " +
      `${where}ORDER BY \`sort_order\`, \`adopted_at\`, \`id\``,
  );
  return rows.map(toScopeRow);
}

/** One scope row by its key, retired or not, or null. */
export async function readNeed(pool: Pool, needKey: string): Promise<NeedScopeRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `need_key`, `label`, `is_custom`, `depth_target`, `breadth_target_pct`, `note`, " +
      "`sort_order`, `adopted_at`, `retired_at` FROM `village_needs` WHERE `need_key` = ? LIMIT 1",
    [needKey],
  );
  return rows[0] ? toScopeRow(rows[0]) : null;
}

/* -------------------------------------------------------------------------- *
 * Writes.
 * -------------------------------------------------------------------------- */

/**
 * Take on a need, or change what this village said about one it already has.
 *
 * ONE ROW PER NEED KEY, held by the unique index and not by a read-then-write:
 * two founders ticking the same box in two tabs is an ordinary race and MySQL
 * settles it. An upsert onto a RETIRED row un-retires it, which is what
 * ticking the box again means, and its links are still there because retiring
 * never touched them.
 *
 * `label` is copied from the taxonomy at adoption for a platform need and is
 * typed for a custom one. Both are clipped by `needLabelFor` before they reach
 * the column: strict MySQL turns one over-long field into a LOST ROW.
 */
export async function upsertScopeNeed(
  pool: Pool,
  input: ScopeInput,
): Promise<{ ok: true; row: NeedScopeRow } | { ok: false; problem: string }> {
  const problem = scopeProblem(input);
  if (problem) return { ok: false, problem };
  const needKey = input.needKey.trim();
  const isCustom = isCustomNeedKey(needKey);
  const label = needLabelFor(needKey, input.label);
  // WHAT THE VILLAGE VOTED, and only where the caller said nothing. A scope
  // editor that names a rung or a share still wins: these two dials are the
  // starting point for a need adopted without one, which is what their
  // registry entries say they are.
  const depth: NeedDepth = input.depthTarget ?? defaultDepthTarget();
  const breadth = input.breadthTargetPct === undefined ? defaultBreadthPct() : Number(input.breadthTargetPct);
  const note = input.note === undefined || input.note === null ? null : String(input.note).slice(0, 4000);
  const sortOrder =
    input.sortOrder === undefined
      ? isCustom
        ? 100
        : Object.keys(HUMAN_NEEDS_BY_ID).indexOf(needKey)
      : Number(input.sortOrder);

  await pool.query(
    "INSERT INTO `village_needs` " +
      "(`id`, `need_key`, `label`, `is_custom`, `depth_target`, `breadth_target_pct`, `note`, `sort_order`) " +
      "VALUES (?,?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `depth_target` = VALUES(`depth_target`), " +
      "`breadth_target_pct` = VALUES(`breadth_target_pct`), `note` = VALUES(`note`), " +
      "`sort_order` = VALUES(`sort_order`), `retired_at` = NULL",
    [newId(NEED_ID_PREFIX), needKey, label, isCustom ? 1 : 0, depth, breadth, note, sortOrder],
  );
  const row = await readNeed(pool, needKey);
  if (!row) return { ok: false, problem: "That need did not save." };
  return { ok: true, row };
}

/**
 * Retire a need. THE LINKS STAY, and so does anything frozen against it.
 *
 * A retired need is out of scope and still readable, so a health snapshot
 * written under `needs_met_<key>` at a cycle that has already closed still has
 * a label and a depth target to render against. Snapshots are frozen once and
 * never recomputed, so a delete here would strand them.
 *
 * Retiring twice is a no-op: the second call finds `retired_at` already set
 * and reports `changed: false` without moving the timestamp, so a retyped
 * button press cannot rewrite when the village decided.
 */
export async function retireNeed(
  pool: Pool,
  needKey: string,
): Promise<{ found: boolean; changed: boolean; row: NeedScopeRow | null }> {
  const before = await readNeed(pool, needKey);
  if (!before) return { found: false, changed: false, row: null };
  if (!before.active) return { found: true, changed: false, row: before };
  await pool.query("UPDATE `village_needs` SET `retired_at` = NOW() WHERE `need_key` = ? AND `retired_at` IS NULL", [
    needKey,
  ]);
  return { found: true, changed: true, row: await readNeed(pool, needKey) };
}

/** Put a retired need back in scope, keeping its links and its history. */
export async function reviveNeed(pool: Pool, needKey: string): Promise<NeedScopeRow | null> {
  await pool.query("UPDATE `village_needs` SET `retired_at` = NULL WHERE `need_key` = ?", [needKey]);
  return readNeed(pool, needKey);
}

/**
 * Tag a thing as meeting a need.
 *
 * The unique key is (need, subject type, subject ref), so tagging the same
 * quest twice updates the weight and never doubles the count. The need must
 * exist; tagging a need this village has not taken on is refused by name,
 * because a link to nothing is what makes a coverage read lie.
 */
export async function linkNeed(
  pool: Pool,
  input: LinkInput,
): Promise<{ ok: true; row: NeedLinkRow } | { ok: false; problem: string }> {
  const problem = linkProblem(input);
  if (problem) return { ok: false, problem };
  const need = await readNeed(pool, input.needKey);
  if (!need) return { ok: false, problem: `This village has not taken on "${input.needKey}".` };
  const subjectRef = String(input.subjectRef).trim();
  const weight: NeedWeight = input.weight ?? "primary";
  const createdBy = input.createdBy ? String(input.createdBy).slice(0, 64) : null;
  await pool.query(
    "INSERT INTO `need_links` (`id`, `need_id`, `subject_type`, `subject_ref`, `weight`, `created_by`) " +
      "VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `weight` = VALUES(`weight`)",
    [newId(LINK_ID_PREFIX), need.id, input.subjectType, subjectRef, weight, createdBy],
  );
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `id`, `need_id`, `subject_type`, `subject_ref`, `weight`, `created_by`, `created_at` " +
      "FROM `need_links` WHERE `need_id` = ? AND `subject_type` = ? AND `subject_ref` = ? LIMIT 1",
    [need.id, input.subjectType, subjectRef],
  );
  if (!rows[0]) return { ok: false, problem: "That link did not save." };
  return { ok: true, row: toLinkRow(rows[0]) };
}

/** Take one tag off. Returns false when there was nothing there. */
export async function unlinkNeed(pool: Pool, linkId: string): Promise<boolean> {
  const [r] = await pool.query<any>("DELETE FROM `need_links` WHERE `id` = ?", [linkId]);
  return Number(r?.affectedRows ?? 0) > 0;
}

/**
 * Every link onto one subject, so deleting a quest can clear its tags.
 *
 * The reconciler this replaces a foreign key with. Nothing here runs on a
 * schedule: the domain that owns the subject calls it when the subject goes.
 */
export async function unlinkSubject(pool: Pool, subjectType: NeedSubject, subjectRef: string): Promise<number> {
  const [r] = await pool.query<any>("DELETE FROM `need_links` WHERE `subject_type` = ? AND `subject_ref` = ?", [
    subjectType,
    subjectRef,
  ]);
  return Number(r?.affectedRows ?? 0);
}

/* -------------------------------------------------------------------------- *
 * Link reads.
 * -------------------------------------------------------------------------- */

/** Every tag on one need, retired or not. */
export async function linksForNeed(pool: Pool, needKey: string): Promise<NeedLinkRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.`id`, l.`need_id`, l.`subject_type`, l.`subject_ref`, l.`weight`, l.`created_by`, l.`created_at` " +
      "FROM `need_links` l JOIN `village_needs` n ON n.`id` = l.`need_id` " +
      "WHERE n.`need_key` = ? ORDER BY l.`subject_type`, l.`subject_ref`",
    [needKey],
  );
  return rows.map(toLinkRow);
}

/** Every need one thing meets. A quest may meet three. */
export async function linksForSubject(
  pool: Pool,
  subjectType: NeedSubject,
  subjectRef: string,
): Promise<Array<NeedLinkRow & { needKey: string; needLabel: string; needActive: boolean }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT l.`id`, l.`need_id`, l.`subject_type`, l.`subject_ref`, l.`weight`, l.`created_by`, l.`created_at`, " +
      "n.`need_key`, n.`label`, n.`retired_at` " +
      "FROM `need_links` l JOIN `village_needs` n ON n.`id` = l.`need_id` " +
      "WHERE l.`subject_type` = ? AND l.`subject_ref` = ? ORDER BY n.`sort_order`, n.`need_key`",
    [subjectType, subjectRef],
  );
  return rows.map((r) => ({
    ...toLinkRow(r),
    needKey: String(r.need_key),
    needLabel: String(r.label),
    needActive: r.retired_at === null,
  }));
}

/* -------------------------------------------------------------------------- *
 * The two derived reads.
 * -------------------------------------------------------------------------- */

/** One need in scope, with what is tagged to it counted by kind. */
export interface NeedCoverageRow {
  needKey: string;
  label: string;
  depthTarget: NeedDepth;
  breadthTargetPct: number;
  /** Counts by subject type, every kind present as a key so a zero is a zero. */
  counts: Record<NeedSubject, number>;
  total: number;
  primaryCount: number;
  /** True when nothing at all is tagged to this need. */
  uncovered: boolean;
}

/**
 * What meets each need this village took on, and what meets none of them.
 *
 * ONE ROW PER NEED IN SCOPE, including the needs with nothing, because a need
 * with nothing tagged to it is the whole point of the read. The empty state
 * and the real zero stay apart: a village with no scope at all gets an empty
 * array and `scopeSummary().answered` is false, while a village that took on
 * Play and tagged nothing to it gets a row with `total: 0`.
 *
 * A LEFT JOIN and not a subquery per need, so the cost is one round trip
 * whatever the scope is.
 */
export async function needsCoverage(pool: Pool): Promise<NeedCoverageRow[]> {
  const scope = await readScope(pool);
  if (scope.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT n.`need_key` AS need_key, l.`subject_type` AS subject_type, l.`weight` AS weight, " +
      "COUNT(*) AS n FROM `village_needs` n JOIN `need_links` l ON l.`need_id` = n.`id` " +
      "WHERE n.`retired_at` IS NULL GROUP BY n.`need_key`, l.`subject_type`, l.`weight`",
  );
  const blank = (): Record<NeedSubject, number> => ({
    quest: 0,
    role: 0,
    sink: 0,
    stay: 0,
    event: 0,
    place: 0,
  });
  const byNeed = new Map<string, NeedCoverageRow>();
  for (const need of scope) {
    byNeed.set(need.needKey, {
      needKey: need.needKey,
      label: need.label,
      depthTarget: need.depthTarget,
      breadthTargetPct: need.breadthTargetPct,
      counts: blank(),
      total: 0,
      primaryCount: 0,
      uncovered: true,
    });
  }
  for (const r of rows) {
    const row = byNeed.get(String(r.need_key));
    if (!row) continue;
    const kind = String(r.subject_type) as NeedSubject;
    const n = Number(r.n);
    row.counts[kind] += n;
    row.total += n;
    if (String(r.weight) === "primary") row.primaryCount += n;
    row.uncovered = false;
  }
  return scope.map((s) => byNeed.get(s.needKey) as NeedCoverageRow);
}

/** The seats one need in scope leans on, and how many of them are held. */
export interface NeedSeatingRow {
  needKey: string;
  label: string;
  /** Seats the linked roles advertise, summed. R18's "roles you need". */
  seatsNeeded: number;
  /** Live seatings against those roles. R18's "roles filled". */
  seatsFilled: number;
  /** Linked roles that no live seating touches at all. */
  rolesWithNobodyInThem: Array<{ roleId: string; name: string; seats: number; held: number }>;
}

/**
 * Roles needed, of roles filled, per need in scope. R18 made countable.
 *
 * WHERE THE TWO HALVES COME FROM, and neither is invented here. `org_roles`
 * declares `seats` and says in migration 0049's own comment that vacancy is
 * DERIVED from active assignments below seats and is never a status column. So
 * "filled" is `org_role_assignments` with `ended_at IS NULL`, which is the same
 * clause the settlement and `loadOrgChart` use, so a needs screen and a payout
 * cannot disagree about what a held seat is.
 *
 * WHAT THIS DOES NOT DO, stated so a later lane does not read more into it.
 * It counts LIVE seatings and does not apply the lapse rule, which needs the
 * season context a caller reads (`lapseContext` in server/index.ts) and which
 * `seatState` in server/lib/orgChart.ts owns. A seat whose holder's mandate has
 * run out counts as held here and reads `expired` on the org chart. Applying
 * lapse from this file would be a second implementation of that rule.
 *
 * It also does not propose how many roles a depth target IMPLIES. That figure
 * is a proposal and belongs with the test run, which prints its estimates as
 * estimates. This read is a measurement: linked seats, and who is in them.
 */
export async function needSeatings(pool: Pool): Promise<NeedSeatingRow[]> {
  const scope = await readScope(pool);
  if (scope.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT n.`need_key` AS need_key, r.`id` AS role_id, r.`name` AS role_name, r.`seats` AS seats, " +
      "(SELECT COUNT(*) FROM `org_role_assignments` a WHERE a.`org_role_id` = r.`id` AND a.`ended_at` IS NULL) AS held " +
      "FROM `village_needs` n " +
      "JOIN `need_links` l ON l.`need_id` = n.`id` AND l.`subject_type` = 'role' " +
      "JOIN `org_roles` r ON r.`id` = l.`subject_ref` AND r.`active` = 1 " +
      "WHERE n.`retired_at` IS NULL ORDER BY n.`sort_order`, r.`sort_order`, r.`id`",
  );
  const byNeed = new Map<string, NeedSeatingRow>();
  for (const need of scope) {
    byNeed.set(need.needKey, {
      needKey: need.needKey,
      label: need.label,
      seatsNeeded: 0,
      seatsFilled: 0,
      rolesWithNobodyInThem: [],
    });
  }
  for (const r of rows) {
    const row = byNeed.get(String(r.need_key));
    if (!row) continue;
    const seats = Number(r.seats);
    const held = Number(r.held);
    row.seatsNeeded += seats;
    // A seat held by more people than it advertises still fills that seat once.
    row.seatsFilled += Math.min(held, seats);
    if (held === 0) {
      row.rolesWithNobodyInThem.push({
        roleId: String(r.role_id),
        name: String(r.role_name),
        seats,
        held,
      });
    }
  }
  return scope.map((s) => byNeed.get(s.needKey) as NeedSeatingRow);
}

/** Both derived reads and the summary, for the one screen that wants all three. */
export async function coverageReport(pool: Pool): Promise<{
  answered: boolean;
  summary: ReturnType<typeof scopeSummary>;
  coverage: NeedCoverageRow[];
  seatings: NeedSeatingRow[];
  /** Needs in scope with nothing tagged to them at all. */
  uncovered: string[];
}> {
  const scope = await readScope(pool, { includeRetired: true });
  const summary = scopeSummary(scope);
  const coverage = await needsCoverage(pool);
  const seatings = await needSeatings(pool);
  return {
    answered: summary.answered,
    summary,
    coverage,
    seatings,
    uncovered: coverage.filter((c) => c.uncovered).map((c) => c.needKey),
  };
}

/** Re-exported so a caller has one import for the whole domain. */
export { CUSTOM_NEED_PREFIX };

/* -------------------------------------------------------------------------- *
 * The member's own card: `member_needs` (0187). Lane N4.
 *
 * WHAT THE VILLAGE MAY READ FROM THIS TABLE, and it is the whole design: a
 * COUNT, and only above a floor. There is no function below that returns
 * another member's row, and no route that calls one. A steward, an admin and
 * the founder all read the same aggregate every other member reads.
 *
 * WHY THAT IS STRUCTURAL AND NOT A PROMISE. `readMemberNeeds` takes the user
 * id it filters on, and the only caller passes the id off the signed-in
 * member's own token. `needsAggregate` takes no user id at all and its SELECT
 * names no `user_id` in its column list, so a caller who wanted a name would
 * have to write new SQL to get one.
 * -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- *
 * THE THREE NUMBERS A VILLAGE VOTES, AND THIS FILE OBEYS.
 *
 * `needs.aggregate_floor`, `needs.default_depth_target` and
 * `needs.default_breadth_pct` are open-ring dials any member may put on a
 * ballot. Each of the three constants below is the value the registry
 * DECLARES as the platform default, kept here so a reader can see it and
 * pinned against the registry by needs.dials.test.ts. None of the three is
 * the value this file acts on: the accessors beside them are, and every one
 * of them reads AT THE POINT OF USE. Reading at module load would freeze the
 * platform default into the bundle, because the override cache is filled
 * after the stores initialise, and every village that voted would be served
 * the number it voted against.
 *
 * WHAT THE FLOOR IS FOR. The smallest number of answers on one need that may
 * be shown as a count. 3 is the smallest floor at which a count cannot be
 * read back to a person by elimination once two of three answers are known,
 * and it is a floor a village of thirteen can clear on a need only a few
 * people care about. A village where four people are identifiable to each
 * other raises it, and the raise now reaches the SQL and the sentence
 * together.
 *
 * 1 IS THE SMALLEST FLOOR THE ENGINE HONOURS, and the registry agrees (min 1).
 * A floor of 0 would suppress nothing while claiming to suppress something,
 * so a value under 1 is clamped here instead of being trusted.
 * -------------------------------------------------------------------------- */

/** What the registry declares as the platform floor. Never what is enforced. */
export const NEEDS_AGGREGATE_FLOOR = 3;

/** What the registry declares as the platform rung. Never what is written. */
export const NEEDS_DEFAULT_DEPTH_TARGET: NeedDepth = "satisfied";

/** What the registry declares as the platform share. Never what is written. */
export const NEEDS_DEFAULT_BREADTH_PCT = 100;

/** The floor in force: this village's dial, clamped to the registry's own min. */
export function aggregateFloor(): number {
  const voted = Math.trunc(numberVar("needs.aggregate_floor"));
  return Number.isFinite(voted) ? Math.max(1, voted) : NEEDS_AGGREGATE_FLOOR;
}

/**
 * The rung a need starts at when the village adopts it without choosing one.
 *
 * A value the ladder does not name falls back to the declared default. The
 * registry validates the choice on the way in, so this can only fire on a row
 * written before a rung was renamed, and a need silently adopted at a rung
 * nothing names would compare against nothing.
 */
export function defaultDepthTarget(): NeedDepth {
  const voted = stringVar("needs.default_depth_target");
  return isNeedDepth(voted) ? voted : NEEDS_DEFAULT_DEPTH_TARGET;
}

/** The share a need aims at when the village adopts it without a figure. */
export function defaultBreadthPct(): number {
  const voted = Math.trunc(numberVar("needs.default_breadth_pct"));
  return Number.isFinite(voted) ? Math.min(100, Math.max(0, voted)) : NEEDS_DEFAULT_BREADTH_PCT;
}

/**
 * What a member's own row may be seen by. ONE VALUE THIS RELEASE.
 *
 * The column is `enum('private')` in 0187 for the reasons its header gives.
 * This array is what the route validates against, so the refusal is a sentence
 * and never a MySQL error, and the two can never disagree about the list.
 */
export const MEMBER_NEED_VISIBILITIES = ["private"] as const;
export type MemberNeedVisibility = (typeof MEMBER_NEED_VISIBILITIES)[number];

/** The widths 0187 declares. Clipped HERE, before the insert, never by MySQL. */
export const MEMBER_NEED_FEELING_MAX = 64;
export const MEMBER_NEED_NOTE_MAX = 500;

/** One member's answer about one need in one moon. */
export interface MemberNeedRow {
  id: string;
  needKey: string;
  depth: NeedDepth;
  feeling: string | null;
  note: string | null;
  visibility: MemberNeedVisibility;
  cycleId: string;
  recordedAt: Date;
  updatedAt: Date;
}

/** What a member may send. Everything but the key and the rung is optional. */
export interface MemberNeedInput {
  needKey: string;
  depth: NeedDepth;
  feeling?: string | null;
  note?: string | null;
  /** Present only so a client that sends one is REFUSED by name. */
  visibility?: string;
}

const MEMBER_NEED_ID_PREFIX = "mneed";

/**
 * Why this answer may not be saved, or null when it may.
 *
 * The visibility clause is the load-bearing one. A client that sends
 * "village" is told what happened in a sentence, because a request silently
 * downgraded to private teaches the member that the field works.
 */
export function memberNeedProblem(input: Partial<MemberNeedInput>): string | null {
  const keyProblem = needKeyProblem(input.needKey);
  if (keyProblem) return keyProblem;
  if (!isNeedDepth(input.depth)) {
    return "Say where you are with it: Deprived, Unmet, Alive, Satisfied or Thriving.";
  }
  if (input.visibility !== undefined && input.visibility !== "private") {
    return "Your answer is private. This release ships no other setting for it.";
  }
  return null;
}

function toMemberNeedRow(r: RowDataPacket): MemberNeedRow {
  return {
    id: String(r.id),
    needKey: String(r.need_key),
    depth: String(r.depth) as NeedDepth,
    feeling: r.feeling === null || r.feeling === undefined ? null : String(r.feeling),
    note: r.note === null || r.note === undefined ? null : String(r.note),
    visibility: String(r.visibility) as MemberNeedVisibility,
    cycleId: String(r.cycle_id),
    recordedAt: new Date(r.recorded_at),
    updatedAt: new Date(r.updated_at),
  };
}

const MEMBER_NEED_COLUMNS =
  "`id`, `need_key`, `depth`, `feeling`, `note`, `visibility`, `cycle_id`, `recorded_at`, `updated_at`";

/**
 * Trim and clip one free-text field, or null.
 *
 * STRICT MYSQL DOES NOT TRUNCATE, IT REFUSES THE ROW, so a member typing past
 * the width would lose every word of the answer and be told nothing they could
 * act on. The clip happens on this side of the insert for the same reason
 * `needLabelFor` clips the scope's label.
 */
function clipOrNull(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Save one member's answer about one need, for one moon.
 *
 * `visibility` IS SET HERE AND NEVER READ FROM THE INPUT. The column takes the
 * literal, so no code path exists that could write another value even if the
 * refusal above were removed. The ON DUPLICATE clause does not name it either,
 * so a second save cannot raise a row that was already saved.
 *
 * The cycle stamp comes from `cycleIdFor`, which server/lib/gratitude-cycles.ts
 * calls the only function allowed to make one. An answer changed twice inside
 * one moon updates the same row; the next moon is a new row, and last moon's
 * answer is still there to be compared against.
 */
export async function saveMemberNeed(
  pool: Pool,
  userId: string,
  input: MemberNeedInput,
  at: Date = new Date(),
): Promise<{ ok: true; row: MemberNeedRow } | { ok: false; problem: string }> {
  const problem = memberNeedProblem(input);
  if (problem) return { ok: false, problem };
  const uid = String(userId ?? "").trim().slice(0, 64);
  if (!uid) return { ok: false, problem: "Sign in to answer this." };
  const needKey = input.needKey.trim();
  const cycleId = cycleIdFor(at);
  const feeling = clipOrNull(input.feeling, MEMBER_NEED_FEELING_MAX);
  const note = clipOrNull(input.note, MEMBER_NEED_NOTE_MAX);
  await pool.query(
    "INSERT INTO `member_needs` " +
      "(`id`, `user_id`, `need_key`, `depth`, `feeling`, `note`, `visibility`, `cycle_id`) " +
      "VALUES (?,?,?,?,?,?,'private',?) " +
      "ON DUPLICATE KEY UPDATE `depth` = VALUES(`depth`), `feeling` = VALUES(`feeling`), " +
      "`note` = VALUES(`note`)",
    [newId(MEMBER_NEED_ID_PREFIX), uid, needKey, input.depth, feeling, note, cycleId],
  );
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${MEMBER_NEED_COLUMNS} FROM \`member_needs\` ` +
      "WHERE `user_id` = ? AND `need_key` = ? AND `cycle_id` = ? LIMIT 1",
    [uid, needKey, cycleId],
  );
  if (!rows[0]) return { ok: false, problem: "That answer did not save." };
  return { ok: true, row: toMemberNeedRow(rows[0]) };
}

/**
 * One member's own answers. THE ONLY READ THAT RETURNS A ROW.
 *
 * Defaults to the moon in progress, because that is the card's question. A
 * caller that wants the whole history says `allCycles`, which is what a data
 * export would ask for.
 */
export async function readMemberNeeds(
  pool: Pool,
  userId: string,
  opts: { allCycles?: boolean; at?: Date } = {},
): Promise<MemberNeedRow[]> {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];
  if (opts.allCycles) {
    const [all] = await pool.query<RowDataPacket[]>(
      `SELECT ${MEMBER_NEED_COLUMNS} FROM \`member_needs\` WHERE \`user_id\` = ? ` +
        "ORDER BY `cycle_id` DESC, `need_key`",
      [uid],
    );
    return all.map(toMemberNeedRow);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${MEMBER_NEED_COLUMNS} FROM \`member_needs\` WHERE \`user_id\` = ? AND \`cycle_id\` = ? ` +
      "ORDER BY `need_key`",
    [uid, cycleIdFor(opts.at ?? new Date())],
  );
  return rows.map(toMemberNeedRow);
}

/** Take one answer back. Returns false when there was nothing to take back. */
export async function deleteMemberNeed(
  pool: Pool,
  userId: string,
  needKey: string,
  at: Date = new Date(),
): Promise<boolean> {
  const uid = String(userId ?? "").trim();
  if (!uid || !needKey) return false;
  const [r] = await pool.query<any>(
    "DELETE FROM `member_needs` WHERE `user_id` = ? AND `need_key` = ? AND `cycle_id` = ?",
    [uid, String(needKey).trim(), cycleIdFor(at)],
  );
  return Number(r?.affectedRows ?? 0) > 0;
}

/**
 * Every answer this member ever gave, gone. What the tombstone calls.
 *
 * DELETED AND NOT ANONYMIZED, which is the opposite of what the value tables
 * do. The ledger keeps its rows because conservation has to keep holding and
 * the village owes somebody the record. This table holds no value and settles
 * nothing: it is one person's words about their own life, and there is no
 * accounting reason to keep a single one of them.
 *
 * WHERE THIS IS CALLED FROM. `anonymizeMember` in server/index.ts, which exit
 * resolve runs. That function sits inside the monolith, which is under a
 * no-net-lines ratchet this lane may not spend, so the call is a one-line
 * addition another hand makes beside `eraseIntentsForMember`. The function is
 * here, tested, and takes exactly the arguments that line would pass.
 */
export async function forgetMemberNeeds(pool: Pool, userId: string): Promise<number> {
  const uid = String(userId ?? "").trim();
  if (!uid) return 0;
  const [r] = await pool.query<any>("DELETE FROM `member_needs` WHERE `user_id` = ?", [uid]);
  return Number(r?.affectedRows ?? 0);
}

/* -------------------------------------------------------------------------- *
 * The aggregate. Counts, never rows.
 * -------------------------------------------------------------------------- */

/** How one need is going across the village, as two numbers or as nothing. */
export interface NeedAggregateRow {
  needKey: string;
  /** The village's own word for it, when it took the need on. */
  label: string;
  /** The rung this village aims at, or its voted default when out of scope. */
  depthTarget: NeedDepth;
  /** True when this need is one the village said it was for. */
  inScope: boolean;
  /** Members at or above the target. Null when the answers are too few. */
  atOrAbove: number | null;
  /** Members below it. Null when the answers are too few. */
  below: number | null;
  /** How many answered at all. Null when the answers are too few. */
  answers: number | null;
  /** True when the counts were withheld, so a screen can say why. */
  suppressed: boolean;
}

/**
 * Per need, how many members are at or above the target and how many below.
 *
 * THE FLOOR IS COUNTED IN ANSWERS ON THAT NEED, never in members on the roll.
 * A village of two hundred where three people answered about Love is exactly
 * the case the rule is for: the count is small, the answers are recent, and
 * two people who know they both answered can read the third off the total. So
 * the suppression asks the question the leak asks, which is how many answers
 * this number is made of.
 *
 * A SUPPRESSED ROW IS STILL A ROW, carrying nulls and `suppressed: true`. An
 * absent row would say the need does not exist; a zero would say nobody is
 * struggling. Neither is what "too few answers to show" means, and a screen
 * that cannot tell the three apart prints a confident number about a village
 * it knows nothing about.
 *
 * NEEDS WITH NO ANSWERS AT ALL still appear when they are in scope, with
 * `suppressed: true`, because the village asking and nobody answering is a
 * fact worth seeing. A need OUT of scope appears only once somebody has
 * answered on it, which is how a village hears about a need it never took on.
 */
export async function needsAggregate(
  pool: Pool,
  opts: { at?: Date; cycleId?: string; floor?: number } = {},
): Promise<{ cycleId: string; floor: number; needs: NeedAggregateRow[] }> {
  const cycleId = opts.cycleId ?? cycleIdFor(opts.at ?? new Date());
  const floor = opts.floor ?? aggregateFloor();
  // Read ONCE per report, so every out-of-scope need in one payload is judged
  // against the same rung even when a write lands mid-loop.
  const fallbackTarget = defaultDepthTarget();
  const scope = await readScope(pool);
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT `need_key` AS need_key, `depth` AS depth, COUNT(*) AS n FROM `member_needs` " +
      "WHERE `cycle_id` = ? GROUP BY `need_key`, `depth`",
    [cycleId],
  );
  const tallies = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = String(r.need_key);
    const byDepth = tallies.get(key) ?? new Map<string, number>();
    byDepth.set(String(r.depth), Number(r.n));
    tallies.set(key, byDepth);
  }
  const scopeByKey = new Map(scope.map((s) => [s.needKey, s]));
  const answeredKeys = Array.from(tallies.keys()).filter((k) => !scopeByKey.has(k));
  const keys = scope.map((s) => s.needKey).concat(answeredKeys);
  const out: NeedAggregateRow[] = [];
  for (const key of keys) {
    const inScopeRow = scopeByKey.get(key) ?? null;
    const target: NeedDepth = inScopeRow?.depthTarget ?? fallbackTarget;
    const byDepth = tallies.get(key) ?? new Map<string, number>();
    let atOrAbove = 0;
    let below = 0;
    for (const [depth, n] of Array.from(byDepth.entries())) {
      if (!isNeedDepth(depth)) continue;
      if (depthAtLeast(depth, target)) atOrAbove += n;
      else below += n;
    }
    const answers = atOrAbove + below;
    const suppressed = answers < floor;
    out.push({
      needKey: key,
      label: inScopeRow?.label ?? needLabelFor(key, null),
      depthTarget: target,
      inScope: inScopeRow !== null,
      atOrAbove: suppressed ? null : atOrAbove,
      below: suppressed ? null : below,
      answers: suppressed ? null : answers,
      suppressed,
    });
  }
  return { cycleId, floor, needs: out };
}
