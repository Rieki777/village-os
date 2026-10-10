/**
 * YOUR SEASON: EACH MEMBER'S PLAN FOR A SEASON (season plans RC1, 2026-10-09).
 *
 * Every season each member says three things: which seats they keep, hand
 * back or apply for, and what they personally commit to. This file is the part
 * with no database and no request in it: when members plan a season, what a
 * plan may carry, and the words its notices say. The route
 * (server/routes/seasonPlans.ts), the notice job and both pages read these, so
 * a rule has one spelling.
 *
 * The code noun is `seasonPlan`. "Roll" already means a ballot's electorate
 * and `season_roll_log`, so it is never used for this.
 *
 * ── WHAT IS DECIDED, AND WHAT IS ONLY FILED ────────────────────────────────
 *
 * A seat choice that needs the village's word is an ordinary seat application
 * (shared/seatApplications.ts), made through the member door and decided the
 * way every application is. A plan holds no second store of them: the plan
 * page lists the member's applications by `candidate_user_id` and
 * `term_season_id`. What a member personally commits to (an aim, a season
 * goal they serve, quests a moon and up to three measures) is FILED and never
 * voted (Rye, 2026-10-09, decision 1). Filing is a stamp, not a ballot.
 *
 * ── THE WINDOW ─────────────────────────────────────────────────────────────
 *
 * `planWindowFor` opens a season's window at `termWarningOpensAt` of the
 * season's first instant: one cycle before it starts, the same instant a
 * holder whose term ends with the season is told (shared/cycleClock.ts). It
 * closes at the first cycle boundary a whole cycle after the season starts, so
 * a member always has at least one whole moon inside the season to finish.
 * A season can carry `planWindow: {opensOn, closesOn}` set by hand in the
 * admin Season tab; both of those days are inside the window.
 *
 * The window only drives the notices and the banner. A plan filed after it
 * closes is taken all the same. With no season whose window has opened, there
 * is nothing to plan for and filing is refused in words.
 *
 * ── NO MONEY, NO RANKING ───────────────────────────────────────────────────
 *
 * A plan carries no terms. Money lives in an application's terms and is read
 * on the application's own page, behind `terms.read`. The village page never
 * carries a terms key, and it orders people by name, never by how far along
 * they are. Measures are parsed with the seat settings scoreboard reader,
 * which refuses words that rank people.
 */
import { termWarningOpensAt, type CycleClock } from "./cycleClock";
import { civilDateKey, zonedTimeToUtc } from "./lunar";
import {
  looksLikePaymentDetails,
  parseSeatSettings,
  PAYMENT_DETAIL_MESSAGE,
  type QuestSettings,
  type ScoreboardSettings,
} from "./seatSettings";

/** The member's own season page. Every notice about planning links here. */
export const SEASON_PLAN_MINE = "/season-plans/mine";

/** The village's page: everyone's plan, by name. Members only. */
export const SEASON_PLANS_PAGE = "/season-plans";

export const AIM_MAX = 600;
export const GOAL_MAX = 200;
/** A personal plan names at most three measures of the work. */
export const PLAN_MEASURES_MAX = 3;
/** More seats than anybody holds, to refuse a runaway list. */
export const HANDING_BACK_MAX = 20;

const DAY_MS = 86_400_000;

// ── The window ───────────────────────────────────────────────────────────────

/** A season, as much of it as planning reads. */
export interface PlanSeason {
  id: string;
  name?: string | null;
  startsOn: string;
  endsOn?: string | null;
  goals?: Array<{ text: string; done?: boolean }> | null;
  planWindow?: { opensOn: string; closesOn: string } | null;
}

export interface PlanWindow {
  seasonId: string;
  /** The first instant a plan notice may go out. */
  opensAt: Date;
  /** The first instant after the window. Filing still works after it. */
  closesAt: Date;
  /** The first day inside the window, in the village's zone. */
  opensOn: string;
  /** The last day inside the window, in the village's zone. */
  closesOn: string;
  /** True when an admin set the window by hand. */
  setByHand: boolean;
}

