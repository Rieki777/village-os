/**
 * THE CANVAS, IN PUBLIC: one line per block, and who decides what
 * (plan 2.3 "Content section canvas", 4.6 "Visibility"; 2026-09-28).
 *
 *   GET /api/canvas/public                   everybody: each block's public line, in canvas order
 *   PUT /api/canvas/public/:block            the canvas pen: write or take down one block's line
 *   GET /api/canvas/public/decision-matrix   everybody: the Decision Matrix rows the platform
 *                                            generates, and nothing a village wrote
 *
 * Everything under `/api/canvas/public` answers a visitor with no session, and
 * that is the whole test for adding a door here: if a stranger may not read
 * it, it does not belong under this prefix. The canvas's readings and its
 * radar are members-only (server/routes/canvas.ts) and never come through
 * here.
 *
 * ── THE LINES NAME NOBODY, CHECKED TWICE ───────────────────────────────────
 *
 * The write refuses a line holding the name of anybody the village has
 * admitted (server/lib/canvasNames.ts). The read asks the same question of
 * every stored line, every time, because somebody can join, or change their
 * display name, after a line was written, and a line that names them from
 * that day on is held back (`withheld: true`, no text) until the pen writes it
 * again. If the names cannot be read, the read fails closed: 503, no lines.
 *
 * The lines live in the `content` document under `canvas`. Its generic doors,
 * `GET /api/content/:section` and `PUT /api/admin/content/:section`, refuse
 * that one key (one line each in server/index.ts), so the check above cannot
 * be walked around from either side.
 *
 * ── THE PEN IS `story.tell`, ASKED OF THE ONE GATE ─────────────────────────
 *
 * The same pen as the canvas's readings and the rest of what a village says
 * about itself: `guardCapability(req, res, "story.tell", ...)`, in the gate's
 * own order. Before the handover an admin or founder writes; once the village
 * holds the key, its holder writes and an admin meets the gate's 409 hatch.
 * No second check lives here. A visitor is asked to sign in before the gate
 * is asked, because "sign in" and "this is not yours to write" are different
 * answers.
 *
 * ── WHY THE MATRIX HAS A PUBLIC DOOR OF ITS OWN ────────────────────────────
 *
 * Plan 4.6 gives a visitor "the generated matrix rows". The members' door,
 * `GET /api/canvas/decision-matrix`, is where the village's own columns are
 * planned to arrive (Wave 3a, the canvas frames), and who may read those is a
 * question for the lane that writes them. This door calls the same reader and
 * the same generator (`readMatrixInputs`, `generateDecisionMatrix`) and can
 * only ever serve what the platform generates, so nothing a village writes
 * can reach a stranger through it by accident. The generator's rows name
 * roles and head counts, never a person (shared/decisionMatrix.ts).
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { generateDecisionMatrix, type DecisionMatrixInputs } from "../../shared/decisionMatrix";
import { CANVAS_BLOCK_IDS, isCanvasBlockId } from "../../shared/governanceCanvas";
import {
  CANVAS_PUBLIC_SECTION,
  PUBLIC_LINE_WORDS,
  parsePublicLine,
  readPublicLines,
  type CanvasPublicBlock,
} from "../../shared/canvasPublicLines";
import { nameInLine, namesToProtect, nameRefusal } from "../lib/canvasNames";
import { recordEvent } from "../lib/events";
import { MATRIX_UNREADABLE, readMatrixInputs, type DecisionMatrixDeps } from "./decisionMatrix";

export type CanvasPublicDeps = DecisionMatrixDeps & Pick<AppDeps, "guardCapability" | "members" | "contentRepo">;

/** What a signed-in member who does not hold the pen is told. */
export const PUBLIC_LINE_PEN_REFUSAL =
  "Writing the canvas's public lines is for whoever holds the village's story. You can read every line.";

/** What the page is told when the names the lines are checked against cannot be read. */
export const PUBLIC_LINES_UNREADABLE = "The canvas's public lines could not be read just now.";

/**
 * What `PUT /api/admin/content/canvas` and `GET /api/content/canvas` answer.
 * server/index.ts serves it from both generic doors, keyed on
 * `CANVAS_PUBLIC_SECTION`.
 */
export const CANVAS_SECTION_DOOR =
  "The canvas's public lines are read at GET /api/canvas/public and written one block at a time at PUT /api/canvas/public/:block, which checks each line for members' names.";

export { CANVAS_PUBLIC_SECTION };

export function register(app: Express, deps: CanvasPublicDeps): void {
  const { authedUser, guardCapability, members, hasMembership, contentRepo, getPool } = deps;

  /** The names no public line may hold, read now. Throws when the roster cannot be read. */
  const protectedNames = async () => namesToProtect(await members.all(), hasMembership);

  app.get("/api/canvas/public", async (_req, res) => {
    let names: string[];
    try {
      names = await protectedNames();
    } catch (e) {
      console.error("[canvas-public] the roster could not be read, so no line is served", e);
      return res.status(503).json({ error: PUBLIC_LINES_UNREADABLE });
    }
    const stored = readPublicLines(contentRepo.get()?.[CANVAS_PUBLIC_SECTION]);
    const blocks: CanvasPublicBlock[] = CANVAS_BLOCK_IDS.map((id) => {
      const line = stored[id] ?? null;
      const withheld = line !== null && nameInLine(line, names) !== null;
      return { id, line: withheld ? null : line, withheld };
    });
    res.json({ blocks });
  });

  app.put("/api/canvas/public/:block", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await guardCapability(req, res, "story.tell", { status: 403, body: { error: PUBLIC_LINE_PEN_REFUSAL } }))) return;
    const block = req.params.block;
    if (!isCanvasBlockId(block)) return res.status(404).json({ error: PUBLIC_LINE_WORDS.notABlock });
    const parsed = parsePublicLine(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    if (parsed.line) {
      let names: string[];
      try {
        names = await protectedNames();
      } catch (e) {
        console.error("[canvas-public] the roster could not be read, so the line is not written", e);
        return res.status(503).json({ error: PUBLIC_LINES_UNREADABLE });
      }
      const named = nameInLine(parsed.line, names);
      if (named) return res.status(400).json({ error: nameRefusal(named) });
    }

    // Copied, never mutated: `get()` hands back the cache itself.
    const content = (contentRepo.get() ?? {}) as Record<string, unknown>;
    const lines = { ...readPublicLines(content[CANVAS_PUBLIC_SECTION]) };
    if (parsed.line) lines[block] = parsed.line;
    else delete lines[block];
    await contentRepo.put({ ...content, [CANVAS_PUBLIC_SECTION]: lines });
    void recordEvent(getPool(), {
      kind: "audit",
      text: `canvas:public-line:${parsed.line ? "write" : "clear"}:${block}`,
      actorUserId: String(user.id),
      entityType: "canvas",
      entityRef: block,
      audience: "admin",
    });
    const saved: CanvasPublicBlock = { id: block, line: parsed.line || null, withheld: false };
    res.json({ block: saved });
  });

  app.get("/api/canvas/public/decision-matrix", async (_req, res) => {
    let inputs: DecisionMatrixInputs;
    try {
      inputs = await readMatrixInputs(deps);
    } catch (e) {
      console.error("[canvas-public] the village's holdings could not be read", e);
      return res.status(503).json({ error: MATRIX_UNREADABLE });
    }
    res.json(generateDecisionMatrix(inputs));
  });
}
