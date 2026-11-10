/**
 * THE BRAIN EDITOR'S DOORS: reading the whole brief, writing one section,
 * confirming one (S74; canvas follow-up D2 and G.4, Rye 2026-11-06).
 *
 *   GET  /api/admin/brain                    the brief and the record's shape
 *   PUT  /api/admin/brain/:section           write one section
 *   POST /api/admin/brain/:section/confirm   confirm a proposed section
 *
 * Moved out of server/index.ts so the rule below is tested over HTTP. The
 * handlers are the ones that lived there, with two changes.
 *
 * ── THE NINE SHARED SECTIONS ASK `story.tell` THROUGH THE ONE GATE (D2) ────
 *
 * As canvas prose does (server/routes/canvas.ts, `POST /api/canvas/readings`).
 * These routes used to ask `isAdmin`, widened to `story.tell` holders by
 * server/lib/operatorRoutes.ts, with the admin asked first: on a village that
 * holds `story.tell` an admin still wrote the village's words alone. Now the
 * gate answers, so on such a village an unseated admin gets the gate's own 409
 * and the holder writes. The two `ROUTE_POWERS` entries are gone.
 *
 * ── THE FOUR PRIVATE SECTIONS ASK THE ADMIN PEN (G.4) ─────────────────────
 *
 * `people`, `legal`, `land` and `constraints` (`ADMIN_ONLY_SECTIONS`) ask the
 * same predicate the canvas's admin pen asks, `whoAdoptsCanvasAnswer("admin")`
 * in shared/powerHands.ts: the administrators, until a `power_grant` vote
 * seats `brief.private` on a role, and after the Birthing its live holders
 * (`liveHoldersOf`, the admin short-circuit left out), with an unseated admin
 * refused. A `story.tell` holder never reaches them. The refusal names the
 * vote (Article 0.4). The read leaves the private sections out for anybody
 * that predicate refuses.
 *
 * Every door marks the request for the /api/admin default-deny
 * (`markAdminGate`), the way `isAdmin` and `guardCapability` do.
 */
import type express from "express";
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { markAdminGate } from "../lib/adminGate";
import { recordEvent } from "../lib/events";
import { readGameStart } from "../lib/gameStart";
import { briefAll, briefAudienceFromBody, briefGet, briefWrite, recordSummaries } from "../lib/villageBrain";
import { capabilityDecision } from "../../shared/capabilities";
import { isAdminOnlySection } from "../../shared/canvasFrames";
import { whoAdoptsCanvasAnswer } from "../../shared/powerHands";
import { BRIEF_BY_ID, BRIEF_SECTIONS } from "../../shared/villageBrief";

/** Said to anybody the four private sections refuse. It names the vote that moves them. */
export const BRIEF_PRIVATE_REFUSAL =
  "The brief's private sections (people, legal, land and constraints) stay with the administrators until a power_grant vote gives brief.private to a role. After the Game starts, whoever holds it reads and writes them, and nobody else.";

