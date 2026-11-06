/**
 * THE GRATITUDE NUDGE: a few days before the cycle closes, one warm note to
 * each member who still has gratitude to send, with the people they worked
 * with this cycle a tap away.
 *
 * Rye, 2026-10-30, idea 3 of five to make earnings feel like a game: "a
 * gratitude nudge three days before the cycle closes, if you still have
 * gratitude to send, with one-tap suggestions of people you worked with".
 *
 * ── WHAT IT NEVER DOES ───────────────────────────────────────────────────────
 *
 * It sends nothing. Gratitude only counts when a member sends it
 * (2026-10-23), so the nudge is a notice and a link, and every gift still goes
 * through `sendGratitude` from the wall's own form. It never closes a cycle and
 * it never pays work: the scheduler host's rules hold here like everywhere.
 *
 * ── ONCE PER (CYCLE, MEMBER) ─────────────────────────────────────────────────
 *
 * The dedupe key is the cycle id and the member, so the job can run every few
 * hours across the whole lead window and a member hears it exactly once. A
 * member who sends everything before the job reaches them never hears it, and
 * one who still has some left hears the amount true at the moment it ran.
 *
 * ── WHO ──────────────────────────────────────────────────────────────────────
 *
 * Every present person (`isPresent`, the predicate every ballot roll uses)
 * with a sending allowance left, who has not turned the nudge off
 * (`gratitudeNudge` in their notification preferences). The email, if any,
 * rides `gratitudeEmail`, which is a daily digest unless they chose the bell
 * only (`emailCadenceFor` in server/lib/notify.ts).
 *
 * ── THE SUGGESTIONS ──────────────────────────────────────────────────────────
 *
 * `gratitudeSuggestionsFor` is the one function both the nudge and the send
 * panel's chips read, so the people a notice promised are the people the page
 * shows. They are real co-workers from this cycle only (the reads and their
 * joins are in server/repos/gratitudeSuggestions.ts), ranked by how much they
 * shared, with anybody already thanked this cycle left out. Fewer than three
 * real people is fewer than three chips: the list is never padded with
 * strangers to reach a number.
 *
 * The notice itself names nobody. A notice that names a member has to carry
 * them as its actor or the erasure sweep cannot find it (`NoticeAbout` in
 * server/lib/notify.ts), and one notice cannot carry five actors, so the names
 * live on the page, read fresh, where an erased member is simply absent.
 */
import { cycleWindow } from "./economy";
import { resolveNotifyPrefs } from "./notify";
import type { PresenceTest } from "./memberPresence";
import {
  circlePartners,
  crewPartners,
  questPartners,
  sessionPartners,
  thankedInCycle,
  type WorkedWithRow,
  type WorkedWithSource,
  type WorkedWithWindow,
} from "../repos/gratitudeSuggestions";
import type { Pool } from "mysql2/promise";

export const GRATITUDE_NUDGE_TYPE = "gratitude_nudge";

/** The most chips a send panel shows, and the fewest the nudge promises when it has them. */
export const MAX_SUGGESTIONS = 5;
export const MIN_SUGGESTIONS = 3;

/**
 * How much one shared trace counts toward a suggestion. Doing a quest together
 * is the closest work there is; a room together is close; holding a role in
 * the same circle is the widest net, so it counts least and mostly breaks ties.
 */
export const SOURCE_WEIGHT: Record<WorkedWithSource, number> = { quest: 3, crew: 3, session: 2, circle: 1 };

/** Where the nudge sends a member: the wall, scrolled to the send panel. */
export const GRATITUDE_NUDGE_LINK = "/gratitude?nudge=1#send";

export interface RankedPartner {
  userId: string;
  score: number;
  sources: WorkedWithSource[];
}

/**
 * Rank who a member worked with, best first. PURE.
 *
 * Sums the weighted counts across sources, leaves out the member themself and
 * anybody already thanked this cycle, and breaks ties by id so the same rows
 * always give the same order.
 */
