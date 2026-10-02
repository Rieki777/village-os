/**
 * The founder's own agent drafts the village map from its masterplan.
 *
 *   GET  /api/agent/v1/map         the brief: the method, the scene schema, the
 *                                  masterplan, where the village stands, and
 *                                  what is live and waiting
 *   POST /api/agent/v1/map/draft   a drafted scene, checked, echoed, and kept as
 *                                  the holder's draft after their yes
 *
 * Both need a `vat_` token carrying `map.draft`, and the token's holder has to
 * be someone who may draft the land (`map.edit`), asked of the one gate on
 * every request. A token only ever narrows what its holder can do (the rule
 * at the top of server/lib/agentTokens.ts), so a member who could not keep a
 * draft by hand cannot have their agent keep one either.
 *
 * ── NOTHING HERE PUBLISHES, AND NOTHING HERE CALLS A MODEL ───────────────
 * The draft lands in the holder's own row of `map_scene_drafts`, the same row
 * build mode autosaves into, through the same `saveDraft`. The live map does
 * not move. The founder opens the map, the map offers the draft ("You have an
 * unpublished draft of the map"), they look at it, and they press Publish,
 * which goes through `POST /api/map/publish` and the `map.publish` key like
 * every other publish. The generation is the agent's: the platform holds no
 * model key for this and makes no model call. What it holds is the method
 * (docs/MAP_FROM_A_MASTERPLAN.md), the rules (`draftSceneProblems`), and the
 * founder's yes.
 *
 * ── THE TWO CALLS ────────────────────────────────────────────────────────
 * Same contract as the RSVP write: call one answers 202 with an echo of what
 * will be written and a confirm token bound to it; call two sends the echo
 * back with `confirm: true`. The echo carries a hash of the exact scene text,
 * and whether the holder already has unpublished work that this would
 * replace, because one row per member means a draft from an agent REPLACES
 * whatever the founder had in progress. The agent shows that to the founder
 * before the yes. If either the scene or the draft underneath changed between
 * the two calls, the echo no longer matches and nothing is written.
 *
 * Registered inside the agent block in server/index.ts, before the block's
 * catch-all 404, which is the only place an `/api/agent/v1` route can live.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type express from "express";
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import {
  DRAFT_SCENE_VERSION,
  FEATURE_GEOMS,
  FEATURE_KINDS,
  MAP_ARCHETYPES,
  RECORD_BLOCKS,
  SCENE_WORLD,
  draftSceneProblems,
} from "../../shared/mapFromMasterplan";
import { MAX_SCENE_BYTES, sceneSizeProblem, sceneSummary } from "../../shared/mapScene";
import type { AppDeps } from "../lib/appDeps";
import { type AgentScope, type AgentTokenRow, CONFIRM_REASON_SENTENCE, echoHash, mintConfirmToken, verifyConfirmToken } from "../lib/agentTokens";
import { recordEvent } from "../lib/events";
import { getDraft, pendingDraft, publishedScene, publishedVersion, saveDraft } from "../lib/mapScene";
import { currentMasterplan } from "../lib/mapMasterplan";
import { publicLand } from "./land";

type Deps = Pick<AppDeps, "capabilityCtx" | "getPool"> & {
  /** The agent block's own resolver: token to holder, scope, bucket, session. */
  resolveAgent: (
    req: express.Request,
    res: express.Response,
    scope: AgentScope,
    kind: "read" | "write",
  ) => Promise<{ row: AgentTokenRow; user: any } | null>;
  /** The server's signing secret, which confirm tokens are bound under. */
  confirmSecret: string;
};

const ACTION = "map_draft";
const METHOD_FILE = path.join(process.cwd(), "docs", "MAP_FROM_A_MASTERPLAN.md");

