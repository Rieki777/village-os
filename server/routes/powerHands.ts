/**
 * The two doors between a member and a power: asking for one, and being
 * seated where one lives.
 *
 *   POST /api/powers/:key/raise-hand          { note? }   file a hand in the inbox
 *   GET  /api/powers/hands                                the hands that are up
 *   POST /api/powers/hands/:id/put-to-village { roleId?, reason?, termEndsOn? }
 *   POST /api/governance/role-seats                       open a vote on a seat
 *
 * The first three are the hand, and the rest of this header is about them. The
 * seat vote keeps its own reasoning beside `registerSeatVote` at the foot of the
 * file, which is where it was written and where the server/index.ts ratchet
 * cannot reach it.
 *
 * ── THE TWO DOORS SHARE ONE `openSeatVote` ─────────────────────────────────
 *
 * `registerSeatVote` RETURNS the function its own route calls, and the hand
 * door calls that same function. So every check, the term, the document and the
 * notice are one copy: a seating rule cannot grow a second, more lenient
 * spelling for one door to find. server/index.ts holds the two registrations at
 * the lines they were lifted from, for the reason written above
 * `registerSeatVote`, and carries the returned function between them.
 *
 * The rules are in shared/powerHands.ts, including why there is no route to
 * take a hand down yet. This file asks who is asking, reads their catalogue
 * fresh, and files the row.
 *
 * ── THE TWO ROUTES RYE'S RULINGS OF 2026-09-23 ADDED ───────────────────────
 *
 * A hand asks and never grants, and until those rulings nothing carried one to
 * a vote: the only answer available was an admin moving the inbox row. The GET
 * is ruling 2 (members read the notes), the POST is ruling 1 (who may put a
 * hand to the village). Both of them read one function, `whoMayPutHandToVillage`
 * and `publicHands` in shared/powerHands.ts, so the rule is provable without a
 * database and stated in one place.
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
import { isVillageHeld, type Capability } from "../../shared/capabilities";
import {
  asOffer,
  POWER_APPLICATION,
  publicHands,
  putToVillageRefusal,
  raiseHandRefusal,
  standingHands,
  whoMayPutHandToVillage,
  type PublicHand,
} from "../../shared/powerHands";
import type { AppDeps } from "../lib/appDeps";
import { capabilityHoldings } from "../lib/capabilityHolding";
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
import { openBallot, type BallotRow } from "../lib/ballots";
import { EXAMPLE_REFUSAL_BODY, isExampleUser } from "../lib/examples";
import type { WeightModeSnapshot } from "../lib/governanceWeights";
import { seatVoteLandsAt } from "../lib/seatTermLanding";
import { STEWARD_VETO } from "../lib/stewardship";
import { freezeSeatTerm } from "../repos/ballotSeatTerms";

/**
 * WHAT ONE DOOR HANDS THE OTHER. `registerSeatVote` returns `openSeatVote`,
 * server/index.ts carries it to the hand door's registration, and this is the
 * shape it travels in. Exported so that carriage is typed at both ends.
 */
export interface SeatVoteAsk {
  userId: string;
  roleId: string;
  /** Why this person for this role. The whole roll reads it before voting. */
  reason: string;
  termEndsOn?: unknown;
  /** Who is opening it: named on the document, and not rung by the notice. */
  openedBy: { id: string; name: string };
}
export type SeatVoteOpened =
  | { ok: true; ballot: BallotRow }
  | { ok: false; status: number; body: Record<string, unknown> };
export type OpenSeatVote = (ask: SeatVoteAsk) => Promise<SeatVoteOpened>;

/**
 * ── HOW THE HAND DOOR REACHES `openSeatVote` ───────────────────────────────
 *
 * The two registrations cannot move to sit beside each other, and no gate can
 * see why. `server/index.ts` mounts `requireModule("governance")` on
 * `/api/governance` partway down the file and Express matches in registration
 * order, so `registerSeatVote` has to stay BELOW that mount while the hand
 * door registers thousands of lines above it. Registering them together would
 * take the governance module's lifecycle gate off a governance route with
 * every gate still green. `notifyRoll` and `landingDeps` are consts declared
 * lower still, so the opener cannot even be BUILT at the hand door's line.
 *
 * So the hand door is handed `opener`, which resolves at REQUEST time, and
 * `registerSeatVote`'s return goes into `fill` when the lower line runs. Both
 * live in one call rather than in module state, because a test builds two apps
 * in one process and they must not share a seat vote.
 */
