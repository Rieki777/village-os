/**
 * Roadmap milestones: the public list, and the admin CRUD behind it.
 *
 * Moved out of server/index.ts verbatim. Five registrations, contiguous, with
 * ZERO inline SQL: every read and write goes through the milestones collection
 * repository. The three names in the Deps slice below are the complete list of
 * what these routes can reach.
 *
 * Note the two different gates, preserved exactly as they were: the admin READ
 * takes `isAdmin`, the three WRITES take `guardCapability(req, res,
 * "story.tell")`. That asymmetry is deliberate in the original and is not this
 * lane's to tidy.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";

type Deps = Pick<AppDeps, "isAdmin" | "guardCapability" | "milestonesRepo">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, guardCapability, milestonesRepo } = deps;

  app.get("/api/milestones", async (_req, res) => {
    const mils: any[] = milestonesRepo.all();
    mils.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json(mils);
  });

  app.get("/api/admin/milestones", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const mils: any[] = milestonesRepo.all();
    mils.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    res.json(mils);
  });

  app.post("/api/admin/milestones", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const { phase, title, description, status, completedDate, updateNote, order } = req.body ?? {};
    if (!title || !phase) return res.status(400).json({ error: "Missing title or phase" });
    const mils: any[] = milestonesRepo.all();
    const entry = {
      id: `mil-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      phase,
      title,
      description: description ?? "",
      status: status ?? "upcoming",
      completedDate: completedDate ?? null,
      updateNote: updateNote ?? "",
      order: typeof order === "number" ? order : mils.length + 1,
      updatedAt: new Date().toISOString(),
    };
    mils.push(entry);
    await milestonesRepo.replaceAll(mils);
    res.json(entry);
  });

  app.put("/api/admin/milestones/:id", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const mils: any[] = milestonesRepo.all();
    const idx = mils.findIndex((m) => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const allowed = ["phase", "title", "description", "status", "completedDate", "updateNote", "order"];
    let touched = false;
    for (const k of allowed) {
      if (req.body[k] !== undefined && mils[idx][k] !== req.body[k]) { mils[idx][k] = req.body[k]; touched = true; }
    }
    // Stamped so the admin can surface milestones nobody has looked at in weeks —
    // a board goes stale silently otherwise (see "Founding Team Assembled").
    if (touched) mils[idx].updatedAt = new Date().toISOString();
    await milestonesRepo.replaceAll(mils);
    res.json(mils[idx]);
  });

  app.delete("/api/admin/milestones/:id", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    // By id. `replaceAll(all().filter(...))` writes an EMPTY array when it
    // removes the last milestone, and an empty array carries no version stamp,
    // so the store reads it as boot seeding and deletes the table as it stands
    // (server/repos/store-db.ts, 0123).
    if (!(await milestonesRepo.remove([String(req.params.id)]))) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ success: true });
  });
}
