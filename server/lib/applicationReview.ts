/**
 * REVIEW, INTERVIEWS AND SELECTION (role journey L5): the work, with no request
 * in it. The rules are shared/applicationReview.ts, the SQL is
 * server/repos/applicationReview.ts and the doors are
 * server/routes/applicationReview.ts.
 *
 *   beginReview        at confirm: the "received" step, the role's interviewers
 *                      become the application's, the first one is opened
 *                      (or, when our review comes first, none until invited)
 *   inviteToConversations / answerNotInvited
 *                      our review's two answers, one per application
 *   announceReview     the notices that follow, after the transaction commits
 *   submitScore        one interviewer's scorecard; the next one opens
 *   scorecardsFor      who may read what (rule: mayReadScorecards)
 *   recuse             one click, recorded
 *   statusFor...       the applicant's page: step, who acts next, by when
 *   reviewClockTick    reminders only. NOTHING HERE ADOPTS, DECLINES OR SEATS.
 *
 * ── NO AI IN SELECTION ──────────────────────────────────────────────────────
 *
 * Nothing in this file calls a model, and no tool the guide or a companion
 * holds reads these tables (server/lib/applicationReview.refusal.test.ts).
 *
 * ── THE ORDER IS THE DATA ───────────────────────────────────────────────────
 *
 * An interview is `open` only when every earlier one is scored or skipped. A
 * score for a `waiting` interview is refused, and the update that closes an
 * interview is guarded on `open`, so two scorers at once cannot both win.
 */
import { applicantOffer } from "./counterOffer";
import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  currentInterview,
  FALLBACK_CRITERIA,
  firstReplyDueAt,
  firstReplyReminderAt,
  interviewDueAt,
  interviewsDone,
  isStale,
  kindOfRef,
  bookingWords,
  mayReadScorecards,
  minutesWords,
  parseConversationMode,
  nextAfter,
  parseCriteria,
  parseInterviewerRoles,
  parseScoreInput,
  REVIEW_FIRST_VARIABLE,
  REVIEW_WORDS,
  reviewStageOf,
  STALE_DAYS,
  statusFor,
  type ConversationMode,
  type Criterion,
  type InterviewerRole,
  type Status,
} from "../../shared/applicationReview";
import { civilDateKey } from "../../shared/lunar";
import { DECIDE_WORDS, openProposalHref } from "../../shared/openProposalDecide";
import { consentClosesAt } from "../../shared/roleProposalConsent";
import { inTransaction } from "../repos/liveSessions";
import * as repo from "../repos/applicationReview";
import * as proposals from "../repos/openProposals";
import { asksFor, holdersInCircles, insertAsks } from "../repos/roleProposals";
import { listOrgRoles } from "./orgChart";
import { isExampleUser } from "./examples";
import { isTombstone } from "./oauthAccounts";
import type { DecideDeps } from "./openProposalDecide";
import { boolVar, numberVar, stringVar } from "./variables";
import { verifyLink } from "./comms/links";
import { languageOf } from "./applicantLanguage";
import type { ApplicantLanguage } from "../../shared/applicantWords";

type Db = Pool | PoolConnection;

export interface ReviewDeps extends Pick<DecideDeps, "getPool" | "notify" | "notifyAdmins" | "liveHoldersOf" | "calendar" | "now" | "members"> {
  /** The village setting `org.consent_after_interviews`. Absent reads as off. */
  consentAfterInterviews?: () => boolean;
  /** The village setting `org.review_before_conversations`. Absent reads the setting itself (`reviewFirstOn`). */
  reviewFirst?: () => boolean;
  /** The role that sends first replies (`org.onboarding_role`). Absent or empty reads as nobody. */
  onboardingRole?: () => string;
  /** Tells the person who proposed, by email and on their profile (server/lib/applicantUpdates.ts). Absent tells nobody. */
  tellApplicant?: import("./applicantUpdates").TellApplicant;
}

/** Whether our review comes before the conversations for an application confirming now. */
export function reviewFirstOn(deps: Pick<ReviewDeps, "reviewFirst">): boolean {
  return deps.reviewFirst ? deps.reviewFirst() : boolVar(REVIEW_FIRST_VARIABLE);
}

/**
 * THE VILLAGE'S WAY TO STAY CLOSE (`org.stay_close_name`, `org.stay_close_link`),
 * named in the not-invited letter and on the status page. Null when the village
 * names none, or names one with nowhere to go.
 */
export function stayCloseProgram(): { name: string; href: string } | null {
  const name = stringVar("org.stay_close_name").trim().slice(0, 80);
  const href = stringVar("org.stay_close_link").trim().slice(0, 300);
  if (!name || !href) return null;
  if (!href.startsWith("/") && !/^https:\/\/[^\s]+$/i.test(href)) return null;
  if (href.startsWith("//")) return null;
  return { name, href };
}

const ADOPTING_POWER = "org.seat";

