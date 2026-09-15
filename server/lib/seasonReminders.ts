/**
 * THE SEASON IS TURNING: VILLAGE-WIDE REMINDERS BEFORE IT DOES.
 *
 * Rye, 2026-09-14: "we should give lots of warnings across the village two
 * weeks before the season ends to remind everyone to run the end of season
 * governance to record in for the next season."
 *
 * ── WHEN ────────────────────────────────────────────────────────────────────
 *
 * 14, 7, 3 and 1 day(s) before a season with an end date turns. An open-ended
 * season has no end, so it gets no reminder, and neither does a village with
 * no season running (`runTermWatch` is already loud to the admins about that).
 *
 * Days are CIVIL days in the village's own timezone. `endsOn` is exclusive: a
 * season runs until the first moment of that date where the village lives
 * (`seasonEndInstant` in server/lib/governanceWindows.ts). The subtraction here
 * is the one `seasonState().daysLeft` makes, so the banner and the bell always
 * say the same number.
 *
 * ── CATCH-UP, DECIDED ───────────────────────────────────────────────────────
 *
 * The scheduler runs a job when it is DUE, not on a wall clock, so a job's
 * start drifts a few minutes a day and a deploy can hold it off for longer.
 * A day can therefore pass with no sweep at all. The rule:
 *
 *   a mark whose day passed unsent is sent late, ONCE, and only the most
 *   recent one.
 *
 * Missing the 7-day sweep and running with 6 days left sends the 7-day
 * reminder, which says 6 days because that is true. Missing 14 AND 7 and
 * running with 5 left sends the 7 and never the 14: two notices in one sweep
 * saying different numbers would be noise, and the older one is stale. The
 * key carries the mark, so a mark already sent is never sent twice.
 *
 * The job is registered every 12 hours for the same reason. A 24-hour job
 * that drifts past midnight skips a civil day, and the day it skips can be
 * the last one, after which there is nothing left to catch up to. Twice a
 * day cannot skip a date, and the dedupe key makes the second sweep free.
 *
 * ── ONCE PER (SEASON, END DATE, MARK, RECIPIENT) ────────────────────────────
 *
 * The end date is in the dedupe key on purpose. An admin who moves the end of
 * the season re-arms the reminders, because the date the village was told is
 * no longer the date.
 *
 * ── WHO ─────────────────────────────────────────────────────────────────────
 *
 * Every real account. Example users are content and never people, and an
 * account with no password hash is a departed member or a claim nobody took
 * up; that is the filter `buildElectorate` in server/index.ts uses for every
 * ballot roll. Agents hold seats as documented holders on the org chart
 * (`is_agent`, 0142) and have no account, so no agent reaches this list.
 *
 * Admins get the same reminder pointed at the admin panel's seasons and
 * patterns tab, where the end-of-season governance that exists today lives:
 * the season review ("What the season taught",
 * `GET /api/admin/seasons/retrospective`) and the season roll. Both are
 * admin-only. Everyone else is pointed at the season calendar, because no
 * member-facing end-of-season screen exists yet.
 */
import crypto from "node:crypto";
import { isExampleUser } from "./examples";

export const SEASON_REMINDER_DAYS = [14, 7, 3, 1] as const;
export type SeasonReminderMark = (typeof SEASON_REMINDER_DAYS)[number];

export const SEASON_REMINDER_TYPE = "season_ending";

/** Where each audience is sent. See the header for why the two differ. */
export const SEASON_REMINDER_LINKS = {
  member: "/seasonal-festivals",
  admin: "/admin?tab=seasons-patterns",
} as const;

export interface SeasonLike {
  id?: string | null;
  name?: string | null;
  endsOn?: string | null;
}

export interface DueSeasonReminder {
  seasonId: string;
  seasonName: string;
  /** The civil date the season turns on, exclusive, as the admin wrote it. */
  endsOn: string;
  /** Whole civil days until `endsOn`, today included. Always 1 or more. */
  daysLeft: number;
  /** The reminder this sweep is sending, which may be one already passed. */
  mark: SeasonReminderMark;
}

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const civilMs = (m: RegExpExecArray): number => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

/** Whole days from one civil date to another, or null when either is not a date. */
export function civilDaysUntil(today: string, endsOn: string): number | null {
  const a = CIVIL_DATE.exec(String(today ?? "").trim());
  const b = CIVIL_DATE.exec(String(endsOn ?? "").trim());
  if (!a || !b) return null;
  return Math.round((civilMs(b) - civilMs(a)) / 86_400_000);
}