export function rankWorkedWith(
  rows: readonly WorkedWithRow[],
  opts: { selfId: string; alreadyThanked?: ReadonlySet<string> },
): RankedPartner[] {
  const by = new Map<string, { score: number; sources: Set<WorkedWithSource> }>();
  for (const r of rows) {
    const id = String(r.userId ?? "");
    if (!id || id === opts.selfId || opts.alreadyThanked?.has(id)) continue;
    const row = by.get(id) ?? { score: 0, sources: new Set<WorkedWithSource>() };
    row.score += SOURCE_WEIGHT[r.source] * Math.max(1, Math.floor(Number(r.times) || 1));
    row.sources.add(r.source);
    by.set(id, row);
  }
  return Array.from(by.entries())
    .map(([userId, r]) => ({
      userId,
      score: r.score,
      sources: (Object.keys(SOURCE_WEIGHT) as WorkedWithSource[]).filter((s) => r.sources.has(s)),
    }))
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
}

export interface GratitudeSuggestion {
  userId: string;
  name: string;
  /** What the send form takes, without the @. */
  handle: string;
  sources: WorkedWithSource[];
}

export interface SuggestionDeps {
  pool: Pool;
  memberById(id: string): Promise<Record<string, any> | null>;
  isPresent: PresenceTest;
  /** Whether a module is on. A read whose module is off is never made. */
  moduleOn(id: string): boolean;
}

/** One read, and a failed one costs its own suggestions and never the rest. */
async function safely(read: Promise<WorkedWithRow[]>, what: string): Promise<WorkedWithRow[]> {
  try {
    return await read;
  } catch (e) {
    console.error(`[gratitude-nudge] reading ${what} partners failed (the other sources still count)`, e);
    return [];
  }
}

/**
 * THE ONE SUGGESTIONS FUNCTION: up to five people this member worked with in
 * the cycle open at `at`, each one somebody the send form can reach by handle.
 */
export async function gratitudeSuggestionsFor(
  deps: SuggestionDeps,
  userId: string,
  at: Date = new Date(),
): Promise<GratitudeSuggestion[]> {
  const { startsAt, endsAt, key } = cycleWindow(at);
  const w: WorkedWithWindow = { startsAt, endsAt };
  const reads = [
    safely(questPartners(deps.pool, userId, w), "quest"),
    safely(crewPartners(deps.pool, userId, w), "crew"),
    safely(circlePartners(deps.pool, userId, w), "circle"),
  ];
  if (deps.moduleOn("sessions")) reads.push(safely(sessionPartners(deps.pool, userId, w), "session"));
  const rows = (await Promise.all(reads)).flat();
  let thanked: string[] = [];
  try {
    thanked = await thankedInCycle(deps.pool, userId, key);
  } catch (e) {
    console.error("[gratitude-nudge] reading who was already thanked failed (nobody is left out for it)", e);
  }
  const ranked = rankWorkedWith(rows, { selfId: userId, alreadyThanked: new Set(thanked) });
  const out: GratitudeSuggestion[] = [];
  for (const p of ranked) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const m = await deps.memberById(p.userId);
    if (!m || m.isExample || !deps.isPresent(m as any)) continue;
    const handle = String(m.handle ?? "").trim();
    if (!handle) continue;
    out.push({ userId: p.userId, name: String(m.name ?? "").trim() || `@${handle}`, handle, sources: p.sources });
  }
  return out;
}

export interface DueNudge {
  cycleId: string;
  endsAt: Date;
  /** Whole days until the close, rounded up, so it is never 0 while open. */
  daysLeft: number;
}

/** Whether the cycle open at `at` closes within `leadDays`, and which one. PURE. */
export function dueNudge(at: Date, leadDays: number): DueNudge | null {
  const { endsAt, key } = cycleWindow(at);
  const msLeft = endsAt.getTime() - at.getTime();
  const lead = Math.max(0, Number(leadDays) || 0) * 86_400_000;
  if (msLeft <= 0 || lead <= 0 || msLeft > lead) return null;
  return { cycleId: key, endsAt, daysLeft: Math.max(1, Math.ceil(msLeft / 86_400_000)) };
}

