/**
 * `GET /api/role-measures`: how the role journey is going, for members (L11).
 *
 * Counts and medians per season and circle. No name, no id of a person, no
 * application ref: the key set is held by `MEASURE_KEYS` and a test. Signed-in
 * members only; a visitor is refused. Writes nothing.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { buildMeasures } from "../../shared/roleMeasures";
import { applicationFacts, holderFacts } from "../repos/roleMeasures";

type Deps = Pick<AppDeps, "getPool" | "authedUser"> & Partial<Pick<AppDeps, "overLimit">>;

export function register(app: Express, deps: Deps): void {
  const { getPool, authedUser, overLimit } = deps;
  app.get("/api/role-measures", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to see this." });
    if (overLimit && (await overLimit(`role-measures:${user.id}`, 20, 60_000))) return res.status(429).json({ error: "Slow down a little." });
    try {
      const pool = getPool();
      const [apps, holders] = await Promise.all([applicationFacts(pool), holderFacts(pool)]);
      const names = new Map<string, string>();
      try {
        const [c] = await pool.query<any[]>("SELECT id, name FROM circles");
        for (const r of c) names.set(String(r.id), String(r.name));
      } catch {
        /* circle names are a nicety */
      }
      const rows = buildMeasures(apps, holders, Date.now()).map((r) => ({ ...r, circleName: r.circleId ? (names.get(r.circleId) ?? null) : null }));
      res.json({ rows });
    } catch {
      res.status(500).json({ error: "Could not read the measures." });
    }
  });
}
