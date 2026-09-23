/**
 * `failed_action_items`: every statement that touches the list of things that
 * are failing.
 *
 * Why the table exists is argued in migration 0207 and in
 * server/lib/failedActions.ts. What this file owns is narrower: the table's
 * readers and writers stay in one place, and every time comparison is made by
 * the DATABASE's clock.
 *
 * ── THE CLOCK IS THE DATABASE'S, ON PURPOSE ──────────────────────────────────
 *
 * Every column here is a TIMESTAMP written with CURRENT_TIMESTAMP, and every age
 * is read back as `TIMESTAMPDIFF(... CURRENT_TIMESTAMP)`. The app's pool pins
 * each connection to UTC (server/db/pool.ts), but a test suite's own pool does
 * not, and on an unpinned session a TIMESTAMP read into a JavaScript Date is
 * shifted by the database host's offset. An age computed in SQL is right under
 * either, because both ends of the subtraction are on one clock.
 */
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** One thing a source found failing this run. */
export interface Finding {
  /** Stable within its source, and opaque. Never a member id, name or address. */
  key: string;
  /** What is failing, naming no person. */
  title: string;
  /** What to do about it, and who can. */
  advice: string;
  /** The error as the system recorded it. Kept only while the item is open. */
  lastError?: string | null;
  /**
   * How long the thing has been failing, when its source knows. The item's
   * first sighting is set this far back, so its age, its quiet hours and the
   * tab all count from when the failure began: a payment error eight hours old
   * on the report's first run is eight hours old, and never "failing for a
   * minute".
   */
  failingForSeconds?: number;
  /**
   * How long the item may be open before a notice mentions it, counted from
   * when it began failing. Kept on the row, so a run that cannot read this
   * item's area still honours it.
   */
  quietHours?: number;
}

export interface FailedItem {
  source: string;
  key: string;
  title: string;
  advice: string;
  lastError: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  notifiedAt: string | null;
  /** Seconds since `first_seen_at`, by the database's clock. */
  ageSeconds: number;
  /** Seconds since `notified_at`, or null when it has never been in a notice. */
  notifiedAgeSeconds: number | null;
  /** Seconds since `resolved_at`, or null while it is still failing. */
  resolvedAgeSeconds: number | null;
  /** How long it may be open before a notice mentions it. */
  quietSeconds: number;
  /** Whether a notice has carried it since its current episode began. */
  toldThisEpisode: boolean;
}

const clip = (value: string | null | undefined, max: number): string | null =>
  value == null ? null : String(value).slice(0, max);

const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Both shapes a member id is minted in. Bootstrap mints `usr-<epoch>-<rand>`
 * (server/index.ts), and registration, by password or by Google, mints
 * `user-<epoch>-<rand>` (server/routes/register.ts, server/routes/authGoogle.ts),
 * so an ordinary member's id is the second shape. This matched only the first
 * until a failed give-back brought the redemption closer's error here, which
 * names the member it could not pay back. The `user-` half insists on the epoch
 * digits, so an error that says `user-agent` keeps its words.
 */
const MEMBER_ID = /\b(?:usr-[A-Za-z0-9-]{4,}|user-\d{6,}[A-Za-z0-9-]*)/g;

/**
 * Email addresses and member ids, taken out of text copied from another system.
 *
 * The rule that matters is upstream: a source whose text can name a person is
 * not copied at all (startup-check events), and an admin-typed name never goes
 * in a title (calendar feeds). This is the net under that rule, for the vendor
 * error nobody has read yet, like an SMTP refusal that quotes the address it
 * refused, and for a closer's error that names the member it failed. It runs on
 * the write, so nothing reaches the table unscrubbed.
 */
export function scrubPersonal(text: string): string {
  return text.replace(EMAIL_ADDRESS, "(an email address)").replace(MEMBER_ID, "(a member)");
}

const scrubbed = (value: string | null | undefined, max: number): string | null =>
  value == null ? null : clip(scrubPersonal(String(value)), max);

const toIso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

const MAX_SECONDS = 10 * 365 * 24 * 60 * 60;
const wholeSeconds = (value: unknown): number => Math.max(0, Math.min(MAX_SECONDS, Math.trunc(Number(value ?? 0)) || 0));

