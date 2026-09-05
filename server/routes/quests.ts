/**
 * Quests: the public board, the share card, crews, the admin CRUD, and the
 * two steps a member takes through a quest.
 *
 * Thirteen routes, lifted out of server/index.ts unchanged:
 *
 *   board     GET  /api/quests
 *             GET  /api/quests/field
 *             GET  /api/quests/:id
 *             GET  /api/og/quest/:id
 *   crews     GET  /api/quests/:id/crews
 *             POST /api/quests/:id/crews
 *             POST /api/crews/join/:code
 *             POST /api/crews/:id/leave
 *   admin     POST   /api/admin/quests
 *             PUT    /api/admin/quests/:id
 *             DELETE /api/admin/quests/:id
 *   the walk  POST /api/game/quests/:id/claim
 *             POST /api/game/quests/:id/submit
 *
 * ORDER INSIDE THIS FILE IS LOAD-BEARING, and one pair especially:
 * `/api/quests/field` is registered BEFORE `/api/quests/:id`, so the literal
 * path keeps winning over the parameter. The route's own comment says so.
 * Sorting this file alphabetically would make `field` a quest id that does
 * not exist. `register()` is likewise called at exactly the point the run
 * occupied in server/index.ts.
 *
 * CREWS RIDE WITH QUESTS rather than getting their own file. A crew exists
 * for one quest, is created at `/api/quests/:id/crews`, and dies with it.
 * Splitting them would have meant two register() calls interleaved at one
 * point to keep the order, which is more machinery than the boundary earns.
 *
 * NOTHING IN THE CREW ROUTES TOUCHES VALUE. Members of a crew still claim,
 * submit and are consented individually, so a crew cannot become a way to
 * move recognition around the human gate. The section comment below carries
 * the rest of that reasoning.
 *
 * THE OG CARD'S TWO DIMENSIONS ARE EXPORTED, not passed in. They moved here
 * with the renderer that uses them, and server/index.ts imports them back for
 * the `og:image:width` and `og:image:height` meta tags on the share page.
 * Same shape as FAQ_PATHWAYS in server/routes/faqs.ts: the domain that
 * defines a value owns it, and the host reads it from there.
 *
 * `uploadsDir` ARRIVES UNDER ITS OLD NAME. The share-card route reads
 * `UPLOADS_DIR`, which is what the constant is called in server/index.ts, and
 * the destructure below renames rather than the fifteen lines of handler.
 * Renaming inside a move is how a behaviour change hides in a diff.
 */
import type express from "express";
import type { Express } from "express";
import fs from "fs";
import path from "path";
import type { AppDeps } from "../lib/appDeps";
import { getStage, stageIndex } from "../../shared/gameConfig";
import { sceneStopsFor } from "../../shared/questScenes";
import { cleanCrewName } from "../lib/crews";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY, isExampleRow, onRealItemPublished } from "../lib/examples";
import {
  addMembers as addConversationMembers,
  createGroup,
  leaveConversation,
} from "../lib/messaging";
import { effectiveLifecycle } from "../lib/modules";
import { captureIntoCurrentPattern } from "../lib/seasonPatterns";