/** The village's own origin, for links the agent hands the founder. */
const originOf = (req: express.Request) =>
  (process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** What a drafted scene's own lines say it holds, for an echo a person reads. */
function counts(scene: unknown) {
  const s = sceneSummary(scene);
  return { buildings: s.buildings, features: s.features, flows: s.flows, changes: s.edits };
}

/**
 * The shape of a draft, for an agent to copy the SHAPE of.
 *
 * Every name, kind and position in it is a placeholder: a real draft takes
 * each one from the masterplan or leaves it out. Held to `draftSceneProblems`
 * by the route's own test, so the example a generator copies is one the gate
 * accepts.
 */
export function exampleDraft(): Record<string, unknown> {
  return {
    map_scene: { key: "village-grounds", name: "", status: "draft", version: DRAFT_SCENE_VERSION },
    map_structures: [
      {
        key: "common-house", name: "Common House", archetype: "bighall", anchor: { x: 1210, y: 790 }, phase: 1,
        circle_id: null, blurb: "", origin_story: "", state_inputs: { fund: null, activity: "steady", event: null },
        bindings: { doors: [] }, scale: 1,
      },
    ],
    map_zones: [
      { id: "f1", kind: "road", geom: "line", path: [[900, 600], [1200, 780]], subtype: "track", phase: 1, owner_structure_key: null, name: "Main track", public: false },
      { id: "f2", kind: "zone", geom: "area", polygon: [[1100, 700], [1320, 700], [1320, 880], [1100, 880]], subtype: "meadow", phase: 1, owner_structure_key: null, name: "Commons clearing", public: false },
    ],
    map_flows: [],
    map_edits: [
      { seq: 1, actor: "agent", action: "place", target: "structure:Common House", diff: {}, at: "2026-01-01T00:00:00.000Z" },
      { seq: 2, actor: "agent", action: "feature-edit", target: "feature:Main track", diff: {}, at: "2026-01-01T00:00:01.000Z" },
      { seq: 3, actor: "agent", action: "feature-edit", target: "feature:Commons clearing", diff: {}, at: "2026-01-01T00:00:02.000Z" },
    ],
    boundary: { scene_units: [[600, 400], [1800, 400], [1800, 1200], [600, 1200]] },
    org_roles: [],
    quests: [],
    journeys: [],
    forum_threads: [],
    events: [],
  };
}

/** The lines a generator must keep, said once here and in the brief. */
export const DRAFT_RULES: readonly string[] = [
  "Draw only what the masterplan shows. Every building, road, water line, zone and the property line comes from the plan; nothing is added because a village of this kind usually has one.",
  "Names come from the plan's own labels. A thing the plan does not name gets a plain descriptive name (\"Building 4\"), never an invented one.",
  "Leave every village record empty: quests, seats, threads, journeys, gatherings and vitals belong to the people who keep them.",
  "Leave origin stories, funding and gatherings empty on every building. They are things that happened to a place.",
  "Never draw a coast, a river, a road or a landmark off the plan. Ground past the plan is the village's own picture, never yours.",
  "Positions are world units: 0 to 2400 across, 0 to 1600 down, north up. The frame is the village's land record: `ground.spanM` metres across, centred on its centre.",
  "Write one map_edits line per thing you placed, so the founder's publish card lists your work.",
  "You draft. The founder reviews it on the map and publishes it. Nothing you send is live.",
];

export function register(app: Express, deps: Deps): void {
  const { resolveAgent, capabilityCtx, getPool, confirmSecret } = deps;
  const V1 = "/api/agent/v1";

  /** The holder, when they may draft the land; otherwise the refusal is sent and null comes back. */
  async function mapMakerAgent(req: express.Request, res: express.Response, kind: "read" | "write") {
    const resolved = await resolveAgent(req, res, "map.draft", kind);
    if (!resolved) return null;
    if (!hasCapability("map.edit", await capabilityCtx(resolved.user))) {
      res.status(403).json({
        error: "map_edit_required",
        message: "This token's holder may not draft the village map, so their agent may not either.",
      });
      return null;
    }
    return resolved;
  }

  /**
   * The holder's draft that is unpublished work, counted, or null.
   *
   * Its text's hash rides along, so the echo binds the exact work a yes
   * would replace: a founder who keeps editing between the two calls changes
   * the hash, the echo stops matching, and nothing is overwritten. Counts and
   * a timestamp alone would match across an edit made in the same second.
   */
  async function waitingDraft(userId: string) {
    const draft = await getDraft(getPool(), userId);
    if (!draft) return null;
    const live = await publishedScene(getPool());
    const pending = pendingDraft(draft, live?.scene);
    if (!pending) return null;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(pending.scene);
    } catch {
      /* Unreadable: counted as empty, and still work that would be replaced. */
    }
    return { ...counts(parsed), updatedAt: pending.updatedAt, sceneSha256: sha256(pending.scene) };
  }

  app.get(`${V1}/map`, async (req, res) => {
    const resolved = await mapMakerAgent(req, res, "read");
    if (!resolved) return;
    const origin = originOf(req);
    const plan = await currentMasterplan(getPool());
    const land = await publicLand(getPool());
    const spanM = typeof land.spanM === "number" && land.spanM > 0 ? land.spanM : null;
    res.json({
      method: fs.existsSync(METHOD_FILE) ? fs.readFileSync(METHOD_FILE, "utf8") : null,
      rules: DRAFT_RULES,
      masterplan: plan
        ? {
            url: `${origin}${plan.url}`,
            originalName: plan.originalName,
            kind: plan.kind,
            mimeType: plan.mimeType,
            bytes: plan.bytes,
            width: plan.width,
            height: plan.height,
            uploadedAt: plan.uploadedAt,
          }
        : null,
      ground: {
        configured: land.configured,
        spanM,
        metresPerUnit: spanM ? spanM / SCENE_WORLD.w : null,
        centre: land.centre,
        seedFrame: land.seedFrame,
        imageryUrl: land.imageryUrl ? `${origin}${land.imageryUrl}` : null,
      },
      schema: {
        version: DRAFT_SCENE_VERSION,
        world: SCENE_WORLD,
        maxBytes: MAX_SCENE_BYTES,
        archetypes: MAP_ARCHETYPES,
        featureKinds: FEATURE_KINDS,
        featureGeoms: FEATURE_GEOMS,
        phases: { 1: "built", 2: "building next", 3: "the long vision" },
        emptyBlocks: RECORD_BLOCKS,
        example: exampleDraft(),
      },
      live: { version: await publishedVersion(getPool()) },
      draft: await waitingDraft(resolved.user.id),
      submit: { method: "POST", url: `${origin}${V1}/map/draft` },
      reviewUrl: `${origin}/map`,
    });
  });

  app.post(`${V1}/map/draft`, async (req, res) => {
    const resolved = await mapMakerAgent(req, res, "write");
    if (!resolved) return;
    const { user, row } = resolved;

    // The scene as text, which is what is stored and what the echo hashes.
    const raw = req.body?.scene;
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw && typeof raw === "object") text = JSON.stringify(raw);
    else return res.status(400).json({ error: "scene_required", message: "Send the drafted scene as `scene`, an object or its JSON text. Nothing was written." });
    const tooBig = sceneSizeProblem(Buffer.byteLength(text, "utf8"));
    if (tooBig) return res.status(413).json({ error: "scene_too_big", message: tooBig });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(400).json({ error: "scene_not_json", message: "That scene is not valid JSON. Nothing was written." });
    }
    const problems = draftSceneProblems(parsed, text);
    if (problems.length) {
      return res.status(400).json({ error: "draft_refused", problems, message: "Nothing was written. Fix these and send the draft again." });
    }

    const liveVersion = await publishedVersion(getPool());
    const echo = {
      sceneSha256: sha256(text),
      ...counts(parsed),
      liveVersion,
      replaces: await waitingDraft(user.id),
    };

    if (req.body?.confirm !== true) {
      const { token, expiresAt } = mintConfirmToken(confirmSecret, { action: ACTION, userId: user.id, echo });
      return res.status(202).json({
        confirmRequired: true,
        confirmToken: token,
        echo,
        expiresAt,
        message: echo.replaces
          ? "Show the founder this echo and get a yes. It REPLACES the unpublished draft they already have. Then send the same scene back with confirm: true, the confirmToken and the echo. Nothing is written until then"
          : "Show the founder this echo and get a yes. Then send the same scene back with confirm: true, the confirmToken and the echo. Nothing is written until then",
      });
    }

    const check = verifyConfirmToken(confirmSecret, req.body?.confirmToken, { action: ACTION, userId: user.id, echo: req.body?.echo });
    if (!check.ok) return res.status(409).json({ error: check.reason, message: CONFIRM_REASON_SENTENCE[check.reason] });
    // The echo sent back verified against its token; it must also be what
    // THIS request would write, or a token for one scene could carry another.
    if (echoHash(req.body?.echo) !== echoHash(echo)) {
      return res.status(409).json({ error: "echo_mismatch", message: CONFIRM_REASON_SENTENCE.echo_mismatch });
    }

    await saveDraft(getPool(), user.id, text, liveVersion);
    await recordEvent(getPool(), {
      kind: "map_draft",
      text: `kept a drafted map from their agent (${row.prefix}...): ${echo.buildings} buildings, ${echo.features} features`,
      actorUserId: user.id,
      actorKind: "agent",
      entityType: "map_scene_draft",
      entityRef: user.id,
      audience: "admin",
    });
    res.json({
      success: true,
      echo,
      reviewUrl: `${originOf(req)}/map`,
      message: "Kept as the founder's draft. Nothing is live: they open the map, review the draft, and publish it.",
    });
  });
}
