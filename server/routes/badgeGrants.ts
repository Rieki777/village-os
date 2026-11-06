/**
 * POST /api/governance/badge-grants: the village gives a badge to a member, or
 * takes one back, by its own vote (vote-path gap 6).
 *
 * Rye, 2026-11-06: "EVERYTHING can change with the highest village vote." The
 * badge panel is behind `isAdmin`, and a badge carries powers through the one
 * gate, so before this route a badge moved only when an administrator moved it.
 * The wizard has carried a `badge_grant` type all along (client
 * wizardConfig.ts posts here); `CONDUCTABLE_TYPES` now names it, and the
 * closer (server/lib/badgeGrantCloser.ts) awards through the same
 * `awardBadge` the admin route uses.
 *
 * ── WHO OPENS ONE ──────────────────────────────────────────────────────────
 *
 * A member holding `proposal.open` as a member, asked through
 * `refuseUnlessMemberMayOpen`, the helper every power ceremony asks. An
 * administrator whose only path to it is the admin account is pointed at the
 * advisory vote, as at every other ceremony.
 *
 * ── AT WHAT BAR ────────────────────────────────────────────────────────────
 *
 * The village's ordinary dials, raised to its highest set tier when the badge
 * carries a power the village holds. Such a badge moves that power to whoever
 * wears it, and a power the village holds moves only at the highest vote: the
 * same bar a re-point of a held power clears. The document says which.
 *
 * REGISTERED BELOW `requireModule("governance")` and below `SUBJECT_CLOSERS`
 * in server/index.ts, because Express matches in registration order and the
 * closer table has to exist before this writes into it.
 */
