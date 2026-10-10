/**
 * YOUR SEASON: EVERY MEMBER'S PLAN, AND THE VILLAGE'S PAGE OF THEM (season plans RC1).
 *
 *   GET  /api/season-plans               everyone's plan for the season (terms.read)
 *   GET  /api/season-plans?handle=<h>    one member's, for their profile (terms.read)
 *   GET  /api/season-plans/mine          your own plan, seats and applications
 *   PUT  /api/season-plans/mine          save your plan as its next version
 *   POST /api/season-plans/mine/file     file the newest version
 *
 * Plus one job, `season-plan-notices`, twice a day: "Plan your season" when the
 * window opens, and a reminder to anybody not filed halfway through it and three
 * days before it closes (server/lib/seasonPlanNotices.ts).
 *
 * ── TWO KINDS OF CHOICE, TWO ROADS ─────────────────────────────────────────
 *
 * A seat a member keeps or applies for needs the village's word, so it goes
 * through the member door as an ordinary seat application
 * (server/routes/seatApplications.ts), decided the way every application is.
 * This file only reads those back, by `candidate_user_id` and
 * `term_season_id`. A seat handed back, and everything a member commits to
 * personally, is FILED here and never voted (Rye, 2026-10-09).
 *
 * ── THE OPEN BOOK, WITH NO MONEY ON IT ─────────────────────────────────────
 *
 * The village page answers 401 to a visitor and to a signed-in guest: it is
 * `terms.read`, asked through the one gate. And even a member reads no terms
 * here. A card carries seat names, application statuses linking each
 * application's own page, the member's aim, this moon's quest pips and their
 * measures in words: nothing from an application's settings. Every card is
 * ordered by name, never by progress, and the members who have not filed are
 * named, never ranked (Rye, 2026-10-09, decision 2).
 *
 * ── NO PUBLIC EVENT ────────────────────────────────────────────────────────
 *
 * No `recordEvent` and no `addActivity` anywhere here: both reach the village's
 * public record by default. The plan row is the record, and the notices carry
 * the season and a link.
 *
 * ── MOUNTED BEHIND THE GOVERNANCE MODULE ───────────────────────────────────
 *
 * `/api/season-plans` is one of the governance module's prefixes
 * (shared/modules.ts), and the gate for it is mounted here, first, with the
 * routes it guards.
 */
import type { Express, RequestHandler } from "express";
import type { CycleClock } from "../../shared/cycleClock";
import {
  fileRefusal,
  parsePlanInput,
  planTargetAt,
  planWindowPayload,
  type PlanSeason,
  type PlanTarget,
} from "../../shared/seasonPlans";
import { applicationHref, STATUS_WORDS, type ApplicationStatus } from "../../shared/seatApplications";
import { civilDateKey } from "../../shared/lunar";
import type { AppDeps } from "../lib/appDeps";
import { listOrgAssignments, listOrgRoles, type LapseContext } from "../lib/orgChart";
import { userIdForHandle } from "../lib/profile";
import { villageClock } from "../lib/stewardship";
import { registerJob } from "../lib/scheduler";
import { runSeasonPlanNotices } from "../lib/seasonPlanNotices";
import { consentedBetween, fileNewestVersion, filedMembers, insertPlanVersion, planVersions, plansInSeason, type StoredPlan } from "../repos/seasonPlans";
import { applicationsInSeason, type StoredApplication } from "../repos/seatApplications";

/** Everything a member's plans hold, for `GET /api/profile/export`. */
export { plansOfMember as seasonPlansForMember } from "../repos/seasonPlans";

export const SEASON_PLAN_JOB = "season-plan-notices";
/** Twice a day, for the reason the season-end reminders give: a daily job that drifts can skip a date. */
export const SEASON_PLAN_EVERY_MS = 12 * 60 * 60 * 1000;

/** Thirty saves in ten minutes per member: a page saving as somebody types stays under it. */
const SAVES_PER_WINDOW = 30;
const SAVE_WINDOW_MS = 10 * 60 * 1000;

