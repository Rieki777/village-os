/**
 * THE GOVERNANCE CANVAS: reading it, and recording a reading (0222).
 *
 *   GET  /api/canvas            every member: each block's newest reading and its history
 *   POST /api/canvas/readings   the canvas pen: one new reading of one block
 *
 * ── CORE, AND ALWAYS ON ────────────────────────────────────────────────────
 *
 * The canvas is not a module. No `requireModule` sits in front of it and no
 * lifecycle switch can take it away, because Rye ruled on 2026-09-24 that
 * every block must be on record before a village's Birthing, and a gate a
 * village has to pass cannot sit behind a switch it could turn off.
 *
 * ── WHO MAY READ ───────────────────────────────────────────────────────────
 *
 * Signed in and nothing more, the same door the governing purpose statement
 * uses (server/routes/governingPurpose.ts): the canvas is the village's own
 * account of how it governs itself, and every member lives under it. A
 * visitor with no session gets 401.
 *
 * ── WHO MAY WRITE: THE PEN IS `story.tell`, ASKED OF THE ONE GATE ──────────
 *
 * The canvas is the village saying, in its own words, what it is and how it
 * works, which is what `story.tell` already covers. So the write asks
 * `guardCapability(req, res, "story.tell", ...)`, and the gate decides in its
 * own order: before the handover an admin or founder passes it exactly as
 * they do for page content and the milestones; once the village holds the
 * key, its holder writes and an admin meets the 409 hatch like everywhere
 * else. There is no second check in this file and there must never be one.
 *
 * The one thing this file adds to the gate is the WORDS of a refusal. A
 * signed-in member who does not hold the pen gets 403 and a sentence, and a
 * visitor gets 401 before the gate is asked at all, because "sign in" and
 * "this is not yours to write" are different answers.
 *
 * `mayRecord` on the read is the same question asked without the request:
 * `capabilityDecision` on the member's context, never a re-spelling of the
 * order. It only decides whether the page offers a form; the write is still
 * refused by the gate if the page is wrong.
 *
 * ── NO NUMBER BUT THE LEVEL ────────────────────────────────────────────────
 *
 * The payload carries each block's level and nothing computed across blocks:
 * no total, no average, no count of blocks read. R55 forbids the scorecard
 * and the radar is the one exception, for this view only.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { capabilityDecision } from "../../shared/capabilities";
import { LEVEL_WORDS, MOMENT_LABELS, parseCanvasReading } from "../../shared/governanceCanvas";
import { allCanvasReadings, readingsByBlock, recordCanvasReading, type CanvasReadingRow } from "../repos/canvasReadings";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "capabilityCtx" | "getPool" | "firstName">;

/** What a signed-in member who does not hold the pen is told. */
export const CANVAS_PEN_REFUSAL =
  "Recording a canvas reading is for whoever holds the village's story. You can read every block and its history.";

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, capabilityCtx, getPool, firstName } = deps;

  /** One reading, as the page renders it. The recorder's first name only, as every public line does. */
  const shape = (r: CanvasReadingRow) => ({
    id: r.id,
    level: r.level,
    word: LEVEL_WORDS[r.level],
    sentence: r.sentence,
    moment: r.moment,
    momentLabel: MOMENT_LABELS[r.moment],
    recordedBy: { id: r.recordedBy, name: firstName(r.recorderName ?? "") },
    recordedAt: r.recordedAt,
  });

  app.get("/api/canvas", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const rows = await allCanvasReadings(getPool());
    const mayRecord = capabilityDecision("story.tell", await capabilityCtx(user)).allowed;
    res.json({
      blocks: readingsByBlock(rows).map(({ blockId, readings }) => ({
        id: blockId,
        latest: readings[0] ? shape(readings[0]) : null,
        history: readings.map(shape),
      })),
      mayRecord,
    });
  });

  app.post("/api/canvas/readings", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: CANVAS_PEN_REFUSAL } }))) return;
    const parsed = parseCanvasReading(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const id = await recordCanvasReading(getPool(), { ...parsed.reading, recordedBy: String(user.id) });
    const saved = (await allCanvasReadings(getPool())).find((r) => r.id === id);
    if (!saved) return res.status(500).json({ error: "The reading was written and could not be read back." });
    res.status(201).json({ reading: { blockId: saved.blockId, ...shape(saved) } });
  });
}
