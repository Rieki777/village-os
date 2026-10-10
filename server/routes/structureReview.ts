/**
 * The structure change review: one arrival from an outside service, read as a
 * change to this village's chart, and accepted with a steward's decisions.
 *
 *   GET  /api/review/batches/:batchId/structure          the plan
 *   POST /api/review/batches/:batchId/structure/accept   accept, or `dryRun` to preview
 *
 * Registered by server/routes/review.ts and behind the same key as the review
 * queue, `intake.moderate`: the read asks `mayStillSee` (looking has no
 * break-glass), the accept asks `guardCapability`. What accepting produces is
 * a DRAFT, and nothing here publishes; see the header of review.ts for why
 * that boundary is load-bearing.
 *
 * `ids` (query on the read, body on the accept) narrows the batch to a
 * selection. Without it the batch is every proposal in it still waiting.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { draftChangeCap } from "../lib/orgDrafts";
import { acceptStructure, readDecisions, readStructure, type RepoCircle } from "../lib/structureReview";

type Deps = Pick<AppDeps, "authedUser" | "adminActor" | "guardCapability" | "mayStillSee" | "getPool" | "members" | "circlesRepo">;

const idList = (v: unknown): string[] | null => {
  const raw = Array.isArray(v) ? v : typeof v === "string" && v !== "" ? v.split(",") : [];
  const ids = raw.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 500);
  return ids.length ? ids : null;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, adminActor, guardCapability, mayStillSee, getPool, members, circlesRepo } = deps;

  app.get("/api/review/batches/:batchId/structure", async (req, res) => {
    if (!(await mayStillSee(req, "intake.moderate"))) return res.status(401).json({ error: "auth_required" });
    const read = await readStructure(
      getPool(),
      circlesRepo.all() as RepoCircle[],
      String(req.params.batchId),
      idList(req.query.ids),
    );
    if (!read) return res.status(404).json({ error: "Nothing in that batch is waiting for a decision" });
    res.json({ ...read.header, plan: read.plan, proposalChangeLimit: draftChangeCap() });
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
}