/** One stable key per (cycle, member). A cycle id is 16 characters at most and a user id 64. */
export function gratitudeNudgeKey(cycleId: string, userId: string): string {
  return `gratitude-nudge:${cycleId}:${userId}`;
}

/** "Sunday 2 November", in the village's own timezone. */
export function closeDayLabel(endsAt: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(endsAt);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(endsAt);
  }
}

/**
 * The words. Warm and plain, with the amount and the day, and no guilt: what a
 * member leaves unsent is theirs to leave, and the copy says the allowance
 * refills rather than that anything is lost.
 */
export function gratitudeNudgeCopy(input: {
  remaining: number;
  currency: string;
  due: DueNudge;
  timeZone: string;
  suggestions: number;
}): { title: string; body: string; link: string } {
  const amount = `${Math.floor(input.remaining)} ${input.currency}`;
  const days = input.due.daysLeft === 1 ? "tomorrow" : `in ${input.due.daysLeft} days`;
  const people =
    input.suggestions === 0
      ? ""
      : input.suggestions === 1
        ? " The person you worked with most this cycle is one tap away on the send panel."
        : ` ${input.suggestions} people you worked with this cycle are one tap away on the send panel.`;
  return {
    title: `You have ${amount} left to send this cycle`,
    body:
      `The cycle closes ${days}, on ${closeDayLabel(input.due.endsAt, input.timeZone)}. ` +
      `If someone's work meant something to you, this is a lovely moment to tell them.${people} ` +
      `Whatever you leave unsent refills when the new cycle begins.`,
    link: GRATITUDE_NUDGE_LINK,
  };
}

export interface GratitudeNudgeDeps {
  at?: Date;
  /** `gratitude.nudge_days_before_close`. 0 switches the nudge off for the village. */
  leadDays: number;
  timeZone: string;
  currency: string;
  members: ReadonlyArray<Record<string, any>>;
  isPresent: PresenceTest;
  /** What this member may still send this cycle, in the unit they type. */
  remainingFor(member: Record<string, any>): Promise<number>;
  suggestionsFor(userId: string): Promise<GratitudeSuggestion[]>;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }): Promise<{ fresh: boolean }>;
}

export interface GratitudeNudgeReport {
  due: DueNudge | null;
  /** Present members with something left to send who have not turned the nudge off. */
  eligible: number;
  /** Of those, how many were told on this run (the rest were told earlier). */
  told: number;
}

/** The sweep. One member's failure never stops the rest hearing. */
export async function runGratitudeNudge(deps: GratitudeNudgeDeps): Promise<GratitudeNudgeReport> {
  const due = dueNudge(deps.at ?? new Date(), deps.leadDays);
  const report: GratitudeNudgeReport = { due, eligible: 0, told: 0 };
  if (!due) return report;
  for (const member of deps.members) {
    if (member?.isExample || !deps.isPresent(member as any)) continue;
    if (resolveNotifyPrefs(member.prefs).gratitudeNudge === "off") continue;
    const userId = String(member.id);
    try {
      const remaining = await deps.remainingFor(member);
      if (!(remaining > 0)) continue;
      report.eligible += 1;
      const suggestions = await deps.suggestionsFor(userId);
      const copy = gratitudeNudgeCopy({
        remaining,
        currency: deps.currency,
        due,
        timeZone: deps.timeZone,
        suggestions: suggestions.length,
      });
      const r = await deps.notify({
        userId,
        type: GRATITUDE_NUDGE_TYPE,
        title: copy.title,
        body: copy.body,
        link: copy.link,
        dedupeKey: gratitudeNudgeKey(due.cycleId, userId),
      });
      if (r.fresh) report.told += 1;
    } catch (e) {
      console.error(`[gratitude-nudge] nudging ${userId} failed (the rest continue)`, e);
    }
  }
  return report;
}
