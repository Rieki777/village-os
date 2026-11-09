/**
 * SUGGEST-TO-EDIT, THE DOORS (ROLE_POWERS_DESIGN.md §4.5; Rye made it GO on
 * 2026-11-06). The server half of the first slice; the admin panel's
 * "Suggest this change" button and the review queue's screen are the next.
 *
 *   POST /api/admin/suggestions                    a member suggests an edit to one admin control
 *   GET  /api/admin/suggestions/queue              a holder's review queue
 *   GET  /api/admin/suggestions/mine               the suggester's own, with any decline reason
 *   POST /api/admin/suggestions/:id/accept         a holder applies it, as themselves
 *   POST /api/admin/suggestions/:id/decline        a holder declines it, with a one-line reason
 *   POST /api/admin/suggestions/:id/send-to-vote   a holder turns it into a village ballot
 *   POST /api/admin/suggestions/:id/raise          the suggester raises it to a ballot after 14 days
 *
 * ── WHO MAY KNOCK ON WHICH DOOR ────────────────────────────────────────────
 *
 * Suggesting: a signed-in member at the `member` rung or up who has not left
 * the village. A guest, a former member, and somebody signed out are refused.
 * The rung is read off the stage (the gate's own `stageIndex`), with no admin
 * short-circuit: suggesting is a member's act.
 *
 * Reviewing (accept, decline, send to a vote): a LIVE HOLDER of the control's
 * power, counted the bridged way (`liveHoldersOf`), so an admin who was never
 * given the power is not a reviewer. Never the suggester: "a holder never
 * reviews a suggestion they made. They would have edited directly." Accept
 * then asks the gate exactly as the direct route does (`guardCapability`) and
 * applies through the control's own write (server/lib/adminSuggestions.ts),
 * so every guard the direct edit meets, the Accept meets too.
 *
 * Where a suggestion goes is `routeSuggestion` (shared/suggestions.ts), asked
 * at creation and again at every review, so a power the village took since a
 * suggestion was made sends it to a vote, never to a holder.
 *
 * ── THE CLOSER ─────────────────────────────────────────────────────────────
 *
 * `register` writes `admin_edit` into the closer table it is handed
 * (`SUBJECT_CLOSERS` in server/index.ts), which is what lets `openBallot`
 * open a vote on a suggestion at all.
 *
 * Every POST is bounded: ten in ten minutes per member, because a vote rings
 * the whole roll and a suggestion rings every holder.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { SubjectCloser } from "../lib/applyDue";
import type { RollNotice } from "../lib/ballotNotices";
import type { BallotSetup } from "../lib/ballotSetup";
import { markAdminGate } from "../lib/adminGate";
import { recordEvent } from "../lib/events";
import { leftTheVillage } from "../lib/formerMember";
import { deadlineInVillage } from "../lib/villageReaders";
import {
  ADMIN_EDIT,
  acceptSuggestion,
  adminEditCloser,
  adminEditControl,
  putSuggestionToVillage,
  staleDifference,
  type SuggestionBallotDeps,
} from "../lib/adminSuggestions";
import { suggestionStore, type SuggestionRow, type SuggestionStore } from "../repos/adminSuggestions";
import { villageSuggestionRoutes } from "../lib/suggestionRoutes";
import { isVillageHeld, type Capability, type CapabilityCtx } from "../../shared/capabilities";
import { SUGGESTION_KIND_CONSEQUENCE, validateDraftPayload, type AdminEditPayload } from "../../shared/draftKinds";
import {
  ADMIN_EDIT_CONTROLS,
  SUGGESTION_RAISE_AFTER_DAYS,
  declineReasonProblem,
  isAdminEditControl,
  mayRaiseToBallot,
  routeSuggestion,
  type SuggestionRoute,
} from "../../shared/suggestions";

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "guardCapability" | "getPool" | "overLimit" | "notify" | "members" | "firstName"> & {
  /** Who holds a power live, the admin short-circuit excluded. `liveHoldersOf` in server/index.ts. */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The roll, the dials, the weights and the window: `roleBallotSetup` in server/index.ts. */
  ballotSetup(): Promise<BallotSetup>;
  /** Tell the whole roll that a vote opened. */
  notifyRoll(b: { id: string }, input: RollNotice): Promise<number>;
  /** Is the governance module on. Off means nobody could vote on what this opens. */
  governanceOn(): boolean;
  /** The closer table. `admin_edit` is written into it here. */
  closers: Record<string, SubjectCloser>;
  /** Tests hand in a memory store; the server uses `assistant_drafts`. */
  store?: SuggestionStore;
  /** Has this account left the village. Defaults to `leftTheVillage`. */
  isFormerMember?(user: any): Promise<boolean>;
  /** The clock, for the 14-day wait. */
  now?(): Date;
  /** The village's own SUGGESTION_ROUTE, the dial's table. Defaults to `villageSuggestionRoutes`. */
  routes?(): Readonly<Record<Capability, SuggestionRoute>>;
};

