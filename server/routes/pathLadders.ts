/**
 * A member's own per-path ladders.
 *
 *   GET /api/paths/ladders         the signed-in member's ladders, one per path they walk
 *   GET /api/admin/players/detail  every member's ladders, balances and last stage change, for the admin roster
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
import type { Pool } from "mysql2/promise";
import { LADDER_PATH_IDS, type LadderPathId, type PathLadder } from "../../shared/pathLadders";
import type { AppDeps } from "../lib/appDeps";
import { } from "../lib/housing";
import { laddersFor, particularsFor, type MoonOf } from "../lib/pathLadders";
import { moonOneCycle, villageMoonFor } from "../lib/villageMoon";
import { factsForMember } from "../repos/investorPath";
import { seatingsForMember } from "../repos/pathLadders";
import { venturesForMember } from "../repos/ventures";
import { latestStageSets } from "../repos/stageGrants";
import { balancesFor, memberAccount, tokenDef } from "../lib/ledger";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "lapseContext" | "isAdmin" | "members">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, lapseContext, isAdmin, members } = deps;

  app.get("/api/paths/ladders", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });

    // The member's own claims decide what is read and what is served. A path
    // they do not walk gets no ladder even when rows for it exist, because a
    // ladder is a claim about somebody's journey and holding a row is not the
    // same as walking a path.
    const walked = new Set<string>((Array.isArray(user.paths) ? user.paths : []).map(String));
    const wanted = LADDER_PATH_IDS.filter((id) => walked.has(id));
    if (wanted.length === 0) return res.json({ ladders: [], paths: {} });

    const pool = getPool();
    const moonOf = moonResolver(await moonOneCycle(pool));
    const rows = await rowsFor(pool, String(user.id), wanted);

    // The member's own order, so the panel draws each ladder inside the tile
    // it belongs to and the two orders cannot drift apart.
    const claimed = Array.isArray(user.paths) ? user.paths.map(String) : [];

    res.json({
      ladders: laddersFor(claimed, rows, lapseContext(), moonOf),
      // THE SAME ROWS, READ FOR WHAT THEY SAY. A ladder answers where somebody
      // stands and drops everything else, which left the profile unable to
      // name one thing a member had actually done. Both projections come off
      // this one fetch: a second route would re-run these four queries and add
      // a round trip to every profile paint for data already in memory here.
      paths: particularsFor(claimed, rows, moonOf),
    });
  });

  /**
   * EVERY MEMBER'S LADDERS, for the admin Players cards (Rye, 2026-10-30:
   * "players can be walking multiple paths and have different status in each").
   *
   *   GET /api/admin/players/detail
   *     ladders:    { [userId]: PathLadder[] }
   *     balances:   { [userId]: { slug, name, balance, decimals }[] }   MINOR units + scale, active tokens only
   *     stageSetBy: { [userId]: { at, actorUserId } }
   *
   * Balances are here, beside the ladders, because the roster's own `balance`
   * is the cached Gratitude column in MINOR units with no scale, which is one
   * token printed without the number that formats it. This reads every token
   * from the ledger, the same way GET /api/game/ledger does for a member.
   *
   * Positions only. `particularsFor` is never called here: a resident's
   * reservation carries a name, an email and a phone, and the roster has no
   * reason to hold any of it. A ladder says which rungs hold and nothing else.
   *
   * Reads are per member and only for the paths each one walks, so a member on
   * no path costs nothing. That is N small reads for the roster, which is the
   * right trade at village size; the batched form is the fix if a roster ever
   * runs to thousands.
   */
  app.get("/api/admin/players/detail", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const ctx = lapseContext();
    const [anchor, everyone, stageSets] = await Promise.all([moonOneCycle(pool), members.all(), latestStageSets(pool)]);
    const moonOf = moonResolver(anchor);
    const ladders: Record<string, PathLadder[]> = {};
    const balances: Record<string, { slug: string; name: string; balance: number; decimals: number }[]> = {};
    await Promise.all(
      (everyone as any[])
        .filter((u) => !u.isExample)
        .map(async (u) => {
          const held = Object.entries(await balancesFor(pool, memberAccount(String(u.id))));
          // Hidden tokens stay out, the rule GET /api/game/ledger applies; a token
          // with no registry row is shown, because that drift is worth seeing.
          balances[String(u.id)] = held
            .filter(([slug, balance]) => balance !== 0 && tokenDef(slug)?.active !== false)
            .map(([slug, balance]) => ({ slug, name: tokenDef(slug)?.name ?? slug, balance, decimals: tokenDef(slug)?.decimals ?? 0 }));
          const claimed = (Array.isArray(u.paths) ? u.paths : []).map(String);
          const wanted = LADDER_PATH_IDS.filter((id) => claimed.includes(id));
          if (wanted.length === 0) return;
          ladders[String(u.id)] = laddersFor(claimed, await rowsFor(pool, String(u.id), wanted), ctx, moonOf);
        }),
    );
    res.json({ ladders, balances, stageSetBy: Object.fromEntries(Array.from(stageSets)) });
  });
}

const moonResolver = (anchor: Awaited<ReturnType<typeof moonOneCycle>>): MoonOf => (value) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? villageMoonFor(date, anchor) : null;
};

/** The rows one member's ladders read, fetched only for the paths they walk. */
async function rowsFor(pool: Pool, userId: string, wanted: readonly LadderPathId[]) {
  const needs = (id: LadderPathId) => wanted.includes(id);
  const [seatings, reservations, investorFacts, ventures] = await Promise.all([
    needs("steward") ? seatingsForMember(pool, userId) : Promise.resolve([]),
    needs("resident") ? reservationsForMember(pool, userId) : Promise.resolve([]),
    // Ended facts and closed ventures are asked for on purpose: they never
    // lift a position and they are the only thing that can say a rung was
    // reached. Examples stay excluded by both repos' defaults, so a seeded
    // standing example cannot promote a real member.
    needs("investor") ? factsForMember(pool, userId, { includeEnded: true }) : Promise.resolve([]),
    needs("prosperity-creator") ? venturesForMember(pool, userId, { includeClosed: true }) : Promise.resolve([]),
  ]);
  return { seatings, reservations, investorFacts, ventures };
}