/** The address's account here, when it is a real, present person. The same rule as openProposalDecide's, kept here so the two files do not import each other. */
async function accountFor(members: Pick<ReviewDeps["members"], "byEmail">, email: string | null): Promise<string | null> {
  if (!email) return null;
  const m: any = await members.byEmail(email);
  return m && !isExampleUser(m) && !isTombstone({ email: String(m.email ?? "") }) ? String(m.id) : null;
}

/** The page an interviewer opens. */
export const scorecardHref = (ref: string): string => (kindOfRef(ref) === "open" ? `${openProposalHref(ref)}#scorecards` : `/role-applications/${encodeURIComponent(ref)}#scorecards`);

// ── The role's review setup ─────────────────────────────────────────────────

export interface ReviewSetup {
  interviewers: InterviewerRole[];
  criteria: Criterion[];
  /** How the conversations are booked (D30): one block by default, or split over days. */
  mode: ConversationMode;
}

/** The first of the applicant's roles that names interviewers decides the path; the others are read in their own order later. */
export async function setupFor(db: Db, roleIds: readonly string[]): Promise<ReviewSetup> {
  for (const id of roleIds) {
    const s = await repo.roleSetup(db, id);
    const interviewers = parseInterviewerRoles(s.interviewerRoles);
    if (interviewers.length) {
      const criteria = parseCriteria(s.criteria);
      return { interviewers, criteria: criteria.length ? criteria : [...FALLBACK_CRITERIA], mode: parseConversationMode(s.mode) };
    }
  }
  return { interviewers: [], criteria: [], mode: "block" };
}

// ── Beginning ───────────────────────────────────────────────────────────────

export interface ReviewStart {
  ref: string;
  roleIds: string[];
  interviews: InterviewerRole[];
  /** Our review comes first: nothing opens, and nobody is asked to interview, until a decider invites. */
  reviewFirst?: boolean;
  /** Shown once on the confirmation page and sent by email; only its hash is kept. Null when the applicant has an account. */
  statusToken: string | null;
  /** True when the circle's ask waits for the interviews. */
  holdConsent: boolean;
  at: Date;
}

export const hashToken = (t: string): string => crypto.createHash("sha256").update(t).digest("hex");

/**
 * AT CONFIRM, inside the confirm transaction: stamp "received", make the role's
 * interviewers the application's, open the first. A role that names none has
 * its interviews "done" at once, so nothing waits on a list nobody wrote.
 */
export async function beginReview(
  db: Db,
  deps: Pick<ReviewDeps, "consentAfterInterviews">,
  p: { ref: string; roleIds: string[]; applicantUserId: string | null; at: Date; reviewFirst?: boolean },
): Promise<ReviewStart> {
  const setup = await setupFor(db, p.roleIds);
  // Our review is for an open proposal: the doors that answer it are the open proposal's page.
  const reviewFirst = !!p.reviewFirst && kindOfRef(p.ref) === "open";
  // Reviewed first, the decision is the circle's consent after the conversations, so the ask always waits.
  const holdConsent = reviewFirst || (!!deps.consentAfterInterviews?.() && setup.interviewers.length > 0 && kindOfRef(p.ref) === "open");
  const statusToken = p.applicantUserId ? null : crypto.randomBytes(24).toString("base64url");
  await repo.stampStep(db, {
    ref: p.ref,
    kind: "confirmed",
    at: p.at,
    detail: { roleIds: p.roleIds, criteria: setup.criteria, mode: setup.mode, holdConsent, reviewFirst, applicantUserId: p.applicantUserId, statusHash: statusToken ? hashToken(statusToken) : null },
  });
  await repo.insertInterviews(db, p.ref, setup.interviewers, p.at, !reviewFirst);
  if (!setup.interviewers.length) await repo.stampStep(db, { ref: p.ref, kind: "scores_in", at: p.at });
  return { ref: p.ref, roleIds: p.roleIds, interviews: setup.interviewers, reviewFirst, statusToken, holdConsent, at: p.at };
}

/** After commit: the first interviewer's holders hear it waits on them. A retry writes nothing twice (stable keys). Reviewed first, nobody hears until the invitation. */
export async function announceReview(deps: Pick<ReviewDeps, "getPool" | "notify" | "tellApplicant">, start: ReviewStart, applicantFirstName: string | null): Promise<void> {
  const first = start.interviews[0];
  if (!first || start.reviewFirst) return;
  await tellInterviewers(deps, start.ref, 1, first.roleId, first.minutes, applicantFirstName);
}

