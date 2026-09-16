/**
 * The map's own doors: the draft, the publish, the undo, and the walk.
 *
 * Eleven routes, lifted out of server/index.ts unchanged:
 *
 *   GET    /api/map/draft                     this member's working copy
 *   PUT    /api/map/draft                     autosave
 *   DELETE /api/map/draft                     throw the working copy away
 *   POST   /api/map/publish                   make a draft the live map
 *   GET    /api/map/revisions                 the history
 *   POST   /api/map/revisions/:version/restore  undo to one of them
 *   GET    /api/admin/map/walk-log            where the walk loses people
 *   GET    /api/admin/map/walk                the whole walk, every language
 *   PUT    /api/admin/map/walk                replace it
 *   GET    /api/admin/map/structures          the keys a walk step may point at
 *   PUT    /api/admin/map/vocabulary          what this village calls things
 *
 * WHY THIS IS ONE MODULE. The six scene routes share three helpers that exist
 * nowhere else (`mapHand`, `liveCard`, `readScene`) and one piece of
 * reasoning: the scene crosses this boundary as a STRING and is parsed only
 * to be CHECKED, so the bytes the map wrote are the bytes the next reader
 * gets. The five walk-and-vocabulary routes are the same surface's editor,
 * writing the two documents the published scene is read against.
 *
 * THE GATE IS HERE AND ONLY HERE, and the block comment below says why in
 * full: the map artifact is a static file anyone can open, so what it is told
 * to draw was never the permission. Every route asks the one gate itself.
 *
 * NOT BEHIND `requireModule("map")` IN THIS FILE. The `/api/map` prefix is
 * already gated where the map's public routes are registered, far earlier in
 * startServer, and the four `/api/admin/map` routes were never behind it.
 * Moving these bodies changes neither.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order:
 * after the photograph gallery, before the season routes.
 */
import type express from "express";
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import { WALK_GESTURES, sanitiseMapVocabulary, sanitiseWalk } from "../../shared/mapAddress";
import { changeSummary, sceneProblem, sceneSizeProblem, sceneSummary } from "../../shared/mapScene";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import {
  discardDraft,
  getDraft,
  listRevisions,
  publishScene,
  pendingDraft,
  publishedScene,
  publishedVersion,
  restoreRevision,
  saveDraft,
} from "../lib/mapScene";
import { walkReport } from "../lib/walkLog";

type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "capabilityCtx"
  | "guardCapability"
  | "isAdmin"
  | "mapVocabRepo"
  | "mapWalkRepo"
  | "members"
  | "getPool"
