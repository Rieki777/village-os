/**
 * A member's season summary, over HTTP (idea 4, Rye 2026-10-30).
 *
 *   GET /api/me/season-summary              the most recently closed season
 *   GET /api/me/season-summary?season=<id>  any season that has begun
 *
 * Read only, and only ever the asker's own: there is no handle parameter, so
 * nobody reads another member's earnings, cash or gratitude here. What a
 * member shares leaves as an image they made (the card's own choices), never
 * as a public URL onto these numbers.
 *
 * 200 with `{ summary: null }` when no season has closed yet, so the client
 * asking on every visit after a turn reads a plain answer and no error. 404
 * when a named season does not exist or has not begun.
 *
 * IN ITS OWN MODULE for the reason server/routes/cashOwed.ts gives: the
 * server/index.ts ratchet counts lines and route registrations.
 *
 * A CORE READ, no module gate: tokens, quests and Gratitude are core, so every
 * village has something to sum up.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { seasonSummaryFor, type SummaryCalendar } from "../repos/seasonSummary";

type Deps = Pick<AppDeps, "authedUser" | "getPool"> & {
  /** The village's calendar: `seasonState` in server/index.ts. */
  seasonState: () => SummaryCalendar;
};

/** A season id is a short slug; anything longer is nothing to look up. */
const SEASON_ID_MAX = 64;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, seasonState } = deps;

  app.get("/api/me/season-summary", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const raw = typeof req.query.season === "string" ? req.query.season.trim() : "";
    if (raw.length > SEASON_ID_MAX) return res.status(400).json({ error: "That season id is too long." });
    const summary = await seasonSummaryFor(
      getPool(),
      { id: String(user.id), name: String(user.name ?? ""), handle: user.handle ? String(user.handle) : null },
      seasonState(),
      raw || null,
    );
    if (!summary && raw) return res.status(404).json({ error: "No season by that id has begun." });
    res.json({ summary });
  });
}
