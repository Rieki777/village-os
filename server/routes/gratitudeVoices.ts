/**
 * The hero of the Gratitude wall: one public read.
 *
 * A route module rather than another entry in server/index.ts, following the
 * pattern server/routes/faqs.ts set out. `register(app, deps)` is the only
 * export that touches Express, and the dependency slice is the complete list
 * of what this route can reach: a pool, and nothing else.
 *
 * ── THE HERO IS ANONYMOUS AND THE WALL IS NOT, AND THAT IS DELIBERATE ────
 *
 * `heroVoices` selects `message` and an opaque row id. No name, no handle, no
 * amount, no timestamp. That is what lets the hero be the one thing a stranger
 * meets first: unattributed sentences are not a directory of anybody, and the
 * hero's own examples could not exist otherwise.
 *
 * The WALL below it now carries names, handles and portraits, on Rye's ruling
 * of 2026-09-06. The cost was stated before it was made and is recorded here
 * because it is the kind of thing a later reader will want the reasoning for:
 * `resolveTyped` in server/lib/gratitude.ts chose handles over a member picker
 * precisely because a picker needs a DIRECTORY, and it ends "nothing here can
 * be asked for a LIST". Sixty rows of handle and portrait on an unauthenticated
 * endpoint is that list. It was raised, it was decided, and the decision is the
 * village's to make.
 *
 * What the ruling does NOT reach, and what this route therefore still honours:
 * the three fields it serves are exactly the three `publicView` serves with no
 * privacy flag consulted (name, handle, fronted character). Nothing gated by a
 * member's own settings is added, and `showHearts` keeps meaning their
 * BALANCES rather than their appearance here.
 *
 * ── NO CACHING HEADER, DELIBERATELY ──────────────────────────────────────
 *
 * The hero changes the moment somebody sends, and the send animation on the
 * page re-reads this. A cached hero would show a member the wall as it was
 * before their own thanks landed, which is the one moment the page most needs
 * to be right.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import { heroVoices, wallEntries, type WallLogRow } from "../lib/gratitudeVoices";

/**
 * The log arrives as a FUNCTION rather than as the repo.
 *
 * `gratitudeRepo` is not in `AppDeps`, and widening that type to add it would
 * hand every future route module the whole gratitude log whether or not it
 * asked. The slice a route module declares is meant to be the complete list of
 * what it can reach, and "one read of the log" is the honest size of what this
 * one needs.
 */
type Deps = Pick<AppDeps, "getPool"> & { gratitudeLog: () => Promise<WallLogRow[]> };

export function register(app: Express, deps: Deps): void {
  const { getPool, gratitudeLog } = deps;

  app.get("/api/game/gratitude/voices", async (_req, res) => {
    try {
      res.json(await heroVoices(getPool()));
    } catch {
      // An empty hero is a page with no opening line, which is worse than a
      // page that says nothing. The wall below still renders, so this answers
      // with an honest empty set rather than a 500 that blanks the route.
      res.json({ voices: [], realTotal: 0 });
    }
  });

  app.get("/api/game/gratitude/wall", async (_req, res) => {
    res.json(await wallEntries(getPool(), await gratitudeLog()));
  });
}
