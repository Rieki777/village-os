/**
 * `budget_lines` and `budget_syncs` (0347): every statement against them, plus
 * the reads the budget needs from the chart and from `cash_owed`.
 *
 * One function per statement, handing back what the driver handed back. Every
 * decision (what a key is, which lines count, who may write) stays in
 * server/lib/budgets.ts, so this file imports nothing from server/lib.
 *
 * Each takes a pool OR a connection, because a confirmed import runs on one
 * connection that holds the budget's lock and its transaction from the read
 * of the state to the last write, so two confirms can never both read the
 * same state and both write.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;

/** The writable columns of one line, in the order the statements below name them. */
export interface BudgetLineRow {
  id: string;
  lineKey: string;
  source: "upload" | "sera" | "manual";
  sourceRef: string | null;
  sourceChangedAt: Date | null;
  periodKind: "moon" | "month" | "season" | "span";
  periodKey: string;
  startsOn: string;
  endsOn: string;
  circleId: string | null;
  roleId: string | null;
  matched: boolean;
  /** A source's line that named no circle and landed on the village's circle (R34). */
  sourceVillageWide: boolean;
  category: "role_pay" | "quest_pay" | "materials" | "other";
  plannedMinor: number;
  spentMinor: number | null;
  currency: string;
  label: string;
  sourceLabel: string | null;
  note: string | null;
  status: "approved" | "draft" | "closed" | "withdrawn";
  adoptedAt: Date | null;
  adoptedAs: string | null;
  changedBy: string | null;
  changedAs: string | null;
  /** A rate a person locked (spec 5a): decimal text, its source, its day, who and when. */
  fxRate: string | null;
  fxSource: string | null;
  fxAsOf: string | null;
  fxLockedBy: string | null;
  fxLockedAt: Date | null;
  /** The amount before the last change, and when that amount was written (v0.4, R18). */
  prevPlannedMinor: number | null;
  prevSeenAt: Date | null;
}

const COLUMNS =
  "`id`, `line_key`, `source`, `source_ref`, `source_changed_at`, `period_kind`, `period_key`, `starts_on`, `ends_on`, " +
  "`circle_id`, `role_id`, `matched`, `source_village_wide`, `category`, `planned_minor`, `spent_minor`, `currency`, `label`, `source_label`, `note`, " +
  "`status`, `adopted_at`, `adopted_as`, `changed_by`, `changed_as`, `fx_rate`, `fx_source`, `fx_as_of`, `fx_locked_by`, `fx_locked_at`, `prev_planned_minor`, `prev_seen_at`";

const values = (r: BudgetLineRow): unknown[] => [
  r.id, r.lineKey, r.source, r.sourceRef, r.sourceChangedAt, r.periodKind, r.periodKey, r.startsOn, r.endsOn,
  r.circleId, r.roleId, r.matched ? 1 : 0, r.sourceVillageWide ? 1 : 0, r.category, r.plannedMinor, r.spentMinor, r.currency, r.label, r.sourceLabel, r.note,
  r.status, r.adoptedAt, r.adoptedAs, r.changedBy, r.changedAs, r.fxRate, r.fxSource, r.fxAsOf, r.fxLockedBy, r.fxLockedAt, r.prevPlannedMinor, r.prevSeenAt,
];

/**
 * Every line, oldest period first. Dates come back as `YYYY-MM-DD` text
 * through DATE_FORMAT, never as a driver Date, because a DATE read through a
 * driver that parses it as an instant moves a day east of UTC.
 */
export async function budgetLineRows(db: Db): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT *, DATE_FORMAT(`starts_on`, '%Y-%m-%d') AS `starts_on_text`, DATE_FORMAT(`ends_on`, '%Y-%m-%d') AS `ends_on_text`, " +
      "DATE_FORMAT(`fx_as_of`, '%Y-%m-%d') AS `fx_as_of_text` FROM `budget_lines` ORDER BY `starts_on`, `id`",
  );
  return rows;
}

export async function insertBudgetLine(db: Db, r: BudgetLineRow): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO \`budget_lines\` (${COLUMNS}, \`changed_at\`) VALUES (${Array.from({ length: 33 }, () => "?").join(", ")})`,
    [...values(r), new Date()],
  );
  return res;
}