/**
 * WHICH REMINDER IS DUE TODAY, or null. PURE.
 *
 * The smallest mark that is at least the days left, which is the most recent
 * mark to have arrived: 6 days left answers 7, 2 answers 3, 15 answers
 * nothing. See CATCH-UP in the header for why a passed mark still answers.
 */
export function dueSeasonReminder(input: {
  current: SeasonLike | null | undefined;
  /** The village's civil date today, YYYY-MM-DD, in its own timezone. */
  today: string;
}): DueSeasonReminder | null {
  const season = input.current;
  const seasonId = String(season?.id ?? "").trim();
  if (!seasonId) return null;
  const endsOn = String(season?.endsOn ?? "").trim();
  if (!endsOn) return null;
  const daysLeft = civilDaysUntil(input.today, endsOn);
  if (daysLeft === null || daysLeft < 1) return null;
  let mark: SeasonReminderMark | null = null;
  for (const m of SEASON_REMINDER_DAYS) if (m >= daysLeft) mark = m;
  if (mark === null) return null;
  return { seasonId, seasonName: String(season?.name ?? "").trim(), endsOn, daysLeft, mark };
}

/**
 * The stable dedupe key. `notifications.dedupe_key` is varchar(191), and a
 * strict server turns an over-long key into a LOST notice, not a truncated
 * one, so a long season id is hashed down before the key can reach that.
 */
export function seasonReminderKey(due: DueSeasonReminder, userId: string): string {
  const raw = `season-ending:${due.seasonId}:${due.endsOn}:${due.mark}:${userId}`;
  if (raw.length <= 191) return raw;
  const season = crypto.createHash("sha256").update(`${due.seasonId}:${due.endsOn}`).digest("hex").slice(0, 24);
  return `season-ending:${season}:${due.mark}:${userId}`.slice(0, 191);
}

/** "1 October 2026" from "2026-10-01". The date is civil, so it is read in UTC. */
export function formatCivilDate(civil: string): string {
  const m = CIVIL_DATE.exec(String(civil ?? "").trim());
  if (!m) return String(civil ?? "");
  return new Date(civilMs(m)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function seasonReminderCopy(
  due: DueSeasonReminder,
  audience: "member" | "admin",
): { title: string; body: string; link: string } {
  const name = due.seasonName || "This season";
  const days = due.daysLeft === 1 ? "1 day" : `${due.daysLeft} days`;
  const ask =
    "Before it turns, run the end-of-season governance: record what this season did, and seat people for the next season. " +
    "Seats end with the season by default, so the seats filled now are the seats the next season starts with.";
  return {
    title: `${name} turns in ${days}, on ${formatCivilDate(due.endsOn)}`,
    body:
      audience === "admin"
        ? `${ask} The season review and the season roll are under Season Shapes in the admin panel.`
        : ask,
    link: SEASON_REMINDER_LINKS[audience],
  };
}

/** A person this reminder reaches. See WHO in the header. */
export function seasonReminderRecipient(member: Record<string, any> | null | undefined): boolean {
  return !!member && String(member.id ?? "") !== "" && !isExampleUser(member) && !!member.passwordHash;
}

export interface SeasonReminderDeps {
  /** `seasonState()`, or undefined when the calendar could not be read. */
  season: { current: SeasonLike | null; today: string } | null | undefined;
  members: ReadonlyArray<Record<string, any>>;
  isAdmin(member: Record<string, any>): boolean;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }): Promise<{ fresh: boolean }>;
}

export interface SeasonReminderReport {
  due: DueSeasonReminder | null;
  /** People the reminder was addressed to on this sweep. */
  recipients: number;
  /** Of those, how many had not already been told this mark. */
  told: number;
}

/** The daily sweep. One member's failure never stops the rest hearing. */
export async function runSeasonReminders(deps: SeasonReminderDeps): Promise<SeasonReminderReport> {
  const due = deps.season ? dueSeasonReminder({ current: deps.season.current, today: deps.season.today }) : null;
  const report: SeasonReminderReport = { due, recipients: 0, told: 0 };
  if (!due) return report;
  for (const member of deps.members) {
    if (!seasonReminderRecipient(member)) continue;
    report.recipients += 1;
    const userId = String(member.id);
    const copy = seasonReminderCopy(due, deps.isAdmin(member) ? "admin" : "member");
    try {
      const r = await deps.notify({
        userId,
        type: "season_ending",
        title: copy.title,
        body: copy.body,
        link: copy.link,
        dedupeKey: seasonReminderKey(due, userId),
      });
      if (r.fresh) report.told += 1;
    } catch (e) {
      console.error(`[season] reminding ${userId} that the season turns failed (the rest continue)`, e);
    }
  }
  return report;
}