export function deferredSeatVote(): { opener: OpenSeatVote; fill(built: OpenSeatVote): void } {
  let built: OpenSeatVote | null = null;
  return {
    // ASYNC so the refusal is a REJECTION and not a synchronous throw. Every
    // caller is an `await` inside an express handler, and the two are not the
    // same thing to a caller that wraps its await.
    opener: async (ask) => {
      if (!built) throw new Error("A seat vote was asked for before registerSeatVote ran.");
      return built(ask);
    },
    fill: (o) => {
      built = o;
    },
  };
}

type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "capabilityCtx"
  | "stageOf"
  | "firstName"
  | "isPresent"
  | "members"
  | "notifyAdmins"
  | "getPool"
  | "overLimit"
> & {
  submissionsRepo: DbCollection;
  /**
   * Who holds a power live, counted the way the gate counts (lapsed terms out,
   * carried keys in, a warning badge's deny beating a role). One spelling,
   * shared with the redemption door: `liveHoldersOf` in server/index.ts.
   */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** This village's own roles whose list carries a power, example roles out. */
  rolesCarrying(capability: string): Array<{ id: string; name: string }>;
  /**
   * Open a `role_seat` ballot, every check and the term and the document and
   * the notice included. The SAME function `POST /api/governance/role-seats`
   * calls, so this route cannot grow a more lenient copy of a seating rule.
   */
  openSeatVote: OpenSeatVote;
};