/** Rewrite one line whole, by id. The key is never rewritten: a line keeps the identity it was made with. */
export async function updateBudgetLine(db: Db, r: BudgetLineRow): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE `budget_lines` SET `source` = ?, `source_ref` = ?, `source_changed_at` = ?, `period_kind` = ?, `period_key` = ?, `starts_on` = ?, `ends_on` = ?, " +
      "`circle_id` = ?, `role_id` = ?, `matched` = ?, `source_village_wide` = ?, `category` = ?, `planned_minor` = ?, `spent_minor` = ?, `currency` = ?, `label` = ?, `source_label` = ?, `note` = ?, " +
      "`status` = ?, `adopted_at` = ?, `adopted_as` = ?, `changed_by` = ?, `changed_as` = ?, " +
      "`fx_rate` = ?, `fx_source` = ?, `fx_as_of` = ?, `fx_locked_by` = ?, `fx_locked_at` = ?, `prev_planned_minor` = ?, `prev_seen_at` = ?, `changed_at` = ? WHERE `id` = ?",
    [
      r.source, r.sourceRef, r.sourceChangedAt, r.periodKind, r.periodKey, r.startsOn, r.endsOn,
      r.circleId, r.roleId, r.matched ? 1 : 0, r.sourceVillageWide ? 1 : 0, r.category, r.plannedMinor, r.spentMinor, r.currency, r.label, r.sourceLabel, r.note,
      r.status, r.adoptedAt, r.adoptedAs, r.changedBy, r.changedAs, r.fxRate, r.fxSource, r.fxAsOf, r.fxLockedBy, r.fxLockedAt, r.prevPlannedMinor, r.prevSeenAt, new Date(), r.id,
    ],
  );
  return res;
}

export interface BudgetSyncRow {
  id: string;
  source: "upload" | "sera" | "manual";
  by: string | null;
  byAs: string | null;
  scope: unknown;
  whole: boolean;
  lines: number;
  added: number;
  changed: number;
  withdrawn: number;
  refused: number;
  ok: boolean;
  error: string | null;
  /** What was imported, in the holder's words, and an optional https address of it (R29). */
  sourceLabel: string | null;
  sourceLink: string | null;
}

export async function insertBudgetSync(db: Db, r: BudgetSyncRow): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `budget_syncs` (`id`, `source`, `at`, `by`, `by_as`, `scope`, `whole`, `lines`, `added`, `changed`, `withdrawn`, `refused`, `ok`, `error`, `source_label`, `source_link`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      r.id, r.source, new Date(), r.by, r.byAs, r.scope === undefined ? null : JSON.stringify(r.scope), r.whole ? 1 : 0,
      r.lines, r.added, r.changed, r.withdrawn, r.refused, r.ok ? 1 : 0, r.error, r.sourceLabel, r.sourceLink,
    ],
  );
  return res;
}

/** The newest import per source: what "last synced" reads (R5). */
export async function latestBudgetSyncs(db: Db): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT s.* FROM `budget_syncs` s JOIN (SELECT `source`, MAX(`at`) AS `at` FROM `budget_syncs` GROUP BY `source`) n " +
      "ON n.`source` = s.`source` AND n.`at` = s.`at` ORDER BY s.`source`, s.`id` DESC",
  );
  return rows;
}

/** Every import, newest first, for a suite and for the history a holder reads. */
export async function budgetSyncRows(db: Db, limit = 50): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `budget_syncs` ORDER BY `at` DESC, `id` DESC LIMIT ?", [limit]);
  return rows;
}

/** The chart a row's circle and role are matched against (R11): circles, and roles with their circle. */
export async function budgetChartRows(db: Db): Promise<{ circles: RowDataPacket[]; roles: RowDataPacket[]; seatings: RowDataPacket[] }> {
  const [circles] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `name`, `is_example`, `status`, `layer`, `parent_circle_id`, `sort_order` FROM `circles` ORDER BY `sort_order`, `name`, `id`",
  );
  const [roles] = await db.query<RowDataPacket[]>("SELECT `id`, `name`, `circle_id`, `active`, `is_example` FROM `org_roles`");
  // A seating's role, so cash owed against a seat (the moon invoice's rows) finds its circle.
  const [seatings] = await db.query<RowDataPacket[]>("SELECT `id`, `org_role_id` FROM `org_role_assignments`");
  return { circles, roles, seatings };
}

