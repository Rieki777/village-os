/**
 * REVIEW, INTERVIEWS AND SELECTION (role journey L5): the doors.
 * Registered by part A's module (server/routes/openProposals.ts) beside part
 * B's, so server/index.ts keeps one line for the whole feature. The rules are
 * shared/applicationReview.ts and the work is server/lib/applicationReview.ts.
 *
 *   GET  /api/application-status/:ref?token=                   the applicant's page, by the emailed link
 *   GET  /api/governance/applications/:ref/status              the applicant's page, signed in
 *   POST /api/application-status/:ref/split?token=             the applicant asks for the conversations over days (D30)
 *   POST /api/governance/applications/:ref/split               the same, signed in as the applicant or a holder
 *   GET  /api/governance/applications/:ref/scorecards          what this reader may read, and what they may write
 *   POST /api/governance/applications/:ref/interviews/:id/score  one interviewer's scorecard
 *   POST /api/governance/applications/:ref/recuse              one click, recorded
 *   POST /api/governance/applications/:ref/first-reply         a person sent the first reply
 *   POST /api/governance/open-proposals/:id/to-the-village     the ballot fallback (G12)
 *
 * ── NOBODY BUT PEOPLE ───────────────────────────────────────────────────────
 *
 * No door here adopts, declines or seats. The hourly job reminds and nothing
 * more. No AI reads a score: this file imports no model client, and no tool a
 * companion holds reaches these doors (server/lib/applicationReview.refusal.test.ts).
 *
 * ── THE APPLICANT READS STEPS, NEVER SCORES ─────────────────────────────────
 *
 * The status doors answer the step, who acts next and by when, by role. The
 * scorecard door answers 404 to the applicant, as to anyone who is not on it.
 */
import type { Express } from "express";
import { kindOfRef, REVIEW_WORDS } from "../../shared/applicationReview";
import { DECIDE_WORDS, OPEN_PROPOSAL_ID, openProposalHref } from "../../shared/openProposalDecide";
import { applicationHref } from "../../shared/seatApplications";
import {
  hasRecused,
  isApplicant,
  recuse,
  requestSplit,
  reviewClockTick,
  scorecardsFor,
  stampFirstReply,
  statusByToken,
  statusOf,
  submitScore,
  type ReviewDeps,
} from "../lib/applicationReview";
import { accountFor, decideRule, placeOnRoles } from "../lib/openProposalDecide";
import { registerJob } from "../lib/scheduler";
import { boolVar, stringVar } from "../lib/variables";
import * as repo from "../repos/applicationReview";
import * as store from "../repos/openProposals";
import type { DecideRouteDeps } from "./openProposalDecide";

const MINUTE = 60_000;
const CLOCK_EVERY_MS = 60 * MINUTE;
export const REVIEW_CLOCK_JOB = "application-review-clock";

const NOT_HERE = { error: "not_found", message: REVIEW_WORDS.notFound };