>;

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, guardCapability, isAdmin, mapVocabRepo, mapWalkRepo, members, getPool } = deps;

  /*
   * ── THE MAP'S OWN DOORS: draft, publish, undo (0063) ───────────────────
   *
   * THE GATE IS HERE AND ONLY HERE. `grounds-v0.html` is a static file served
   * at a URL anyone can open directly, so its Build button is decoration:
   * hiding it stops nobody, and the artifact could not be trusted to enforce
   * a permission even if it tried. Every one of these routes asks the one
   * gate itself. What the artifact gets told is what to DRAW, never what is
   * allowed.
   *
   * All of them sit under `/api/map`, so `requireModule("map")` already
   * covers them: 404 while the module is off, 401 for a signed-out visitor
   * while it is members-only.
   *
   * The scene crosses this boundary as a STRING, deliberately. It is parsed
   * here to be CHECKED and the original text is what gets stored, so the
   * bytes the map wrote are the bytes the next reader gets. Re-serialising a
   * parsed scene would reorder keys and re-space the text for no gain, and
   * the whole point of `shared/mapScene.ts` is that nothing between the map
   * and the column has an opinion about the body.
   */

  /**
   * What this member may do to the map, asked once per request.
   *
   * 0103: a LOOK, and it stays one. Both flags ride the pure gate with no
   * override read and no side effect, because the shell asks
   * `GET /api/map/draft` on every boot of every map to decide what to DRAW.
   * The two routes that ACT on `map.publish` ask `guardCapability` for
   * themselves below, and the map's own header already says why: the artifact
   * is a static file anyone can open, so what it is told to draw was never
   * the permission in the first place.
   *
   * An admin sees `canPublish: false` while the village holds the key, which
   * is the honest answer on a drawing hint. The 409 on the publish route is
   * where the operator is told how to go through anyway.
   */
  async function mapHand(req: express.Request) {
    const user = await authedUser(req);
    if (!user) return { user: null, canEdit: false, canPublish: false };
    const ctx = await capabilityCtx(user);
    return {
      user,
      canEdit: hasCapability("map.edit", ctx),
      canPublish: hasCapability("map.publish", ctx),
    };
  }

  /**
   * A published revision, dressed for reading: ids become names.
   *
   * `listRevisions` and NOT `publishedScene`, deliberately. This runs on every
   * boot of every map, and the scene is megabytes: fetching one to report a
   * version number and a name would put the whole published land on the wire
   * for a card that renders eleven words. The history query never selects the
   * body for exactly this reason.
   */
  async function liveCard(): Promise<Record<string, unknown> | null> {
    /*
     * TWO rows, because `previous` cannot be computed as version - 1.
     * `version` is AUTO_INCREMENT and a refused publish still consumes an id,
     * so a village where two admins ever raced has GAPS in its history. An
     * Undo button that guessed the number below would 404 on exactly the
     * villages busy enough to need it.
     */
    const [live, prev] = await listRevisions(getPool(), 2);
    if (!live) return null;
    const who = live.actorUserId ? await members.byId(live.actorUserId) : null;
    return {
      version: live.version,
      by: who?.name ?? null,
      at: live.createdAt,
      note: live.note,
      restoredFrom: live.restoredFrom,
      summary: live.summary,
      previous: prev?.version ?? null,
    };
  }

  /**
   * Take a scene off the wire: check it, and hand back the exact text.
   *
   * Returns the string to store, or the sentence to show the person. The
   * parse happens for validation only and its result is thrown away.
   */
  function readScene(body: any): { scene: string } | { error: string } {
    const raw = body?.scene;
    if (typeof raw !== "string") {
      return { error: "Send the scene as JSON text, so it can be stored exactly as the map wrote it." };
    }
    const sizeProblem = sceneSizeProblem(Buffer.byteLength(raw, "utf8"));
    if (sizeProblem) return { error: sizeProblem };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "That scene is not valid JSON." };
    }
    const problem = sceneProblem(parsed);
    if (problem) return { error: problem };
    return { scene: raw };
  }

  /**
   * The member's own working copy, plus what is live and what they may do.
   *
   * 200 for a signed-out visitor rather than 401, with everything false. The
   * shell asks this on every boot of every map, and the overwhelming majority
   * of those are visitors who will never edit anything. Answering "you may do
   * nothing, here is the live version" is the true answer and costs no error.
   */
  app.get("/api/map/draft", async (req, res) => {
    const { user, canEdit, canPublish } = await mapHand(req);
    const draft = user && canEdit ? await getDraft(getPool(), user.id) : null;
    // ONLY when there is something to compare. A scene is megabytes and this
    // runs on every boot of every map, the overwhelming majority of them
    // visitors with no draft at all. `liveCard` avoids the body for the same
    // reason and says so; this must not undo that on the common path.
    const live = draft ? await publishedScene(getPool()) : null;
    // A draft byte-identical to live is not unpublished work. The rule and
    // the reason live in `pendingDraft` (server/lib/mapScene.ts), beside the
    // rebase that creates the condition.
    const pending = pendingDraft(draft, live?.scene);
    res.json({
      canEdit,
      canPublish,
      live: await liveCard(),
      liveVersion: live?.version ?? (await publishedVersion(getPool())),
      draft: pending
        ? { scene: pending.scene, baseVersion: pending.baseVersion, updatedAt: pending.updatedAt }
        : null,
    });
  });

  /** Autosave. Private to this member and invisible to the live map. */
  app.put("/api/map/draft", async (req, res) => {
    const { user, canEdit } = await mapHand(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to keep a draft of the map." });
    if (!canEdit) return res.status(403).json({ error: "Shaping the map is a cartographer's work." });

    const read = readScene(req.body);
    if ("error" in read) return res.status(400).json({ error: read.error });

    const baseVersion = Number.isInteger(req.body?.baseVersion)
      ? Math.max(0, Number(req.body.baseVersion))
      : await publishedVersion(getPool());

    await saveDraft(getPool(), user.id, read.scene, baseVersion);
    res.json({ ok: true, baseVersion });
  });

  /** Throw away my draft. Never touches anyone else's, never touches live. */
  app.delete("/api/map/draft", async (req, res) => {
    const { user, canEdit } = await mapHand(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!canEdit) return res.status(403).json({ error: "Shaping the map is a cartographer's work." });
    res.json({ ok: true, discarded: await discardDraft(getPool(), user.id) });
  });

  /**
   * Make my draft the map everybody sees.
   *
   * The stale case is the one worth reading. Two admins each hold a draft
   * forked from version 5; the first publishes and the map becomes 6. The
   * second gets 409 with WHO moved it and WHEN, their draft untouched on
   * disk, and nothing written. That refusal is the entire reason
   * `base_version` is a UNIQUE column: a read-then-write here would have a
   * window, and the window is where a founder's afternoon disappears.
   *
   * A successful publish REBASES the member's draft instead of deleting it.
   * The work under their hands is the same work a second later, now forked
   * from what they just made live, so pressing publish twice in a row is
   * harmless and nothing vanishes at the moment they were told it worked.
   */
  app.post("/api/map/publish", async (req, res) => {
    const { user } = await mapHand(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to publish the map." });
    // 0103: ACT, and the sharpest one this key gates. One press puts a new
    // shape of the land in front of every visitor at once. `readScene` reads
    // `scene` and `baseVersion` only, so an `override` in the body reaches
    // nothing but the hatch.
    const mayPublish = await guardCapability(req, res, "map.publish", {
      status: 403,
      body: { error: "Publishing the map is a cartographer's work. Your draft is safe and still yours." },
    });
    if (!mayPublish) return;

    const read = readScene(req.body);
    if ("error" in read) return res.status(400).json({ error: read.error });

    const baseVersion = Number.isInteger(req.body?.baseVersion)
      ? Math.max(0, Number(req.body.baseVersion))
      : 0;
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;
    const parsed = JSON.parse(read.scene);

    const result = await publishScene(getPool(), {
      scene: read.scene,
      baseVersion,
      actorUserId: user.id,
      note,
      summary: changeSummary(parsed, 40),
    });

    if (!result.ok) {
      const who = result.live.actorUserId ? await members.byId(result.live.actorUserId) : null;
      return res.status(409).json({
        ok: false,
        reason: "stale",
        error: who?.name
          ? `${who.name} published a change to the live map while you were working. Your draft is safe. Take a look at what moved, then publish again.`
          : "The live map changed while you were working. Your draft is safe. Take a look at what moved, then publish again.",
        live: { version: result.live.version, by: who?.name ?? null, at: result.live.createdAt },
      });
    }

    // Rebase, so the draft they are still looking at is forked from the map
    // they just made live.
    await saveDraft(getPool(), user.id, read.scene, result.version);

    const counts = sceneSummary(parsed);
    await recordEvent(getPool(), {
      kind: "map_published",
      text: `made version ${result.version} of the living map the one everyone sees (${counts.buildings} buildings)`,
      actorUserId: user.id,
      entityType: "map_scene",
      entityRef: String(result.version),
      // The shape of the land is public news, the same way a new gathering is.
      audience: "public",
    });

    res.json({ ok: true, version: result.version, live: await liveCard() });
  });

  /**
   * What has been made live, and by whom.
   *
   * Gated on `map.edit` and not on publishing: someone trusted to draft a
   * change needs to see what the land has already been through to draft a
   * sensible one. The scenes themselves never travel in this list.
   */
  app.get("/api/map/revisions", async (req, res) => {
    const { user, canEdit } = await mapHand(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!canEdit) return res.status(403).json({ error: "Forbidden" });

    const rows = await listRevisions(getPool(), 50);
    const names = new Map<string, string>();
    for (const r of rows) {
      if (r.actorUserId && !names.has(r.actorUserId)) {
        const who = await members.byId(r.actorUserId);
        names.set(r.actorUserId, who?.name ?? "");
      }
    }
    res.json({
      liveVersion: rows[0]?.version ?? 0,
      revisions: rows.map((r) => ({
        version: r.version,
        by: r.actorUserId ? names.get(r.actorUserId) || null : null,
        at: r.createdAt,
        note: r.note,
        restoredFrom: r.restoredFrom,
        summary: r.summary,
      })),
    });
  });

  /**
   * Put an earlier version back.
   *
   * An undo is a publish carrying an old scene, so it needs the same key and
   * settles the same race. Nothing is deleted and nothing is rewritten: the
   * version that was live a moment ago is still in the history, which is what
   * makes this safe to press when you are not certain.
   */
  app.post("/api/map/revisions/:version/restore", async (req, res) => {
    const { user } = await mapHand(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    // 0103: ACT. An undo is a publish carrying an old scene, so it takes the
    // same key through the same door.
    const mayRestore = await guardCapability(req, res, "map.publish", {
      status: 403,
      body: { error: "Putting an earlier map back is a cartographer's work." },
    });
    if (!mayRestore) return;
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ error: "That is not a version number." });
    }

    const result = await restoreRevision(getPool(), version, user.id);
    if (!result.ok && result.reason === "missing") {
      return res.status(404).json({ error: `There is no version ${version} to put back.` });
    }
    if (!result.ok) {
      return res.status(409).json({
        ok: false,
        reason: "stale",
        error: "The live map changed a moment ago. Take a look at what moved, then try again.",
      });
    }

    await recordEvent(getPool(), {
      kind: "map_restored",
      text: `put version ${version} of the living map back`,
      actorUserId: user.id,
      entityType: "map_scene",
      entityRef: String(version),
      audience: "public",
    });

    res.json({ ok: true, version: result.version, live: await liveCard() });
  });

  /** Where the walk loses people. The reason the table exists. */
  app.get("/api/admin/map/walk-log", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const source = ["live", "import", "all"].includes(String(req.query.source))
      ? (req.query.source as "live" | "import" | "all")
      : "all";
    res.json(await walkReport(getPool(), { source, days: Number(req.query.days) || 90 }));
  });

  /** The whole walk document, every language, for the editor. */
  app.get("/api/admin/map/walk", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ walk: sanitiseWalk(mapWalkRepo.get()), gestures: WALK_GESTURES });
  });

  app.put("/api/admin/map/walk", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const next = sanitiseWalk(req.body?.walk ?? req.body);
    await mapWalkRepo.put(next as any);
    res.json({ success: true, walk: next });
  });

  /**
   * The structure keys a walk step can point at.
   *
   * Sourced from the circles and seats the village has actually addressed
   * (0060), so the editor offers real places instead of a free-text field
   * where a typo becomes a step that never fires.
   */
  app.get("/api/admin/map/structures", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const [rows] = await getPool().query<any[]>(
      `SELECT DISTINCT k FROM (
         SELECT home_structure_key AS k FROM circles WHERE home_structure_key IS NOT NULL
         UNION SELECT structure_key FROM org_roles WHERE structure_key IS NOT NULL
         UNION SELECT structure_key FROM quests WHERE structure_key IS NOT NULL
       ) t WHERE k <> '' ORDER BY k`,
    );
    res.json({ structures: rows.map((r) => String(r.k)) });
  });

  app.put("/api/admin/map/vocabulary", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const next = sanitiseMapVocabulary(req.body?.vocabulary ?? req.body);
    await mapVocabRepo.put(next as any);
    res.json({ success: true, vocabulary: next });
  });
}
