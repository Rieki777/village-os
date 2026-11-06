/**
 * PROPOSE MY ROLES FOR NEXT SEASON (role proposals PR A).
 *
 *   GET    /api/governance/role-proposals/mine                     your proposals, newest first, and next season
 *   POST   /api/governance/role-proposals                          start a draft, empty or with a first body
 *   POST   /api/governance/role-proposals/prefill                  start a draft from your current card
 *   GET    /api/governance/role-proposals/:id                      your draft (owner only)
 *   PUT    /api/governance/role-proposals/:id                      save one or more steps of it
 *   DELETE /api/governance/role-proposals/:id                      delete a draft
 *   GET    /api/governance/role-proposals/:id/card                 the card it would make, in proposal mode
 *   POST   /api/governance/role-proposals/:id/words                the exact words submitting aligns with
 *   POST   /api/governance/role-proposals/:id/share                turn the link on, or set who it opens to
 *   POST   /api/governance/role-proposals/:id/share/regenerate     a new link; the old one reads nothing
 *   DELETE /api/governance/role-proposals/:id/share                turn the link off
 *   GET    /api/governance/role-proposals/:id/comments             every comment, for the owner
 *   POST   /api/governance/role-proposals/:id/submit               write the application for next season
 *   GET    /api/governance/role-proposals/shared/:token            the shared read, at the reader's tier
 *   GET    /api/governance/role-proposals/shared/:token/comments   your own comments (the owner's: all)
 *   POST   /api/governance/role-proposals/shared/:token/comments   leave feedback (members only)
 *   GET    /api/governance/role-proposals/nudge                    the nudge due for you now, for the profile banner
 *   POST   /api/governance/role-applications/:id/consent           an asked holder consents or objects (PR B)
 *
 * Plus one job, `role-proposal-nudges`, four times a day: when next season's
 * window opens, at a role's review date, and 2 business days before the
 * window closes (server/lib/roleProposals.ts), each trigger once.
 *
 * The contract, every limit and every sentence is shared/roleProposals.ts;
 * the statements are server/repos/roleProposals.ts.
 *
 * ── A DRAFT IS THE OWNER'S UNTIL SUBMITTED ─────────────────────────────────
 *
 * Every read by id answers 404 to anybody but the owner, a holder of the
 * power that seats people and an admin included: a draft is on no list and
 * its existence is not confirmed. The share link is the one way somebody
 * else reads it, and only while the owner keeps it on.
 *
 * ── SUBMIT IS THE MEMBER DOOR ──────────────────────────────────────────────
 *
 * Submitting asks the member door (`roleApplicationDoor`,
 * server/routes/seatApplications.ts) for an ordinary application: the roles,
 * the terms, the target season, and a first day at that season's start. Every
 * check the door makes is made. The draft is stamped submitted INSIDE the
 * application's transaction, so the two never disagree. A new role is named
 * in the application by the id the draft gave it, and the village creates it
 * under that id. The member's season words are saved as their plan for that
 * season once the application is written.
 *
 * ── THE CIRCLE IS ASKED IN THE SAME TRANSACTION (PR B) ─────────────────────
 *
 * Every live holder of a role in the proposed roles' circles, the member
 * excluded, is asked to consent or object within 2 business days, and the
 * asks are written with the application. A proposal always waits on a holder
 * and never opens a village vote: Rye's ruling decides it by the circle or by
 * the power. Adoption is the member door's own adopt route, which applies the
 * proposal's role changes first (server/lib/roleProposals.ts).
 *
 * ── THE SHARED READ ────────────────────────────────────────────────────────
 *
 * Members (`terms.read`) with the link read the proposal and its card at the
 * member tier, terms included, and may leave feedback while it is a draft.
 * With "anyone with the link" on, everybody else reads it at the public tier:
 * the roles and their words, no terms, no season words, no review dates, no
 * comments. Everything here sits under the governance module's prefix, so a
 * village keeping governance to members keeps a stranger out whatever the
 * draft says; the owner's payload says so (`anyoneReaches`).
 *
 * No `recordEvent` and no `addActivity`: a draft is private, and the row is
 * the record.
 */
import crypto from "node:crypto";
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { hasCapability } from "../../shared/capabilities";
import { civilDateKey } from "../../shared/lunar";
import type { ModuleLifecycle } from "../../shared/modules";
import {
  applicationWordsOf,
  changesRoles,
  emptyBody,
  isShareAudience,
  MAX_PROPOSAL_ROLES,
  parseBodyUpdate,
  parseComment,
  PROPOSAL_ID,
  PROPOSAL_WORDS,
  proposalHref,
  SHARE_TOKEN,
  sharedProposalHref,
  submitRefusal,
  wordFields,
  type BodyContext,
  type ProposalBody,
  type ShareAudience,
  type WordFieldsContext,
} from "../../shared/roleProposals";
import { APPLICATION_ID, applicationHref } from "../../shared/seatApplications";
import { CONSENT_WORDS, consentClosesAt, NUDGE_WORDS, PROPOSE_ENTRY_HREF, whoApprovesWords } from "../../shared/roleProposalConsent";
import { parseSeatSettings, type SeatSettings } from "../../shared/seatSettings";
import { carriesMoney, intentSentence } from "../../shared/alignments";
import type { AppDeps } from "../lib/appDeps";
import { seatTermsWords } from "../lib/alignmentSubjects";
import { effectiveLifecycle } from "../lib/modules";
import { listOrgAssignments, listOrgRoles, type OrgRole } from "../lib/orgChart";
import {
  answerConsent,
  askRolesFor,
  circleAsksFor,
  consentView,
  NUDGE_EVERY_MS,
  NUDGE_JOB,
  nudgesFor,
  ROLE_WORD_FIELDS,
  runProposalNudges,
  type AskRoles,
} from "../lib/roleProposals";
import { registerJob } from "../lib/scheduler";
import { villageClock } from "../lib/stewardship";
import { buildPlayerCards, type CardLevel, type CardProposal } from "../lib/playerCardData";
import * as store from "../repos/roleProposals";
import { readApplications } from "../repos/seatApplications";
import { insertPlanVersion, latestCardWords, planToStore, planVersions, plansOfMember } from "../repos/seasonPlans";
import { cardContext, cardSeatTier, type CardDeps } from "./playerCard";
import { roleAdoptersReader, roleApplicationDoor } from "./seatApplications";
import { registerRoleCardRoutes } from "./roleCardImport";