/** The share-card raster. 1200x630 is what every major unfurler crops to. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

type Deps = Pick<
  AppDeps,
  | "isAdmin"
  | "authedUser"
  | "adminActor"
  | "getPool"
  | "uploadsDir"
  | "members"
  | "questsRepo"
  | "claimsRepo"
  | "crewsRepo"
  | "firstName"
  | "notify"
  | "stageOf"
  | "loadRoles"
  | "roleIdsFor"
  | "currentPatternId"
  | "questConsentRecipients"
  | "overLimit"
  | "clientIp"
>;

export function register(app: Express, deps: Deps): void {
  const {
    isAdmin,
    authedUser,
    adminActor,
    getPool,
    uploadsDir: UPLOADS_DIR,
    members,
    questsRepo,
    claimsRepo,
    crewsRepo,
    firstName,
    notify,
    stageOf,
    loadRoles,
    roleIdsFor,
    currentPatternId,
    questConsentRecipients,
    overLimit,
    clientIp,
  } = deps;

  // Quests: public list
  app.get("/api/quests", async (_req, res) => {
    res.json(await questsRepo.all());
  });

  /**
   * Life signs for the quest board (public): how many members hold each quest
   * right now, how many times each has been consented, and the latest
   * completions. Every count here is a consent-gated fact, never a promise.
   * Standing examples are filtered on both sides: an example quest's claims
   * are refused at claim time, and an example member never reaches the feed,
   * so a fresh fork's board shows life only once real people do real work.
   * First names only, the same rule the roles page follows on public surfaces.
   */
  app.get("/api/quests/field", async (_req, res) => {
    // Two aggregate queries, not three full table loads. The first version
    // read every quest, every claim and every member on each request and
    // filtered in JavaScript to produce a count map and eight rows. That is a
    // full scan of quest_claims per page view, and quest pages are public, so
    // a crawler walking the board paid it once per quest.
    const [counts, recent] = await Promise.all([
      claimsRepo.fieldCounts(),
      claimsRepo.recentConsented(8),
    ]);
    const perQuest: Record<string, { active: number; done: number }> = {};
    counts.forEach((slot, questId) => {
      perQuest[questId] = slot;
    });
    res.json({
      perQuest,
      recent: recent.map((r) => ({
        questId: r.questId,
        questTitle: r.questTitle,
        name: firstName(r.userName),
        when: r.when,
      })),
    });
  });

  /**
   * One quest, by id. The detail page used to pull the whole board and find
   * its quest on the client, which meant every deep link carried every other
   * quest's story, steps and tips. Registered AFTER /api/quests/field so the
   * literal path keeps winning over this parameter.
   */
  app.get("/api/quests/:id", async (req, res) => {
    const id = String(req.params.id);
    const all = await questsRepo.all();
    const quest = all.find((q) => q.id === id) ?? null;
    if (!quest) return res.status(404).json({ error: "No such quest" });
    // Three more from the same circle, resolved here so the page never ships
    // the whole board to show a strip of three. A quest only sits beside its
    // own kind: an example never poses as real work, and a closed quest is not
    // an invitation.
    const related = all
      .filter(
        (q) =>
          q.id !== quest.id &&
          Boolean(q.isExample) === Boolean(quest.isExample) &&
          String(q.status ?? "").trim().toLowerCase() === "open" &&
          Boolean(q.circle) &&
          q.circle === quest.circle,
      )
      .slice(0, 3);
    res.json({ quest, related });
  });

  /**
   * The share card for a quest (public, 1200x630).
   *
   * No text is drawn into the image on purpose. Rendering type through sharp
   * means resvg finding a font, and this platform ships its typefaces as woff2
   * bundled for the browser, not installed for the renderer. On a slim deploy
   * image the text would silently come out blank, which is worse than a card
   * without it. The title and the description ride in the meta tags instead,
   * and every platform that shows a card shows those beside the image.
   */
  /*
   * Rendering is CPU work on a public endpoint, and the output only changes
   * when the poster does. A crawler walking the board would otherwise pay for
   * a fresh raster per quest per visit. Keyed on the poster path so setting a
   * new one in Admin invalidates by itself, and bounded so it can never grow
   * into a leak on a village with hundreds of quests.
   */
  const ogCache = new Map<string, Buffer>();
  const OG_CACHE_MAX = 64;

  app.get("/api/og/quest/:id", async (req, res) => {
    const quest = await questsRepo.byId(String(req.params.id));
    if (!quest) return res.status(404).json({ error: "No such quest" });
    const cacheKey = `${quest.id}|${quest.imageUrl ?? ""}|${quest.circle ?? ""}`;
    const hit = ogCache.get(cacheKey);
    if (hit) {
      return res.type("jpeg").set("Cache-Control", "public, max-age=3600").send(hit);
    }
    /*
     * THE BOUND SITS AFTER THE CACHE, ON PURPOSE.
     *
     * This is the only route on the board that rasters an image for somebody
     * with no account, and `sharp` is the most expensive thing the process
     * does per request. The cache above makes a repeat fetch free, so a real
     * crawler walking the board pays this once per quest and is never
     * counted. What the bound catches is the miss flood: a caller cycling
     * ids, or cache keys, to make the village raster on demand. 120 an hour
     * is more posters than any village has.
     *
     * 429 with Retry-After, and NOT a redirect to a default poster: there is
     * no default poster in `client/public` to redirect to, and inventing one
     * would spend the image budget to make a rate limit look prettier. A
     * crawler that is over 120 misses an hour is not a social platform
     * fetching one card.
     */
    if (await overLimit(`og-quest:${clientIp(req)}`, 120, 60 * 60 * 1000)) {
      return res
        .status(429)
        .set("Retry-After", "600")
        .json({ error: "Too many poster requests. Try again shortly." });
    }
    const sharp = (await import("sharp")).default;
    // basename and nothing else: image_url is admin-typed and this reads disk.
    const url = String(quest.imageUrl ?? "");
    const file = url.startsWith("/api/uploads/")
      ? path.join(UPLOADS_DIR, path.basename(url))
      : "";
    const svg = (inner: string) =>
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">${inner}</svg>`,
      );
    let base: Buffer;
    if (file && fs.existsSync(file)) {
      base = await sharp(file).resize(OG_WIDTH, OG_HEIGHT, { fit: "cover" }).toBuffer();
    } else {
      const [from, to] = sceneStopsFor(quest.circle);
      base = await sharp(
        svg(
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0" stop-color="${from.hex}"/><stop offset="1" stop-color="${to.hex}"/>` +
            `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`,
        ),
      )
        .png()
        .toBuffer();
    }
    // The same scrim the card wears, so a platform that overlays its own text
    // at the bottom has something to sit on.
    const scrim = svg(
      `<defs><linearGradient id="s" x1="0" y1="1" x2="0" y2="0">` +
        `<stop offset="0" stop-color="#000000" stop-opacity="0.5"/>` +
        `<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>` +
        `</linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/>`,
    );
    // JPEG, not PNG. The same card came out at 1278 KB as a PNG and 96 KB as a
    // quality-82 JPEG, indistinguishable to the eye on painterly art, because
    // PNG is lossless and these are photographs in all but origin. CI caps any
    // single shipped image at 400 KB for a village on a phone in rural Costa
    // Rica; a share card generated at three times that would have been the one
    // image nobody measured.
    const card = await sharp(base)
      .composite([{ input: scrim }])
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    // Oldest out first. A Map iterates in insertion order, so the first key is
    // the coldest one.
    if (ogCache.size >= OG_CACHE_MAX) {
      const oldest = ogCache.keys().next();
      if (!oldest.done) ogCache.delete(oldest.value);
    }
    ogCache.set(cacheKey, card);
    res.type("jpeg").set("Cache-Control", "public, max-age=3600").send(card);
  });

  /*
   * QUEST CREWS (0067).
   *
   * Every crew route requires a signed-in member, including the read. A quest
   * page is public and indexable, and who is walking a quest with whom is not
   * something a crawler gets to index. The public page shows the quest; the
   * crew panel appears once somebody is inside.
   *
   * Nothing here touches value. Members of a crew still claim, submit and are
   * consented to individually, so a crew cannot become a way to move
   * recognition without the human gate.
   */
  const CREW_MAX_SIZE = 12;

  /**
   * A crew gets a thread when, and only when, the village runs messaging.
   *
   * Quests is a core module and cannot be switched off; messaging is not, and
   * ships off. So a crew has to be whole without one: the roster is the crew,
   * and the conversation is a room it gains if the village has rooms. Every
   * call here is best-effort for the same reason, because failing to open a
   * chat must never fail the act of forming a crew, and a village that turns
   * messaging off later keeps its crews and simply loses the rooms.
   */
  const messagingOn = () => effectiveLifecycle("messaging") !== "off";

  async function openCrewThread(
    crew: { id: string; name: string; questId: string },
    founderId: string,
  ) {
    if (!messagingOn()) return;
    try {
      const conversation = await createGroup(getPool(), {
        createdBy: founderId,
        name: crew.name,
        memberIds: [founderId],
        kind: "crew",
        contextType: "quest",
        contextId: crew.questId,
      });
      await crewsRepo.attachConversation(crew.id, conversation.id);
    } catch (e) {
      console.error("[crews] could not open a thread for", crew.id, e);
    }
  }

  async function addToCrewThread(conversationId: string | null, userId: string) {
    if (!conversationId || !messagingOn()) return;
    try {
      await addConversationMembers(getPool(), conversationId, [userId]);
    } catch (e) {
      console.error("[crews] could not add", userId, "to", conversationId, e);
    }
  }
  /** First names only, the rule every public-facing member surface follows. */
  async function crewShape(crew: any) {
    const names = await Promise.all(
      crew.members.map(async (m: any) => {
        const u: any = await members.byId(m.userId);
        return { role: m.role, name: firstName(String(u?.name ?? "")) };
      }),
    );
    return {
      id: crew.id,
      questId: crew.questId,
      name: crew.name,
      status: crew.status,
      maxSize: crew.maxSize,
      size: crew.members.length,
      conversationId: crew.conversationId,
      members: names,
    };
  }

  app.get("/api/quests/:id/crews", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to see crews" });
    const crews = await crewsRepo.forQuest(String(req.params.id));
    const shaped = await Promise.all(crews.map(crewShape));
    // The invite code goes ONLY to members of that crew. It is a capability to
    // join, so it travels to people a member chose, never to everyone who can
    // read the page.
    const mine = new Set(
      crews.filter((c) => c.members.some((m) => m.userId === user.id)).map((c) => c.id),
    );
    res.json(
      shaped.map((c, i) => ({
        ...c,
        joined: mine.has(c.id),
        inviteCode: mine.has(c.id) ? crews[i].inviteCode : undefined,
      })),
    );
  });

  app.post("/api/quests/:id/crews", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to form a crew" });
    const quest: any = await questsRepo.byId(String(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    const name = cleanCrewName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Give the crew a name" });
    const maxSize = Math.max(2, Math.min(CREW_MAX_SIZE, Number(req.body?.maxSize) || 5));
    const crew = await crewsRepo.create({
      id: `crew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      questId: quest.id,
      name,
      creatorId: user.id,
      maxSize,
    });
    await openCrewThread(crew, user.id);
    const fresh = (await crewsRepo.byId(crew.id)) ?? crew;
    res.json({ ...(await crewShape(fresh)), joined: true, inviteCode: crew.inviteCode });
  });

  app.post("/api/crews/join/:code", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to join a crew" });
    const crew = await crewsRepo.byInvite(String(req.params.code));
    if (!crew || crew.status === "disbanded") {
      return res.status(404).json({ error: "That invite is no longer open" });
    }
    const outcome = await crewsRepo.join(crew.id, user.id);
    if (outcome === "full") return res.status(409).json({ error: "That crew is full" });
    if (outcome === "gone") return res.status(404).json({ error: "That invite is no longer open" });
    if (outcome === "joined") await addToCrewThread(crew.conversationId, user.id);
    const fresh = await crewsRepo.byId(crew.id);
    res.json({
      ...(await crewShape(fresh)),
      joined: true,
      inviteCode: fresh!.inviteCode,
      questId: crew.questId,
      already: outcome === "already",
    });
  });

  app.post("/api/crews/:id/leave", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const before = await crewsRepo.byId(String(req.params.id));
    const outcome = await crewsRepo.leave(String(req.params.id), user.id);
    if (outcome !== "not-a-member" && before?.conversationId && messagingOn()) {
      // Leaving the crew leaves its room. A thread you can still read after
      // walking out is a privacy bug wearing a convenience hat.
      try {
        await leaveConversation(getPool(), before.conversationId, user.id);
      } catch (e) {
        console.error("[crews] could not remove", user.id, "from", before.conversationId, e);
      }
    }
    if (outcome === "not-a-member") {
      return res.status(404).json({ error: "You are not in that crew" });
    }
    res.json({ left: true, disbanded: outcome === "disbanded" });
  });

  // Quests: admin CRUD
  // A quest poster follows the same rule the forum already enforces on its
  // image field: it comes through the village's own upload. An off-site URL on
  // a page this public hands every visitor's address to a third party, and a
  // village that self-hosts would be serving bytes it does not own.
  const rejectOffsiteImage = (
    value: unknown,
    res: express.Response,
  ): boolean => {
    if (value == null) return false;
    const url = String(value).trim();
    if (url === "" || url.startsWith("/api/uploads/")) return false;
    res.status(400).json({ error: "Images must come through the village's own upload" });
    return true;
  };

  app.post("/api/admin/quests", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { title } = req.body ?? {};
    if (!title) return res.status(400).json({ error: "Missing title" });
    if (rejectOffsiteImage(req.body?.imageUrl, res)) return;
    const count = (await questsRepo.all()).length;
    const entry = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      order: count + 1,
      icon: "Star",
      status: "Open",
      difficulty: "Beginner",
      tags: [],
      gratitude: "",
      ...req.body,
    };
    await questsRepo.add(entry);
    onRealItemPublished(getPool(), "quests", adminActor(req)?.id ?? null);
    // A quest posted during a season belongs to that season's pattern, so it
    // returns with it next year. No-op for a village with no pattern running.
    await captureIntoCurrentPattern(getPool(), currentPatternId(), "quest", entry.id);
    res.json(entry);
  });

  app.put("/api/admin/quests/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // Editing an example into a real quest would launder it: the row keeps
    // is_example, so retirement would later delete the admin's own work.
    if (await isExampleRow(getPool(), "quests", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    if (rejectOffsiteImage(req.body?.imageUrl, res)) return;
    const updated = await questsRepo.update(req.params.id, (q: any) => {
      Object.assign(q, req.body, { id: q.id });
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/admin/quests/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // quests is a CORE module, so on a fresh fork the whole board is examples
    // and deleting them one by one empties the page without stamping a
    // tombstone: refreshRowPresence only runs at boot, on a seed and on a
    // retirement, so the banner sits over nothing until the next restart.
    // "Clear examples" in Admin is the supported way to be rid of them.
    if (await isExampleRow(getPool(), "quests", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    // SETTLE FIRST, the same rule openStateCheck applies to modules: a claim
    // in flight is work someone is doing or has already submitted, and
    // deleting the quest out from under it strands the claim (badges and
    // health both still join against it) with nothing left to consent.
    const open = (await claimsRepo.all()).filter(
      (c) => c.questId === req.params.id && (c.status === "claimed" || c.status === "submitted"),
    );
    if (open.length) {
      return res.status(409).json({
        error: `${open.length} member(s) have this quest in flight. Consent or decline those claims first. Deleting it now would strand their work.`,
        openClaims: open.length,
      });
    }
    const removed = await questsRepo.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: "Not found" });
    void recordEvent(getPool(), {
      kind: "audit", text: `quest:deleted:${req.params.id}`,
      actorUserId: (await authedUser(req))?.id ?? adminActor(req)?.id ?? null,
      entityType: "quest", entityRef: req.params.id, audience: "admin",
    });
    res.json({ success: true });
  });

  // Quests: claim / submit (player)
  app.post("/api/game/quests/:id/claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to claim quests" });
    const quest: any = await questsRepo.byId(req.params.id);
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    // Consent on a claimed quest mints recognition from the faucet, grants
    // stay credits and advances a stage. Refusing the CLAIM closes that whole
    // chain, because consent cannot happen without one.
    if (await isExampleRow(getPool(), "quests", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }

    // Progression gates (revision 2, step 3). Structured fields enforce; the
    // legacy free-text `roleRequired` stays display-only prose. Refusals name
    // exactly what is missing, because "computer says no" teaches nothing.
    if (quest.minStage) {
      const needed = stageIndex(quest.minStage);
      if (needed >= 0 && stageIndex(await stageOf(user)) < needed) {
        const stage = getStage(quest.minStage);
        return res.status(403).json({
          error: `This quest opens at the ${stage?.name ?? quest.minStage} stage. Keep walking the path and it will unlock.`,
          minStage: quest.minStage,
        });
      }
    }
    if (quest.requiresRole) {
      const role = loadRoles().find((r) => r.id === quest.requiresRole);
      if (!roleIdsFor(user.id).includes(quest.requiresRole)) {
        return res.status(403).json({
          error: `This quest is reserved for ${role?.name ?? quest.requiresRole}. Ask a founder about joining.`,
          requiresRole: quest.requiresRole,
        });
      }
    }

    const mine = await claimsRepo.forUser(user.id);
    const existing = mine.find((c) => c.questId === quest.id && c.status !== "declined");
    if (existing) return res.status(409).json({ error: "Already claimed", claim: existing });
    const claim = {
      id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      questId: quest.id,
      questTitle: quest.title,
      userId: user.id,
      userName: user.name,
      status: "claimed" as const, // claimed -> submitted -> consented | declined
      claimedAt: new Date().toISOString(),
      artifactUrl: "",
      note: "",
    };
    await claimsRepo.add(claim);
    res.json(claim);
  });

  app.post("/api/game/quests/:id/submit", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const { artifactUrl, note } = req.body ?? {};
    if (!artifactUrl && !note) return res.status(400).json({ error: "Share a link or a few words as evidence of your work" });
    const mine = await claimsRepo.forUser(user.id);
    const active = mine.find((c) => c.questId === req.params.id && (c.status === "claimed" || c.status === "submitted"));
    if (!active) return res.status(404).json({ error: "No active claim for this quest" });
    // Also guarded here, not only on claim: a claim made before this shipped
    // must not be walkable through to consent.
    if (await isExampleRow(getPool(), "quests", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const updated = await claimsRepo.update(active.id, (c) => {
      c.status = "submitted";
      c.artifactUrl = artifactUrl ?? "";
      c.note = note ?? "";
      c.submittedAt = new Date().toISOString();
    });
    /*
     * SWEEP (the incomplete loop). The claim moved to `submitted` and the
     * route returned. Nobody who can consent was told, so a member who
     * finished work waited on a steward happening to open a panel, and the
     * one step that releases value in this game is the step that stalled.
     *
     * KEYED ON THE CLAIM, suffixed per recipient: each consenter is summoned
     * once for this piece of work, and a member who resubmits a corrected
     * link (the route accepts a second submit on an already-submitted claim)
     * does not ring the same steward again. The dedupe key is the guarantee,
     * not the caller's care.
     *
     * The doer is skipped when they can consent themselves. Nobody needs
     * summoning to work they just handed in.
     *
     * WHAT IT CARRIES: who and which quest, both of which the recipient can
     * already read in the queue, and nothing the member wrote. The note and
     * the artifact link are the member's own account of their work and belong
     * behind the gate, not on a lock screen.
     */
    const questTitle = String(active.questTitle ?? "a quest");
    for (const recipientId of await questConsentRecipients()) {
      if (recipientId === user.id) continue;
      await notify({
        userId: recipientId,
        type: "quest_submitted",
        title: `${firstName(user.name)} submitted work on ${questTitle}`,
        body: "Read what they did and consent when you are ready. Value moves when a steward says so.",
        link: "/admin?tab=quest-claims",
        dedupeKey: `quest-submission:${active.id}:${recipientId}`,
      });
    }
    res.json(updated);
  });
}
