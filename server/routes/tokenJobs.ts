/**
 * `GET /api/admin/token-jobs`: which token does which job, for the admin screen
 * (Rye, 2026-10-22). Read only. Each job names the door that changes it
 * (shared/tokenJobs.ts `setBy`), and a change goes through that door, so this
 * route never writes and never holds a second copy of the answer.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { tokenJobs } from "../lib/tokenJobs";

type Deps = Pick<AppDeps, "isAdmin" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, getPool } = deps;

  app.get("/api/admin/token-jobs", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ jobs: await tokenJobs(getPool()) });
  });
}