type Deps = CardDeps &
  Pick<AppDeps, "guardCapability" | "overLimit" | "notify" | "members" | "isPresent"> & {
    /** The governance module's lifecycle. Defaults to the live one; tests hand one in. */
    governanceLifecycle?: () => ModuleLifecycle;
    /** Whether Live Sessions is on, so an objection has a circle backlog to go to. Defaults to the live lifecycle. */
    sessionsOn?: () => boolean;
  };

const BASE = "/api/governance/role-proposals";
const WINDOW_MS = 10 * 60 * 1000;
/**
 * Saves as a member types through the steps. The page (PR C) saves after each
 * pause in typing, on every step, for up to five roles' words, so it needs
 * more room than the season plan's 30, which saves on a button.
 */
const SAVES_PER_WINDOW = 120;
/** Starting, deleting, sharing and submitting: ten of each in ten minutes. */
const ACTS_PER_WINDOW = 10;
/** Feedback a member leaves: ten in ten minutes, across every proposal. */
const COMMENTS_PER_WINDOW = 10;
/** Reads of one link in ten minutes, whoever is reading. */
const SHARED_READS_PER_WINDOW = 240;

/** The word fields of this platform's roles, read off the role reader itself (server/lib/roleProposals.ts). */
const WORDS: WordFieldsContext = ROLE_WORD_FIELDS;

const MEMBERS_ONLY_BODY = { error: "members_only", message: "Proposing roles opens at the member rung." };

interface Target {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
  goals: string[];
}