async function tellInterviewers(deps: Pick<ReviewDeps, "getPool" | "notify" | "tellApplicant">, ref: string, position: number, roleId: string, minutes: number, applicant: string | null): Promise<void> {
  const pool = deps.getPool();
  // The person who proposed hears the next conversation is asked for, once each (stable part). The first opens as they confirm, and their status email covers it.
  if (kindOfRef(ref) === "open" && deps.tellApplicant && position > 1) {
    const withRole = (await repo.roleNamesById(pool, [roleId])).get(roleId) ?? null;
    await deps.tellApplicant(ref, "conversation", { part: String(position), withRole, minutes });
  }
  const recused = new Set(await repo.recusedUsers(pool, ref));
  for (const userId of await repo.liveHoldersOfRole(pool, roleId)) {
    if (recused.has(userId)) continue;
    await deps.notify({
      userId,
      type: "application_interview_turn",
      title: REVIEW_WORDS.turnTitle(applicant, minutes),
      body: REVIEW_WORDS.turnBody,
      link: scorecardHref(ref),
      actorUserId: null,
      dedupeKey: `app:${ref}:iv:${position}:${userId}`,
    });
  }
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export type ScoreOutcome = { ok: true; scoresIn: boolean } | { ok: false; status: number; error: string; field?: string };

async function confirmedDetail(db: Db, ref: string): Promise<{ roleIds: string[]; criteria: Criterion[]; mode: ConversationMode; holdConsent: boolean; reviewFirst: boolean; applicantUserId: string | null; statusHash: string | null; at: Date } | null> {
  const step = (await repo.stepsOf(db, ref)).find((s) => s.kind === "confirmed");
  if (!step) return null;
  const d = step.detail ?? {};
  return {
    roleIds: Array.isArray(d.roleIds) ? d.roleIds.map(String) : [],
    criteria: parseCriteria(d.criteria),
    mode: parseConversationMode(d.mode),
    holdConsent: d.holdConsent === true,
    reviewFirst: d.reviewFirst === true,
    applicantUserId: typeof d.applicantUserId === "string" ? d.applicantUserId : null,
    statusHash: typeof d.statusHash === "string" ? d.statusHash : null,
    at: step.at,
  };
}

/** Whether this account is the applicant. By stored account, or for an open proposal by its address's account. */
export async function isApplicant(deps: ReviewDeps, ref: string, userId: string): Promise<boolean> {
  const pool = deps.getPool();
  const d = await confirmedDetail(pool, ref);
  if (d?.applicantUserId === userId) return true;
  if (kindOfRef(ref) !== "open") return false;
  const p = await proposals.readOpenProposal(pool, ref);
  return !!p && (await accountFor(deps.members, p.email)) === userId;
}

async function decided(db: Db, ref: string): Promise<boolean> {
  return (await repo.stepsOf(db, ref)).some((s) => s.kind === "decided");
}

/**
 * ONE INTERVIEWER'S SCORECARD. Refused unless the interview is the open one
 * (the order), the scorer holds the interviewing role now, did not step out,
 * and is not the applicant. Every criterion needs a level and a line of
 * evidence. When it was the last, "interviews done" is stamped and, where the
 * village asked for it, the circle's consent round opens.
 */
export async function submitScore(deps: ReviewDeps, p: { ref: string; interviewId: number; scorerId: string; body: unknown }): Promise<ScoreOutcome> {
  const pool = deps.getPool();
  const at = deps.now();
  const d = await confirmedDetail(pool, p.ref);
  if (!d) return { ok: false, status: 404, error: REVIEW_WORDS.notFound };
  if (await decided(pool, p.ref)) return { ok: false, status: 409, error: REVIEW_WORDS.gone };
  if (await isApplicant(deps, p.ref, p.scorerId)) return { ok: false, status: 403, error: REVIEW_WORDS.own };
  if ((await repo.recusedUsers(pool, p.ref)).includes(p.scorerId)) return { ok: false, status: 403, error: REVIEW_WORDS.recused };
  const parsed = parseScoreInput(p.body, d.criteria.length ? d.criteria : [...FALLBACK_CRITERIA]);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, ...(parsed.field ? { field: parsed.field } : {}) };

  let opened: { position: number; roleId: string; minutes: number } | null = null;
  let scoresIn = false;
  const out = await inTransaction(pool, async (conn): Promise<ScoreOutcome | null> => {
    const list = await repo.interviewsOf(conn, p.ref, true);
    const iv = list.find((i) => i.id === p.interviewId);
    if (!iv) return { ok: false, status: 404, error: REVIEW_WORDS.notFound };
    if (iv.state === "scored") return { ok: false, status: 409, error: REVIEW_WORDS.alreadyScored };
    if (iv.state === "skipped") return { ok: false, status: 409, error: REVIEW_WORDS.gone };
    const open = currentInterview(list);
    if (iv.state !== "open" || !open || open.id !== iv.id) return { ok: false, status: 409, error: REVIEW_WORDS.notYourTurn };
    if (!(await repo.liveHoldersOfRole(conn, iv.roleId)).includes(p.scorerId)) return { ok: false, status: 403, error: REVIEW_WORDS.notAnInterviewer };
    if (!(await repo.closeInterviewScored(conn, iv.id, p.scorerId, at))) return { ok: false, status: 409, error: REVIEW_WORDS.alreadyScored };
    await repo.insertScores(conn, p.ref, iv.id, p.scorerId, parsed.entries, at);
    await repo.stampStep(conn, { ref: p.ref, kind: "interview", subject: String(iv.position), at, actorUserId: null });
    const after = list.map((i) => (i.id === iv.id ? { ...i, state: "scored" as const } : i));
    const next = nextAfter(after, iv.position);
    if (next && (await repo.openInterview(conn, next.id, at))) opened = { position: next.position, roleId: next.roleId, minutes: next.minutes };
    else if (interviewsDone(after)) {
      scoresIn = await repo.stampStep(conn, { ref: p.ref, kind: "scores_in", at });
    }
    return null;
  });
  if (out) return out;
  await afterMove(deps, p.ref, opened, scoresIn, d.holdConsent);
  return { ok: true, scoresIn };
}

