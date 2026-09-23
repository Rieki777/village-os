/**
 * A member raises a hand for a power the village puts to them.
 *
 *   POST /api/powers/:key/raise-hand          { note? }   file a hand in the inbox
 *   GET  /api/powers/hands                                the hands that are up
 *   POST /api/powers/hands/:id/put-to-village { roleId?, reason?, termEndsOn? }
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

/** What opening a seat vote answers with. The shape server/index.ts hands over. */
type SeatVoteOpened =
  | { ok: true; ballot: { id: string; closesAt: string } }
  | { ok: false; status: number; body: Record<string, unknown> };

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
  openSeatVote(ask: {
    userId: string;
    roleId: string;
    reason: string;
    termEndsOn?: unknown;
    openedBy: { id: string; name: string };
  }): Promise<SeatVoteOpened>;
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
