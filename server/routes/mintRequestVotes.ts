/**
 * "Put it to the village": the vote half of a grant that waits for a second
 * steward (vote-path gap 8).
 *
 *   POST /api/governance/mint-requests/:id/put-to-village   open a `mint_request` ballot on it
 *
 * The rules, the ballot text, the approval and the closer are all in
 * server/lib/mintRequests.ts. This file asks who is asking and answers.
 *
 * ── WHO MAY KNOCK ──────────────────────────────────────────────────────────
 *
 * Any member holding `proposal.open` as a member, which is the stage a member
 * reaches before they may put anything to the whole village. Asked with
 * `isAdmin: false`, the question `refuseUnlessMemberMayOpen` asks in
 * server/index.ts: an admin who could sign the grant has the admin door, and an
 * admin with no member standing cannot open a village vote on their own panel's
 * queue. The person who asked for the grant may put it to the village too: the
 * village decides, and the rule that the person paid is never the person who
 * asked still holds at the landing.
 *
 * ── THE CLOSER ─────────────────────────────────────────────────────────────
 *
 * `register` writes `mint_request` into the closer table it is handed, which is
 * `SUBJECT_CLOSERS` in server/index.ts. Without that line `openBallot` would
 * refuse a binding vote on a subject nobody can close.
 *
 * Bounded like the other put-to-village doors: ten in ten minutes per member,
 * because each vote rings the whole roll.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { SubjectCloser } from "../lib/applyDue";
import type { RollNotice } from "../lib/ballotNotices";
import type { BallotSetup } from "../lib/orgDraftDecide";
import { MINT_REQUEST, mintRequestCloser, putMintRequestToVillage, type MintRequestDeps } from "../lib/mintRequests";
import { capabilityDecision } from "../../shared/capabilities";
import { deadlineInVillage } from "../lib/villageReaders";

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "getPool" | "overLimit" | "notify" | "members"> & {
  /** The roll, the dials, the weights and the window: `roleBallotSetup` in server/index.ts. */
  ballotSetup(): Promise<BallotSetup>;
  /** Tell the whole roll that a vote opened. */
  notifyRoll(b: { id: string }, input: RollNotice): Promise<number>;
  /** Is the governance module on. Off means nobody could vote on what this opens. */
  governanceOn(): boolean;
  /** The closer table. `mint_request` is written into it here. */
  closers: Record<string, SubjectCloser>;
};

const ASKS_PER_WINDOW = 10;
const ASK_WINDOW_MS = 10 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, overLimit, notify, members, ballotSetup, notifyRoll, governanceOn, closers } = deps;

  // `pool` is read at each use, never at registration, so the pool a test or a
  // reconnect hands over later is the one the landing writes to.
  const requestDeps: MintRequestDeps = {
    get pool() {
      return getPool();
    },
    members,
    notify: (input) => notify(input),
  };
  closers[MINT_REQUEST] = mintRequestCloser(requestDeps);

  app.post("/api/governance/mint-requests/:id/put-to-village", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to put a grant to the village." });
    if (await overLimit(`mint-to-village:${String(user.id)}`, ASKS_PER_WINDOW, ASK_WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of votes to open in a few minutes. Wait a little and try again." });
    }
    if (!governanceOn()) {
      return res.status(409).json({ error: "governance_off", message: "This village has not turned voting on, so there is nobody to put the grant to yet." });
    }
    const ctx = await capabilityCtx(user);
    if (!capabilityDecision("proposal.open", { ...ctx, isAdmin: false }).allowed) {
      return res.status(403).json({ error: "Putting a grant to the village is for a member who holds proposal.open" });
    }
    const opened = await putMintRequestToVillage(requestDeps, {
      requestId: String(req.params.id ?? ""),
      openedBy: String(user.id),
      setup: await ballotSetup(),
    });
    if (!opened.ok) return res.status(opened.status).json(opened.body);
    void notifyRoll(opened.ballot, {
      type: "ballot_opened",
      title: "The village is asked to decide a grant of new tokens",
      body: `Voting is open until ${deadlineInVillage(opened.ballot.closesAt)}.`,
      keySuffix: "open",
      except: [String(user.id)],
      roll: opened.electorate,
    });
    res.json({ success: true, ballot: { id: opened.ballot.id, closesAt: opened.ballot.closesAt } });
  });
}