/**
 * The newest stored day and source of each quote, with no 14-day window, so
 * a lock refused for a stale rate can say which day the newest one is from.
 * The RATE itself is read through `latestRates` (server/lib/fxRates.ts),
 * which keeps 14 days; this only dates it. A read, never a write: `fx_rates`
 * stays the daily job's to write (visionNeverApplies.test.ts).
 */
export async function fxQuoteDays(db: Db, quotes: readonly string[]): Promise<RowDataPacket[]> {
  if (!quotes.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT f.`quote`, DATE_FORMAT(f.`as_of`, '%Y-%m-%d') AS `as_of`, f.`source` FROM `fx_rates` f " +
      "JOIN (SELECT `quote`, MAX(`as_of`) AS `as_of` FROM `fx_rates` WHERE `quote` IN (?) GROUP BY `quote`) n " +
      "ON n.`quote` = f.`quote` AND n.`as_of` = f.`as_of`",
    [quotes],
  );
  return rows;
}

/** LIKE's own wildcards, escaped, so a key prefix matches only itself. */
const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The `cash_owed` rows a moon's committed figure reads (R7): role rows whose
 * key starts with the moon's encoded cycle (the caller decodes each key and
 * keeps only an exact match), and quest and proposal rows owed inside the
 * moon's instants.
 */
export async function cashOwedForMoon(db: Db, rolePrefix: string, startsAt: Date, endsAt: Date): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT `id`, `work_kind`, `work_ref`, `occurrence_key`, `amount_minor`, `currency`, `owed_at` FROM `cash_owed` " +
      "WHERE (`work_kind` = 'role' AND `occurrence_key` LIKE ?) OR (`work_kind` IN ('quest', 'proposal') AND `owed_at` >= ? AND `owed_at` < ?)",
    [likePrefix(rolePrefix), startsAt, endsAt],
  );
  return rows;
}

/**
 * ERASURE (R26): an erased member's account id comes off every line they
 * changed, every rate they locked, and every import they ran. `changed_as`,
 * the role they acted through, stays: it names a role, never a person.
 */
export async function forgetBudgetAttributionOf(db: Db, userId: string): Promise<void> {
  await db.query("UPDATE `budget_lines` SET `changed_by` = NULL WHERE `changed_by` = ?", [userId]);
  await db.query("UPDATE `budget_lines` SET `fx_locked_by` = NULL WHERE `fx_locked_by` = ?", [userId]);
  await db.query("UPDATE `budget_syncs` SET `by` = NULL WHERE `by` = ?", [userId]);
  await db.query("UPDATE `budget_period_notes` SET `changed_by` = NULL WHERE `changed_by` = ?", [userId]);
  await db.query("UPDATE `budget_sources` SET `set_by` = NULL WHERE `set_by` = ?", [userId]);
  await db.query("UPDATE `budget_envelopes` SET `changed_by` = NULL WHERE `changed_by` = ?", [userId]);
}

/** Every circle's envelope (R35), dates as text for the reason `budgetLineRows` gives. */
export async function budgetEnvelopeRows(db: Db): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT *, DATE_FORMAT(`starts_on`, '%Y-%m-%d') AS `starts_on_text`, DATE_FORMAT(`ends_on`, '%Y-%m-%d') AS `ends_on_text` FROM `budget_envelopes` ORDER BY `circle_id`, `starts_on`",
  );
  return rows;
}

/** Write one circle's envelope for one period whole, or replace it. */
export async function upsertBudgetEnvelope(
  db: Db,
  r: { circleId: string; periodKind: string; periodKey: string; startsOn: string; endsOn: string; plannedMinor: number; currency: string; goalNote: string | null; changedBy: string | null; changedAs: string | null },
): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `budget_envelopes` (`circle_id`, `period_kind`, `period_key`, `starts_on`, `ends_on`, `planned_minor`, `currency`, `goal_note`, `changed_at`, `changed_by`, `changed_as`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `period_kind` = VALUES(`period_kind`), `starts_on` = VALUES(`starts_on`), `ends_on` = VALUES(`ends_on`), " +
      "`planned_minor` = VALUES(`planned_minor`), `currency` = VALUES(`currency`), `goal_note` = VALUES(`goal_note`), `changed_at` = VALUES(`changed_at`), " +
      "`changed_by` = VALUES(`changed_by`), `changed_as` = VALUES(`changed_as`)",
    [r.circleId, r.periodKind, r.periodKey, r.startsOn, r.endsOn, r.plannedMinor, r.currency, r.goalNote, new Date(), r.changedBy, r.changedAs],
  );
  return res;
}