/** The longest note a hand carries, the same as a seat hand. */
const NOTE_MAX = 2000;
/** How many hands one member may raise in a window. Each one rings every founder. */
const HANDS_PER_WINDOW = 10;
const HAND_WINDOW_MS = 10 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, stageOf, firstName, notifyAdmins, getPool, overLimit, submissionsRepo } = deps;
  const { isPresent, members, liveHoldersOf, rolesCarrying, openSeatVote } = deps;

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

  /**
   * How a power stands for one member: who may put a hand for it to the
   * village, and which role a vote would seat somebody into.
   *
   * Both halves are one read each, so the GET below asks per POWER and never
   * per hand. Ten hands for one power cost the same as one.
   */
  async function standingOf(capability: string, ctx: { villageHeld?: readonly string[] }, holdingRoleId: string | null) {
    const rule = whoMayPutHandToVillage(
      isVillageHeld(capability as Capability, ctx.villageHeld),
      await liveHoldersOf(capability),
    );
    const carrying = rolesCarrying(capability);
    /*
     * WHICH ROLE THE VOTE WOULD USE. A power the village holds names its
     * holding role in `capability_holding`, so that one is settled. Otherwise
     * one role carrying it is settled too, and several means the opener says
     * which. None means there is no seat to vote somebody into yet, and the
     * refusal says where that door is.
     */
    const held = holdingRoleId ? carrying.find((r) => r.id === holdingRoleId) : undefined;
    const role = held ?? (carrying.length === 1 ? carrying[0] : null);
    return { rule, carrying, role: role ?? null };
  }

  /** The `role-application` neighbour is a seat hand and a separate question. */
  const handsNow = async (): Promise<PublicHand[]> => {
    const roster = new Map((await members.all()).map((m: any) => [String(m.id), m]));
    return publicHands(submissionsRepo.all(), (id) => {
      const m = roster.get(id);
      return !!m && isPresent(m);
    });
  };

  /**
   * ── RULING 2: THE HANDS THAT ARE UP, NOTES AND ALL ─────────────────────────
   *
   * Rye chose "Everything public" over the recommended "Ask public, note
   * private", and then chose "All notes public" over "only new notes public"
   * when asked about writing already in the inbox. So this serves every
   * standing hand's note, whenever it was written, to any signed in member.
   *
   * ── WHAT IT CANNOT LEAK, BY CONSTRUCTION ───────────────────────────────────
   *
   * `submissions` is one table holding membership requests, visit inquiries,
   * investor enquiries and work-with-us letters beside these. `publicHands`
   * builds each row field by field from a row it has already checked is a
   * `power-application`, so nothing else in the table has a path out of here,
   * and `email`, which the raise-hand route stores beside the note, is a field
   * it never names. Widening this read by status or by type is the one change
   * that would turn it into a privacy break, which is why the filter is in the
   * pure function with a test on it and not in this handler.
   *
   * A HAND THAT IS DOWN IS NOT LISTED. "A raised hand" is the thing the ruling
   * is about, and `STANDING_HAND_STATUSES` is already what raised means
   * everywhere else in this loop, so an answered hand leaves this list exactly
   * as it leaves the member's own profile. Its note stays where every
   * submission's note has always been, in the founders' inbox.
   *
   * A MEMBER WHO ASKED TO BE FORGOTTEN IS NOT LISTED EITHER. The erasure step
   * anonymises an inbox row and keeps it, and `note` is not among the fields it
   * scrubs, so their writing survives. It survives in the admin inbox where it
   * always was; it does not join a list members read.
   */
  app.get("/api/powers/hands", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to read the hands that are up." });
    const hands = await handsNow();
    const ctx = await capabilityCtx(user);
    const holdings = await capabilityHoldings(getPool());
    const holdingRole = new Map(holdings.map((h) => [h.capability, h.holderRoleId]));
    const byPower = new Map<string, Awaited<ReturnType<typeof standingOf>>>();
    for (const key of Array.from(new Set(hands.map((h) => h.capability)))) {
      byPower.set(key, await standingOf(key, ctx, holdingRole.get(key) ?? null));
    }
    res.json({
      hands: hands.map((h) => {
        const state = byPower.get(h.capability)!;
        return {
          ...h,
          /** May the member reading this put THIS hand to the village today. */
          youMayPut: putToVillageRefusal(state.rule, String(user.id), h.powerLabel) === null,
          whoMay: state.rule.who,
          because: state.rule.because,
          seatRole: state.role,
          rolesCarrying: state.carrying,
        };
      }),
    });
  });

  /**
   * ── RULING 1: PUT A STANDING HAND TO THE VILLAGE ───────────────────────────
   *
   * The hole this fills is precise. A hand asks and never grants, and the only
   * answer it could get was an admin moving its row, with the appointment a
   * separate act somewhere else. This is the path from a standing hand to a
   * vote, and `whoMayPutHandToVillage` is Rye's ruling about who may walk it.
   *
   * ── WHAT IT OPENS, AND WHY THAT ONE ────────────────────────────────────────
   *
   * A `role_seat` ballot, through the same `openSeatVote` that
   * `POST /api/governance/role-seats` calls. A power reaches a member through a
   * role that carries it and a seat on that role, so seating them in the role
   * that carries the power is the vote that answers the hand. Every refusal
   * that route makes is made here, including the one about `ballot.vote` and
   * `member.vouch`, because it is the same function and not a copy of it. The
   * term comes from `resolveSeatTerm` inside it, so every seat still has one.
   *
   * ── THE ONE GATE THAT IS DELIBERATELY NOT ASKED ────────────────────────────
   *
   * Every other vote-opening route asks `refuseUnlessMemberMayOpen`, which
   * wants `proposal.open` held as a member. This one does not, and that is
   * ruling 1 taken at its word: "any member can select hands and put them to
   * the village once the village holds the approving power". `proposal.open`
   * unlocks at the co-creator rung (STAGE_UNLOCKS), so asking for it would put
   * every member below that rung outside a ruling that says "any member".
   *
   * WHAT IS LEFT HOLDING THE DOOR, stated plainly because this is the widest
   * thing in the change: the hand has to exist and be up, its author has to
   * still be here, the vote can only seat that author into a role that already
   * carries that power, and one member gets ten of these in ten minutes. Rye
   * ruled it and the reason he gave is that the vote decides, so proposing
   * costs nothing.
   */
  app.post("/api/powers/hands/:id/put-to-village", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to put a hand to the village." });
    if (await overLimit(`hand-to-village:${String(user.id)}`, HANDS_PER_WINDOW, HAND_WINDOW_MS)) {
      return res.status(429).json({
        error: "too_many_asks",
        message: "That is a lot of votes to open in a few minutes. Wait a little and try again.",
      });
    }
    const id = String(req.params.id ?? "").trim();
    const hand = (await handsNow()).find((h) => h.id === id);
    if (!hand) {
      return res.status(404).json({
        error: "hand_not_up",
        message: "That hand is not up any more. It may have been answered already.",
      });
    }
    const ctx = await capabilityCtx(user);
    const holdings = await capabilityHoldings(getPool());
    const state = await standingOf(hand.capability, ctx, holdings.find((h) => h.capability === hand.capability)?.holderRoleId ?? null);
    const refusal = putToVillageRefusal(state.rule, String(user.id), hand.powerLabel);
    if (refusal) return res.status(refusal.status).json({ error: refusal.error, message: refusal.message, whoMay: state.rule.who, because: state.rule.because });

    const asked = String(req.body?.roleId ?? "").trim();
    const role = asked ? state.carrying.find((r) => r.id === asked) : state.role;
    if (!state.carrying.length) {
      return res.status(409).json({
        error: "no_role_carries_it",
        message:
          `No role in this village carries ${hand.powerLabel ? `"${hand.powerLabel}"` : "that power"} yet, so there is no seat to vote anybody into. ` +
          "The village votes a power onto a role first, and then a hand for it has somewhere to go.",
        rolesCarrying: state.carrying,
      });
    }
    if (!role) {
      return res.status(409).json({
        error: "which_role",
        message: "More than one role carries this power. Say which one the village is being asked to seat them in.",
        rolesCarrying: state.carrying,
      });
    }

    const said = String(req.body?.reason ?? "").trim().slice(0, 16000);
    const offered = hand.powerLabel ? `to ${asOffer(hand.powerLabel)}` : `for the power ${hand.capability}`;
    const quoted = hand.note.trim()
      ? `They wrote:\n\n${hand.note.trim().split("\n").map((l) => `> ${l}`).join("\n")}`
      : "They wrote nothing with it.";
    const reason = [
      `${hand.userName || "A member"} raised a hand ${offered} on ${hand.submittedAt.slice(0, 10)}.`,
      quoted,
      said,
      `${firstName(user.name)} put that hand to the village.`,
    ]
      .filter((part) => part.trim() !== "")
      .join("\n\n");

    const opened = await openSeatVote({
      userId: hand.userId,
      roleId: role.id,
      reason,
      termEndsOn: req.body?.termEndsOn,
      openedBy: user,
    });
    if (!opened.ok) return res.status(opened.status).json(opened.body);

    await recordEvent(getPool(), {
      kind: "role",
      text: `${firstName(user.name)} put a raised hand ${offered} to the village`,
      actorUserId: String(user.id),
      entityType: "capability",
      entityRef: hand.capability,
      audience: "admin",
    });
    res.json({ success: true, ballot: { id: opened.ballot.id, closesAt: opened.ballot.closesAt }, seatRole: role });
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
 *
 * IT RETURNS `openSeatVote`, which is how the OTHER door reaches the same act.
 * The hand door registers thousands of lines above this call, so it cannot be
 * handed a built opener at its own registration line; server/index.ts keeps
 * what this returns and the hand door calls it at request time.
 */
export function registerSeatVote(app: Express, deps: SeatVoteDeps): OpenSeatVote {
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
   *
   * ── OPENING A SEAT VOTE, ONCE, FOR EVERY DOOR THAT OPENS ONE ──────────────
   *
   * Lifted whole out of the route below on 2026-09-23, when a second door onto
   * the same act arrived: a member putting a standing hand for a power to the
   * village (`put-to-village`, above). Nothing about the checks, the term, the
   * document or the notice changed in the move.
   *
   * ONE FUNCTION RATHER THAN TWO COPIES, for the reason `carriedBy` is exported
   * from shared/capabilities.ts: every check below is a rule about what a
   * village may vote on, and a rule with two spellings grows a lenient one, and
   * the lenient one is the one somebody finds. The refusal about `ballot.vote`
   * and `member.vouch` is the sharpest example. A second seat-vote path that
   * forgot it would let a few members choose who else gets a say.
   *
   * WHAT THE TWO DOORS DO DIFFER ON IS WHO MAY KNOCK, and that stays at each
   * route. The one below asks for `proposal.open` held as a member
   * (`refuseUnlessMemberMayOpen`). The hand route asks Rye's ruling of
   * 2026-09-23 instead (`whoMayPutHandToVillage`, shared/powerHands.ts).
   *
   * HOW THE HAND DOOR REACHES IT: this function is RETURNED, and server/index.ts
   * carries it to a registration that runs THOUSANDS of lines earlier. Both
   * registrations stay where they are, because Express matches in registration
   * order and the `requireModule("governance")` mount sits between them.
   *
   * The caller owns the reply, so a refusal comes back as a status and a body
   * rather than being sent from here.
   */
  async function openSeatVote(ask: SeatVoteAsk): Promise<SeatVoteOpened> {
    const { userId, roleId, reason } = ask;
    const user = ask.openedBy;
    const no = (status: number, body: Record<string, unknown>): SeatVoteOpened => ({ ok: false, status, body });

    const role = rolesRepo.all().find((r: any) => r.id === roleId) as any;
    if (!role) return no(404, { error: "There is no role by that name." });
    if (role.isExample) {
      return no(409, { error: "That is one of the platform's example roles, not one of this village's. Declare a role of your own first." });
    }
    const carried = ((role.capabilities ?? []) as string[]).filter((c) =>
      ["ballot.vote", "member.vouch"].includes(c), // superVouch absent: SUPER_VOUCH_PLACEMENT
    );
    if (carried.length) {
      return no(409, {
        error:
          `${role.name ?? roleId} carries ${carried.join(" and ")}, so seating somebody in it would be a few members choosing who else gets a say. ` +
          "Who votes here is a rule of the game, and the village changes it the way it changes any rule: open a rule change on the rung that decides who is on the roll, and the whole roll decides it.",
      });
    }
    const member = await members.byId(userId);
    if (!member) return no(404, { error: "There is no member by that id." });
    if (isExampleUser(member)) return no(409, EXAMPLE_REFUSAL_BODY);
    if (loadRoleHolders().some((h) => h.roleId === roleId && h.userId === userId)) {
      return no(409, {
        error: `${firstName(member.name)} already sits in ${role.name ?? roleId}. There is nothing for the village to decide here.`,
      });
    }
    // A role can require a minimum stage, and an appointment made by the whole
    // village respects the ladder the same way an admin's does. Asked again at
    // close, because a member can slip below it while the vote runs.
    if (role.minStage) {
      const needed = stageIndex(role.minStage);
      if (needed >= 0 && stageIndex(await stageOf(member)) < needed) {
        return no(409, {
          error: `${firstName(member.name)} has not reached the ${getStage(role.minStage)?.name ?? role.minStage} stage this role asks for.`,
          minStage: role.minStage,
        });
      }
    }
    if (userId.includes("@") || roleId.includes("@")) {
      return no(400, { error: "A member and a role are both named without an @ in them." });
    }
    const subjectRef = `${userId}@${roleId}`;
    if (subjectRef.length > 64) {
      return no(409, { error: "That role's name is too long for the record to hold beside the member. Shorten the role id first." });
    }
    if (reason.length < 40) {
      return no(400, {
        error: "Say why this person for this role. The whole roll reads this before voting.",
      });
    }

    const setup = await roleBallotSetup();
    if (setup.tokenProblem) return no(409, { error: setup.tokenProblem });

    const term = resolveSeatTerm({ requestedEndsOn: ask.termEndsOn, calendar: seatCalendar(), capAtSeasonEnd: ((role.capabilities ?? []) as string[]).includes(STEWARD_VETO), now: new Date(), startsNoEarlierThan: seatVoteLandsAt(landingDeps(), setup.durationDays) });
    if (!term.ok) return no(409, { error: term.error, code: term.code });
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
    if (!result.ok) return no(409, { error: result.error, ballotId: result.alreadyOpen?.id ?? null });

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
    return { ok: true, ballot: result.ballot };
  }

  app.post("/api/governance/role-seats", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const ctx = await capabilityCtx(user);
    if (await refuseUnlessMemberMayOpen(req, res, ctx, "Seating somebody in a role")) return;
    const opened = await openSeatVote({
      userId: String(req.body?.userId ?? "").trim(),
      roleId: String(req.body?.roleId ?? "").trim(),
      reason: String(req.body?.reason ?? "").trim().slice(0, 20000),
      termEndsOn: req.body?.termEndsOn,
      openedBy: user,
    });
    if (!opened.ok) return res.status(opened.status).json(opened.body);
    res.json({ success: true, ballot: await serveBallot(opened.ballot, user.id) });
  });

  return openSeatVote;
}
