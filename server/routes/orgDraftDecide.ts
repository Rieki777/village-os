/**
 * "Put it to the village": the governance half of an org chart draft.
 *
 *   GET  /api/org/drafts/:id/decide            who may publish now, and whether a vote is needed or open
 *   POST /api/org/drafts/:id/publish-by-power  a holder of `org.decide` publishes it straight onto the chart
 *   POST /api/org/drafts/:id/put-to-village    open an `org_draft` ballot on it
 *
 * The rules, the ballot text, the publish and the closer are all in
 * server/lib/orgDraftDecide.ts, whose header carries the rulings. This file
 * asks who is asking and answers.
 *
 * ── WHO MAY KNOCK ON WHICH DOOR ────────────────────────────────────────────
 *
 * Publish-by-power: a live holder of `org.decide`, through the gate, and the
 * break-glass where the village holds it (`holderMayPublish`). An admin who
 * holds nothing is refused here, the same as anybody else: before launch the
 * admin panel keeps its own door (`POST /api/admin/org/drafts/:id/publish`),
 * and after a launch vote that door asks the same question this one does.
 *
 * Put-to-village: Rye's predicate of 2026-09-23, `whoMayPutHandToVillage`.
 * Any signed-in member when the village holds the power or nobody does, and
 * only a holder when a role holds it. `proposal.open` is deliberately not
 * asked, for the reason the raised-hand door gives: where the village holds
 * the power the vote is the decision, so proposing costs nothing.
 *
 * ── A DRAFT UNDER A VOTE IS FROZEN ─────────────────────────────────────────
 *
 * Neither door publishes a draft while a vote on it is open, and the edit
 * paths in server/lib/orgDrafts.ts refuse it too, so the village votes on the
 * draft it read. Withdrawing the draft (server/routes/review.ts) calls the
 * vote off first.
 *
 * ── THE CLOSER ─────────────────────────────────────────────────────────────
 *
 * `register` writes `org_draft` into the closer table it is handed, which is
 * `SUBJECT_CLOSERS` in server/index.ts. That is the table `ballotBinds` and
 * `openBallot`'s closer check read, so without this line a vote on a draft
 * could not open at all. The one register line is the only line this costs
 * server/index.ts.
 *
 * Both POSTs are bounded like the raised-hand door: ten in ten minutes per
 * member, because each vote rings the whole roll.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { SubjectCloser } from "../lib/applyDue";
import type { RollNotice } from "../lib/ballotNotices";
import { addChange, createDraft, getDraft, withdrawDraft } from "../lib/orgDrafts";
import { parseArrangement } from "../lib/circlePlacement";
import {
  BALLOT_OPEN_REFUSAL,
  decideStanding,
  draftReadiness,
  holderMayPublish,
  latestDraftBallot,
  launchedByVote,
  openDraftBallot,
  ORG_DECIDE,
  ORG_DRAFT,
  orgDraftCloser,
  publishDoorFor,
  publishOrgDraft,
  putDraftToVillage,
  putToVillageRefusal,
  type BallotSetup,
  type PublishDeps,
  type PublishDoor,
} from "../lib/orgDraftDecide";
import type { Pool } from "mysql2/promise";

type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "isAdmin"
  | "guardCapability"
  | "capabilityCtx"
  | "getPool"
  | "overLimit"
  | "notify"
  | "seasonState"
  | "circlesRepo"
> & {
  /** Who holds a power live, the gate's own count. `liveHoldersOf` in server/index.ts. */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The roll, the dials, the weights and the window: `roleBallotSetup` in server/index.ts. */
  ballotSetup(): Promise<BallotSetup>;
  /** Tell the whole roll that a vote opened. */
  notifyRoll(b: { id: string }, input: RollNotice): Promise<number>;
  /** Is the governance module on. Off means nobody could vote on what this opens. */
  governanceOn(): boolean;
  /** The closer table. `org_draft` is written into it here. */
  closers: Record<string, SubjectCloser>;
};

const ASKS_PER_WINDOW = 10;
const ASK_WINDOW_MS = 10 * 60 * 1000;