export function registerApplicationReview(app: Express, deps: DecideRouteDeps & { overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>; clientIp?(req: any): string }): void {
  const { authedUser, guardCapability, getPool, overLimit } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const work: ReviewDeps = {
    getPool,
    notify: deps.notify,
    notifyAdmins: deps.notifyAdmins,
    liveHoldersOf: deps.liveHoldersOf,
    calendar: deps.seatCalendar,
    now,
    members: deps.members,
    consentAfterInterviews: () => boolVar("org.consent_after_interviews"),
    onboardingRole: () => stringVar("org.onboarding_role"),
  };

  /** The signed-in member holding `terms.read`, or null after answering 401. */
  async function reader(req: any, res: any): Promise<any | null> {
    if (!(await guardCapability(req, res, "terms.read", { status: 401, body: { error: "auth_required", message: DECIDE_WORDS.membersOnly } }))) return null;
    const viewer = await authedUser(req);
    if (!viewer) {
      res.status(401).json({ error: "auth_required", message: DECIDE_WORDS.membersOnly });
      return null;
    }
    return viewer;
  }

  const refOf = (req: any): string | null => {
    const ref = String(req.params.ref ?? "");
    return kindOfRef(ref) ? ref : null;
  };

  // ── The applicant's page ──────────────────────────────────────────────────

  app.get("/api/application-status/:ref", async (req, res) => {
    const ref = refOf(req);
    const token = typeof req.query.token === "string" ? req.query.token.slice(0, 100) : "";
    if (await overLimit(`application-status:${deps.clientIp ? deps.clientIp(req) : "x"}`, 60, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const s = ref && token ? await statusByToken(work, ref, token) : null;
    // One answer for an unknown ref and a wrong token, so a ref cannot be probed.
    if (!s) return res.status(404).json(NOT_HERE);
    res.set("Cache-Control", "no-store").json({ status: s });
  });

  app.get("/api/governance/applications/:ref/status", async (req, res) => {
    const viewer = await authedUser(req);
    if (!viewer) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`application-status:${String(viewer.id)}`, 60, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const ref = refOf(req);
    if (!ref || !(await isApplicant(work, ref, String(viewer.id)))) return res.status(404).json(NOT_HERE);
    const s = await statusOf(work, ref);
    if (!s) return res.status(404).json(NOT_HERE);
    res.set("Cache-Control", "no-store").json({ status: s });
  });

  // ── Splitting the conversations over days (D30) ───────────────────────────

  app.post("/api/application-status/:ref/split", async (req, res) => {
    const ref = refOf(req);
    const token = typeof req.query.token === "string" ? req.query.token.slice(0, 100) : "";
    if (await overLimit(`application-split:${deps.clientIp ? deps.clientIp(req) : "x"}`, 10, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    // The link proves who asks, the way it does for the status page.
    if (!ref || !token || !(await statusByToken(work, ref, token))) return res.status(404).json(NOT_HERE);
    const out = await requestSplit(work, ref);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, message: REVIEW_WORDS.splitAsked });
  });

  app.post("/api/governance/applications/:ref/split", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const userId = String(viewer.id);
    if (await overLimit(`application-split:${userId}`, 10, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const ref = refOf(req);
    if (!ref) return res.status(404).json(NOT_HERE);
    // The applicant, or somebody who holds one of the conversation roles, may ask.
    const mine = new Set(await repo.rolesHeldBy(getPool(), userId));
    const holds = (await repo.interviewsOf(getPool(), ref)).some((i) => mine.has(i.roleId));
    if (!holds && !(await isApplicant(work, ref, userId))) return res.status(404).json(NOT_HERE);
    const out = await requestSplit(work, ref);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, message: REVIEW_WORDS.splitAsked });
  });

  // ── Scorecards ────────────────────────────────────────────────────────────

  app.get("/api/governance/applications/:ref/scorecards", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    if (await overLimit(`application-scorecards:${String(viewer.id)}`, 120, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const ref = refOf(req);
    const view = ref ? await scorecardsFor(work, ref, String(viewer.id)) : null;
    // The applicant and a stranger get the same answer: nothing is here.
    if (!view) return res.status(404).json(NOT_HERE);
    res.set("Cache-Control", "no-store").json({ scorecards: view, words: view.mayRead ? null : REVIEW_WORDS.mayNotRead });
  });

  app.post("/api/governance/applications/:ref/interviews/:id/score", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    if (await overLimit(`application-score:${String(viewer.id)}`, 20, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const ref = refOf(req);
    const interviewId = Number(req.params.id);
    if (!ref || !Number.isInteger(interviewId) || interviewId < 1) return res.status(404).json(NOT_HERE);
    const out = await submitScore(work, { ref, interviewId, scorerId: String(viewer.id), body: req.body });
    if (!out.ok) return res.status(out.status).json({ error: out.error, ...(out.field ? { field: out.field } : {}) });
    res.json({ success: true, scoresIn: out.scoresIn });
  });

  // ── Recusal ───────────────────────────────────────────────────────────────

  app.post("/api/governance/applications/:ref/recuse", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    if (await overLimit(`application-recuse:${String(viewer.id)}`, 20, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const ref = refOf(req);
    if (!ref) return res.status(404).json(NOT_HERE);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    const out = await recuse(work, { ref, userId: String(viewer.id), reason });
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json({ success: true, message: REVIEW_WORDS.recusalRecorded });
  });

  // ── The first reply ───────────────────────────────────────────────────────

  app.post("/api/governance/applications/:ref/first-reply", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const userId = String(viewer.id);
    if (await overLimit(`application-first-reply:${userId}`, 30, 10 * MINUTE)) return res.status(429).json({ error: "too_many" });
    const ref = refOf(req);
    if (!ref) return res.status(404).json(NOT_HERE);
    // The role named in the village's settings, or the power to fill roles when none is named.
    const roleId = stringVar("org.onboarding_role").trim();
    const mayReply = (roleId && (await repo.liveHoldersOfRole(getPool(), roleId)).includes(userId)) || (await deps.liveHoldersOf("org.seat")).includes(userId);
    if (!mayReply) return res.status(403).json({ error: "not_a_holder", message: "The first reply is for the role that welcomes people." });
    if (await isApplicant(work, ref, userId)) return res.status(403).json({ error: "own", message: REVIEW_WORDS.own });
    res.json({ success: true, stamped: await stampFirstReply(work, ref, userId) });
  });

  // ── The ballot fallback (G12) ─────────────────────────────────────────────
  /*
   * Nobody can adopt at the door: the village holds the power that seats people,
   * nobody holds it live, or its only holder is the applicant. The proposal
   * becomes an ordinary role application for the applicant's account, waiting on
   * the village, and the member door's own "send to the village" opens the
   * `role_application` ballot. It needs an account: a ballot is cast on a member,
   * and a stranger has none until an invitation is used, so the answer says so.
   */
  app.post("/api/governance/open-proposals/:id/to-the-village", async (req, res) => {
    const viewer = await reader(req, res);
    if (!viewer) return;
    const actorId = String(viewer.id);
    if (await overLimit(`open-proposal-decide:${actorId}`, 10, 10 * MINUTE)) return res.status(429).json({ error: DECIDE_WORDS.tooMany });
    const id = String(req.params.id ?? "");
    const pool = getPool();
    const p = OPEN_PROPOSAL_ID.test(id) ? await store.readOpenProposal(pool, id) : null;
    if (!p || p.status !== "confirmed") return res.status(404).json({ error: "not_found", message: DECIDE_WORDS.missing });
    if (await hasRecused(work, p.id, actorId)) return res.status(403).json({ error: "recused", message: REVIEW_WORDS.recused });
    const decide = { ...work, stageOf: deps.stageOf, recordStageEvent: deps.recordStageEvent, lapse: deps.lapse };
    const rule = await decideRule(decide);
    const deciders = rule.who === "live-holders" ? rule.holders : [];
    const own = await accountFor(deps.members, p.email);
    if (deciders.some((h) => h !== own)) return res.status(409).json({ error: "someone_can_adopt", message: "A holder of the power to fill roles can adopt this at its page, so it does not go to a vote." });
    if (!own) return res.status(409).json({ error: "needs_an_account", message: "A vote is cast on a member, and this person has no account yet. It can go to the village once they have one." });
    const placed = await placeOnRoles(decide, { account: own, proposal: p, adopterId: actorId, authority: "village-vote", adopt: false });
    if (!placed.ok) return res.status(409).json({ error: placed.code === "pending" ? DECIDE_WORDS.pending : placed.error, ...(placed.code === "pending" ? { applicationId: placed.applicationId } : {}) });
    res.json({ success: true, application: { id: placed.applicationId, href: applicationHref(placed.applicationId) }, next: "Send it to the village from its application page.", back: openProposalHref(p.id) });
  });

  // ── The clock: reminders only ─────────────────────────────────────────────
  registerJob(REVIEW_CLOCK_JOB, CLOCK_EVERY_MS, async () => {
    const t = await reviewClockTick(work);
    return `${t.due} first replies due, ${t.reminded} reminded, ${t.stale} stale`;
  });
}