/** Said to a member who does not hold the village's story. */
export const BRAIN_PEN_REFUSAL =
  "Writing the village brief is for whoever holds the village's story (story.tell). You can suggest words on the canvas.";

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "capabilityCtx" | "guardCapability"> & {
  /** Who holds a power live, the admin short-circuit left out (`liveHoldersOf` in server/index.ts). */
  liveHoldersOf(capability: string): Promise<string[]>;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool } = deps;

  /** Whether this person holds the admin pen over the four private sections, by the canvas's own predicate. */
  const mayPrivate = async (req: express.Request, user: any): Promise<boolean> => {
    const [start, holders] = await Promise.all([readGameStart(getPool()), deps.liveHoldersOf("brief.private")]);
    const rule = whoAdoptsCanvasAnswer("admin", { birthed: start.started, handoverComplete: false, holders: { admin: holders } });
    if (rule.who === "live-holders") return !!user && (rule.holders ?? []).includes(String(user.id));
    return isAdmin(req);
  };

  /**
   * The gate for one section's write, or false once the refusal is sent. A
   * private section asks the admin pen; any other asks `story.tell` of the
   * one gate, whose own 409 meets an admin on a village that holds it.
   */
  const mayWrite = async (req: express.Request, res: express.Response, user: any, section: string): Promise<boolean> => {
    if (isAdminOnlySection(section)) {
      if (await mayPrivate(req, user)) return true;
      res.status(403).json({ error: BRIEF_PRIVATE_REFUSAL });
      return false;
    }
    return deps.guardCapability(req, res, "story.tell", { status: 403, body: { error: BRAIN_PEN_REFUSAL } });
  };

  /** The whole brief plus the record's shape, for the editor. */
  app.get("/api/admin/brain", async (req, res) => {
    markAdminGate(req);
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const admin = await isAdmin(req);
    const story = capabilityDecision("story.tell", await deps.capabilityCtx(user)).allowed;
    const privateOk = await mayPrivate(req, user);
    // An admin reads the shared sections as before; a story.tell holder reads them too (D2).
    const shared = admin || story;
    if (!shared && !privateOk) return res.status(401).json({ error: "auth_required" });
    const visible = BRIEF_SECTIONS.filter((spec) => (isAdminOnlySection(spec.id) ? privateOk : shared));
    const [filled, records] = await Promise.all([briefAll(getPool(), "admin"), recordSummaries(getPool())]);
    const byId = new Map(filled.map((r) => [r.section, r]));
    res.json({
      // Every section this person may read, written or not. The blanks are the
      // point: they are what lets the assistant raise a subject nobody has covered yet.
      sections: visible.map((spec) => {
        const row = byId.get(spec.id);
        return {
          id: spec.id,
          title: spec.title,
          audience: row?.audience ?? spec.audience,
          feeds: spec.feeds,
          ask: spec.ask,
          minimum: !!spec.minimum,
          status: row ? row.status : "blank",
          source: row?.source ?? null,
          body: row?.body ?? "",
          confirmedBy: row?.confirmedBy ?? null,
          revision: row?.revision ?? 0,
          updatedAt: row?.updatedAt ?? null,
        };
      }),
      record: records,
      blanks: visible.filter((s) => !byId.has(s.id)).map((s) => s.id),
    });
  });

  /** Write one section. Confirming is a separate, named act. */
  app.put("/api/admin/brain/:section", async (req, res) => {
    markAdminGate(req);
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const section = String(req.params.section);
    if (!BRIEF_BY_ID[section]) return res.status(400).json({ error: `no brief section called ${section}` });
    if (!(await mayWrite(req, res, user, section))) return;
    const body = String(req.body?.body ?? "").trim();
    if (body.length < 2) return res.status(400).json({ error: "A section needs something in it" });
    if (body.length > 40000) return res.status(400).json({ error: "That section is too long to keep" });
    const actor = String(user.id);
    const row = await briefWrite(getPool(), {
      section,
      body,
      audience: briefAudienceFromBody(req.body?.audience),
      source: "admin",
      confirmedBy: req.body?.confirm === false ? null : actor,
    });
    void recordEvent(getPool(), {
      kind: "audit", text: `brain:write:${section}:r${row.revision}:${row.audience}`, actorUserId: actor,
      entityType: "brain", entityRef: section, audience: "admin",
    });
    res.json({ success: true, section: row });
  });

  /** Confirm a section the assistant or the intake proposed. */
  app.post("/api/admin/brain/:section/confirm", async (req, res) => {
    markAdminGate(req);
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const section = String(req.params.section);
    if (!BRIEF_BY_ID[section]) return res.status(400).json({ error: `no brief section called ${section}` });
    if (!(await mayWrite(req, res, user, section))) return;
    const existing = await briefGet(getPool(), section, "admin");
    if (!existing) return res.status(404).json({ error: "There is nothing written there yet" });
    const actor = String(user.id);
    const row = await briefWrite(getPool(), {
      section, body: existing.body, audience: existing.audience,
      source: existing.source as any, confirmedBy: actor,
    });
    void recordEvent(getPool(), {
      kind: "audit", text: `brain:confirm:${section}`, actorUserId: actor,
      entityType: "brain", entityRef: section, audience: "admin",
    });
    res.json({ success: true, section: row });
  });
}