const COLUMNS =
  "`source`, `item_key`, `title`, `advice`, `last_error`, `first_seen_at`, `last_seen_at`, `resolved_at`, `notified_at`, " +
  "`quiet_seconds`, " +
  "TIMESTAMPDIFF(SECOND, `first_seen_at`, CURRENT_TIMESTAMP) AS age_s, " +
  "TIMESTAMPDIFF(SECOND, `notified_at`, CURRENT_TIMESTAMP) AS notified_age_s, " +
  "TIMESTAMPDIFF(SECOND, `resolved_at`, CURRENT_TIMESTAMP) AS resolved_age_s, " +
  "(`notified_episode` IS NOT NULL AND `notified_episode` = `episode`) AS told_episode";

function toItem(r: RowDataPacket): FailedItem {
  return {
    source: String(r.source),
    key: String(r.item_key),
    title: String(r.title),
    advice: String(r.advice),
    lastError: r.last_error == null ? null : String(r.last_error),
    firstSeenAt: toIso(r.first_seen_at),
    lastSeenAt: toIso(r.last_seen_at),
    resolvedAt: toIso(r.resolved_at),
    notifiedAt: toIso(r.notified_at),
    ageSeconds: Math.max(0, Number(r.age_s ?? 0)),
    notifiedAgeSeconds: r.notified_age_s == null ? null : Math.max(0, Number(r.notified_age_s)),
    resolvedAgeSeconds: r.resolved_age_s == null ? null : Math.max(0, Number(r.resolved_age_s)),
    quietSeconds: Math.max(0, Number(r.quiet_seconds ?? 0)),
    toldThisEpisode: Number(r.told_episode) === 1,
  };
}

/**
 * Record what one source found this run, and close what it no longer finds.
 *
 * EPISODES. A finding that was resolved and has come back REOPENS as a new
 * episode: `episode` counts up, and `first_seen_at` moves to when the failure
 * began. `notified_at` is left alone, on purpose. A notice counts for the item
 * only while `notified_episode` names its current episode (`told_episode`), so
 * nothing needs erasing, and the day's record of having sent a notice cannot be
 * erased by a reopen. It was, once, in review: a reopen cleared the only stamp
 * from today, the next run sent a second notice under the same day's dedupe key,
 * the dedupe swallowed it, and the items it carried were marked as told anyway.
 * A counter and never a pair of timestamps: those hold whole seconds, and a
 * reopen in the same second as a notice read as already told.
 *
 * ORDER. The assignments run left to right and each later one sees the earlier
 * ones' results, which is why every test of `resolved_at` comes before
 * `resolved_at` is cleared. MariaDB's SIMULTANEOUS_ASSIGNMENT mode reads the old
 * values throughout, which gives the same answers.
 *
 * DATING. A finding that knows how long it has been failing sets `first_seen_at`
 * that far back, and a later read can only move it earlier (`LEAST`), never later.
 *
 * ONE STATEMENT PER FINDING. The text is passed twice rather than read back
 * through `VALUES(...)`, which MySQL 8 deprecates, and whose replacement (a row
 * alias) MariaDB does not have. The portable multi-row upsert needs one of the
 * two, so there is none.
 *
 * Only a source that was READ successfully may close its items. A caller that
 * could not read a source must not call this with an empty list, or it would
 * report every failure in that source as fixed.
 *
 * Closing an item forgets its `last_error`. That text is copied from the system
 * that failed and can say anything, so it is kept only while the table it came
 * from holds the same words. server/lib/failedActions.ts says why at length.
 */
