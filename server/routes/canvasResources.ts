/**
 * CANVAS RESOURCES: the Governance Canvas Database on a village's own shelf
 * (plan 5.1-5.3, Wave 4 of the canvas build, 2026-09-28).
 *
 *   GET  /api/canvas/resources?block=<id>&surface=learn|safety
 *                                          a member: what shows under one block
 *   PUT  /api/canvas/resources/:key/blocks the canvas pen: where one resource
 *                                          shows in this village
 *
 * And the two nightly jobs, registered here beside the routes that read what
 * they write, the way server/routes/failedActions.ts registers its own:
 * `canvas-resources-sync` and `canvas-resources-link-check`. What each does
 * and why is argued once, in server/lib/canvasResourcesSync.ts. A failed or
 * refused read reaches the admins through the scheduler (the failures report
 * and the error notice). There is no "read it now" route: no admin screen
 * would call it (scripts/check-admin-reach.mjs refuses a doorless admin
 * write), and the next night's run is the retry.
 *
 * ── WHO MAY READ: WHOEVER MAY READ THE CANVAS ──────────────────────────────
 *
 * The resources show inside a block's Learn frame, so the door is the
 * canvas's own (`mayReadCanvas`, server/routes/canvas.ts): an admitted member
 * or an admin. The rows themselves are public upstream, but the page they sit
 * on is the village's, and one door is easier to hold than two.
 *
 * ── WHO MAY PLACE: THE CANVAS PEN, ASKED OF THE ONE GATE ───────────────────
 *
 * Where a resource shows is a word about the village's canvas, so it is the
 * canvas pen's, `story.tell`, asked through `guardCapability` exactly as a
 * reading is (server/routes/canvas.ts). There is no second check here. What
 * is written is the village's own placing only (`tags_local`); the rows the
 * database gives are read-only and no route edits them.
 *
 * ── A SAFETY SURFACE NEVER SHOWS NVC ───────────────────────────────────────
 *
 * `surface=safety` leaves out every Nonviolent Communication row, whatever
 * block is asked for (`safetyExcluded`, shared/canvasResourceTags.ts says
 * why). The Learn frame asks for `learn`.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { capabilityDecision } from "../../shared/capabilities";
import { isCanvasBlockId } from "../../shared/governanceCanvas";
import {
  CANVAS_DATABASE,
  RESOURCE_SURFACES,
  type CanvasResourcesPayload,
  type ResourceSurface,
} from "../../shared/canvasResources";
import { parseBlockList } from "../../shared/canvasResourceTags";
import {
  checkResourceLinks,
  DAY_MS,
  LINK_CHECK_JOB,
  readSyncState,
  resourcesForBlock,
  shelfForReading,
  snapshotInstant,
  SNAPSHOT_TAKEN,
  suggestFormUrl,
  SYNC_DIAL,
  SYNC_JOB,
  syncCanvasResources,
} from "../lib/canvasResourcesSync";
import { boolVar } from "../lib/variables";
import { registerJob } from "../lib/scheduler";
import { resourceByKey, setVillagePlacing } from "../repos/canvasResources";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "hasMembership" | "guardCapability" | "capabilityCtx" | "getPool">;

/** What a signed-in member who does not hold the pen is told when they try to place a resource. */
export const RESOURCE_PEN_REFUSAL =
  "Choosing where a resource shows is for whoever holds the village's story. You can read every resource under every block.";

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, capabilityCtx, getPool } = deps;

  // The pool is read when a job RUNS, never when it is registered: this runs
  // during boot, before the pool is guaranteed to be the one the village uses.
  registerJob(SYNC_JOB, DAY_MS, () => syncCanvasResources({ pool: getPool() }));
  registerJob(LINK_CHECK_JOB, DAY_MS, () => checkResourceLinks({ pool: getPool() }));

  app.get("/api/canvas/resources", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayReadCanvas(deps, req, user))) return res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
    const block = String(req.query.block ?? "");
    if (!isCanvasBlockId(block)) return res.status(400).json({ error: "Name a canvas block, such as ?block=power." });
    const surfaceRaw = String(req.query.surface ?? "learn");
    if (!(RESOURCE_SURFACES as readonly string[]).includes(surfaceRaw)) {
      return res.status(400).json({ error: "The surface is learn or safety." });
    }
    const surface = surfaceRaw as ResourceSurface;
    try {
      const pool = getPool();
      const rows = await shelfForReading(pool);
      const state = await readSyncState(pool);
      const fromDatabase = state?.source === "database" && !!state.lastReadAt;
      const payload: CanvasResourcesPayload = {
        block,
        surface,
        resources: resourcesForBlock(rows, block, surface),
        credit: { text: CANVAS_DATABASE.credit, url: CANVAS_DATABASE.sheetUrl },
        source: {
          kind: fromDatabase ? "database" : "snapshot",
          asOf: fromDatabase ? state!.lastReadAt : snapshotInstant(state?.snapshotTaken ?? SNAPSHOT_TAKEN),
          syncOn: boolVar(SYNC_DIAL),
        },
        suggestUrl: suggestFormUrl(),
        mayPlace: capabilityDecision("story.tell", await capabilityCtx(user)).allowed,
      };
      res.json(payload);
    } catch (e: any) {
      // An error, never an empty shelf: "nothing listed here" and "the shelf could not be read" must not look alike.
      res.status(500).json({ error: "The resources could not be read.", detail: String(e?.message ?? e).slice(0, 200) });
    }
  });

  app.put("/api/canvas/resources/:key/blocks", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: RESOURCE_PEN_REFUSAL } }))) return;
    const key = String(req.params.key ?? "");
    if (!/^[0-9a-f]{40}$/.test(key)) return res.status(404).json({ error: "There is no such resource." });
    const raw = req.body?.blocks;
    const blocks = raw === null ? null : parseBlockList(raw);
    if (raw !== null && !blocks) {
      return res.status(400).json({ error: "Send the blocks as a list of canvas block ids, or null to use the platform's placing." });
    }
    const existing = await resourceByKey(getPool(), key);
    if (!existing) return res.status(404).json({ error: "There is no such resource." });
    await setVillagePlacing(getPool(), key, blocks, String(user.id));
    res.json({ key, blocks, by: blocks ? "village" : null });
  });
}
