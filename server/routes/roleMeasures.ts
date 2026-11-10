/**
 * `GET /api/role-measures`: how the role journey is going, for administrators (L11).
 *
 * Counts and medians per season and circle. No name, no id of a person, no
 * application ref: the key set is held by `MEASURE_KEYS` and a test. Admin
 * only (the village lead, 2026-11-10): a visitor gets 401, a signed-in member
 * who is not an admin or founder gets 403, through the house `isAdmin` gate.
 * Writes nothing.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { buildMeasures } from "../../shared/roleMeasures";
import { applicationFacts, circleNames, holderFacts } from "../repos/roleMeasures";

type Deps = Pick<AppDeps, "getPool" | "authedUser" | "isAdmin"> & Partial<Pick<AppDeps, "overLimit">>;

export function register(app: Express, deps: Deps): void {
  const { getPool, authedUser, isAdmin, overLimit } = deps;
  app.get("/api/role-measures", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see this." });
    if (!(await isAdmin(req))) return res.status(403).json({ error: "Only administrators can see this." });
    if (overLimit && (await overLimit(`role-measures:${user.id}`, 20, 60_000))) return res.status(429).json({ error: "Slow down a little." });
    try {
      const pool = getPool();
      const [apps, holders] = await Promise.all([applicationFacts(pool), holderFacts(pool)]);
      const names = await circleNames(pool).catch(() => new Map<string, string>());
      const rows = buildMeasures(apps, holders, Date.now()).map((r) => ({ ...r, circleName: r.circleId ? (names.get(r.circleId) ?? null) : null }));
      res.json({ rows });
    } catch {
      res.status(500).json({ error: "Could not read the measures." });
    }
  });
}
