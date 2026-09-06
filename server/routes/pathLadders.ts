/**
 * A member's own per-path ladders.
 *
 *   GET /api/paths/ladders   the signed-in member's ladders, one per path they walk
 *
 * ── A NEW MODULE, NOT A NEW LINE IN server/index.ts ─────────────────────────
 *
 * `scripts/check-server-index-size.mjs` ratchets that file on lines and on
 * route registrations, and both numbers only ever fall. A route module is free
 * on both by construction, which is the whole point of the ratchet: it makes
 * extraction the cheap direction. Nothing here raises a baseline.
 *
 * ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
 *
 * A stranger, with the same 401 every member-scoped route answers with. Every
 * read below is scoped to `authedUser(req).id` inside the statement, so there
 * is no id in the request that could point the query at somebody else, and no
 * ordering of calls that would let it. `housing_reservations` in particular
 * carries a name, an email and a phone number, and the founder's read of that
 * table sits behind `map.publish` for exactly that reason; this route never
 * returns any of those fields, only whether a status has been reached.
 *
 * ── WHY THE READS ARE CONDITIONAL ───────────────────────────────────────────
 *
 * A member who walks one path pays for one table. The profile page loads this
 * on every visit, so four queries for a member who claims nothing would be four
 * queries answering nothing. A member who claims no path at all gets an empty
 * list and the database is never opened.
 *
 * ── DATES ───────────────────────────────────────────────────────────────────
 *
 * Every instant on the way out is a village moon, resolved through
 * `server/lib/villageMoon.ts`, and the anchor is read ONCE for the whole
 * response rather than once per rung. No `cycle_id` is ever printed: a moon
 * carries the absolute lunation number for support conversations and the
 * client prints the ordinal and the window. A village that has not set a first
 * moon gets the window with no number on it, which is the honest answer and is
 * what `villageMoonLabel` already produces.
 */
import { reservationsForMember } from "../repos/housing";
import type { Express } from "express";
import { LADDER_PATH_IDS, type LadderPathId } from "../../shared/pathLadders";
import type { AppDeps } from "../lib/appDeps";
import { } from "../lib/housing";
import { laddersFor, type MoonOf } from "../lib/pathLadders";
import { moonOneCycle, villageMoonFor } from "../lib/villageMoon";
import { factsForMember } from "../repos/investorPath";
import { seatingsForMember } from "../repos/pathLadders";
import { venturesForMember } from "../repos/ventures";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "lapseContext">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, lapseContext } = deps;

  app.get("/api/paths/ladders", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });

    // The member's own claims decide what is read and what is served. A path
    // they do not walk gets no ladder even when rows for it exist, because a
    // ladder is a claim about somebody's journey and holding a row is not the
    // same as walking a path.
    const walked = new Set<string>((Array.isArray(user.paths) ? user.paths : []).map(String));
    const wanted = LADDER_PATH_IDS.filter((id) => walked.has(id));
    if (wanted.length === 0) return res.json({ ladders: [] });

    const pool = getPool();
    const needs = (id: LadderPathId) => wanted.includes(id);
    const [anchor, seatings, reservations, investorFacts, ventures] = await Promise.all([
      moonOneCycle(pool),
      needs("steward") ? seatingsForMember(pool, user.id) : Promise.resolve([]),
      needs("resident") ? reservationsForMember(pool, user.id) : Promise.resolve([]),
      // Ended facts and closed ventures are asked for on purpose: they never
      // lift a position and they are the only thing that can say a rung was
      // reached. Examples stay excluded by both repos' defaults, so a seeded
      // standing example cannot promote a real member.
      needs("investor")
        ? factsForMember(pool, user.id, { includeEnded: true })
        : Promise.resolve([]),
      needs("prosperity-creator")
        ? venturesForMember(pool, user.id, { includeClosed: true })
        : Promise.resolve([]),
    ]);

    const moonOf: MoonOf = (value) => {
      if (value == null) return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isFinite(date.getTime()) ? villageMoonFor(date, anchor) : null;
    };

    res.json({
      ladders: laddersFor(
        // The member's own order, so the panel draws each ladder inside the
        // tile it belongs to and the two orders cannot drift apart.
        Array.isArray(user.paths) ? user.paths.map(String) : [],
        { seatings, reservations, investorFacts, ventures },
        lapseContext(),
        moonOf,
      ),
    });
  });
}