/**
 * WHO MAY ARRANGE THE CIRCLES ON THE MAP, and through which door (2026-10-23).
 *
 * Arranging publishes an org draft, so the answer is exactly who may publish
 * one: a live holder of `org.decide` (the power door, stewards by default and
 * any role the village gives it to, an org designer for one), or an admin
 * until a launch vote carries (the admin panel's door). Rye: "org designers,
 * me and founder/steward roles should be able to drag and drop the
 * orientation and update it". It was `admin` alone, which also offered the
 * drag to an admin after launch, whose publish the door then refused.
 */
export async function arrangeViewer(
  pool: Pool,
  viewer: { id?: unknown } | null,
  isAdmin: boolean,
  liveHoldersOf: (capability: string) => Promise<string[]>,
): Promise<{ mayArrange: boolean; arrangeDoor: PublishDoor | null }> {
  const door = await publishDoorFor(pool, { userId: viewer?.id ? String(viewer.id) : null, isAdmin }, await liveHoldersOf(ORG_DECIDE));
  return { mayArrange: door !== null, arrangeDoor: door };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, guardCapability, capabilityCtx, getPool, overLimit, notify, seasonState, circlesRepo } = deps;
  const { liveHoldersOf, ballotSetup, notifyRoll, governanceOn, closers } = deps;

  // `pool` is read at each use, never at registration: the pool a test or a
  // reconnect hands over later is the one the publish has to write to.
  const publishDeps: PublishDeps = {
    get pool() {
      return getPool();
    },
    reloadCircles: async () => {
      await circlesRepo.load();
    },
    notify: (input) => notify(input),
    seasonState,
  };
  closers[ORG_DRAFT] = orgDraftCloser(publishDeps);

  app.get("/api/org/drafts/:id/decide", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to read how this draft is decided." });
    const pool = getPool();
    const draft = await getDraft(pool, String(req.params.id ?? ""));
    if (!draft) return res.status(404).json({ error: "no_such_draft", message: "There is no draft by that id." });
    const standing = decideStanding(await capabilityCtx(user), await liveHoldersOf(ORG_DECIDE));
    const userId = String(user.id);
    const [open, latest, launched, admin] = await Promise.all([
      openDraftBallot(pool, draft.id),
      latestDraftBallot(pool, draft.id),
      launchedByVote(pool),
      isAdmin(req),
    ]);
    const ready = draft.status === "open" ? await draftReadiness(pool, draft) : { blocked: 0, blockedLines: [], changes: draft.changes.length };
    const publishable = draft.status === "open" && !open && ready.blocked === 0 && ready.changes > 0;
    res.json({
      draftId: draft.id,
      status: draft.status,
      changes: ready.changes,
      blocked: ready.blocked,
      blockedLines: ready.blockedLines,
      launched,
      holderCount: standing.holders.length,
      villageHolds: standing.villageHolds,
      whoMayPutToVillage: standing.rule.who,
      because: standing.rule.because,
      /** Nobody holds the power, so adopting this draft is a vote. */
      ballotNeeded: standing.holders.length === 0,
      youHoldThePower: standing.holders.includes(userId),
      youMayPublish: publishable && standing.holders.includes(userId),
      youMayPutToVillage: publishable && governanceOn() && putToVillageRefusal(standing, userId) === null,
      /** The admin panel's own door, which stands until a launch vote carries. */
      adminMayPublish: publishable && admin && !launched,
      governanceOn: governanceOn(),
      ballot: open ? { id: open.id, status: open.status, closesAt: open.closesAt } : null,
      lastBallot: latest && latest.id !== open?.id ? { id: latest.id, status: latest.status, closesAt: latest.closesAt } : null,
    });
  });

  app.post("/api/org/drafts/:id/publish-by-power", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to publish a draft." });
    if (await overLimit(`draft-decide:${String(user.id)}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot in a few minutes. Wait a little and try again." });
    }
    if (!(await holderMayPublish(req, res, { authedUser, guardCapability, capabilityCtx, liveHoldersOf }))) return;
    const draftId = String(req.params.id ?? "");
    const running = await openDraftBallot(getPool(), draftId);
    if (running) return res.status(409).json({ error: "ballot_open", message: BALLOT_OPEN_REFUSAL, ballotId: running.id });
    const r = await publishOrgDraft(publishDeps, draftId, String(user.id), String(user.id));
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ success: true, applied: r.applied, reloaded: r.reloaded, treasury: r.treasury });
  });

  /*
   * THE ARRANGEMENT DOOR (2026-10-23): a holder of `org.decide` drags circles
   * into place on the map and publishes it in one act. The moves become ONE
   * human-sourced org draft of `move_circle` changes, checked by the same
   * preview every draft meets, against the village as the draft leaves it, and
   * then published by power like any draft a holder publishes: live, no window
   * (Rye, 2026-09-14). A refused arrangement is withdrawn and the refusals come
   * back in words, so nothing is left half open for somebody else to find.
   * The admin panel's door keeps its own route (`/api/admin/org/drafts`).
   */
  app.post("/api/org/arrangements", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to arrange the circles." });
    if (await overLimit(`arrange:${String(user.id)}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot in a few minutes. Wait a little and try again." });
    }
    if (!(await holderMayPublish(req, res, { authedUser, guardCapability, capabilityCtx, liveHoldersOf }))) return;
    const parsed = parseArrangement(req.body);
    if (!parsed.ok) return res.status(400).json({ error: "refused", message: parsed.problem });
    const pool = getPool();
    const userId = String(user.id);
    const made = await createDraft(pool, {
      title: "Circles arranged on the map",
      rationale: "Arranged on the circles map by a holder of the power to decide the structure.",
      createdBy: userId,
      sourceKind: "human",
      openCap: null,
    });
    if (!made.ok) return res.status(409).json({ error: "refused", message: made.error });
    for (const m of parsed.moves) {
      const { circleId, ...payload } = m;
      const added = await addChange(pool, made.id, { op: "move_circle", orgRoleId: `circle:${circleId}`, payload });
      if (!added.ok) {
        await withdrawDraft(pool, made.id);
        return res.status(400).json({ error: "refused", message: added.error });
      }
    }
    const draft = await getDraft(pool, made.id);
    const ready = draft ? await draftReadiness(pool, draft) : { blocked: 1, blockedLines: [], changes: 0 };
    if (ready.blocked > 0) {
      await withdrawDraft(pool, made.id);
      const first = ready.blockedLines[0];
      return res.status(409).json({
        error: "blocked",
        message: first ? `${first.reads}: ${first.blocked}. Nothing was published.` : "This arrangement does not fit the village as it stands. Nothing was published.",
        blockedLines: ready.blockedLines,
      });
    }
    const r = await publishOrgDraft(publishDeps, made.id, userId, userId);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ success: true, draftId: made.id, applied: r.applied, reloaded: r.reloaded });
  });

  app.post("/api/org/drafts/:id/put-to-village", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to put a draft to the village." });
    if (await overLimit(`draft-to-village:${String(user.id)}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of votes to open in a few minutes. Wait a little and try again." });
    }
    if (!governanceOn()) {
      return res.status(409).json({ error: "governance_off", message: "This village has not turned voting on, so there is nobody to put the draft to yet." });
    }
    const standing = decideStanding(await capabilityCtx(user), await liveHoldersOf(ORG_DECIDE));
    const refusal = putToVillageRefusal(standing, String(user.id));
    if (refusal) {
      return res.status(refusal.status).json({ error: refusal.error, message: refusal.message, whoMay: standing.rule.who, because: standing.rule.because });
    }
    const opened = await putDraftToVillage(getPool(), {
      draftId: String(req.params.id ?? ""),
      openedBy: String(user.id),
      why: standing.rule.because,
      setup: await ballotSetup(),
    });
    if (!opened.ok) return res.status(opened.status).json(opened.body);
    void notifyRoll(opened.ballot, {
      type: "ballot_opened",
      title: "The village is asked to decide a change to its structure",
      body: `Voting is open until ${new Date(opened.ballot.closesAt).toLocaleDateString()}.`,
      keySuffix: "open",
      except: [String(user.id)],
      roll: opened.electorate,
    });
    res.json({ success: true, ballot: { id: opened.ballot.id, closesAt: opened.ballot.closesAt } });
  });
}
