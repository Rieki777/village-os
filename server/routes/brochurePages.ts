/**
 * The switches for this village's story pages (shared/brochure.ts), from
 * Admin: the master switch for all of them, and one per page.
 *
 * It used to take a SQL statement and a restart (Rye, 2026-10-22: every
 * village's pages are its own to switch). The capability is `story.tell`, the
 * same one that writes the words on those pages: what a village says about
 * itself in public, and whether it says it at all, are one power. That holds
 * for one page as much as for all of them.
 *
 *   GET  { enabled, hidden }                       admin
 *   PUT  { enabled?, pages?: { "/housing": false } } story.tell
 *
 * A PUT names only what changes. Pages it does not name keep their state, and
 * the answer is the whole stored state afterwards.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { brochureHiddenPages, brochurePagesOn, updateBrochurePages } from "../lib/brochurePages";
import { brochurePatchProblem, type BrochurePatch } from "../../shared/brochure";

type Deps = Pick<AppDeps, "isAdmin" | "guardCapability">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, guardCapability } = deps;

  app.get("/api/admin/brochure-pages", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ enabled: brochurePagesOn(), hidden: brochureHiddenPages() });
  });

  app.put("/api/admin/brochure-pages", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const problem = brochurePatchProblem(req.body);
    if (problem) return res.status(400).json({ error: problem });
    res.json(await updateBrochurePages(req.body as BrochurePatch));
  });
}