/** The notices and the consent round that follow a score or a skipped interview. Keys are stable, so a retry repeats nothing. */
async function afterMove(deps: ReviewDeps, ref: string, opened: { position: number; roleId: string; minutes: number } | null, scoresIn: boolean, holdConsent: boolean): Promise<void> {
  if (opened) {
    const name = kindOfRef(ref) === "open" ? ((await proposals.readOpenProposal(deps.getPool(), ref))?.name ?? null) : null;
    await tellInterviewers(deps, ref, opened.position, opened.roleId, opened.minutes, firstName(name));
  }
  if (scoresIn) {
    await deps.notifyAdmins("governance", REVIEW_WORDS.interviewsDone(await roleNamesOf(deps, ref)), `app:${ref}:scores-in`, scorecardHref(ref));
    if (holdConsent) await openConsentRound(deps, ref);
  }
}

const firstName = (full: string | null): string | null => (full ? (full.trim().split(/\s+/)[0] ?? null) : null);

async function roleNamesOf(deps: ReviewDeps, ref: string): Promise<string[]> {
  const d = await confirmedDetail(deps.getPool(), ref);
  const names = await repo.roleNamesById(deps.getPool(), d?.roleIds ?? []);
  return (d?.roleIds ?? []).map((id) => names.get(id) ?? id);
}

// ── The circle's consent round, after the interviews ────────────────────────

/**
 * Open the consent round for an open proposal whose ask was held back. The same
 * holders `confirmAndAsk` would have asked, the same 2 business days from now.
 * Does nothing twice: a proposal that already has asks, or is no longer waiting,
 * is left alone.
 */
export async function openConsentRound(deps: ReviewDeps, ref: string): Promise<boolean> {
  if (kindOfRef(ref) !== "open") return false;
  const pool = deps.getPool();
  const p = await proposals.readOpenProposal(pool, ref);
  if (!p || p.status !== "confirmed") return false;
  if ((await asksFor(pool, [ref])).get(ref)?.length) return false;
  const at = deps.now();
  const closesAt = consentClosesAt(at, deps.calendar().timezone || "UTC");
  const circleOf = new Map((await listOrgRoles(pool)).map((r) => [r.id, r.circleId]));
  const own = await accountFor(deps.members, p.email);
  const circles: string[] = [];
  for (const r of p.body.roles) {
    const c = circleOf.get(r.roleId);
    if (c && !circles.includes(c)) circles.push(c);
  }
  const recused = new Set(await repo.recusedUsers(pool, ref));
  const holders = await holdersInCircles(pool, circles);
  const asked: Array<{ userId: string; circleId: string }> = [];
  for (const circleId of circles) {
    for (const h of holders) {
      if (h.circleId !== circleId || h.userId === own || recused.has(h.userId) || asked.some((a) => a.userId === h.userId)) continue;
      asked.push({ userId: h.userId, circleId });
    }
  }
  await insertAsks(pool, asked.map((a) => ({ proposalId: ref, userId: a.userId, circleId: a.circleId, askedAt: at, closesAt })));
  // An AI agent holding a role is never asked (D31); the round says so.
  const agents = await repo.agentRoleNamesInCircles(pool, circles);
  await repo.stampStep(pool, { ref, kind: "consent", at, detail: agents.length ? { skippedAgents: agents } : undefined });
  if (deps.tellApplicant) await deps.tellApplicant(ref, "consent");
  const names = await roleNamesOf(deps, ref);
  const closesOn = civilDateKey(new Date(closesAt.getTime() - 1), deps.calendar().timezone || "UTC");
  for (const a of asked) {
    await deps.notify({
      userId: a.userId,
      type: "open_role_proposal_consent_ask",
      title: `Consent is asked for ${names.join(", ")}`,
      body: `The conversations are written up. Consent or object by ${closesOn}.${agents.length ? ` ${REVIEW_WORDS.agentsSkipped(agents)}` : ""}`,
      link: openProposalHref(ref),
      actorUserId: null,
      dedupeKey: `op:${ref}:ask:${a.userId}`,
    });
  }
  return true;
}

// ── Reading scorecards ──────────────────────────────────────────────────────

export interface ScorecardView {
  criteria: Criterion[];
  /** How the conversations are booked, in words, and which mode (D30). */
  booking: { mode: ConversationMode; words: string };
  interviews: Array<{
    position: number;
    roleName: string;
    minutes: number;
    final: boolean;
    state: string;
    /** Only the viewer's own, or all of them when the rule lets the viewer read. */
    entries: Array<{ criterionId: string; level: string; evidence: string }> | null;
  }>;
  /** The interview this viewer may write now, if any. */
  mayScore: { interviewId: number; position: number; minutes: number } | null;
  mayRead: boolean;
}

