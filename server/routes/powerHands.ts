/**
 * A member raises a hand for a power the village puts to them.
 *
 *   POST /api/powers/:key/raise-hand   { note? }   file a hand in the inbox
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
