/**
 * Training modules: the public list, and the admin CRUD behind it.
 *
 * Moved out of server/index.ts verbatim. Five registrations, contiguous, with
 * ZERO inline SQL: every read and write goes through the training collection
 * repository. The two names in the Deps slice below are the complete list of
 * what these routes can reach, which is the point of the move.
 *
 * `isAdmin` arrives through deps rather than by import so it stays the real
 * one, which marks the request for the DEFAULT-DENY middleware under
 * /api/admin (server/lib/adminGate.ts). A hand-rolled gate here would pass a
 * review and then turn every one of these admin routes into a 403.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { completionsFor, recordCompletion, serverOwnedJourneyRefusal } from "../lib/trainingRecord";

type Deps = Pick<AppDeps, "isAdmin" | "trainingRepo" | "authedUser" | "getPool" | "members">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, trainingRepo, authedUser, getPool, members } = deps;

  app.get("/api/training-modules", async (_req, res) => {
    const mods: any[] = trainingRepo.all();
    mods.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json(mods);
  });

  /**
   * MARK ONE MODULE COMPLETE. The server records it, and the server says when.
   *
   * This replaces the half of `POST /api/game/journey/sync` that gated a stage.
   * That route took a whole LIST and stored it unchecked, so a member advanced
   * their own rung by posting one. The ids were never secret: the list above is
   * public by design, and it should stay public, because knowing an id is worth
   * nothing once the record is the server's.
   *
   * ONE module per request, by an id that must name a real one, stamped with an
   * instant nobody sends. Idempotent, so a double click is one row and does not
   * move the date a module was first finished.
   */
  app.post("/api/game/training/:moduleId/complete", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const moduleId = String(req.params.moduleId ?? "");
    // The catalogue is the authority on what exists. An id it does not know is
    // refused by name, because "that module does not exist" is a different
    // thing from "you have not done it" and a member is owed the difference.
    if (!trainingRepo.all().some((m: any) => String(m.id) === moduleId)) {
      return res.status(404).json({ error: `No training module with id "${moduleId}".` });
    }
    await recordCompletion(getPool(), user.id, moduleId);
    res.json({ completed: await completionsFor(getPool(), user.id) });
  });

  /** What this member has finished, as the server recorded it. */
  app.get("/api/game/training/completed", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json({ completed: await completionsFor(getPool(), user.id) });
  });

  /**
   * JOURNEY PROGRESS, and it lives here because of what it may no longer do.
   *
   * It stores whatever list a member sends, which is right for a journey that
   * gates nothing and was a stage promotion for the one that did. The door
   * that refuses `training` is `serverOwnedJourneyRefusal`, so the route and
   * the record that replaced half of it now sit in one place rather than at
   * opposite ends of the monolith.
   */
  app.post("/api/game/journey/sync", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const { journeyId, steps } = req.body ?? {};
    if (!journeyId || !Array.isArray(steps)) return res.status(400).json({ error: "Missing journeyId or steps" });
    // Training is the server's record now; see `serverOwnedJourneyRefusal`.
    const journeyRefusal = serverOwnedJourneyRefusal(journeyId);
    if (journeyRefusal) return void res.status(409).json(journeyRefusal);
    const updated = await members.update(user.id, (u: any) => {
      if (!u.journeys) u.journeys = {};
      u.journeys[journeyId] = steps.map(String);
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, journeys: updated.journeys });
  });

  app.get("/api/admin/training-modules", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const mods: any[] = trainingRepo.all();
    mods.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json(mods);
  });

  app.post("/api/admin/training-modules", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const { title, description, type, url, order } = req.body ?? {};
    if (!title || !type) return res.status(400).json({ error: "Missing title or type" });
    const mods: any[] = trainingRepo.all();
    const entry = {
      id: `mod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      description: description ?? "",
      type,
      url: url ?? "",
      order: typeof order === "number" ? order : mods.length + 1,
    };
    mods.push(entry);
    await trainingRepo.replaceAll(mods);
    res.json(entry);
  });

  app.put("/api/admin/training-modules/:id", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const mods: any[] = trainingRepo.all();
    const idx = mods.findIndex((m) => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const allowed = ["title", "description", "type", "url", "order"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) mods[idx][key] = req.body[key];
    }
    await trainingRepo.replaceAll(mods);
    res.json(mods[idx]);
  });

  app.delete("/api/admin/training-modules/:id", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({ error: "auth_required" });
    }
    const mods: any[] = trainingRepo.all();
    const filtered = mods.filter((m) => m.id !== req.params.id);
    if (filtered.length === mods.length) return res.status(404).json({ error: "Not found" });
    await trainingRepo.replaceAll(filtered);
    res.json({ success: true });
  });
}
