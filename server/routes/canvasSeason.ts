/**
 * THE CANVAS SEASON: the week map a village lays over its governance canvas
 * (2026-09-26).
 *
 *   GET    /api/canvas/season   an admitted member or an admin: the season, if one is loaded
 *   PUT    /api/canvas/season   the canvas pen: load a season file, replacing any before it
 *   DELETE /api/canvas/season   the canvas pen: take the season off
 *
 * The format and the one validator are shared/canvasSeason.ts. The document
 * is `canvas-season` in `app_config` (server/repos/canvasSeason.ts). A season
 * ORDERS the Canvas view's cards by the week's focus and never gates a block:
 * nothing here, and nothing that reads this, hides or locks one.
 *
 * ── WORKS WITH NO OUTSIDE SERVICE ──────────────────────────────────────────
 *
 * The file is loaded by hand, from a paste or a chosen file, and stored in
 * the village's own database. A self-hosted village needs nothing from anyone
 * to use a season, and a village with no season loses nothing: the view
 * falls back to canvas order.
 *
 * ── WHO MAY READ ───────────────────────────────────────────────────────────
 *
 * The same door as `GET /api/canvas`, asked through the same function
 * (`mayReadCanvas`, server/routes/canvas.ts): a member the village has
 * admitted, or an admin. The season is how the village works through its own
 * canvas, and it names who loaded it. A signed-in account the village has not
 * admitted (an invited one before admission, or anybody on a fork with
 * `membership.invite_only` off) gets 403 and `CANVAS_MEMBERS_ONLY`; a visitor
 * gets 401.
 *
 * ── WHO MAY WRITE: THE CANVAS PROSE PEN, `story.tell`, ASKED OF THE ONE GATE ─
 *
 * Exactly as server/routes/canvas.ts decides who records a reading, and for
 * the same reason: `guardCapability(req, res, "story.tell", ...)`, with the
 * gate deciding in its own order. Before the handover an admin or founder
 * passes; once the village holds the key, its holder writes and an admin
 * meets the gate's 409. This file adds only the words of a refusal: 401 to a
 * visitor before the gate is asked, 403 and a sentence to a member without
 * the pen. `mayEdit` on the read is the same question asked of
 * `capabilityDecision`, and only decides whether the page offers the form.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { capabilityDecision } from "../../shared/capabilities";
import { parseCanvasSeason, type CanvasSeasonPayload } from "../../shared/canvasSeason";
import { readCanvasSeason, removeCanvasSeason, saveCanvasSeason } from "../repos/canvasSeason";
import { CANVAS_MEMBERS_ONLY, mayReadCanvas } from "./canvas";

type Deps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "hasMembership" | "guardCapability" | "capabilityCtx" | "getPool" | "firstName"
>;

/** What a signed-in member who does not hold the pen is told. */
export const SEASON_PEN_REFUSAL =
  "Loading or removing the season is for whoever holds the village's story. You can read the season and every week in it.";

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, capabilityCtx, getPool, firstName } = deps;

  app.get("/api/canvas/season", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await mayReadCanvas(deps, req, user))) return res.status(403).json({ error: CANVAS_MEMBERS_ONLY });
    const mayEdit = capabilityDecision("story.tell", await capabilityCtx(user)).allowed;
    const read = await readCanvasSeason(getPool());
    const payload: CanvasSeasonPayload =
      read.state === "stored"
        ? {
            season: read.season,
            // No name, no one: an erased or missing loader is not "Someone", and never "A".
            savedBy: read.savedBy && read.savedByName ? { id: read.savedBy, name: firstName(read.savedByName) } : null,
            savedAt: read.savedAt,
            problem: null,
            mayEdit,
          }
        : {
            season: null,
            savedBy: null,
            savedAt: null,
            problem: read.state === "unreadable" ? `The stored season could not be read: ${read.problem}` : null,
            mayEdit,
          };
    res.json(payload);
  });

  app.put("/api/canvas/season", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: SEASON_PEN_REFUSAL } }))) return;
    const parsed = parseCanvasSeason(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const saved = await saveCanvasSeason(getPool(), parsed.season, String(user.id));
    res.json({
      season: saved.season,
      ignored: parsed.ignored,
      savedBy: { id: saved.savedBy, name: firstName(String(user.name ?? "")) },
      savedAt: saved.savedAt,
    });
  });

  app.delete("/api/canvas/season", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: SEASON_PEN_REFUSAL } }))) return;
    const removed = await removeCanvasSeason(getPool());
    res.json({ removed });
  });
}