const ASKS_PER_WINDOW = 10;
const ASK_WINDOW_MS = 10 * 60 * 1000;
/** The member rung: "All members" means `member` and up (§4.5). */
const MEMBER_RUNG = "member";

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, guardCapability, getPool, overLimit, notify, members, firstName } = deps;
  const { liveHoldersOf, ballotSetup, notifyRoll, governanceOn, closers } = deps;
  const store = deps.store ?? suggestionStore(() => getPool());
  const isFormer = deps.isFormerMember ?? ((user: any) => leftTheVillage(getPool(), user));
  const now = () => (deps.now ? deps.now() : new Date());
  const routes = () => (deps.routes ? deps.routes() : villageSuggestionRoutes());

  const nameOf = async (userId: string): Promise<string> => {
    const m = await members.byId(userId);
    return m?.name ? firstName(String(m.name)) : "a member";
  };
  const ballotDeps: SuggestionBallotDeps = {
    get pool() {
      return getPool();
    },
    store,
    nameOf,
    notify: (input) => notify(input as any),
  };
  closers[ADMIN_EDIT] = adminEditCloser(ballotDeps);

  // ── Who is asking ─────────────────────────────────────────────────────────

  const limited = async (res: any, bucket: string): Promise<boolean> => {
    if (!(await overLimit(bucket, ASKS_PER_WINDOW, ASK_WINDOW_MS))) return false;
    res.status(429).json({ error: "too_many_asks", message: "That is a lot in a few minutes. Wait a little and try again." });
    return true;
  };

  /** Signed in and still in the village, or null after answering. */
  async function present(req: any, res: any): Promise<{ user: any; ctx: CapabilityCtx } | null> {
    markAdminGate(req); // a gate is consulted here: the default-deny under /api/admin needs to hear it
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in to suggest a change." });
      return null;
    }
    if (await isFormer(user)) {
      res.status(403).json({ error: "former_member", message: "Suggesting changes is for members of the village." });
      return null;
    }
    return { user, ctx: await capabilityCtx(user) };
  }

  /** A member at the member rung or up, or null after answering. */
  async function member(req: any, res: any): Promise<{ user: any; ctx: CapabilityCtx } | null> {
    const who = await present(req, res);
    if (!who) return null;
    const needed = who.ctx.stageIndexOf(MEMBER_RUNG);
    if (needed < 0 || who.ctx.stageIndex < needed) {
      res.status(403).json({ error: "members_only", message: "Suggesting a change opens at the member rung." });
      return null;
    }
    return who;
  }

  const routeNow = async (s: SuggestionRow, ctx: CapabilityCtx): Promise<{ route: SuggestionRoute; holders: string[] }> => {
    const holders = await liveHoldersOf(s.edit.capability);
    const route = routeSuggestion({
      capability: s.edit.capability,
      villageHolds: isVillageHeld(s.edit.capability, ctx.villageHeld),
      liveHolders: holders,
      passesPowers: ADMIN_EDIT_CONTROLS[s.edit.control]?.passesPowers ?? false,
    }, routes());
    return { route, holders };
  };

  /** The suggestion by id, or null after a 404. */
  async function found(req: any, res: any): Promise<SuggestionRow | null> {
    const s = await store.byId(String(req.params.id ?? ""));
    if (!s || !isAdminEditControl(s.edit.control)) {
      res.status(404).json({ error: "not_found", message: "There is no suggestion by that id." });
      return null;
    }
    return s;
  }

  /**
   * A live holder reviewing somebody else's waiting suggestion, or null after
   * answering. The order is the refusal a person most needs to hear first.
   */
  async function reviewer(req: any, res: any): Promise<{ user: any; ctx: CapabilityCtx; s: SuggestionRow; holders: string[] } | null> {
    const who = await present(req, res);
    if (!who) return null;
    const s = await found(req, res);
    if (!s) return null;
    const userId = String(who.user.id);
    if (s.suggestedBy === userId) {
      res.status(403).json({ error: "own_suggestion", message: "You made this suggestion, so the other holders review it. You could edit it directly instead." });
      return null;
    }
    if (s.status !== "proposed") {
      res.status(409).json({ error: "not_waiting", message: `This suggestion is already ${s.status}.`, status: s.status });
      return null;
    }
    const { route, holders } = await routeNow(s, who.ctx);
    if (!holders.includes(userId)) {
      res.status(403).json({
        error: "holders_only",
        message: "Only the people who hold this power review suggestions on it, and an admin who does not hold it is no exception.",
        capability: s.edit.capability,
      });
      return null;
    }
    if (route !== "holders") {
      res.status(409).json({ error: "goes_to_a_vote", message: "This suggestion now goes to a village vote, so no one person decides it." });
      return null;
    }
    return { ...who, s, holders };
  }

  const view = (s: SuggestionRow, extra: Record<string, unknown> = {}) => ({
    id: s.id,
    control: s.edit.control,
    controlLabel: ADMIN_EDIT_CONTROLS[s.edit.control]?.label ?? s.edit.control,
    capability: s.edit.capability,
    version: s.edit.version,
    payload: s.edit.payload,
    why: s.why,
    suggestedBy: s.suggestedBy,
    suggestedAt: s.suggestedAt.toISOString(),
    status: s.status,
    decidedBy: s.decidedBy,
    decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
    note: s.note,
    ballotId: s.ballotId,
    ...extra,
  });

  /** Open the vote and ring the roll. Answers the response either way. */
  async function toVillage(res: any, s: SuggestionRow, openedBy: string, extra: Record<string, unknown> = {}): Promise<void> {
    if (!governanceOn()) {
      res.status(409).json({ error: "governance_off", message: "This village has not turned voting on, so there is nobody to put the suggestion to yet." });
      return;
    }
    const opened = await putSuggestionToVillage(ballotDeps, { suggestion: s, openedBy, setup: await ballotSetup(), at: now() });
    if (!opened.ok) {
      res.status(opened.status).json(opened.body);
      return;
    }
    void notifyRoll(opened.ballot, {
      type: "ballot_opened",
      title: "The village is asked to decide a suggested change",
      body: `Voting is open until ${deadlineInVillage(opened.ballot.closesAt)}.`,
      keySuffix: "open",
      except: [openedBy],
      roll: opened.electorate,
    });
    res.json({ success: true, ...extra, ballot: { id: opened.ballot.id, closesAt: opened.ballot.closesAt } });
  }

  // ── Suggest ───────────────────────────────────────────────────────────────

  app.post("/api/admin/suggestions", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const userId = String(who.user.id);
    if (await limited(res, `suggest:${userId}`)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isAdminEditControl(body.control)) {
      return res.status(400).json({ error: "unknown_control", message: `Suggestions can be made on: ${Object.keys(ADMIN_EDIT_CONTROLS).join(", ")}.` });
    }
    const control = adminEditControl(body.control);
    if (!control) return res.status(409).json({ error: "control_not_wired", message: "This control cannot take suggestions yet." });
    const why = typeof body.why === "string" ? body.why.trim().slice(0, 2000) : "";
    const current = control.read();
    const edit: AdminEditPayload = {
      control: body.control,
      capability: ADMIN_EDIT_CONTROLS[body.control].capability,
      version: current.version,
      base: current.value,
      payload: body.payload,
    };
    // The form names the version it was opened on, the way a direct save does.
    if (typeof body.was === "string" && body.was && body.was !== current.version) {
      return res.status(409).json({ error: "stale", message: "These words changed since this page was opened. Reload it to see them, then suggest your change again." });
    }
    const shape = validateDraftPayload("admin_edit", edit) ?? control.problem(edit.payload);
    if (shape) return res.status(400).json({ error: "refused", message: shape });

    const made = await store.create({ edit, why, suggestedBy: userId });
    const { route, holders } = await routeNow(made, who.ctx);
    void recordEvent(getPool(), {
      kind: "audit",
      text: `admin_edit:suggested:${made.edit.control}:${made.id}:${route}`,
      actorUserId: userId,
      entityType: "suggestion",
      entityRef: made.id,
      audience: "admin",
    });
    if (route === "ballot") {
      // With voting off it waits, and the suggester raises it once voting is on.
      if (!governanceOn()) return res.status(201).json({ success: true, route, suggestion: view(made), ballot: null, consequence: SUGGESTION_KIND_CONSEQUENCE.admin_edit });
      res.status(201);
      return toVillage(res, made, userId, { route, suggestion: view(made), consequence: SUGGESTION_KIND_CONSEQUENCE.admin_edit });
    }
    const suggester = await nameOf(userId);
    for (const holder of holders.filter((h) => h !== userId)) {
      void notify({
        userId: holder,
        type: "governance",
        title: `${suggester} suggested a change to ${ADMIN_EDIT_CONTROLS[made.edit.control].label}`,
        body: "It changes nothing until a holder accepts it. Accept, decline with a reason, or send it to a vote.",
        link: "/admin",
        actorUserId: userId,
        dedupeKey: `sugg:${made.id}:${holder}`,
      } as any).catch(() => undefined);
    }
    res.status(201).json({ success: true, route, suggestion: view(made), ballot: null, consequence: SUGGESTION_KIND_CONSEQUENCE.admin_edit });
  });

  // ── Read ──────────────────────────────────────────────────────────────────

  app.get("/api/admin/suggestions/queue", async (req, res) => {
    const who = await present(req, res);
    if (!who) return;
    const userId = String(who.user.id);
    const holdersByCap = new Map<string, string[]>();
    const queue: ReturnType<typeof view>[] = [];
    for (const s of await store.withStatus("proposed")) {
      if (s.suggestedBy === userId || !isAdminEditControl(s.edit.control)) continue;
      if (!holdersByCap.has(s.edit.capability)) holdersByCap.set(s.edit.capability, await liveHoldersOf(s.edit.capability));
      const holders = holdersByCap.get(s.edit.capability)!;
      if (!holders.includes(userId)) continue;
      const route = routeSuggestion({
        capability: s.edit.capability,
        villageHolds: isVillageHeld(s.edit.capability, who.ctx.villageHeld),
        liveHolders: holders,
        passesPowers: ADMIN_EDIT_CONTROLS[s.edit.control].passesPowers,
      }, routes());
      if (route !== "holders") continue;
      const control = adminEditControl(s.edit.control);
      queue.push(view(s, { stale: control ? staleDifference(s, control.read()) : null, suggester: await nameOf(s.suggestedBy) }));
    }
    res.json({ suggestions: queue });
  });

  app.get("/api/admin/suggestions/mine", async (req, res) => {
    const who = await present(req, res);
    if (!who) return;
    const out: ReturnType<typeof view>[] = [];
    for (const s of await store.bySuggester(String(who.user.id))) {
      if (!isAdminEditControl(s.edit.control)) continue;
      const mayRaise = s.status === "proposed" && mayRaiseToBallot(s.suggestedAt, now(), (await routeNow(s, who.ctx)).route);
      out.push(view(s, { mayRaise }));
    }
    res.json({ suggestions: out, raiseAfterDays: SUGGESTION_RAISE_AFTER_DAYS });
  });

  // ── Review ────────────────────────────────────────────────────────────────

  app.post("/api/admin/suggestions/:id/accept", async (req, res) => {
    const r = await reviewer(req, res);
    if (!r) return;
    const userId = String(r.user.id);
    if (await limited(res, `suggest-review:${userId}`)) return;
    // The gate the direct edit asks, asked of the reviewer.
    if (!(await guardCapability(req, res, r.s.edit.capability))) return;
    const [suggester, accepter] = await Promise.all([nameOf(r.s.suggestedBy), nameOf(userId)]);
    const note = `Suggested by ${suggester}, accepted by ${accepter}.`;
    const done = await acceptSuggestion(store, r.s, { decidedBy: userId, note });
    if (!done.ok) return res.status(done.status).json(done.body);
    void recordEvent(getPool(), {
      kind: "audit",
      text: `admin_edit:accepted:${r.s.edit.control}:${r.s.id}:suggested-by:${r.s.suggestedBy}:accepted-by:${userId}`,
      actorUserId: userId,
      entityType: "suggestion",
      entityRef: r.s.id,
      audience: "admin",
    });
    void notify({
      userId: r.s.suggestedBy,
      type: "governance",
      title: `${accepter} accepted your suggested change to ${ADMIN_EDIT_CONTROLS[r.s.edit.control].label}`,
      body: note,
      link: "/admin",
      actorUserId: userId,
      dedupeKey: `sugg:${r.s.id}:accepted`,
    } as any).catch(() => undefined);
    res.json({ success: true, suggestion: view((await store.byId(r.s.id)) ?? r.s) });
  });

  app.post("/api/admin/suggestions/:id/decline", async (req, res) => {
    const r = await reviewer(req, res);
    if (!r) return;
    const userId = String(r.user.id);
    if (await limited(res, `suggest-review:${userId}`)) return;
    const reasonProblem = declineReasonProblem(req.body?.reason);
    if (reasonProblem) return res.status(400).json({ error: "reason_required", message: reasonProblem });
    const reason = String(req.body.reason).trim();
    if (!(await store.move(r.s.id, "proposed", "rejected", { decidedBy: userId, note: reason }))) {
      return res.status(409).json({ error: "already_decided", message: "This suggestion has just been decided by somebody else." });
    }
    void recordEvent(getPool(), {
      kind: "audit",
      text: `admin_edit:declined:${r.s.edit.control}:${r.s.id}:declined-by:${userId}`,
      actorUserId: userId,
      entityType: "suggestion",
      entityRef: r.s.id,
      audience: "admin",
    });
    void notify({
      userId: r.s.suggestedBy,
      type: "governance",
      title: `${await nameOf(userId)} declined your suggested change to ${ADMIN_EDIT_CONTROLS[r.s.edit.control].label}`,
      body: `${reason} You can still take it to the village with a proposal.`,
      link: "/admin",
      actorUserId: userId,
      dedupeKey: `sugg:${r.s.id}:declined`,
    } as any).catch(() => undefined);
    res.json({ success: true, suggestion: view((await store.byId(r.s.id)) ?? r.s) });
  });

  app.post("/api/admin/suggestions/:id/send-to-vote", async (req, res) => {
    const r = await reviewer(req, res);
    if (!r) return;
    const userId = String(r.user.id);
    if (await limited(res, `suggest-vote:${userId}`)) return;
    await toVillage(res, r.s, userId);
  });

  // ── The suggester's own door to a vote ────────────────────────────────────

  app.post("/api/admin/suggestions/:id/raise", async (req, res) => {
    const who = await present(req, res);
    if (!who) return;
    const s = await found(req, res);
    if (!s) return;
    const userId = String(who.user.id);
    if (s.suggestedBy !== userId) {
      return res.status(403).json({ error: "not_yours", message: "Only the person who made a suggestion may raise it to a vote." });
    }
    if (s.status !== "proposed") {
      return res.status(409).json({ error: "not_waiting", message: `This suggestion is already ${s.status}.`, status: s.status });
    }
    if (await limited(res, `suggest-vote:${userId}`)) return;
    const { route } = await routeNow(s, who.ctx);
    if (!mayRaiseToBallot(s.suggestedAt, now(), route)) {
      const waitMs = SUGGESTION_RAISE_AFTER_DAYS * 24 * 60 * 60 * 1000 - (now().getTime() - s.suggestedAt.getTime());
      return res.status(409).json({
        error: "too_soon",
        message: `The holders have ${SUGGESTION_RAISE_AFTER_DAYS} days to review a suggestion. After that you may take it to a vote yourself.`,
        daysLeft: Math.ceil(waitMs / (24 * 60 * 60 * 1000)),
      });
    }
    await toVillage(res, s, userId);
  });
}
