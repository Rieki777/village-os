/**
 * The structure change review: one arrival from an outside service, read as a
 * change to this village's chart, and accepted with a steward's decisions.
 *
 *   GET  /api/review/batches/:batchId/structure          the plan, and the draft it went into
 *   POST /api/review/batches/:batchId/structure/accept   accept, or `dryRun` to preview
 *
 * Once the draft is published the read also carries `carry`, the list of
 * people still seated on the old chart (server/routes/carryAcross.ts, which
 * registers the two doors that act on it).
 *
 * Registered by server/routes/review.ts and behind the same key as the review
 * queue, `intake.moderate`: the read asks `mayStillSee` (looking has no
 * break-glass), the accept asks `guardCapability`. A live holder of
 * `org.decide` may also read a batch once it has a draft, to publish it. What accepting produces is
 * a DRAFT, and nothing here publishes; see the header of review.ts for why
 * that boundary is load-bearing.
 *
 * `ids` (query on the read, body on the accept) narrows the batch to a
 * selection. Without it the batch is every proposal in it still waiting.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { draftChangeCap } from "../lib/orgDrafts";
import { openDraftBallot, ORG_DECIDE, publishDoorFor } from "../lib/orgDraftDecide";
import { acceptStructure, batchHeader, draftForBatch, readDecisions, readStructure, type RepoCircle } from "../lib/structureReview";
import { carryAnswer, register as registerCarry, type CarryDeps } from "./carryAcross";

type Deps = Pick<
  AppDeps,
  "isAdmin" | "authedUser" | "adminActor" | "guardCapability" | "mayStillSee" | "getPool" | "members" | "circlesRepo"
> &
  CarryDeps;

const idList = (v: unknown): string[] | null => {
  const raw = Array.isArray(v) ? v : typeof v === "string" && v !== "" ? v.split(",") : [];
  const ids = raw.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 500);
  return ids.length ? ids : null;
};

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, adminActor, guardCapability, mayStillSee, getPool, members, circlesRepo, liveHoldersOf } = deps;

  /*
   * AFTER THE ACCEPT THIS ANSWERS WITH THE DRAFT. A batch accepted whole has
   * nothing waiting, and one whose leftovers are only what the source archived
   * has nothing to decide; both used to read as an empty batch with no word
   * about the draft just made. `draft` is the draft its proposals went into
   * (through `created_ref`), with its preview; `plan` is null when nothing
   * waits.
   *
   * `publishDoor` is the question the two publish routes ask
   * (`publishDoorFor`, server/lib/orgDraftDecide.ts): "power" for a live holder
   * of `org.decide`, "admin" for an admin until a launch vote has carried, and
   * null for anybody else or for a draft the village is voting on. A holder of
   * `org.decide` who does not keep the review queue may still read the page
   * once the batch has a draft, because "Waiting on you" sends them here to
   * publish it. They read the draft only: `plan` and `waiting` are the queue's
   * leftovers and stay with whoever keeps it (`mayModerate`).
   */
  app.get("/api/review/batches/:batchId/structure", async (req, res) => {
    const moderates = await mayStillSee(req, "intake.moderate");
    const viewer = await authedUser(req);
    const deciders = await liveHoldersOf(ORG_DECIDE);
    if (!moderates && !(viewer && deciders.includes(String(viewer.id)))) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const circles = circlesRepo.all() as RepoCircle[];
    const batchId = String(req.params.batchId);
    const [read, draft] = await Promise.all([
      moderates ? readStructure(pool, circles, batchId, idList(req.query.ids)) : Promise.resolve(null),
      draftForBatch(pool, circles, batchId),
    ]);
    const header = read?.header ?? (draft ? await batchHeader(pool, batchId) : null);
    if (!header) return res.status(404).json({ error: "Nothing in that batch is waiting for a decision" });
    const publishDoor =
      draft?.status === "open" && !(await openDraftBallot(pool, draft.id))
        ? await publishDoorFor(pool, { userId: viewer ? String(viewer.id) : null, isAdmin: await isAdmin(req) }, deciders)
        : null;
    res.json({
      ...header,
      plan: read?.plan ?? null,
      waiting: read?.rows.length ?? 0,
      proposalChangeLimit: draftChangeCap(),
      draft,
      mayPublish: publishDoor !== null,
      publishDoor,
      mayModerate: moderates,
      carry: draft?.status === "published" ? await carryAnswer(req, deps, draft.id) : null,
    });
  });

  app.post("/api/review/batches/:batchId/structure/accept", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = (await authedUser(req))?.id ?? adminActor(req)?.id ?? null;
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Accepting a structure change needs a named person" });
    let roster = 0;
    try {
      roster = ((await members.all()) as unknown[]).length;
    } catch {
      roster = 0;
    }
    const r = await acceptStructure(getPool(), {
      circles: circlesRepo.all() as RepoCircle[],
      batchId: String(req.params.batchId),
      ids: idList(req.body?.ids),
      decisions: readDecisions(req.body),
      actor,
      dryRun: req.body?.dryRun === true,
      roster,
    });
    if (!r.ok) return res.status(r.status).json({ error: r.error, problems: r.problems ?? [] });
    if (r.dryRun) {
      return res.json({
        dryRun: true,
        lines: r.lines.map((l) => ({ op: l.op, orgRoleId: l.orgRoleId, reads: l.reads, blocked: l.blocked })),
        blocked: r.blocked,
        blockedLines: r.blockedLines,
        counts: r.decided.counts,
      });
    }
    res.json({
      success: true,
      draftId: r.draftId,
      blocked: r.blocked,
      blockedLines: r.blockedLines,
      counts: r.decided.counts,
      accepted: r.decided.accepted,
      split: r.decided.split,
      // Left in the queue: untouched proposals, and the half of each split structure.
      leftInQueue: [...r.decided.untouched, ...r.remainders.map((x) => x.id)],
      remainders: r.remainders,
    });
  });

  registerCarry(app, deps);
}