/** What every payload in one request reads once: the roles as posted and the circles. */
interface Known {
  posted: Map<string, OrgRole>;
  circles: Map<string, string>;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, guardCapability, getPool, overLimit, notify, firstName } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const governance = deps.governanceLifecycle ?? (() => effectiveLifecycle("governance"));
  const tz = () => deps.seasonState().timezone || "UTC";

  // ── Seasons ───────────────────────────────────────────────────────────────

  const seasons = (): any[] => (deps.seasonState().seasons ?? []).filter((s: any) => s && s.id && s.startsOn);

  const targetOf = (s: any): Target => ({
    id: String(s.id),
    name: String(s.name ?? ""),
    startsOn: String(s.startsOn),
    endsOn: s.endsOn ? String(s.endsOn) : null,
    goals: (Array.isArray(s.goals) ? s.goals : []).map((g: any) => String(g?.text ?? "").trim()).filter(Boolean),
  });

  /** Next season by the village's own calendar: the first that starts after today, or null when none is dated. */
  function nextSeason(): Target | null {
    const today = civilDateKey(now(), tz());
    const next = [...seasons()].sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn))).find((s) => String(s.startsOn) > today);
    return next ? targetOf(next) : null;
  }

  const seasonById = (id: string | null): Target | null => {
    const s = id ? seasons().find((x) => String(x.id) === id) : null;
    return s ? targetOf(s) : null;
  };

  const ended = (t: Target | null): boolean => !!t?.endsOn && t.endsOn <= civilDateKey(now(), tz());

  /**
   * The season a draft is for. A draft with no target, or one whose season was
   * taken off the calendar, takes next season the moment the village dates
   * one, and keeps it.
   */
  async function targetFor(p: store.StoredProposal): Promise<Target | null> {
    const held = seasonById(p.targetSeasonId);
    if (held || p.status !== "draft") return held;
    const next = nextSeason();
    if (next && next.id !== p.targetSeasonId) {
      await store.writeDraft(getPool(), p.id, p.body, next.id, now());
      p.targetSeasonId = next.id;
    }
    return next;
  }

  // ── What one request reads once ───────────────────────────────────────────

  async function known(pool: Pool): Promise<Known> {
    const [roles, circles] = await Promise.all([listOrgRoles(pool), store.villageCircles(pool)]);
    return {
      posted: new Map(roles.filter((r) => r.active && !r.isExample).map((r) => [r.id, r])),
      circles: new Map(circles.filter((c) => c.live).map((c) => [c.id, c.name])),
    };
  }

  const bodyContext = (k: Known, target: Target | null): BodyContext => ({
    words: WORDS,
    postedRoles: new Map(Array.from(k.posted, ([id, r]) => [id, r as unknown as Record<string, unknown>])),
    circles: new Set(k.circles.keys()),
    orgGoals: target?.goals ?? [],
    newRoleId: () => `role-${crypto.randomBytes(6).toString("hex")}`,
  });

  // ── The payload ───────────────────────────────────────────────────────────

  type Reader = "owner" | "member" | "anyone";

  /** A proposal as one reader may read it. Terms, season words and review dates are for members and the owner only. */
  function proposalOut(
    p: store.StoredProposal,
    target: Target | null,
    k: Known,
    reader: Reader,
    asks: store.StoredAsk[] = [],
    viewerId: string | null = null,
    askRoles?: AskRoles,
  ) {
    const membersUp = reader !== "anyone";
    const body = p.body;
    const circleOf = (id: string | null) => (id ? { id, name: k.circles.get(id) ?? "" } : null);
    const roles = body.roles.map((r) => {
      const role = k.posted.get(r.roleId);
      const fields = wordFields(role ? (role as unknown as Record<string, unknown>) : null, r.words, WORDS);
      return {
        roleId: r.roleId,
        name: role?.name ?? r.roleId,
        circle: circleOf(role?.circleId ?? null),
        // A role the village no longer fills reads so here, and the submit refuses it by name.
        live: !!role,
        fields,
        changedCount: fields.filter((f) => f.changed).length,
        ...(membersUp ? { reviewOn: r.reviewOn } : {}),
      };
    });
    const newRoles = body.newRoles.map((r) => ({
      id: r.id,
      name: typeof r.words.name === "string" ? r.words.name : "",
      circle: circleOf(r.circleId),
      seats: r.seats,
      fields: wordFields(null, r.words, WORDS),
      ...(membersUp ? { reviewOn: r.reviewOn } : {}),
    }));
    const isOwner = reader === "owner";
    const refusal = isOwner && p.status === "draft" ? (ended(target) ? PROPOSAL_WORDS.targetEnded : submitRefusal(body, !!target)) : null;
    return {
      id: p.id,
      status: p.status,
      href: proposalHref(p.id),
      target: target ? { seasonId: target.id, name: target.name, startsOn: target.startsOn, endsOn: target.endsOn, ended: ended(target) } : null,
      targetWords: target ? null : PROPOSAL_WORDS.noTarget,
      // The village's goals for that season, so a page can show what each seasonal goal serves.
      orgGoals: target?.goals ?? [],
      roles,
      newRoles,
      limits: { maxRoles: MAX_PROPOSAL_ROLES },
      // Whether role headings carry their CCOS term on hover or tap, the card's own switch (PR C draws it).
      frameworkTerms: deps.boolVar("org.ccos_terms"),
      ...(membersUp ? { settings: body.settings, season: body.season } : {}),
      ...(isOwner
        ? {
            share: {
              on: !!p.shareToken,
              audience: p.shareAudience,
              link: p.shareToken ? sharedProposalHref(p.shareToken) : null,
              token: p.shareToken,
              anyoneReaches: governance() === "public",
              anyoneNote: governance() === "public" ? null : PROPOSAL_WORDS.anyoneNeedsPublicGovernance,
            },
            mayEdit: p.status === "draft",
            readyToSubmit: p.status === "draft" && refusal === null,
            submitBlocked: refusal,
            // A proposal that changes role words or adds a role waits for the step that applies them (PR B).
            changesRoles: changesRoles(body),
          }
        : {}),
      application: p.applicationId ? { id: p.applicationId, href: applicationHref(p.applicationId) } : null,
      // Where the circle's consent stands, and the decision in words once adopted (PR B).
      consent: p.status === "submitted" && membersUp ? consentView(asks, now(), tz(), viewerId, askRoles) : null,
      decided: p.decidedWords,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      submittedAt: p.submittedAt ? p.submittedAt.toISOString() : null,
    };
  }

  /**
   * The card the proposal would make, through the batched builder, at one reader's tier.
   *
   * DRAWN IN THE SEASON IT IS FOR (E9, found end to end on main e1c5eb6): a
   * proposal for the second season was headed with the first season's name
   * and dates, under a page header naming the second, because the card took
   * the RUNNING season. The season is read by id when the card is drawn, so a
   * season renamed since reads by its new name; a draft with no target takes
   * next season the way `targetFor` would, without writing it; and a proposal
   * with no season to be for draws none, never the running one.
   */
  async function cardOf(req: any, viewer: any, p: store.StoredProposal, k: Known, level: CardLevel) {
    const pool = getPool();
    const viewerId = viewer ? String(viewer.id) : null;
    const seat = await cardSeatTier(deps, req, viewer, { terms: level !== "stranger", isSelf: level === "self" });
    const body = p.body;
    const target = seasonById(p.targetSeasonId) ?? (p.status === "draft" ? nextSeason() : null);
    const proposal: CardProposal = {
      applicationId: p.id,
      seatIds: [...body.roles.map((r) => r.roleId), ...body.newRoles.map((r) => r.id)],
      settings: body.settings,
      season: target ? { id: target.id, name: target.name || null, startsOn: target.startsOn, endsOn: target.endsOn } : null,
      termEndsAt: null,
      draft: {
        words: Object.fromEntries(body.roles.map((r) => [r.roleId, r.words as Record<string, unknown>])),
        newRoles: body.newRoles.map((r) => ({ id: r.id, circleId: r.circleId, circleName: k.circles.get(r.circleId) ?? null, seats: r.seats, words: r.words as Record<string, unknown> })),
        season: { aim: body.season.aim, servesGoals: body.season.servesGoals, seasonalGoals: body.season.seasonalGoals },
      },
    };
    const cards = await buildPlayerCards(pool, [{ userId: p.userId, tier: { level, seat }, proposal }], await cardContext(deps, viewerId, false, level !== "stranger"));
    return cards.get(p.userId) ?? null;
  }

  // ── Who is asking ─────────────────────────────────────────────────────────

  /** The signed-in member, or null after answering 401 or 403. Proposing opens at the member rung, like applying. */
  async function member(req: any, res: any): Promise<any | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in to propose your roles." });
      return null;
    }
    if (!(await guardCapability(req, res, "terms.read", { status: 403, body: MEMBERS_ONLY_BODY }))) return null;
    return user;
  }

  /** The owner's proposal by id, or null after answering. Anybody else is told there is no such proposal. */
  async function owned(req: any, res: any, user: any, draftOnly = false): Promise<store.StoredProposal | null> {
    const id = String(req.params.id ?? "");
    const p = PROPOSAL_ID.test(id) ? await store.readProposal(getPool(), id) : null;
    if (!p || p.userId !== String(user.id)) {
      res.status(404).json({ error: "not_found", message: PROPOSAL_WORDS.notYours });
      return null;
    }
    if (draftOnly && p.status !== "draft") {
      res.status(409).json({ error: "submitted", message: PROPOSAL_WORDS.notDraft });
      return null;
    }
    return p;
  }

  const limited = async (res: any, bucket: string, max: number): Promise<boolean> => {
    if (!(await overLimit(bucket, max, WINDOW_MS))) return false;
    res.status(429).json({ error: "too_many_asks", message: "That is a lot in a few minutes. Wait a little and try again." });
    return true;
  };

  // ── Prefill ───────────────────────────────────────────────────────────────

  /**
   * START FROM MY CURRENT CARD. The roles the member holds live, each with no
   * word changed (the diff reads the posted words), up to five; the terms the
   * newest application they were seated through holds, with each role's
   * review day from the application that seated it; and the words of their
   * newest season plan, keeping only the goals served that next season also
   * has. A member holding no role starts from an empty draft.
   */
  async function prefilled(pool: Pool, userId: string, k: Known, target: Target | null): Promise<ProposalBody> {
    const live = (await listOrgAssignments(pool, { ...deps.lapse(), now: now() })).filter(
      (a) => a.holderKind === "member" && a.userId === userId && !a.isExample && k.posted.has(a.orgRoleId),
    );
    const roleIds = Array.from(new Set(live.map((a) => a.orgRoleId))).slice(0, MAX_PROPOSAL_ROLES);
    if (!roleIds.length) return emptyBody();
    const throughIds = Array.from(new Set(live.map((a) => a.applicationId).filter((x): x is string => !!x)));
    const apps = throughIds.length ? await readApplications(pool, throughIds) : [];
    const adopted = apps.filter((a) => a.status === "adopted");
    const settingsOf = (raw: unknown): SeatSettings | null => {
      const parsed = parseSeatSettings(raw);
      return parsed.ok ? parsed.settings : null;
    };
    const newest = [...adopted].sort((a, b) => (b.decidedAt?.getTime() ?? b.createdAt.getTime()) - (a.decidedAt?.getTime() ?? a.createdAt.getTime()))[0];
    const reviewOf = (roleId: string): string | null => {
      const through = live.find((a) => a.orgRoleId === roleId)?.applicationId;
      const app = through ? adopted.find((a) => a.id === through) : null;
      const day = app ? settingsOf(app.settings)?.term?.reviewOn : null;
      return typeof day === "string" ? day : null;
    };
    const plans = (await plansOfMember(pool, userId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.version - a.version);
    const plan = plans[0] ?? null;
    const goals = new Set(target?.goals ?? []);
    return {
      roles: roleIds.map((roleId) => ({ roleId, words: {}, reviewOn: reviewOf(roleId) })),
      newRoles: [],
      settings: (newest && settingsOf(newest.settings)) || { v: 1 },
      season: {
        aim: plan?.aim ?? null,
        seasonalGoals: plan?.seasonalGoals ?? [],
        servesGoals: (plan?.servesGoals ?? []).filter((g) => goals.has(g.goal)),
      },
    };
  }

  /** Start a draft for a member the caller has already signed in. */
  async function startDraft(req: any, res: any, user: any, from: "empty" | "card") {
    const userId = String(user.id);
    if (await limited(res, `role-proposal-start:${userId}`, ACTS_PER_WINDOW)) return;
    const pool = getPool();
    const existing = await store.draftOf(pool, userId);
    if (existing) return res.status(409).json({ error: "draft_exists", message: PROPOSAL_WORDS.draftExists, id: existing.id, href: proposalHref(existing.id) });
    const k = await known(pool);
    const target = nextSeason();
    let body = from === "card" ? await prefilled(pool, userId, k, target) : emptyBody();
    if (from === "empty" && req.body && typeof req.body === "object" && Object.keys(req.body).length) {
      const parsed = parseBodyUpdate(req.body, body, bodyContext(k, target));
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
      body = parsed.value;
    }
    const id = `rp-${crypto.randomBytes(8).toString("hex")}`;
    await store.insertProposal(pool, { id, userId, targetSeasonId: target?.id ?? null, body, now: now() });
    const p = await store.readProposal(pool, id);
    if (!p) throw new Error("role proposals: a draft just written could not be read back");
    res.status(201).set("Cache-Control", "no-store").json({ proposal: proposalOut(p, target, k, "owner") });
  }

  // ── Your own ──────────────────────────────────────────────────────────────

  app.get(`${BASE}/mine`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const pool = getPool();
    // A fixed number of reads however many proposals the member has written.
    const [list, k] = await Promise.all([store.proposalsOf(pool, String(user.id)), known(pool)]);
    const next = nextSeason();
    const out = [];
    const asks = await store.asksFor(pool, list.filter((p) => p.status === "submitted").map((p) => p.id));
    const askRoles = await askRolesFor(pool, Array.from(asks.values()).flat());
    for (const p of list) out.push(proposalOut(p, p.status === "draft" ? await targetFor(p) : seasonById(p.targetSeasonId), k, "owner", asks.get(p.id) ?? [], String(user.id), askRoles));
    res.set("Cache-Control", "no-store").json({
      nextSeason: next ? { seasonId: next.id, name: next.name, startsOn: next.startsOn, endsOn: next.endsOn, goals: next.goals } : null,
      nextSeasonWords: next ? null : PROPOSAL_WORDS.noTarget,
      draftId: list.find((p) => p.status === "draft")?.id ?? null,
      proposals: out,
    });
  });

  app.post(BASE, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    await startDraft(req, res, user, "empty");
  });

  app.post(`${BASE}/prefill`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    await startDraft(req, res, user, "card");
  });

  // ── The nudge, for the profile banner (PR B). Before `/:id`, which would take the path. ──

  const clock = () => (deps.clock ?? villageClock)();

  /*
   * THE BANNER'S READ: the nudge due for the signed-in member now, most
   * pressing first, or nothing. Worked out live from the same facts the sweep
   * reads, so the banner and the bell never disagree about why.
   */
  app.get(`${BASE}/nudge`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const due = await nudgesFor({ pool: getPool(), now: now(), timeZone: tz(), clock: clock(), seasons: seasons(), lapse: deps.lapse() }, String(user.id));
    const first = due[0] ?? null;
    res.set("Cache-Control", "no-store").json({
      show: !!first,
      reason: first?.reason ?? null,
      heading: NUDGE_WORDS.heading,
      reasonWords: first ? NUDGE_WORDS.reasons[first.reason] : null,
      href: PROPOSE_ENTRY_HREF,
      linkWords: NUDGE_WORDS.link,
    });
  });

  // ── The shared read ───────────────────────────────────────────────────────

  /** The proposal a token opens and who is reading, or null after answering. */
  async function shared(req: any, res: any) {
    const token = String(req.params.token ?? "");
    if (!SHARE_TOKEN.test(token)) {
      res.status(404).json({ error: "link_off", message: PROPOSAL_WORDS.linkOff });
      return null;
    }
    if (await limited(res, `role-proposal-shared:${token}`, SHARED_READS_PER_WINDOW)) return null;
    const p = await store.proposalByShareToken(getPool(), token);
    if (!p) {
      res.status(404).json({ error: "link_off", message: PROPOSAL_WORDS.linkOff });
      return null;
    }
    const viewer = await authedUser(req);
    const isOwner = !!viewer && String(viewer.id) === p.userId;
    const isMember = !!viewer && hasCapability("terms.read", await capabilityCtx(viewer));
    if (p.shareAudience === "members" && !isMember && !isOwner) {
      res.status(401).json({ error: "members_only", message: PROPOSAL_WORDS.membersOnly });
      return null;
    }
    const level: CardLevel = isOwner ? "self" : isMember ? "member" : "stranger";
    return { p, viewer, isOwner, isMember, level };
  }

  app.get(`${BASE}/shared/:token`, async (req, res) => {
    const got = await shared(req, res);
    if (!got) return;
    const { p, viewer, isOwner, isMember, level } = got;
    const k = await known(getPool());
    const target = seasonById(p.targetSeasonId);
    const reader: Reader = isOwner ? "owner" : isMember ? "member" : "anyone";
    // The circle's asks, so a member reading a submitted proposal by its link reads where it stands
    // (role proposals PR D). Without them the state read as a circle nobody else holds a role in.
    const asks = reader !== "anyone" && p.status === "submitted" ? ((await store.asksFor(getPool(), [p.id])).get(p.id) ?? []) : [];
    res.set("Cache-Control", "no-store").json({
      proposal: proposalOut(p, target, k, reader === "owner" ? "member" : reader, asks, viewer ? String(viewer.id) : null, await askRolesFor(getPool(), asks)),
      card: await cardOf(req, viewer, p, k, level),
      you: { isOwner, mayComment: isMember && p.status === "draft", tier: reader === "anyone" ? "public" : "member" },
    });
  });

  /** A comment as one reader reads it. The owner reads who wrote each, by first name; a commenter reads only their own. */
  async function commentsOut(p: store.StoredProposal, viewerId: string, owner: boolean) {
    const list = await store.commentsOn(getPool(), p.id, owner ? undefined : viewerId);
    // The members are read once, whatever the number of comments.
    const names = owner && list.some((c) => c.authorId) ? new Map((await deps.members.all()).map((m: any) => [String(m.id), String(m.name ?? "")])) : new Map<string, string>();
    return list.map((c) => ({
      id: c.id,
      text: c.body,
      mine: c.authorId === viewerId,
      ...(owner ? { from: c.authorId ? firstName(String(names.get(c.authorId) ?? "")) || "A member" : "A former member" } : {}),
      writtenOn: civilDateKey(c.createdAt, tz()),
    }));
  }

  app.get(`${BASE}/shared/:token/comments`, async (req, res) => {
    const got = await shared(req, res);
    if (!got) return;
    if (!got.viewer || (!got.isMember && !got.isOwner)) return res.status(401).json({ error: "members_only", message: PROPOSAL_WORDS.commentMembersOnly });
    res.set("Cache-Control", "no-store").json({ comments: await commentsOut(got.p, String(got.viewer.id), got.isOwner) });
  });

  app.post(`${BASE}/shared/:token/comments`, async (req, res) => {
    const got = await shared(req, res);
    if (!got) return;
    const { p, viewer, isMember, isOwner } = got;
    if (!viewer || (!isMember && !isOwner)) return res.status(401).json({ error: "members_only", message: PROPOSAL_WORDS.commentMembersOnly });
    if (p.status !== "draft") return res.status(409).json({ error: "submitted", message: PROPOSAL_WORDS.notDraft });
    const authorId = String(viewer.id);
    if (await limited(res, `role-proposal-comment:${authorId}`, COMMENTS_PER_WINDOW)) return;
    const parsed = parseComment((req.body ?? {}).text);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    // Time first, so comments read in the order they were written even within one millisecond's tie on `created_at`.
    const at = now();
    const id = `rpc-${at.getTime().toString(16).padStart(12, "0")}${crypto.randomBytes(2).toString("hex")}`;
    await store.insertComment(getPool(), { id, proposalId: p.id, authorId, body: parsed.value, now: at });
    if (authorId !== p.userId) {
      await notify({
        userId: p.userId,
        type: "role_proposal_feedback",
        title: PROPOSAL_WORDS.commentNoticeTitle,
        body: null,
        link: proposalHref(p.id),
        actorUserId: null,
        dedupeKey: `rp:${p.id}:comment:${id}`,
      });
    }
    res.status(201).json({ comments: await commentsOut(p, authorId, isOwner) });
  });

  // ── One proposal, the owner's ─────────────────────────────────────────────

  app.get(`${BASE}/:id`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const p = await owned(req, res, user);
    if (!p) return;
    const k = await known(getPool());
    const asks = (await store.asksFor(getPool(), [p.id])).get(p.id) ?? [];
    res.set("Cache-Control", "no-store").json({ proposal: proposalOut(p, await targetFor(p), k, "owner", asks, String(user.id), await askRolesFor(getPool(), asks)) });
  });

  app.put(`${BASE}/:id`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await limited(res, `role-proposal-save:${String(user.id)}`, SAVES_PER_WINDOW)) return;
    const p = await owned(req, res, user, true);
    if (!p) return;
    const pool = getPool();
    const k = await known(pool);
    const target = await targetFor(p);
    const parsed = parseBodyUpdate(req.body, p.body, bodyContext(k, target));
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, field: parsed.field });
    const written = await store.writeDraft(pool, p.id, parsed.value, target?.id ?? null, now());
    if (!written) return res.status(409).json({ error: "submitted", message: PROPOSAL_WORDS.notDraft });
    const fresh = await store.readProposal(pool, p.id);
    res.set("Cache-Control", "no-store").json({ proposal: proposalOut(fresh ?? { ...p, body: parsed.value }, target, k, "owner") });
  });

  app.delete(`${BASE}/:id`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await limited(res, `role-proposal-delete:${String(user.id)}`, ACTS_PER_WINDOW)) return;
    const p = await owned(req, res, user, true);
    if (!p) return;
    const gone = await store.deleteDraft(getPool(), p.id, String(user.id));
    if (!gone) return res.status(409).json({ error: "submitted", message: PROPOSAL_WORDS.notDraft });
    res.json({ success: true });
  });

  app.get(`${BASE}/:id/card`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const p = await owned(req, res, user);
    if (!p) return;
    const card = await cardOf(req, user, p, await known(getPool()), "self");
    if (!card) return res.status(404).json({ error: "not_found", message: PROPOSAL_WORDS.notYours });
    res.set("Cache-Control", "no-store").json(card);
  });

  /**
   * The names an application from this draft carries, as the member door
   * names them: a role the village has by its posted name (a proposed rename
   * is a change to the role, decided with it), a new role by its own.
   */
  const namesOf = (body: ProposalBody, k: Known): string[] => [
    ...body.roles.map((r) => k.posted.get(r.roleId)?.name ?? r.roleId),
    ...body.newRoles.map((r) => (typeof r.words.name === "string" ? r.words.name : r.id)),
  ];

  app.post(`${BASE}/:id/words`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await limited(res, `role-proposal-words:${String(user.id)}`, SAVES_PER_WINDOW)) return;
    const p = await owned(req, res, user);
    if (!p) return;
    const names = namesOf(p.body, await known(getPool()));
    const words = seatTermsWords(names, p.body.settings);
    // Who approves it in THIS village, read from who holds the power, the member themselves never named (E8).
    const adopters = roleAdoptersReader();
    const whoApproves = adopters ? whoApprovesWords({ ...(await adopters(user, String(user.id))), changesRoles: changesRoles(p.body) }) : null;
    res.json({ title: words.title, body: words.body, money: carriesMoney(p.body.settings), intent: intentSentence(names), whoApproves });
  });

  // ── The card as text, and bringing a description in (server/routes/roleCardImport.ts) ──
  registerRoleCardRoutes(app, {
    getPool,
    member,
    owned,
    known,
    targetFor,
    nextSeason,
    prefilled,
    limited,
    draftOf: store.draftOf,
    villageName: () => deps.villageName(),
    members: deps.members,
    lapse: () => deps.lapse(),
    now,
  });

  // ── The share link ────────────────────────────────────────────────────────

  async function shareOut(res: any, p: store.StoredProposal, status = 200) {
    const fresh = (await store.readProposal(getPool(), p.id)) ?? p;
    res.status(status).set("Cache-Control", "no-store").json({
      share: {
        on: !!fresh.shareToken,
        audience: fresh.shareAudience,
        link: fresh.shareToken ? sharedProposalHref(fresh.shareToken) : null,
        token: fresh.shareToken,
        anyoneReaches: governance() === "public",
        anyoneNote: governance() === "public" ? null : PROPOSAL_WORDS.anyoneNeedsPublicGovernance,
      },
    });
  }

  /** 192 random bits, url-safe. A collision with a live token is retried, never shared. */
  async function freshToken(p: store.StoredProposal, audience: ShareAudience): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await store.setShare(getPool(), p.id, crypto.randomBytes(24).toString("base64url"), audience);
        return;
      } catch (e: any) {
        if ((e?.errno !== 1062 && e?.code !== "ER_DUP_ENTRY") || attempt >= 3) throw e;
      }
    }
  }

  const audienceFrom = (body: any, fallback: ShareAudience): ShareAudience | null => {
    const v = body && typeof body === "object" ? body.audience : undefined;
    if (v === undefined || v === null) return fallback;
    return isShareAudience(v) ? v : null;
  };

  app.post(`${BASE}/:id/share`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await limited(res, `role-proposal-share:${String(user.id)}`, ACTS_PER_WINDOW)) return;
    const p = await owned(req, res, user);
    if (!p) return;
    const audience = audienceFrom(req.body, p.shareAudience);
    if (!audience) return res.status(400).json({ error: "Pick members or anyone.", field: "audience" });
    if (p.shareToken) await store.setShare(getPool(), p.id, p.shareToken, audience);
    else await freshToken(p, audience);
    await shareOut(res, p);
  });

  app.post(`${BASE}/:id/share/regenerate`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await limited(res, `role-proposal-share:${String(user.id)}`, ACTS_PER_WINDOW)) return;
    const p = await owned(req, res, user);
    if (!p) return;
    const audience = audienceFrom(req.body, p.shareAudience);
    if (!audience) return res.status(400).json({ error: "Pick members or anyone.", field: "audience" });
    await freshToken(p, audience);
    await shareOut(res, p);
  });

  app.delete(`${BASE}/:id/share`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    if (await limited(res, `role-proposal-share:${String(user.id)}`, ACTS_PER_WINDOW)) return;
    const p = await owned(req, res, user);
    if (!p) return;
    await store.setShare(getPool(), p.id, null, p.shareAudience);
    await shareOut(res, p);
  });

  app.get(`${BASE}/:id/comments`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const p = await owned(req, res, user);
    if (!p) return;
    res.set("Cache-Control", "no-store").json({ comments: await commentsOut(p, String(user.id), true) });
  });

  // ── Submit ────────────────────────────────────────────────────────────────

  /** The member's season words, saved as the next version of their plan for that season. */
  async function saveSeasonWords(pool: Pool, userId: string, target: Target, body: ProposalBody): Promise<void> {
    const versions = await planVersions(pool, userId, target.id);
    const newest = versions.length ? versions[versions.length - 1] : null;
    const s = body.season;
    const plan = planToStore(
      {
        aim: s.aim,
        servesGoal: s.servesGoals[0]?.goal ?? null,
        servesGoals: s.servesGoals.length ? s.servesGoals : null,
        seasonalGoals: s.seasonalGoals.length ? s.seasonalGoals : null,
        commitments: newest?.commitments ?? {},
        handingBack: newest?.handingBack ?? [],
      },
      newest,
      newest ? null : await latestCardWords(pool, userId),
    );
    await insertPlanVersion(pool, userId, target.id, plan);
  }

  app.post(`${BASE}/:id/submit`, async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const userId = String(user.id);
    if (await limited(res, `role-proposal-submit:${userId}`, ACTS_PER_WINDOW)) return;
    const p = await owned(req, res, user, true);
    if (!p) return;
    const pool = getPool();
    const target = await targetFor(p);
    if (ended(target)) return res.status(409).json({ error: "not_ready", message: PROPOSAL_WORDS.targetEnded });
    const refusal = submitRefusal(p.body, !!target);
    if (refusal || !target) return res.status(409).json({ error: "not_ready", message: refusal ?? PROPOSAL_WORDS.noTargetSubmit });
    const applyDoor = roleApplicationDoor();
    if (!applyDoor) return res.status(503).json({ error: "door_closed", message: "Applications are not open on this server yet. Try again in a moment." });

    const words = applicationWordsOf(p.body.season);
    const at = now();
    // The circle: every live holder of a role in the proposed roles' circles, the member excluded (PR B).
    const k = await known(pool);
    const asked = await circleAsksFor(pool, p.body, userId, (id) => k.posted.get(id)?.circleId ?? null);
    const closesAt = consentClosesAt(at, tz());
    const out = await applyDoor(
      user,
      {
        seatIds: [...p.body.roles.map((r) => r.roleId), ...p.body.newRoles.map((r) => r.id)],
        note: words.note,
        deliverables: words.deliverables,
        seatSettings: p.body.settings,
        startsNoEarlierThan: target.startsOn,
        seasonId: target.id,
        ...(req.body && typeof req.body === "object" && req.body.alignedWords !== undefined ? { alignedWords: req.body.alignedWords } : {}),
      },
      {
        pendingRoles: p.body.newRoles.map((r) => ({ id: r.id, name: typeof r.words.name === "string" ? r.words.name : r.id })),
        // A proposal is decided by its circle or by the power (Rye, 2026-10-22), so it always waits on a holder.
        holderOnly: true,
        alsoWrite: async (conn, applicationId) => {
          if (!(await store.markSubmitted(conn, p.id, applicationId, at))) {
            throw Object.assign(new Error("the draft moved"), { code: "DOOR_REFUSED", status: 409, body: { error: "submitted", message: PROPOSAL_WORDS.notDraft } });
          }
          // Asked in the same transaction, so a proposal is never submitted half asked.
          await store.insertAsks(conn, asked.map((a) => ({ proposalId: p.id, userId: a.userId, circleId: a.circleId, askedAt: at, closesAt })));
        },
      },
    );
    if (out.status !== 201) return res.status(out.status).json(out.body);
    // Each asked holder hears once, by the roles' names, in the bell and under Tasks.
    const names = namesOf(p.body, k);
    const closesOn = civilDateKey(new Date(closesAt.getTime() - 1), tz());
    for (const a of asked) {
      await notify({
        userId: a.userId,
        type: "role_proposal_consent_ask",
        title: CONSENT_WORDS.askTitle(names),
        body: CONSENT_WORDS.askBody(closesOn),
        link: applicationHref(String(out.body.id)),
        actorUserId: null,
        dedupeKey: `rp:${p.id}:ask:${a.userId}`,
      });
    }
    let seasonPlanSaved = true;
    try {
      await saveSeasonWords(pool, userId, target, p.body);
    } catch (e) {
      // The application is written and the draft stamped; the plan can be saved again from Your season.
      seasonPlanSaved = false;
      console.error("[role-proposals] the season words could not be saved as a plan", e);
    }
    const fresh = await store.readProposal(pool, p.id);
    const freshAsks = fresh ? ((await store.asksFor(pool, [p.id])).get(p.id) ?? []) : [];
    res.status(201).json({
      ...out.body,
      proposal: fresh ? proposalOut(fresh, target, k, "owner", freshAsks, userId, await askRolesFor(pool, freshAsks)) : null,
      seasonPlanSaved,
    });
  });

  // ── The circle consents or objects (PR B) ─────────────────────────────────
  /*
   * Keyed by the APPLICATION, which is what the asked holder reads and what
   * their bell notice links. Only a holder the circle asked may answer, once,
   * inside the 2 business days; anybody else is told the proposal did not ask
   * them. An objection needs a reason and goes to the circle's next meeting.
   */
  app.post("/api/governance/role-applications/:id/consent", async (req, res) => {
    const user = await member(req, res);
    if (!user) return;
    const userId = String(user.id);
    if (await limited(res, `role-proposal-consent:${userId}`, ACTS_PER_WINDOW)) return;
    const id = String(req.params.id ?? "");
    const pool = getPool();
    const p = APPLICATION_ID.test(id) ? (await store.proposalsForApplications(pool, [id])).get(id) ?? null : null;
    if (!p) return res.status(404).json({ error: "not_asked", message: CONSENT_WORDS.notAsked });
    const k = await known(pool);
    const out = await answerConsent(
      { pool, notify, timeZone: tz(), sessionsOn: (deps.sessionsOn ?? (() => effectiveLifecycle("sessions") !== "off"))(), now: now() },
      p,
      userId,
      namesOf(p.body, k),
      req.body,
    );
    if (!out.ok) return res.status(out.status).json({ error: out.error, ...(out.field ? { field: out.field } : {}) });
    const asks = (await store.asksFor(pool, [p.id])).get(p.id) ?? [];
    res.json({ answer: out.answer, carried: out.carried, carriedWords: out.carriedWords, consent: consentView(asks, now(), tz(), userId, await askRolesFor(pool, asks)) });
  });

  // ── The nudges (PR B) ─────────────────────────────────────────────────────

  // The sweep: when the window opens, at a review date, and 2 business days before the window closes. Each trigger once.
  registerJob(NUDGE_JOB, NUDGE_EVERY_MS, async () => {
    const r = await runProposalNudges({
      pool: getPool(),
      now: now(),
      timeZone: tz(),
      clock: clock(),
      seasons: seasons(),
      lapse: deps.lapse(),
      members: await deps.members.all(),
      isPresent: deps.isPresent,
      notify,
    });
    if (r.sent) return `${r.sent} nudge(s) to propose roles`;
  });
}
