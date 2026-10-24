/**
 * The switch for this village's story pages (shared/brochure.ts), from Admin.
 *
 * It used to take a SQL statement and a restart (Rye, 2026-10-22: every
 * village's pages are its own to switch). The capability is `story.tell`, the
 * same one that writes the words on those pages: what a village says about
 * itself in public, and whether it says it at all, are one power.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { brochurePagesOn, setBrochurePages } from "../lib/brochurePages";

type Deps = Pick<AppDeps, "isAdmin" | "guardCapability">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, guardCapability } = deps;

  app.get("/api/admin/brochure-pages", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ enabled: brochurePagesOn() });
  });

  app.put("/api/admin/brochure-pages", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    res.json({ enabled: await setBrochurePages(enabled) });
  });
}
