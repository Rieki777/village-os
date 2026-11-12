/**
 * The map's lights (Phase D, D2): three doors under `/api/map`, so the map
 * module's own gate (`requireModule("map")`, by the module's `apiPrefixes`)
 * stands in front of all three and a village without the map serves none.
 *
 *   GET /api/map/hearths   which circles meet today and how many lights each
 *                          hearth shows. A signed-in present member only:
 *                          a visitor is answered 401 and sees no lights.
 *   GET /api/map/my-light  this member's own choice.
 *   PUT /api/map/my-light  `{ on: boolean }`, this member's own choice, and
 *                          nobody else's: there is no id in the path or body.
 *
 * The rules (off by default, never a list of names, the floor and the cap,
 * cleared on erasure) are shared/mapLight.ts.
 */
import type { Express } from "express";
import { MAP_LIGHT_PREF, MAP_LIGHT_REFUSALS as R, readMapLight, type HearthsPayload } from "../../shared/mapLight";
import type { AppDeps } from "../lib/appDeps";
import { hearthsToday } from "../lib/mapLight";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "members"> & {
  circles: () => { id: string }[];
  isPresent: (member: any) => boolean;
};

export function register(app: Express, deps: Deps): void {
  /** The signed-in present member asking, or null. */
  const memberAsking = async (req: any) => {
    const user = await deps.authedUser(req);
    return user && deps.isPresent(user) ? user : null;
  };

  app.get("/api/map/hearths", async (req, res) => {
    const user = await memberAsking(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: R.signIn });
    const { day, hearths } = await hearthsToday(deps.getPool(), {
      circles: deps.circles,
      memberById: (id) => deps.members.byId(id),
      isPresent: deps.isPresent,
    });
    const body: HearthsPayload = { day, hearths, myLight: readMapLight(user.prefs) };
    // Personal to the asker (myLight) and true only for today: never cached in between.
    res.setHeader("Cache-Control", "private, no-store");
    res.json(body);
  });

  app.get("/api/map/my-light", async (req, res) => {
    const user = await memberAsking(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: R.signIn });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ on: readMapLight(user.prefs) });
  });

  app.put("/api/map/my-light", async (req, res) => {
    const user = await memberAsking(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: R.signIn });
    const on = req.body?.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: R.notBoolean });
    const updated = await deps.members.update(user.id, (u: any) => {
      const prefs = { ...(u.prefs ?? {}) };
      // Off is the absence of the key, the same state a member who never chose is in.
      if (on) prefs[MAP_LIGHT_PREF] = true;
      else delete prefs[MAP_LIGHT_PREF];
      u.prefs = prefs;
    });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ on: readMapLight(updated.prefs) });
  });
}
