/**
 * The two doors between a member and a power: asking for one, and being
 * seated where one lives.
 *
 *   POST /api/powers/:key/raise-hand   { note? }   file a hand in the inbox
 *   POST /api/governance/role-seats                open a vote on a seat
 *
 * The rest of this header is about the hand. The seat vote keeps its own
 * reasoning beside `registerSeatVote` at the foot of the file, which is where
 * it was written and where the server/index.ts ratchet cannot reach it.
 *
 * The rules are in shared/powerHands.ts, including why there is no route to
 * take a hand down yet. This file asks who is asking, reads their catalogue
 * fresh, and files the row.
 *
 * ── THE PROFILE IS NEVER THE AUTHORITY ─────────────────────────────────────
 *
 * The button shows on a row the profile marked `recommended`, and that profile
 * can be an hour old. So the POST rebuilds this member's catalogue the way
 * `/api/game/progression` builds it, from their capability context and their
 * stage as played now, and refuses unless the power is still put to them.
 *
 * A catalogue whose map could not be read suggests nothing, which on its rows
 * alone looks exactly like "not put to you". So the read says when it degraded
 * (`readPowerAffinity`), and that refusal becomes a 503 and a retry.
 *
 * ── THE SAME INBOX A SEAT HAND USES ────────────────────────────────────────
 *
 * The row goes into `submissions` through the one `submissionsRepo` the rest of
 * the server holds, handed in by `server/index.ts`, and only ever through
 * `insert`. A second `dbCollection` over the same table would keep a cache of
 * its own, and the admin inbox would not list a new hand until the server
 * restarted. The event, the founders' bell and the answer a member hears when
 * the row moves are the ones a seat hand gets (the raise-hand route in
 * `server/index.ts`, `server/lib/submissionNotices.ts`).
 *
 * ── ONE HAND PER POWER ─────────────────────────────────────────────────────
 *
 * Requests for one member and one power run one at a time, so two taps landing
 * together read each other's row and the second is refused. One process serves
 * a deployment (the store's own header says so), which is what makes a queue in
 * this process enough. A refused second hand is answered with the hand that is
 * up, so a profile that drew the button from an old payload can show the hand.
 *
 * ── THE GATES ──────────────────────────────────────────────────────────────
 *
 * A signed-in member, and at most ten hands in ten minutes each, because every
 * hand rings every founder. Whether the power is put to them is the gate that
 * matters, and it is the catalogue's answer, never a capability key: raising a
 * hand permits nothing, so no power guards the asking.
 */
import type { Express } from "express";
import { asOffer, POWER_APPLICATION, raiseHandRefusal, standingHands } from "../../shared/powerHands";
import type { AppDeps } from "../lib/appDeps";
import { villageId } from "../lib/economy";
import { recordEvent } from "../lib/events";
import { readPowerAffinity } from "../lib/powerAffinity";
import { capabilityCatalogue } from "../lib/progressionPayload";
import type { DbCollection } from "../repos/store-db";
import type { Request, Response } from "express";
import type { CapabilityCtx } from "../../shared/capabilities";
import { getStage, stageIndex } from "../../shared/gameConfig";
import type { BallotMethod } from "../../shared/governanceEngine";
import { resolveSeatTerm, type SeatCalendar } from "../../shared/seatTerms";
import type { LandingDeps } from "../lib/applyDue";
import type { RollNotice } from "../lib/ballotNotices";
import { openBallot } from "../lib/ballots";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import type { WeightModeSnapshot } from "../lib/governanceWeights";
import { seatVoteLandsAt } from "../lib/seatTermLanding";
import { STEWARD_VETO } from "../lib/stewardship";
import { freezeSeatTerm } from "../repos/ballotSeatTerms";

type Deps = Pick<
  AppDeps,
  "authedUser" | "capabilityCtx" | "stageOf" | "firstName" | "notifyAdmins" | "getPool" | "overLimit"
> & {
  submissionsRepo: DbCollection;
};

