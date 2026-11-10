/**
 * A member's own time zone (role journey L6).
 *
 *   GET /api/me/time-zone    { timeZone: string | null }
 *   PUT /api/me/time-zone    { timeZone: IANA name | null }   null clears it
 *
 * Private to the member: it only ever answers for the signed-in person.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { setTimeZone, timeZoneOf } from "../repos/memberTimeZone";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit } = deps;

  app.get("/api/me/time-zone", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json({ timeZone: await timeZoneOf(getPool(), user.id) });
  });

  app.put("/api/me/time-zone", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`time-zone:${user.id}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many changes at once. Try again in a while." });
    }
    const raw = (req.body as { timeZone?: unknown } | undefined)?.timeZone;
    if (raw === undefined) return res.status(400).json({ error: "Say which time zone, such as Europe/Lisbon, or null to clear it." });
    const ok = await setTimeZone(getPool(), user.id, raw);
    if (!ok) return res.status(400).json({ error: "That is not a time zone name. Use a place name such as America/Costa_Rica." });
    res.json({ timeZone: await timeZoneOf(getPool(), user.id) });
  });
}