/**
 * What a viewer reads of the scorecards. The rule is `mayReadScorecards`; the
 * viewer's own card is always theirs. A card is named by the interviewing
 * ROLE, never the person. The applicant gets `null`: nothing at all.
 */
export async function scorecardsFor(deps: ReviewDeps, ref: string, viewerId: string): Promise<ScorecardView | null> {
  const pool = deps.getPool();
  const d = await confirmedDetail(pool, ref);
  if (!d) return null;
  if (await isApplicant(deps, ref, viewerId)) return null;
  const interviews = await repo.interviewsOf(pool, ref);
  const scores = await repo.scoresOf(pool, ref);
  const heldRoles = new Set(await repo.rolesHeldBy(pool, viewerId));
  const recused = (await repo.recusedUsers(pool, ref)).includes(viewerId);
  const submitted = scores.some((s) => s.scorerUserId === viewerId);
  const seatHolders = await deps.liveHoldersOf(ADOPTING_POWER);
  const mayRead = mayReadScorecards({
    isApplicant: false,
    isInterviewer: interviews.some((i) => heldRoles.has(i.roleId)),
    hasSubmitted: submitted,
    recused,
    holdsSeatPower: seatHolders.includes(viewerId),
  });
  const names = await repo.roleNamesById(pool, interviews.map((i) => i.roleId));
  const cur = currentInterview(interviews);
  const mine = cur && heldRoles.has(cur.roleId) && !recused ? cur : null;
  const total = interviews.reduce((n, i) => n + i.minutes, 0);
  return {
    criteria: d.criteria,
    booking: { mode: d.mode, words: bookingWords(d.mode, names.get(interviews[0]?.roleId ?? "") ?? null, total) },
    mayRead,
    mayScore: mine ? { interviewId: mine.id, position: mine.position, minutes: mine.minutes } : null,
    interviews: interviews.map((i) => {
      const rows = scores.filter((s) => s.interviewId === i.id);
      const own = rows.filter((s) => s.scorerUserId === viewerId);
      const shown = mayRead ? rows : own;
      return {
        position: i.position,
        roleName: names.get(i.roleId) ?? i.roleId,
        minutes: i.minutes,
        final: i.final,
        state: i.state,
        entries: shown.length ? shown.map((s) => ({ criterionId: s.criterionId, level: s.level, evidence: s.evidence })) : null,
      };
    }),
  };
}

// ── Recusal ─────────────────────────────────────────────────────────────────

/**
 * ONE CLICK, RECORDED. The person steps out of this application: they are not
 * asked again, may not score it or adopt it. An interview whose every holder
 * has stepped out is skipped, so the chain is never stuck on it; the admins are
 * told once.
 */
export async function recuse(deps: ReviewDeps, p: { ref: string; userId: string; reason: string | null }): Promise<{ ok: true; recorded: boolean } | { ok: false; status: number; error: string }> {
  const pool = deps.getPool();
  const at = deps.now();
  const d = await confirmedDetail(pool, p.ref);
  if (!d) return { ok: false, status: 404, error: REVIEW_WORDS.notFound };
  if (await decided(pool, p.ref)) return { ok: false, status: 409, error: REVIEW_WORDS.gone };
  const reason = p.reason ? p.reason.trim().slice(0, 300) || null : null;
  const recorded = await repo.insertRecusal(pool, { ref: p.ref, userId: p.userId, interviewId: null, reason, at });
  let opened: { position: number; roleId: string; minutes: number } | null = null;
  let scoresIn = false;
  let skippedRole: string | null = null;
  await inTransaction(pool, async (conn) => {
    let list = await repo.interviewsOf(conn, p.ref, true);
    const recused = new Set(await repo.recusedUsers(conn, p.ref));
    for (const iv of list) {
      if (iv.state === "scored" || iv.state === "skipped") continue;
      const holders = await repo.liveHoldersOfRole(conn, iv.roleId);
      if (holders.length > 0 && holders.every((h) => recused.has(h))) {
        await repo.skipInterview(conn, iv.id);
        skippedRole = iv.roleId;
        await repo.stampStep(conn, { ref: p.ref, kind: "interview", subject: String(iv.position), at, detail: { skipped: true } });
      }
    }
    list = await repo.interviewsOf(conn, p.ref, true);
    if (!list.some((i) => i.state === "open") && !interviewsDone(list)) {
      const next = [...list].sort((a, b) => a.position - b.position).find((i) => i.state === "waiting");
      if (next && (await repo.openInterview(conn, next.id, at))) opened = { position: next.position, roleId: next.roleId, minutes: next.minutes };
    } else if (interviewsDone(list) && list.length) {
      scoresIn = await repo.stampStep(conn, { ref: p.ref, kind: "scores_in", at });
    }
  });
  if (skippedRole) await deps.notifyAdmins("governance", `Nobody is left to interview for ${skippedRole}, so that conversation was skipped`, `app:${p.ref}:skipped:${skippedRole}`, scorecardHref(p.ref));
  await afterMove(deps, p.ref, opened, scoresIn, d.holdConsent);
  return { ok: true, recorded };
}