import type { Express, Request, Response } from "express";
import type { CapabilityCtx } from "../../shared/capabilities";
import type { BallotMethod } from "../../shared/governanceEngine";
import type { AppDeps } from "../lib/appDeps";
import type { SubjectCloser } from "../lib/applyDue";
import type { RollNotice } from "../lib/ballotNotices";
import { openBallot } from "../lib/ballots";
import { BADGE_GRANT_ROUTE, badgeById, villageHeldKeysOf } from "../lib/badges";
import {
  BADGE_GRANT,
  badgeGrantCloser,
  badgeGrantRef,
  badgeGrantTitle,
  badgeVoteDials,
  badgeVoteProblem,
  wearsBadge,
} from "../lib/badgeGrantCloser";
import { liveConsequence } from "../lib/capabilityConsequence";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import type { WeightModeSnapshot } from "../lib/governanceWeights";
import { deadlineInVillage } from "../lib/villageReaders";

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "getPool" | "notify" | "notifyAdmins" | "members" | "firstName"> & {
  /** Whether the badges module is on. A vote about a badge the village cannot see is refused. */
  badgesOn(): boolean;
  /** The refusal the power ceremonies share, so each keeps its own noun for the act. */
  refuseUnlessMemberMayOpen(req: Request, res: Response, ctx: CapabilityCtx, act: string): Promise<boolean>;
  /** The dials, the weight snapshot, the roll and the window, gathered once. */
  roleBallotSetup(): Promise<{
    method: BallotMethod;
    dials: { unityPct: number; quorumPct: number };
    snapshot: WeightModeSnapshot;
    tokenProblem: string | null;
    electorate: Array<{ userId: string; weight: number }>;
    durationDays: number;
  }>;
  /** Tell the whole roll that a ballot opened. */
  notifyRoll(b: { id: string }, input: RollNotice): Promise<number>;
  /** The ballot in the shape a page reads. */
  serveBallot(b: any, viewerId?: string): Promise<any>;
  /** The close dispatcher's table. `register` writes the `badge_grant` closer into it. */
  closers: Record<string, SubjectCloser>;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, notify, notifyAdmins, members, firstName } = deps;
  deps.closers[BADGE_GRANT] = badgeGrantCloser({ getPool, notify, notifyAdmins, members, firstName });

  app.post(BADGE_GRANT_ROUTE, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!deps.badgesOn()) {
      return res.status(409).json({ error: "Badges are switched off in this village, so there is no badge to vote on." });
    }
    const ctx = await capabilityCtx(user);
    if (await deps.refuseUnlessMemberMayOpen(req, res, ctx, "Giving or taking back a badge")) return;

    const badgeId = String(req.body?.badgeId ?? "").trim();
    const userId = String(req.body?.userId ?? "").trim();
    const revoke = req.body?.revoke === true;
    const reason = String(req.body?.reason ?? "").trim().slice(0, 20000);
    // The wizard offers a term in seasons. Nothing turns seasons into a date
    // for a badge yet, so a term is refused, never quietly dropped.
    if (req.body?.seasons !== undefined && req.body?.seasons !== null && Number(req.body.seasons) > 0) {
      return res.status(400).json({
        error: "A term in seasons cannot be set on a badge by a vote yet. Leave it blank: the village can take the badge back by another vote.",
      });
    }

    const pool = getPool();
    const badge = await badgeById(pool, badgeId);
    if (!badge) return res.status(404).json({ error: "There is no badge by that name." });
    const problem = badgeVoteProblem(badge);
    if (problem) return res.status(409).json({ error: problem });
    const target = await members.byId(userId);
    if (!target) return res.status(404).json({ error: "There is no member by that name." });
    if (isExampleUser(target)) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    const wears = await wearsBadge(pool, target.id, badge.id);
    if (!revoke && wears) return res.status(409).json({ error: `${firstName(target.name)} already wears ${badge.name}.` });
    if (revoke && !wears) return res.status(409).json({ error: `${firstName(target.name)} does not wear ${badge.name}, so there is nothing to take back.` });
    if (reason.length < 40) {
      return res.status(400).json({ error: "Say why, for this badge and this person. The whole roll reads it before voting." });
    }
    const subjectRef = badgeGrantRef({ badgeId: badge.id, userId: target.id, revoke });
    if (subjectRef.length > 64) {
      return res.status(409).json({ error: "That badge's id is too long for the record to hold beside the member. Give the badge a shorter name first." });
    }

    const setup = await deps.roleBallotSetup();
    if (setup.tokenProblem) return res.status(409).json({ error: setup.tokenProblem });
    const villageHeld = await villageHeldKeysOf(pool, badge.capabilities);
    const dials = badgeVoteDials(setup.dials, villageHeld.length > 0);

    const who = firstName(String(target.name ?? ""));
    const title = badgeGrantTitle(badge.name, who, revoke);
    const powers = badge.capabilities.map((c) => liveConsequence(c));
    const doc = [
      `# ${title}`,
      "",
      `## What this vote does`,
      "",
      revoke
        ? `If it carries, ${who} no longer wears ${badge.name}.`
        : `If it carries, ${who} wears ${badge.name}, with no end date. The village can take it back by another vote.`,
      "",
      powers.length
        ? `Whoever wears it can ${powers.join("; ")}.`
        : "This badge carries no powers. It is recognition.",
      "",
      villageHeld.length
        ? "The village holds a power this badge carries, so this is decided at the village's highest tier."
        : "",
      "",
      `## Why`,
      "",
      reason,
      "",
      `Asked by ${firstName(user.name)} on ${new Date().toISOString().slice(0, 10)}.`,
      "",
    ]
      .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
      .join("\n");

    const result = await openBallot(pool, {
      subjectType: BADGE_GRANT,
      subjectRef,
      title,
      docMarkdown: doc,
      method: setup.method,
      weightMode: setup.snapshot.mode,
      weightToken: setup.snapshot.token,
      unityPct: dials.unityPct,
      quorumPct: dials.quorumPct,
      durationDays: setup.durationDays,
      openedBy: user.id,
      electorate: setup.electorate,
      purposeAlignment: req.body?.purposeAlignment,
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });

    void deps.notifyRoll(result.ballot, {
      type: "ballot_opened",
      title: `The village is asked: ${title}`,
      body: `Voting is open until ${deadlineInVillage(result.ballot.closesAt)}.`,
      keySuffix: "open",
      except: [user.id],
      roll: setup.electorate.map((e) => e.userId),
    });
    res.json({ success: true, ballot: await deps.serveBallot(result.ballot, user.id) });
  });
}