/** The longest note a hand carries, the same as a seat hand. */
const NOTE_MAX = 2000;
/** How many hands one member may raise in a window. Each one rings every founder. */
const HANDS_PER_WINDOW = 10;
const HAND_WINDOW_MS = 10 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, stageOf, firstName, notifyAdmins, getPool, overLimit, submissionsRepo } = deps;

  const queues = new Map<string, Promise<void>>();
  /** Run the work after every earlier request for the same member and power has finished. */
  function inTurn<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = queues.get(key) ?? Promise.resolve();
    const run = before.then(work);
    const after = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, after);
    void after.then(() => {
      if (queues.get(key) === after) queues.delete(key);
    });
    return run;
  }

  app.post("/api/powers/:key/raise-hand", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to raise your hand for a power." });
    const userId = String(user.id);
    if (await overLimit(`power-hand:${userId}`, HANDS_PER_WINDOW, HAND_WINDOW_MS)) {
      return res.status(429).json({
        error: "too_many_hands",
        message: "That is a lot of hands in a few minutes. Wait a little and try again.",
      });
    }
    const key = String(req.params.key ?? "").trim();
    const note = String(req.body?.note ?? "").slice(0, NOTE_MAX);

    await inTurn(`${userId}:${key}`, async () => {
      const { rows: catalogue, degraded } = await readPowerAffinity(capabilityCatalogue(await capabilityCtx(user)), {
        pool: getPool(),
        villageId: villageId(),
        userId,
        stageId: await stageOf(user),
      });
      const row = catalogue.find((r) => r.key === key);
      const up = standingHands(submissionsRepo.all(), userId).get(key);
      const refusal = raiseHandRefusal(row, up);
      if (refusal?.error === "not_recommended" && degraded) {
        res.status(503).json({
          error: "try_again",
          message: "The village's powers could not be read just now. Try again in a moment.",
        });
        return;
      }
      if (refusal || !row) {
        if (refusal) {
          res.status(refusal.status).json({
            error: refusal.error,
            message: refusal.message,
            ...(up ? { hand: { status: up.status, submittedAt: up.submittedAt } } : {}),
          });
        }
        return;
      }

      const submittedAt = new Date().toISOString();
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: POWER_APPLICATION,
        status: "new",
        rewarded: false,
        data: {
          capability: key,
          powerLabel: row.label,
          suits: row.suits.filter((s) => s.yours).map((s) => s.name),
          note,
          email: user.email,
          name: user.name,
        },
        userId,
        userName: user.name,
        submittedAt,
      };
      await submissionsRepo.insert(entry);

      const said = `${firstName(user.name)} raised a hand to ${asOffer(row.label)}`;
      await recordEvent(getPool(), {
        kind: "role",
        text: said,
        actorUserId: userId,
        entityType: "capability",
        entityRef: key,
        audience: "admin",
      });
      // Keyed by the row, as a seat hand's bell is: each hand is its own
      // summons, and a retry that stored nothing rings nothing.
      await notifyAdmins("submission", said, `${POWER_APPLICATION}:${entry.id}`, "/admin?tab=submissions");
      res.json({ success: true, hand: { status: "new", submittedAt } });
    });
  });
}

/**
 * WHAT THE SEAT VOTE IS HANDED, and why none of it moved with it.
 *
 * Every name below is read live out of `server/index.ts` and every one of them
 * has other callers there, so the route came across alone. Three are the
 * arithmetic and the wording that three sibling ceremonies share
 * (`roleBallotSetup`, `roleConsequences`, `refuseUnlessMemberMayOpen`), and a
 * second copy of a threshold or a refusal is the thing an extraction is most
 * likely to leave behind.
 */
type SeatVoteDeps = Pick<
  AppDeps,
  "authedUser" | "capabilityCtx" | "members" | "firstName" | "stageOf" | "getPool"
> & {
  /** Every role this village defines, live. `RoleDef` stays private to server/index.ts. */
  rolesRepo: { all(): any[] };
  /** Who sits where, live. */
  loadRoleHolders(): { roleId: string; userId: string }[];
  /** The refusal the role ceremonies share, so each keeps its own noun for the act. */
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
  /** What a role can do today, in the words every other ceremony uses. */
  roleConsequences(role: any): string[];
  /** What every seat's term is decided against (shared/seatTerms.ts). */
  seatCalendar(): SeatCalendar;
  /** The landing reader server/index.ts builds fresh on every call. */
  landingDeps(): LandingDeps;
  /** The village's own record of what happened. */
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<void>;
  /** Tell the whole roll that a ballot opened. */
  notifyRoll(b: { id: string }, input: RollNotice): Promise<number>;
  /** The ballot in the shape a page reads. */
  serveBallot(b: any, viewerId?: string): Promise<any>;
};