export async function hasRecused(deps: Pick<ReviewDeps, "getPool">, ref: string, userId: string): Promise<boolean> {
  return (await repo.recusedUsers(deps.getPool(), ref)).includes(userId);
}

// ── Our review: invite, or not (Phase A) ────────────────────────────────────

export type ReviewAnswer =
  | { ok: true; conversations: Array<{ roleId: string; role: string; minutes: number }> }
  | { ok: false; status: number; error: string; code: "none" | "done" | "gone" };

/** The application's conversations in order, by role name and minutes: what the invitation lists. */
export async function conversationsOf(db: Db, ref: string): Promise<Array<{ roleId: string; role: string; minutes: number }>> {
  const list = await repo.interviewsOf(db, ref);
  const names = await repo.roleNamesById(db, list.map((i) => i.roleId));
  return list.map((i) => ({ roleId: i.roleId, role: names.get(i.roleId) ?? i.roleId, minutes: i.minutes }));
}

/** Whether our review still waits on this application: it has a review step and nobody has answered it. */
export async function reviewWaits(deps: Pick<ReviewDeps, "getPool">, ref: string): Promise<boolean> {
  return reviewStageOf(await repo.stepsOf(deps.getPool(), ref)) === "review";
}

/** The answer's own checks, shared by both: a review step, still unanswered, the application still open. */
async function answerable(db: Db, ref: string): Promise<Exclude<ReviewAnswer, { ok: true }> | null> {
  const steps = await repo.stepsOf(db, ref);
  const stage = reviewStageOf(steps);
  if (!stage) return { ok: false, status: 409, error: DECIDE_WORDS.review.none, code: "none" };
  if (steps.some((s) => s.kind === "decided")) return { ok: false, status: 409, error: REVIEW_WORDS.gone, code: "gone" };
  if (stage !== "review") return { ok: false, status: 409, error: DECIDE_WORDS.review.done, code: "done" };
  return null;
}

/**
 * INVITE TO THE CONVERSATIONS. One `review` step answers it (the unique key
 * admits one answer, so a not-invited letter pressed at the same moment loses),
 * the first reply is stamped with it so the reply clock stops, and the first
 * conversation opens. Its holders hear it waits on them. A role that names no
 * conversations goes straight to the circle's consent. The caller has already
 * checked who may answer; the invitation letter is the caller's to send.
 */
export async function inviteToConversations(deps: ReviewDeps, ref: string, actorId: string): Promise<ReviewAnswer> {
  const pool = deps.getPool();
  const at = deps.now();
  const refused = await answerable(pool, ref);
  if (refused) return refused;
  let opened: { position: number; roleId: string; minutes: number } | null = null;
  const won = await inTransaction(pool, async (conn) => {
    if (!(await repo.stampStep(conn, { ref, kind: "review", at, actorUserId: actorId, detail: { answer: "invited" } }))) return false;
    await repo.stampStep(conn, { ref, kind: "first_reply", at, actorUserId: actorId });
    const first = [...(await repo.interviewsOf(conn, ref, true))].sort((a, b) => a.position - b.position).find((i) => i.state === "waiting");
    if (first && (await repo.openInterview(conn, first.id, at))) opened = { position: first.position, roleId: first.roleId, minutes: first.minutes };
    return true;
  });
  if (!won) return { ok: false, status: 409, error: DECIDE_WORDS.review.done, code: "done" };
  const conversations = await conversationsOf(pool, ref);
  const o = opened as { position: number; roleId: string; minutes: number } | null;
  if (o) {
    const name = (await proposals.readOpenProposal(pool, ref))?.name ?? null;
    await tellInterviewers(deps, ref, o.position, o.roleId, o.minutes, firstName(name));
  } else if (interviewsDone(await repo.interviewsOf(pool, ref))) {
    // Nothing to talk through first: the decision is the circle's, now.
    await openConsentRound(deps, ref);
  }
  return { ok: true, conversations };
}

/**
 * NOT INVITED. One `review` step answers it, the same way, so it can never
 * stand beside an invitation. The caller marks the proposal declined and sends
 * the letter; this only records our review's answer.
 */
export async function answerNotInvited(deps: Pick<ReviewDeps, "getPool" | "now">, ref: string, actorId: string): Promise<ReviewAnswer> {
  const pool = deps.getPool();
  const refused = await answerable(pool, ref);
  if (refused) return refused;
  if (!(await repo.stampStep(pool, { ref, kind: "review", at: deps.now(), actorUserId: actorId, detail: { answer: "not_invited" } }))) {
    return { ok: false, status: 409, error: DECIDE_WORDS.review.done, code: "done" };
  }
  return { ok: true, conversations: [] };
}

// ── Steps the doors stamp ───────────────────────────────────────────────────