/** One source's switch (v0.4, R18), or none. */
export async function budgetSourceRow(db: Db, source: string): Promise<RowDataPacket | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `budget_sources` WHERE `source` = ?", [source]);
  return rows[0] ?? null;
}

export async function budgetSourceRows(db: Db): Promise<RowDataPacket[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `budget_sources` ORDER BY `source`");
  return rows;
}

/** Write one source's switch whole: on or off, its mode and schedule, who set it and through which role. */
export async function upsertBudgetSource(
  db: Db,
  r: { source: string; on: boolean; mode: "auto" | "review"; schedule: "daily" | "hourly" | "off"; setBy: string | null; setAs: string | null },
): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `budget_sources` (`source`, `on`, `mode`, `schedule`, `set_by`, `set_as`, `set_at`, `off_reason`) VALUES (?, ?, ?, ?, ?, ?, ?, NULL) " +
      "ON DUPLICATE KEY UPDATE `on` = VALUES(`on`), `mode` = VALUES(`mode`), `schedule` = VALUES(`schedule`), `set_by` = VALUES(`set_by`), " +
      "`set_as` = VALUES(`set_as`), `set_at` = VALUES(`set_at`), `off_reason` = NULL",
    [r.source, r.on ? 1 : 0, r.mode, r.schedule, r.setBy, r.setAs, new Date()],
  );
  return res;
}

/** A source turns itself off, with the reason, only while it is on: true when this call turned it off. */
export async function turnBudgetSourceOff(db: Db, source: string, reason: string): Promise<boolean> {
  const [res] = await db.query<ResultSetHeader>("UPDATE `budget_sources` SET `on` = 0, `off_reason` = ? WHERE `source` = ? AND `on` = 1", [reason.slice(0, 500), source]);
  return res.affectedRows > 0;
}

/** The notes for these period keys (R32). */
export async function periodNoteRows(db: Db, keys: readonly string[]): Promise<RowDataPacket[]> {
  if (!keys.length) return [];
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM `budget_period_notes` WHERE `period_key` IN (?)", [keys]);
  return rows;
}

/** Write one period's note whole, or replace it. */
export async function upsertPeriodNote(db: Db, r: { periodKey: string; note: string; changedBy: string | null; changedAs: string | null }): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>(
    "INSERT INTO `budget_period_notes` (`period_key`, `note`, `changed_at`, `changed_by`, `changed_as`) VALUES (?, ?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE `note` = VALUES(`note`), `changed_at` = VALUES(`changed_at`), `changed_by` = VALUES(`changed_by`), `changed_as` = VALUES(`changed_as`)",
    [r.periodKey, r.note, new Date(), r.changedBy, r.changedAs],
  );
  return res;
}

/** Clear one period's note: an empty note is no note. */
export async function deletePeriodNote(db: Db, periodKey: string): Promise<ResultSetHeader> {
  const [res] = await db.query<ResultSetHeader>("DELETE FROM `budget_period_notes` WHERE `period_key` = ?", [periodKey]);
  return res;
}

/**
 * The budget's write lock, on one connection. The name carries the database,
 * because MySQL's lock namespace is the whole server (the trap
 * server/repos/namedLock.ts records), so two villages or two test schemas on
 * one server never wait on each other. True when taken within the wait.
 */
const BUDGET_LOCK_SQL = "LEFT(CONCAT('budget-lines:', COALESCE(DATABASE(), '')), 64)";

export async function takeBudgetLock(conn: PoolConnection, waitSeconds: number): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT GET_LOCK(${BUDGET_LOCK_SQL}, ?) AS \`got\``, [waitSeconds]);
  return Number(rows[0]?.got) === 1;
}

export async function releaseBudgetLock(conn: PoolConnection): Promise<void> {
  await conn.query(`SELECT RELEASE_LOCK(${BUDGET_LOCK_SQL})`);
}