export type WindowState = "before" | "open" | "closed";

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight at the start of a civil day in a zone, or null when it is not a date. */
export function civilDayStart(day: string | null | undefined, timezone: string): Date | null {
  const m = CIVIL.exec(String(day ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return zonedTimeToUtc(y, mo, d, 0, 0, timezone || "UTC");
}

/** The civil day after this one. */
function nextDay(day: string): string {
  const m = CIVIL.exec(day) as RegExpExecArray;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + DAY_MS);
  return t.toISOString().slice(0, 10);
}

/**
 * The first cycle boundary a whole cycle after `start`.
 *
 * On a boundary, that is the next boundary. Part way into a cycle, the next
 * boundary leaves less than a cycle, so it is the one after.
 */
export function wholeCycleAfter(start: Date, clock: CycleClock): Date {
  const n = clock.cycleNumberAt(start);
  const onBoundary = clock.startOf(n).getTime() === start.getTime();
  return clock.startOf(onBoundary ? n + 1 : n + 2);
}

/**
 * WHEN MEMBERS PLAN A SEASON. PURE.
 *
 * Set by hand when the season carries a valid `planWindow` (both days, the
 * close on or after the open). Otherwise it opens at `termWarningOpensAt` of
 * the season's first instant, never before the previous season began, and
 * closes a whole cycle after the season starts. Null when the season has no
 * readable first day.
 */
export function planWindowFor(
  season: PlanSeason,
  previousSeason: PlanSeason | null | undefined,
  clock: CycleClock,
  timezone: string,
): PlanWindow | null {
  const tz = timezone || "UTC";
  const hand = season.planWindow;
  if (hand) {
    const opensAt = civilDayStart(hand.opensOn, tz);
    const closesAt = civilDayStart(CIVIL.test(String(hand.closesOn ?? "")) ? nextDay(String(hand.closesOn)) : "", tz);
    if (opensAt && closesAt && closesAt.getTime() > opensAt.getTime()) {
      return { seasonId: season.id, opensAt, closesAt, opensOn: hand.opensOn, closesOn: hand.closesOn, setByHand: true };
    }
  }
  const start = civilDayStart(season.startsOn, tz);
  if (!start) return null;
  let opensAt = termWarningOpensAt(start, clock);
  const previousStart = previousSeason ? civilDayStart(previousSeason.startsOn, tz) : null;
  if (previousStart && opensAt.getTime() < previousStart.getTime()) opensAt = previousStart;
  const closesAt = wholeCycleAfter(start, clock);
  return {
    seasonId: season.id,
    opensAt,
    closesAt,
    opensOn: civilDateKey(opensAt, tz),
    closesOn: civilDateKey(new Date(closesAt.getTime() - 1), tz),
    setByHand: false,
  };
}

export function windowState(w: PlanWindow, now: Date): WindowState {
  if (now.getTime() < w.opensAt.getTime()) return "before";
  return now.getTime() < w.closesAt.getTime() ? "open" : "closed";
}

export interface PlanTarget {
  season: PlanSeason;
  window: PlanWindow;
}

/**
 * THE SEASON A MEMBER PLANS RIGHT NOW, or null. PURE.
 *
 * The latest-starting season whose window has opened and which has not ended.
 * So a window opening before the next season starts moves every new plan onto
 * that season, and a member filing late still files for the season they are
 * in. Null when no window has opened yet: there is nothing to plan for.
 */
export function planTargetAt(seasons: readonly PlanSeason[], clock: CycleClock, timezone: string, now: Date): PlanTarget | null {
  const tz = timezone || "UTC";
  const dated = seasons.filter((s) => s && s.id && civilDayStart(s.startsOn, tz)).slice();
  dated.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  let found: PlanTarget | null = null;
  for (let i = 0; i < dated.length; i += 1) {
    const season = dated[i];
    const window = planWindowFor(season, i > 0 ? dated[i - 1] : null, clock, tz);
    if (!window || now.getTime() < window.opensAt.getTime()) continue;
    const ends = season.endsOn ? civilDayStart(season.endsOn, tz) : null;
    if (ends && ends.getTime() <= now.getTime()) continue;
    found = { season, window };
  }
  return found;
}

/** The window as the client reads it on /api/season. Days only, no instants to misread. */
export interface PlanWindowPayload {
  seasonId: string;
  seasonName: string;
  opensOn: string;
  closesOn: string;
  state: WindowState;
}

export function planWindowPayload(t: PlanTarget | null, now: Date): PlanWindowPayload | null {
  if (!t) return null;
  return {
    seasonId: t.season.id,
    seasonName: String(t.season.name ?? "").trim(),
    opensOn: t.window.opensOn,
    closesOn: t.window.closesOn,
    state: windowState(t.window, now),
  };
}

// ── Reminders ────────────────────────────────────────────────────────────────

export const REMINDER_MARKS = ["halfway", "three-days"] as const;
export type ReminderMark = (typeof REMINDER_MARKS)[number];

/**
 * WHICH REMINDER IS DUE NOW, or null. PURE.
 *
 * Halfway through the window, then three days before it closes. A sweep that
 * missed a mark sends only the most recent one, so a member never hears two
 * numbers at once. Nothing after the window closes.
 */
export function dueReminderMark(w: PlanWindow, now: Date): ReminderMark | null {
  const t = now.getTime();
  if (t < w.opensAt.getTime() || t >= w.closesAt.getTime()) return null;
  if (t >= w.closesAt.getTime() - 3 * DAY_MS) return "three-days";
  if (t >= w.opensAt.getTime() + (w.closesAt.getTime() - w.opensAt.getTime()) / 2) return "halfway";
  return null;
}

/** Whole days until the window closes, counting today. At least 1 while it is open. */
export function daysLeftIn(w: PlanWindow, now: Date): number {
  return Math.max(1, Math.ceil((w.closesAt.getTime() - now.getTime()) / DAY_MS));
}

/** "9 November 2026" from "2026-11-09". The day is civil, so it is read in UTC. */
export function civilDayWords(day: string): string {
  const m = CIVIL.exec(String(day ?? "").trim());
  if (!m) return String(day ?? "");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The notice that planning has opened. Seat names never appear: it goes to everyone. */
export function planOpenCopy(seasonName: string, closesOn: string): { title: string; body: string } {
  const name = seasonName.trim() || "the next season";
  return {
    title: `Plan your season: ${name}`,
    body: `Choose your seats and what you will do. Open until ${civilDayWords(closesOn)}.`,
  };
}

/** The nudge to a member who has not filed. */
export function planReminderCopy(daysLeft: number): { title: string; body: string } {
  return {
    title: "Your season is not filed yet",
    body: `${daysLeft === 1 ? "1 day" : `${daysLeft} days`} left.`,
  };
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** What a member commits to personally. The seat settings quest and scoreboard groups, nothing else. */
export interface PlanCommitments {
  quests?: QuestSettings;
  scoreboard?: ScoreboardSettings;
}

export interface PlanInput {
  aim: string | null;
  /** A goal of the season, copied as written. */
  servesGoal: string | null;
  commitments: PlanCommitments;
  /** Seats the member hands back at the season's turn. */
  handingBack: string[];
}

export type ParsedPlan = { ok: true; plan: PlanInput } | { ok: false; field: string; error: string };

const COMMITMENT_GROUPS = ["quests", "scoreboard"] as const;

/**
 * Read a request body into a plan, or the first reason it cannot be one. PURE.
 *
 * `goals` are the season's own goals: a served goal must be one of them, as
 * written. Seats handed back are checked against the seats the member holds
 * by the route, which can read them.
 */
export function parsePlanInput(body: unknown, ctx: { goals: readonly string[] }): ParsedPlan {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const aimRaw = b.aim === undefined || b.aim === null ? "" : b.aim;
  if (typeof aimRaw !== "string") return { ok: false, field: "aim", error: "Your aim needs to be words." };
  const aim = aimRaw.trim() || null;
  if (aim && aim.length > AIM_MAX) return { ok: false, field: "aim", error: `Keep your aim to ${AIM_MAX} characters.` };
  if (aim && looksLikePaymentDetails(aim)) return { ok: false, field: "aim", error: PAYMENT_DETAIL_MESSAGE };

  const goalRaw = typeof b.servesGoal === "string" ? b.servesGoal.trim() : "";
  if (b.servesGoal !== undefined && b.servesGoal !== null && typeof b.servesGoal !== "string") {
    return { ok: false, field: "servesGoal", error: "Pick a goal from the season's list." };
  }
  const servesGoal = goalRaw || null;
  if (servesGoal && (servesGoal.length > GOAL_MAX || !ctx.goals.map((g) => g.trim()).includes(servesGoal))) {
    return { ok: false, field: "servesGoal", error: "That is not one of this season's goals. Pick one from the list." };
  }

  const c = b.commitments === undefined || b.commitments === null ? {} : b.commitments;
  if (typeof c !== "object" || Array.isArray(c)) return { ok: false, field: "commitments", error: "Your commitments arrive as a set of groups." };
  for (const key of Object.keys(c as object)) {
    if (!(COMMITMENT_GROUPS as readonly string[]).includes(key)) {
      return { ok: false, field: `commitments.${key}`, error: "Your season holds quests and measures. Terms belong on a seat application." };
    }
  }
  const raw = c as Record<string, unknown>;
  const measures = (raw.scoreboard as { measures?: unknown } | undefined)?.measures;
  if (Array.isArray(measures) && measures.length > PLAN_MEASURES_MAX) {
    return { ok: false, field: "commitments.scoreboard", error: `Up to ${PLAN_MEASURES_MAX} measures.` };
  }
  const parsed = parseSeatSettings({ v: 1, ...(raw.quests != null ? { quests: raw.quests } : {}), ...(raw.scoreboard != null ? { scoreboard: raw.scoreboard } : {}) });
  if (!parsed.ok || !parsed.settings) {
    const first = parsed.problems[0];
    return { ok: false, field: `commitments.${first?.path ?? ""}`.replace(/\.$/, ""), error: first?.message ?? "These commitments could not be read." };
  }
  const commitments: PlanCommitments = {};
  if (parsed.settings.quests) commitments.quests = parsed.settings.quests;
  if (parsed.settings.scoreboard && parsed.settings.scoreboard.measures.length > 0) commitments.scoreboard = parsed.settings.scoreboard;

  const back = b.handingBack === undefined || b.handingBack === null ? [] : b.handingBack;
  if (!Array.isArray(back)) return { ok: false, field: "handingBack", error: "Seats handed back arrive as a list." };
  const handingBack = Array.from(new Set(back.map((s) => String(s ?? "").trim()).filter((s) => s !== "")));
  if (handingBack.length > HANDING_BACK_MAX || handingBack.some((s) => s.length > 64)) {
    return { ok: false, field: "handingBack", error: "That list names seats this village does not have." };
  }

  return { ok: true, plan: { aim, servesGoal, commitments, handingBack } };
}

/** What a plan must carry before it can be filed, or null when it is ready. */
export function fileRefusal(plan: Pick<PlanInput, "aim"> | null): string | null {
  if (!plan) return "Save your season first, then file it.";
  if (!plan.aim) return "Write your aim for the season, then file it.";
  return null;
}

// ── Where the seat choices go ────────────────────────────────────────────────

/**
 * The member door, opened for this season. `seat` picks a seat; `renew`
 * picks a seat the member already holds. PR4's wizard reads all three
 * (`roleApplicationStart`), and the season decides the first day.
 */
export function applyHref(opts: { seasonId: string; seat?: string | null; renew?: string | null }): string {
  const q = new URLSearchParams({ type: "role_application" });
  if (opts.renew) {
    q.set("seat", opts.renew);
    q.set("renew", opts.renew);
  } else if (opts.seat) {
    q.set("seat", opts.seat);
  }
  q.set("season", opts.seasonId);
  return `/propose?${q.toString()}`;
}

/** The quest pips of a plan, in words for a screen reader. */
export function questPipsWords(done: number, min: number | null, max: number | null): string {
  const goal = max ?? min;
  if (!goal) return done === 1 ? "1 quest done this moon" : `${done} quests done this moon`;
  return `${done} of ${goal} quests done this moon`;
}