/** A person sent the first reply. Stamped once. */
export async function stampFirstReply(deps: ReviewDeps, ref: string, actorId: string): Promise<boolean> {
  const pool = deps.getPool();
  if (!(await confirmedDetail(pool, ref))) return false;
  return repo.stampStep(pool, { ref, kind: "first_reply", at: deps.now(), actorUserId: actorId });
}

/** The decision landed (adopted, declined or withdrawn). Stamped once; a ref with no review is left alone. */
export async function stampDecided(deps: Pick<ReviewDeps, "getPool" | "now">, ref: string, how: "adopted" | "declined" | "withdrawn"): Promise<void> {
  try {
    const pool = deps.getPool();
    if (!(await repo.stepsOf(pool, ref)).some((s) => s.kind === "confirmed")) return;
    await repo.stampStep(pool, { ref, kind: "decided", at: deps.now(), detail: { how } });
  } catch (e) {
    // The decision stands; a step that did not stamp is not the decider's problem.
    console.warn(`[application-review] the decided step for ${ref} was not stamped: ${String((e as Error)?.message ?? e)}`);
  }
}

/** Whether the interviews are all in. A ref with no review reads as done, so an old application is never held. */
export async function interviewsAreIn(deps: Pick<ReviewDeps, "getPool">, ref: string): Promise<boolean> {
  const pool = deps.getPool();
  if (!(await repo.stepsOf(pool, ref)).some((s) => s.kind === "confirmed")) return true;
  return interviewsDone(await repo.interviewsOf(pool, ref));
}

// ── Splitting the conversations over days (D30) ─────────────────────────────

/**
 * The applicant or a holder asks for the conversations to be booked over days
 * rather than as one block. Recorded on the "confirmed" step's detail, and only
 * while no conversation has been held, so a block already under way stays as
 * booked. Asking twice changes nothing.
 */
export async function requestSplit(deps: ReviewDeps, ref: string): Promise<{ ok: true; changed: boolean } | { ok: false; status: number; error: string }> {
  const pool = deps.getPool();
  const d = await confirmedDetail(pool, ref);
  if (!d) return { ok: false, status: 404, error: REVIEW_WORDS.notFound };
  if (await decided(pool, ref)) return { ok: false, status: 409, error: REVIEW_WORDS.gone };
  const list = await repo.interviewsOf(pool, ref);
  if (list.some((i) => i.state === "scored")) return { ok: false, status: 409, error: REVIEW_WORDS.splitTooLate };
  return { ok: true, changed: await repo.setMode(pool, ref, "split") };
}

// ── The applicant's status ──────────────────────────────────────────────────

/** The status page's data. Steps, roles and times only: never a score, a note or a person. */
export async function statusOf(deps: ReviewDeps, ref: string): Promise<(Status & { roles: string[]; booking: string | null; mode: ConversationMode; outcome: "adopted" | "declined" | "withdrawn" | null; replyDays: number; referencesGiven: number | null; locale: ApplicantLanguage; note: string | null; offer: Awaited<ReturnType<typeof applicantOffer>>; reviewFirst: boolean; notInvited: boolean; stayClose: { name: string; href: string } | null }) | null> {
  const pool = deps.getPool();
  const steps = await repo.stepsOf(pool, ref);
  const confirmed = steps.find((s) => s.kind === "confirmed");
  if (!confirmed) return null;
  const decidedStep = steps.find((s) => s.kind === "decided");
  const interviews = await repo.interviewsOf(pool, ref);
  const names = await repo.roleNamesById(pool, interviews.map((i) => i.roleId));
  const tz = deps.calendar().timezone || "UTC";
  const asks = kindOfRef(ref) === "open" ? ((await asksFor(pool, [ref])).get(ref) ?? []) : [];
  const how = decidedStep?.detail?.how;
  const stage = reviewStageOf(steps);
  const s = statusFor({
    reviewFirst: stage !== null,
    invitedAt: stage === "invited" ? (steps.find((x) => x.kind === "review")?.at ?? null) : null,
    notInvited: stage === "not_invited",
    decided: how === "adopted" || how === "declined" || how === "withdrawn" ? how : decidedStep ? "declined" : null,
    firstReplyAt: steps.find((x) => x.kind === "first_reply")?.at ?? null,
    confirmedAt: confirmed.at,
    interviews: interviews.map((i) => ({ position: i.position, state: i.state, roleName: names.get(i.roleId) ?? i.roleId, minutes: i.minutes, final: i.final, dueAt: i.openedAt ? interviewDueAt(i.openedAt) : null })),
    consentOpen: asks.length > 0,
    consentClosesAt: asks.length ? asks.reduce((m, a) => (a.closesAt > m ? a.closesAt : m), asks[0].closesAt) : null,
    timeZone: tz,
  });
  const d = await confirmedDetail(pool, ref);
  const roleNames = await repo.roleNamesById(pool, d?.roleIds ?? []);
  const mode = d?.mode ?? "block";
  const booking = interviews.length ? bookingWords(mode, names.get(interviews[0].roleId) ?? null, interviews.reduce((n, i) => n + i.minutes, 0)) : null;
  const outcome = how === "adopted" || how === "declined" || how === "withdrawn" ? how : decidedStep ? "declined" : null;
  // About you (joining lane PR 2): the applicant sees HOW MANY references they gave, never who, and nobody else reads this page.
  // The language and the decider's note belong to the applicant: they ride on the applicant's own page only (token or their account), never on a decider's read.
  const own = kindOfRef(ref) === "open" ? await proposals.readOpenProposal(pool, ref) : null;
  const referencesGiven = own && own.body.backgroundCheck ? (own.body.references ?? []).length : null;
  // Reviewed first, the booking line waits for the invitation: before it, nothing is booked.
  const bookingShown = stage === "review" || stage === "not_invited" ? null : booking;
  return {
    ...s,
    roles: (d?.roleIds ?? []).map((id) => roleNames.get(id) ?? id),
    booking: bookingShown,
    mode,
    outcome,
    replyDays: numberVar("org.applicant_reply_days"),
    referencesGiven,
    locale: own ? languageOf(own) : "en",
    note: own?.body.note ?? null,
    offer: outcome ? null : await applicantOffer(pool, ref),
    reviewFirst: stage !== null,
    notInvited: stage === "not_invited",
    stayClose: stage === "not_invited" ? stayCloseProgram() : null,
  };
}