/** The statuses that mean the village has not answered yet. */
const WAITING: readonly ApplicationStatus[] = ["awaiting-holder", "voting"];

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "getPool" | "notify" | "overLimit" | "members" | "isPresent"> & {
  /** `seasonState()`: the dated seasons, goals and hand-set windows, and the village's zone. */
  seasonState(): { seasons: PlanSeason[]; timezone: string };
  /** The village clock. Defaults to the live `cycle.mode` (`villageClock`); tests hand one in. */
  clock?: () => CycleClock;
  lapse(): LapseContext;
  /** `requireModule("governance")`, mounted on this file's prefix before its routes. */
  moduleGate: RequestHandler;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
};

const MEMBERS_ONLY = { error: "auth_required", message: "Members read the village's season plans." };

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, getPool, notify, overLimit, members, isPresent, seasonState, lapse } = deps;
  const clock = deps.clock ?? villageClock;
  const now = () => (deps.now ? deps.now() : new Date());

  app.use("/api/season-plans", deps.moduleGate);

  registerJob(SEASON_PLAN_JOB, SEASON_PLAN_EVERY_MS, async () => {
    const at = now();
    const r = await runSeasonPlanNotices({
      target: targetAt(at),
      now: at,
      members: await members.all(),
      isPresent,
      filed: (seasonId) => filedMembers(getPool(), seasonId),
      notify,
    });
    if (r.opened || r.reminded) return `${r.opened} told planning opened, ${r.reminded} reminded`;
  });

  function targetAt(at: Date): PlanTarget | null {
    const s = seasonState();
    return planTargetAt(s.seasons ?? [], clock(), s.timezone || "UTC", at);
  }

  function seasonOut(t: PlanTarget) {
    return {
      id: t.season.id,
      name: String(t.season.name ?? ""),
      startsOn: t.season.startsOn,
      endsOn: t.season.endsOn || null,
      goals: (t.season.goals ?? []).map((g) => String(g?.text ?? "").trim()).filter(Boolean),
    };
  }

  /** The member's live seats, by member, with names. Examples and documented holders are left out. */
  async function heldSeats(): Promise<Map<string, Array<{ id: string; name: string; termEndsOn: string | null; lapsed: boolean }>>> {
    const pool = getPool();
    const tz = seasonState().timezone || "UTC";
    const [live, roles] = await Promise.all([listOrgAssignments(pool, { ...lapse(), now: now() }), listOrgRoles(pool)]);
    const nameOf = new Map(roles.map((r) => [r.id, r.name]));
    const out = new Map<string, Array<{ id: string; name: string; termEndsOn: string | null; lapsed: boolean }>>();
    for (const a of live) {
      if (a.holderKind !== "member" || !a.userId || a.isExample) continue;
      const list = out.get(a.userId) ?? [];
      if (list.some((s) => s.id === a.orgRoleId)) continue;
      list.push({
        id: a.orgRoleId,
        name: nameOf.get(a.orgRoleId) ?? a.orgRoleId,
        termEndsOn: a.termEndsAt ? civilDateKey(a.termEndsAt, tz) : null,
        lapsed: !!a.lapsed,
      });
      out.set(a.userId, list);
    }
    return out;
  }

  /** An application as a plan shows it: the seats and where it stands. Never its terms. */
  function appOut(a: StoredApplication, nameOf: (id: string) => string) {
    return {
      id: a.id,
      href: applicationHref(a.id),
      status: a.status,
      statusWords: STATUS_WORDS[a.status],
      seats: a.seatIds.map((id) => ({ id, name: nameOf(id) })),
    };
  }

  async function seatNamer(): Promise<(id: string) => string> {
    const roles = await listOrgRoles(getPool());
    const names = new Map(roles.map((r) => [r.id, r.name]));
    return (id: string) => names.get(id) ?? id;
  }

  /** This moon on the village clock: the window the pips count in. */
  function thisMoon(at: Date) {
    const b = clock().boundsFor(at);
    return { from: b.startsAt, to: b.endsAt };
  }

  /** Newest version, and newest filed version. */
  function latestOf(versions: StoredPlan[]) {
    const newest = versions.length ? versions[versions.length - 1] : null;
    const filed = [...versions].reverse().find((v) => v.filedAt) ?? null;
    return { newest, filed };
  }

  /** The words of a plan anybody may read: never a draft. */
  function planWords(p: StoredPlan | null) {
    if (!p) return null;
    return {
      aim: p.aim,
      servesGoal: p.servesGoal,
      quests: p.commitments?.quests ? { min: p.commitments.quests.perMoonMin ?? null, max: p.commitments.quests.perMoonMax ?? null } : null,
      measures: (p.commitments?.scoreboard?.measures ?? []).map((m) => ({ measure: m.measure, target: m.target ?? null })),
    };
  }

  // ── The village page ──────────────────────────────────────────────────────
  app.get("/api/season-plans", async (req, res) => {
    if (!(await guardCapability(req, res, "terms.read", { status: 401, body: MEMBERS_ONLY }))) return;
    const viewer = await authedUser(req);
    if (!viewer) return res.status(401).json(MEMBERS_ONLY);
    const at = now();
    const target = targetAt(at);
    if (!target) return res.json({ season: null, window: null, people: [], filedCount: 0, memberCount: 0, notFiled: [] });

    const pool = getPool();
    const seasonId = target.season.id;
    let people = (await members.all()).filter((m) => isPresent(m));
    const handle = typeof req.query.handle === "string" ? req.query.handle.trim() : "";
    if (handle) {
      const id = await userIdForHandle(pool, handle);
      people = people.filter((m) => String(m.id) === id);
      if (!people.length) return res.status(404).json({ error: "There is no member by that name." });
    }
    const [seats, plans, apps, nameOf, consented] = await Promise.all([
      heldSeats(),
      plansInSeason(pool, seasonId),
      applicationsInSeason(pool, seasonId),
      seatNamer(),
      (async () => {
        const moon = thisMoon(at);
        return consentedBetween(pool, moon.from, moon.to);
      })(),
    ]);

    const tz = seasonState().timezone || "UTC";
    const cards = people
      .map((m) => {
        const id = String(m.id);
        const { newest, filed } = latestOf(plans.filter((p) => p.userId === id));
        const mine = apps.filter((a) => a.candidateUserId === id && a.status !== "withdrawn").map((a) => appOut(a, nameOf));
        const words = planWords(filed);
        return {
          userId: id,
          name: String(m.name ?? "").trim() || "A member",
          handle: typeof m.handle === "string" && m.handle ? m.handle : null,
          filed: !!filed,
          filedOn: filed?.filedAt ? civilDateKey(filed.filedAt, tz) : null,
          changedSinceFiling: !!filed && !!newest && newest.version > filed.version,
          seats: (seats.get(id) ?? []).map((s) => ({ id: s.id, name: s.name })),
          handingBack: (filed?.handingBack ?? []).map((sid) => ({ id: sid, name: nameOf(sid) })),
          applications: mine,
          waiting: mine.some((a) => WAITING.includes(a.status)),
          aim: words?.aim ?? null,
          servesGoal: words?.servesGoal ?? null,
          questsThisMoon: { done: consented.get(id) ?? 0, min: words?.quests?.min ?? null, max: words?.quests?.max ?? null },
          measures: words?.measures ?? [],
        };
      })
      // By name, never by progress.
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.userId.localeCompare(b.userId));

    res.json({
      season: seasonOut(target),
      window: planWindowPayload(target, at),
      people: cards,
      filedCount: cards.filter((c) => c.filed).length,
      memberCount: cards.length,
      notFiled: cards.filter((c) => !c.filed).map((c) => ({ userId: c.userId, name: c.name, handle: c.handle })),
    });
  });

  // ── Your own ──────────────────────────────────────────────────────────────
  async function yours(req: any, res: any) {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in to plan your season." });
      return null;
    }
    return user;
  }

  async function mineOut(userId: string) {
    const at = now();
    const target = targetAt(at);
    if (!target) return { season: null, window: null, plan: null, filed: null, heldSeats: [], applications: [], questsThisMoon: { done: 0 } };
    const pool = getPool();
    const tz = seasonState().timezone || "UTC";
    const seasonId = target.season.id;
    const [versions, seats, apps, nameOf, consented] = await Promise.all([
      planVersions(pool, userId, seasonId),
      heldSeats(),
      applicationsInSeason(pool, seasonId, userId),
      seatNamer(),
      (async () => {
        const moon = thisMoon(at);
        return consentedBetween(pool, moon.from, moon.to);
      })(),
    ]);
    const { newest, filed } = latestOf(versions);
    return {
      season: seasonOut(target),
      window: planWindowPayload(target, at),
      plan: newest
        ? {
            version: newest.version,
            aim: newest.aim,
            servesGoal: newest.servesGoal,
            commitments: newest.commitments ?? {},
            handingBack: newest.handingBack,
            savedOn: civilDateKey(newest.createdAt, tz),
          }
        : null,
      filed: filed ? { version: filed.version, filedOn: filed.filedAt ? civilDateKey(filed.filedAt, tz) : null } : null,
      changedSinceFiling: !!filed && !!newest && newest.version > filed.version,
      heldSeats: seats.get(userId) ?? [],
      applications: apps.filter((a) => a.status !== "withdrawn").map((a) => appOut(a, nameOf)),
      questsThisMoon: { done: consented.get(userId) ?? 0 },
    };
  }

  app.get("/api/season-plans/mine", async (req, res) => {
    const user = await yours(req, res);
    if (!user) return;
    res.json(await mineOut(String(user.id)));
  });

  app.put("/api/season-plans/mine", async (req, res) => {
    const user = await yours(req, res);
    if (!user) return;
    const userId = String(user.id);
    if (await overLimit(`season-plan:${userId}`, SAVES_PER_WINDOW, SAVE_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_saves", message: "That is a lot of saves in a few minutes. Wait a little and try again." });
    }
    const target = targetAt(now());
    if (!target) {
      return res.status(409).json({ error: "no_season", message: "There is no season to plan yet. Planning opens one moon before the next season starts." });
    }
    const goals = (target.season.goals ?? []).map((g) => String(g?.text ?? "").trim()).filter(Boolean);
    const parsed = parsePlanInput(req.body, { goals });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    const held = new Set((await heldSeats()).get(userId)?.map((s) => s.id) ?? []);
    const stray = parsed.plan.handingBack.find((id) => !held.has(id));
    if (stray) return res.status(400).json({ error: "You can only hand back a seat you hold.", field: "handingBack", seatId: stray });
    await insertPlanVersion(getPool(), userId, target.season.id, parsed.plan);
    res.json(await mineOut(userId));
  });

  app.post("/api/season-plans/mine/file", async (req, res) => {
    const user = await yours(req, res);
    if (!user) return;
    const userId = String(user.id);
    if (await overLimit(`season-plan:${userId}`, SAVES_PER_WINDOW, SAVE_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_saves", message: "Wait a little and try again." });
    }
    const target = targetAt(now());
    if (!target) {
      return res.status(409).json({ error: "no_season", message: "There is no season to plan yet. Planning opens one moon before the next season starts." });
    }
    const pool = getPool();
    const versions = await planVersions(pool, userId, target.season.id);
    const newest = versions.length ? versions[versions.length - 1] : null;
    const refusal = fileRefusal(newest);
    if (refusal) return res.status(409).json({ error: "not_ready", message: refusal });
    if (newest && !newest.filedAt) await fileNewestVersion(pool, userId, target.season.id);
    res.json(await mineOut(userId));
  });
}