export async function reconcileSource(pool: Pool, source: string, findings: readonly Finding[]): Promise<void> {
  const src = String(source).slice(0, 48);
  for (const f of findings) {
    const key = String(f.key).slice(0, 128);
    const title = scrubbed(f.title, 255) ?? "";
    const advice = clip(f.advice, 600) ?? "";
    const lastError = scrubbed(f.lastError ?? null, 500);
    const since = wholeSeconds(f.failingForSeconds);
    const quiet = wholeSeconds((f.quietHours ?? 0) * 60 * 60);
    await pool.query(
      "INSERT INTO `failed_action_items` (`source`, `item_key`, `title`, `advice`, `last_error`, `first_seen_at`, `quiet_seconds`) " +
        "VALUES (?,?,?,?,?, CURRENT_TIMESTAMP - INTERVAL ? SECOND, ?) " +
        "ON DUPLICATE KEY UPDATE " +
        "`first_seen_at` = IF(`resolved_at` IS NULL, LEAST(`first_seen_at`, CURRENT_TIMESTAMP - INTERVAL ? SECOND), " +
        "CURRENT_TIMESTAMP - INTERVAL ? SECOND), " +
        "`episode` = IF(`resolved_at` IS NULL, `episode`, `episode` + 1), " +
        "`resolved_at` = NULL, `last_seen_at` = CURRENT_TIMESTAMP, `quiet_seconds` = ?, " +
        "`title` = ?, `advice` = ?, `last_error` = ?",
      [src, key, title, advice, lastError, since, quiet, since, since, quiet, title, advice, lastError],
    );
  }
  const keys = findings.map((f) => String(f.key).slice(0, 128));
  if (keys.length === 0) {
    await pool.query(
      "UPDATE `failed_action_items` SET `resolved_at` = CURRENT_TIMESTAMP, `last_error` = NULL WHERE `source` = ? AND `resolved_at` IS NULL",
      [src],
    );
  } else {
    await pool.query(
      `UPDATE \`failed_action_items\` SET \`resolved_at\` = CURRENT_TIMESTAMP, \`last_error\` = NULL WHERE \`source\` = ? AND \`resolved_at\` IS NULL ` +
        `AND \`item_key\` NOT IN (${keys.map(() => "?").join(",")})`,
      [src, ...keys],
    );
  }
}

/** Everything still failing, grouped by source, oldest first within each. */
export async function openItems(pool: Pool): Promise<FailedItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`failed_action_items\` WHERE \`resolved_at\` IS NULL ORDER BY \`source\`, \`first_seen_at\`, \`item_key\``,
  );
  return rows.map(toItem);
}

/** What stopped failing in the last `days` days, newest first. */
export async function recentlyResolved(pool: Pool, days = 7): Promise<FailedItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNS} FROM \`failed_action_items\` WHERE \`resolved_at\` IS NOT NULL ` +
      "AND `resolved_at` >= CURRENT_TIMESTAMP - INTERVAL ? DAY ORDER BY `resolved_at` DESC LIMIT 100",
    [Math.max(1, Math.min(90, Math.trunc(days)))],
  );
  return rows.map(toItem);
}

/**
 * Delete what cleared more than `days` days ago, a page at a time, and say how
 * many went. The tab shows the last week of cleared items and nothing reads
 * older ones. Never under a week, so a caller cannot empty the tab's own list.
 */
export async function forgetResolvedBefore(pool: Pool, days = 30): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    "DELETE FROM `failed_action_items` WHERE `resolved_at` IS NOT NULL " +
      "AND `resolved_at` < CURRENT_TIMESTAMP - INTERVAL ? DAY LIMIT 1000",
    [Math.max(7, Math.min(3650, Math.trunc(days)))],
  );
  return Number(result.affectedRows ?? 0);
}

/** How many rows the table holds, open or cleared. Zero is half of what makes a first run. */
export async function itemCount(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM `failed_action_items`");
  return Number(rows[0]?.n ?? 0);
}

/**
 * Today by the database's clock, and whether a notice already went out on it.
 *
 * ONE READ ANSWERS BOTH, so the day a notice is filed under and the day it is
 * checked against are always the same calendar. A UTC date from Node beside a
 * `CURRENT_DATE` from a database on local time disagrees for part of every
 * day, and in that gap a new day's notice is filed under a key the dedupe has
 * already seen: it is swallowed, and its items are still marked as told.
 */
export async function noticeDay(pool: Pool): Promise<{ day: string; alreadySent: boolean }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS day, " +
      "EXISTS (SELECT 1 FROM `failed_action_items` WHERE `notified_at` >= CURRENT_DATE) AS sent",
  );
  return { day: String(rows[0]?.day ?? ""), alreadySent: Number(rows[0]?.sent) === 1 };
}

/** Stamp the items a notice just carried, with the day and with the episode it was about. */
export async function markNotified(pool: Pool, items: ReadonlyArray<{ source: string; key: string }>): Promise<void> {
  if (items.length === 0) return;
  await pool.query(
    `UPDATE \`failed_action_items\` SET \`notified_at\` = CURRENT_TIMESTAMP, \`notified_episode\` = \`episode\` WHERE (\`source\`, \`item_key\`) IN (${items
      .map(() => "(?, ?)")
      .join(",")})`,
    items.flatMap((i) => [i.source, i.key]),
  );
}
