/**
 * Remove, Redirect and Done on a form submission.
 *
 *   POST /api/admin/submissions/:id/handling
 *     the reason and optional note, stored for the village, and sent to Sera
 *     when the switch is on and the request is one of Sera's tasks
 *   GET  /api/admin/submissions/hand-targets
 *     people and roles a request can be handed to
 *
 * The submission itself is moved by the existing status and delete routes.
 * This route only keeps the reason. Handing a request on does not delete it.
 */
import { boolVar } from "../lib/variables";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { planSubmissionHandling } from "../../shared/submissionHandling";
import { recordEvent } from "../lib/events";
import { libraryOwnerOf } from "../lib/memberTaskBridge";
import { enqueue, feedbackOn, insertFeedback, notesRelease, activeRoles, redirectPeople } from "../repos/memberTaskFeedback";
import type { FeedbackContext } from "../../shared/memberTaskFeedback";

type Deps = Pick<AppDeps, "isAdmin" | "getPool" | "adminActor">;

const CONTEXT: FeedbackContext = { shownIn: null, rankScore: null, daysOnList: null, surface: "board" };

export function register(app: Express, deps: Deps): void {
  const { isAdmin, getPool, adminActor } = deps;

  app.get("/api/admin/submissions/hand-targets", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = adminActor(req);
    const pool = getPool();
    res.json({
      people: actor ? await redirectPeople(pool, actor.id, boolVar("memberTasks.listDefault")) : [],
      roles: await activeRoles(pool),
    });
  });

  app.post("/api/admin/submissions/:id/handling", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = adminActor(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const id = String(req.params.id || "").slice(0, 64);
    if (!id) return res.status(400).json({ error: "That request could not be found." });
    const pool = getPool();
    const share = (await feedbackOn(pool, actor.id)) && (req.body as { share?: unknown })?.share !== false;
    const ownerId = share ? await libraryOwnerOf(pool, actor.id) : null;
    const planned = planSubmissionHandling(req.body, {
      share, submissionId: id, data: (req.body as { data?: unknown })?.data, ownerId,
    });
    if (!planned.ok) return res.status(400).json({ error: planned.problem });
    const plan = planned.plan;
    const fresh = await insertFeedback(pool, {
      feedbackId: plan.feedbackId,
      userId: actor.id,
      taskId: id,
      action: plan.action,
      reason: plan.reason,
      code: plan.code,
      note: plan.note,
      context: CONTEXT,
      redirectToUserId: plan.toUserId,
      redirectToRoleId: plan.toRoleId,
      review: plan.review,
    });
    if (!fresh) return res.status(200).json({ ok: true, toldSera: false, duplicate: true });
    await recordEvent(pool, {
      kind: "submission_handling",
      text: plan.eventText,
      actorUserId: actor.id,
      entityType: "submission",
      entityRef: id,
      audience: "admin",
    });
    if (plan.toldSera && plan.feedbackPayload) {
      await enqueue(pool, actor.id, plan.feedbackId, "feedback", plan.feedbackPayload, false);
      if (plan.notePayload) {
        const held = (await notesRelease(pool)) !== "released";
        await enqueue(pool, actor.id, `${plan.feedbackId}-note`, "note", plan.notePayload, held);
      }
    }
    const sentence = !share
      ? "Saved here. Sera was not told, because telling Sera is off."
      : plan.toldSera
        ? "Saved here, and the reason was sent on to Sera."
        : "Saved here. Sera was not told, because this is not one of Sera's tasks.";
    res.json({ ok: true, toldSera: plan.toldSera, sentence });
  });
}
