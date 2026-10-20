/**
 * PLAN YOUR SEASON: THE TWO NOTICES (season plans RC1, 2026-10-09).
 *
 *   season_plan_open      to every present member, on the first sweep after
 *                         the window opens
 *   season_plan_reminder  to every present member who has not filed: halfway
 *                         through the window, then three days before it closes
 *
 * Each says the season, a date or a count of days, and links the member's own
 * page. No seat name, no money, and no `recordEvent`: planning is not a public
 * event, and the plan row is the record.
 *
 * ── CATCH-UP, THE SEASON-END RULE ──────────────────────────────────────────
 *
 * The scheduler runs a job when it is due, not on a wall clock, so a sweep can
 * be missed. A missed mark is sent late, once, and only the most recent one
 * (`dueReminderMark` in shared/seasonPlans.ts): a member never hears two
 * numbers at once. The mark is in the key, so one already sent never repeats.
 *
 * ── WHO ────────────────────────────────────────────────────────────────────
 *
 * Every present person, through the same bound predicate every ballot roll and
 * the season-end reminders use (`isPresentMember`, server/lib/memberPresence.ts):
 * no example users, no tombstones, no unclaimed accounts, and no agents.
 */
import crypto from "node:crypto";
import {
  daysLeftIn,
  dueReminderMark,
  planOpenCopy,
  planReminderCopy,
  SEASON_PLAN_MINE,
  windowState,
  type PlanTarget,
  type ReminderMark,
} from "../../shared/seasonPlans";
import type { PresenceTest } from "./memberPresence";

/** `notifications.dedupe_key` is varchar(191), and an over-long key is a lost notice. */
function fitKey(prefix: string, seasonId: string, rest: string): string {
  const raw = `${prefix}:${seasonId}:${rest}`;
  if (raw.length <= 191) return raw;
  const season = crypto.createHash("sha256").update(seasonId).digest("hex").slice(0, 24);
  return `${prefix}:${season}:${rest}`.slice(0, 191);
}

export function planOpenKey(seasonId: string, userId: string): string {
  return fitKey("season-plan-open", seasonId, userId);
}

export function planDueKey(seasonId: string, mark: ReminderMark, userId: string): string {
  return fitKey("season-plan-due", seasonId, `${mark}:${userId}`);
}

export interface PlanNoticeDeps {
  /** The season being planned now, or null when no window has opened. */
  target: PlanTarget | null;
  now: Date;
  members: ReadonlyArray<Record<string, any>>;
  isPresent: PresenceTest;
  /** Who has filed for this season. Asked only when a reminder is due. */
  filed(seasonId: string): Promise<Set<string>>;
  notify(input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }): Promise<{ fresh: boolean }>;
}

export interface PlanNoticeReport {
  seasonId: string | null;
  opened: number;
  reminded: number;
  mark: ReminderMark | null;
}

/** One sweep. One member's failure never stops the rest hearing. */
export async function runSeasonPlanNotices(deps: PlanNoticeDeps): Promise<PlanNoticeReport> {
  const { target, now } = deps;
  const report: PlanNoticeReport = { seasonId: target?.season.id ?? null, opened: 0, reminded: 0, mark: null };
  if (!target || windowState(target.window, now) !== "open") return report;
  const seasonId = target.season.id;
  const seasonName = String(target.season.name ?? "").trim();
  const mark = dueReminderMark(target.window, now);
  report.mark = mark;
  const filed = mark ? await deps.filed(seasonId) : new Set<string>();
  const open = planOpenCopy(seasonName, target.window.closesOn);
  const due = mark ? planReminderCopy(daysLeftIn(target.window, now)) : null;

  for (const member of deps.members) {
    if (!deps.isPresent(member)) continue;
    const userId = String(member.id);
    try {
      const r = await deps.notify({ userId, type: "season_plan_open", title: open.title, body: open.body, link: SEASON_PLAN_MINE, dedupeKey: planOpenKey(seasonId, userId) });
      if (r.fresh) report.opened += 1;
      if (mark && due && !filed.has(userId)) {
        const d = await deps.notify({ userId, type: "season_plan_reminder", title: due.title, body: due.body, link: SEASON_PLAN_MINE, dedupeKey: planDueKey(seasonId, mark, userId) });
        if (d.fresh) report.reminded += 1;
      }
    } catch (e) {
      console.error(`[season-plans] telling ${userId} about planning failed (the rest continue)`, e);
    }
  }
  return report;
}