/**
 * REGISTERED WHERE THE HANDLER USED TO SIT, and that is not a formality.
 *
 * `server/index.ts` mounts `requireModule("governance")` on `/api/governance`
 * partway down the file, and Express runs middleware in registration order.
 * Calling this beside the power-hand route at the top of the file would put
 * the door IN FRONT of that mount, and the governance module would stop
 * gating it. So the call stays at the line the route was lifted from.
 */
export function registerSeatVote(app: Express, deps: SeatVoteDeps): void {
  const {
    authedUser, capabilityCtx, members, firstName, stageOf, getPool,
    rolesRepo, loadRoleHolders, refuseUnlessMemberMayOpen, roleBallotSetup, roleConsequences,
    seatCalendar, landingDeps, addActivity, notifyRoll, serveBallot,
  } = deps;

  /**
   * ── SEAT SOMEBODY IN A ROLE ────────────────────────────────────────────────
   *
   * WHY THIS ONE REFUSES THE TWO KEYS THAT MAKE AN ELECTORATE, and the reason
   * is `power_grant`'s reason one step further along. That route refuses to
   * vote `ballot.vote` or `member.vouch` onto a role because "a role is a set
   * of PEOPLE through its seats", so granting the vote to a role and then
   * seating three people in it is a small group choosing who else gets a say.
   * This route is the seating half of exactly that path. Granting is fenced
   * and seating was not, because until now seating by vote did not exist.
   *
   * TRANSFERABLE excludes both keys today and `power_grant` refuses them by
   * name, so nothing a village can do reaches this refusal. It is written for
   * the same reason the grant's is: the day an admin route or a later lane
   * puts one of those keys on a role, this path would otherwise widen in a
   * commit about something else.
   *
   * R54 IS NOT BEING FENCED OFF. A village widening its own roll is the
   * destination, and the way there is `progression.unlock.ballot.vote`, a
   * mechanic the whole roll changes in one vote about a rule.
   */
  app.post("/api/governance/role-seats", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    if (await refuseUnlessMemberMayOpen(req, res, ctx, "Seating somebody in a role")) return;

    const userId = String(req.body?.userId ?? "").trim();
    const roleId = String(req.body?.roleId ?? "").trim();
    const reason = String(req.body?.reason ?? "").trim().slice(0, 20000);

    const role = rolesRepo.all().find((r: any) => r.id === roleId) as any;
    if (!role) return res.status(404).json({ error: "There is no role by that name." });
    if (role.isExample) {
      return res.status(409).json({ error: "That is one of the platform's example roles, not one of this village's. Declare a role of your own first." });
    }
    const carried = ((role.capabilities ?? []) as string[]).filter((c) =>
      ["ballot.vote", "member.vouch"].includes(c), // superVouch absent: SUPER_VOUCH_PLACEMENT
    );
    if (carried.length) {
      return res.status(409).json({
        error:
          `${role.name ?? roleId} carries ${carried.join(" and ")}, so seating somebody in it would be a few members choosing who else gets a say. ` +
          "Who votes here is a rule of the game, and the village changes it the way it changes any rule: open a rule change on the rung that decides who is on the roll, and the whole roll decides it.",
      });
    }
    const member = await members.byId(userId);
    if (!member) return res.status(404).json({ error: "There is no member by that id." });
    if (isExampleUser(member)) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    if (loadRoleHolders().some((h) => h.roleId === roleId && h.userId === userId)) {
      return res.status(409).json({
        error: `${firstName(member.name)} already sits in ${role.name ?? roleId}. There is nothing for the village to decide here.`,
      });
    }
    // A role can require a minimum stage, and an appointment made by the whole
    // village respects the ladder the same way an admin's does. Asked again at
    // close, because a member can slip below it while the vote runs.
    if (role.minStage) {
      const needed = stageIndex(role.minStage);
      if (needed >= 0 && stageIndex(await stageOf(member)) < needed) {
        return res.status(409).json({
          error: `${firstName(member.name)} has not reached the ${getStage(role.minStage)?.name ?? role.minStage} stage this role asks for.`,
          minStage: role.minStage,
        });
      }
    }
    if (userId.includes("@") || roleId.includes("@")) {
      return res.status(400).json({ error: "A member and a role are both named without an @ in them." });
    }
    const subjectRef = `${userId}@${roleId}`;
    if (subjectRef.length > 64) {
      return res.status(409).json({ error: "That role's name is too long for the record to hold beside the member. Shorten the role id first." });
    }
    if (reason.length < 40) {
      return res.status(400).json({
        error: "Say why this person for this role. The whole roll reads this before voting.",
      });
    }

    const setup = await roleBallotSetup();
    if (setup.tokenProblem) return res.status(409).json({ error: setup.tokenProblem });

    const term = resolveSeatTerm({ requestedEndsOn: req.body?.termEndsOn, calendar: seatCalendar(), capAtSeasonEnd: ((role.capabilities ?? []) as string[]).includes(STEWARD_VETO), now: new Date(), startsNoEarlierThan: seatVoteLandsAt(landingDeps(), setup.durationDays) });
    if (!term.ok) return res.status(409).json({ error: term.error, code: term.code });
    const can = roleConsequences(role);
    const who = role.name ?? roleId;
    const title = `${who}: the village asks ${firstName(member.name)} to sit in it`;
    const doc = [
      `# ${title}`,
      "",
      `## The role`,
      "",
      `${who}. ${String(role.description ?? "").trim()}`.trim(),
      "",
      `## What ${firstName(member.name)} would be able to do`,
      "",
      can.length
        ? `From the day this carries, with no further vote:\n\n${can.map((c) => `- ${c}`).join("\n")}`
        : `${who} carries no powers today, so this seats somebody in a role that grants nothing yet. If the village later votes ${who} a power, whoever is sitting in it holds that power from that day.`,
      "",
      `## Why this person`,
      "",
      reason,
      "",
      `## How long`, "",
      `${term.followsSeason ? `Until the season ends on ${term.endsOn}, and if the season's end date moves, this seat moves with it.` : `Until ${term.endsOn}.`} When the term ends the seat ends, and the village can seat them again.`, ...(term.caution ? ["", term.caution] : []), "",
      `## Taking it back`,
      "",
      `The village can vote this seat back at any time, and that vote is an ordinary one.`,
      "",
      `Asked by ${firstName(user.name)} on ${new Date().toISOString().slice(0, 10)}.`,
      "",
    ]
      .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
      .join("\n");

    const result = await openBallot(getPool(), {
      subjectType: "role_seat",
      onOpen: (conn, ballotId) => freezeSeatTerm(conn, ballotId, { endsAt: term.endsAt, seasonId: term.seasonId, followsSeason: term.followsSeason }),
      subjectRef,
      title,
      docMarkdown: doc,
      method: setup.method,
      weightMode: setup.snapshot.mode,
      weightToken: setup.snapshot.token,
      unityPct: setup.dials.unityPct,
      quorumPct: setup.dials.quorumPct,
      durationDays: setup.durationDays,
      openedBy: user.id,
      electorate: setup.electorate,
    });
    if (!result.ok) return res.status(409).json({ error: result.error, ballotId: result.alreadyOpen?.id ?? null });

    await addActivity("governance", `The village is deciding whether ${firstName(member.name)} sits in ${who}.`, {
      actorUserId: user.id,
      entityType: "ballot",
      entityRef: result.ballot.id,
    });
    void notifyRoll(result.ballot, {
      type: "ballot_opened",
      title: `The village is asked whether ${firstName(member.name)} sits in ${who}`,
      body: `Voting is open until ${new Date(result.ballot.closesAt).toLocaleDateString()}.`,
      keySuffix: "open",
      except: [user.id],
      roll: setup.electorate.map((e) => e.userId),
    });
    res.json({ success: true, ballot: await serveBallot(result.ballot, user.id) });
  });
}