/**
 * The status page for an emailed link: the ref and the token it was given.
 * Two kinds of token read it. The first email's own token is random and only its
 * hash is kept (constant-time compare). The links the later updates carry
 * (the "conversation asked" and "terms changed" letters) are signed for this one
 * proposal, with an expiry, so the first link is never repeated or rotated;
 * `verifyLink` answers for the purpose `application_status` alone and the
 * payload must name this ref.
 */
export async function statusByToken(deps: ReviewDeps, ref: string, token: string) {
  if (!token) return null;
  const d = await confirmedDetail(deps.getPool(), ref);
  if (!d) return null;
  if (d.statusHash) {
    const a = Buffer.from(hashToken(token));
    const b = Buffer.from(d.statusHash);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return statusOf(deps, ref);
  }
  const link = verifyLink("application_status", token);
  if (link && link.ref === ref) return statusOf(deps, ref);
  return null;
}

// ── Clocks: reminders only ──────────────────────────────────────────────────

export interface TickSummary {
  reminded: number;
  due: number;
  stale: number;
}

/**
 * THE HOURLY CLOCK. It reminds. It never adopts, declines, seats, renews or
 * starts anything, and it writes no step: a person does each of those.
 *  - the first reply is due 3 business days after confirm; a reminder at 2;
 *  - an interview open 14 days nudges its interviewing role;
 *  - an application that has not moved in ten days surfaces to the onboarding role.
 * Every notice has one stable key per event and recipient.
 */
export async function reviewClockTick(deps: ReviewDeps): Promise<TickSummary> {
  const pool = deps.getPool();
  const now = deps.now();
  const tz = deps.calendar().timezone || "UTC";
  const out: TickSummary = { reminded: 0, due: 0, stale: 0 };
  const roleId = (deps.onboardingRole?.() ?? "").trim();
  const onboarding = roleId ? await repo.liveHoldersOfRole(pool, roleId) : [];
  const tell = async (kind: "application_first_reply_due" | "application_stale", title: string, key: string, ref: string) => {
    if (onboarding.length) {
      // The type is spelled out in the call, so the notification catalogue's producer scan sees both kinds.
      for (const userId of onboarding) await deps.notify({ userId, type: kind === "application_stale" ? "application_stale" : "application_first_reply_due", title, link: scorecardHref(ref), actorUserId: null, dedupeKey: `${key}:${userId}` });
    } else {
      await deps.notifyAdmins("governance", title, key, scorecardHref(ref));
    }
  };
  for (const r of await repo.openReviews(pool)) {
    const names = await roleNamesOf(deps, r.ref);
    if (!r.firstReplyAt) {
      // Reviewed first, the first reply IS our review's answer, and the reminder says what to do.
      const reviewed = (await confirmedDetail(pool, r.ref))?.reviewFirst === true;
      if (now >= firstReplyDueAt(r.confirmedAt, tz)) {
        await tell("application_first_reply_due", reviewed ? REVIEW_WORDS.reviewDue(names) : REVIEW_WORDS.firstReplyDue(names), `app:${r.ref}:reply-due`, r.ref);
        out.due++;
      } else if (now >= firstReplyReminderAt(r.confirmedAt, tz)) {
        await tell("application_first_reply_due", reviewed ? REVIEW_WORDS.reviewReminder(names) : REVIEW_WORDS.firstReplyReminder(names), `app:${r.ref}:reply-reminder`, r.ref);
        out.reminded++;
      }
    }
    if (isStale(r.lastAt, now)) {
      const bucket = Math.floor((now.getTime() - r.lastAt.getTime()) / (STALE_DAYS * 24 * 60 * 60 * 1000));
      await tell("application_stale", REVIEW_WORDS.stale(names), `app:${r.ref}:stale:${r.lastAt.getTime()}:${bucket}`, r.ref);
      out.stale++;
    }
  }
  return out;
}
