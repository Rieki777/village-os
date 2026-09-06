/**
 * The hero of the Gratitude wall: one public read.
 *
 * A route module rather than another entry in server/index.ts, following the
 * pattern server/routes/faqs.ts set out. `register(app, deps)` is the only
 * export that touches Express, and the dependency slice is the complete list
 * of what this route can reach: a pool, and nothing else.
 *
 * ── WHY THIS ONE IS ALLOWED TO BE ANONYMOUS ──────────────────────────────
 *
 * `/api/game/gratitude/wall` is already public and returns first names, and
 * the design note in `sendGratitude`'s `resolveTyped` explains why the send
 * flow refused to build a member picker: a picker needs a directory, and
 * "nothing here can be asked for a LIST" is the property that was being
 * protected. An enriched wall carrying handles and portraits would give that
 * property away, which is why it is a later phase and behind authentication.
 *
 * This route gives nothing away. `heroVoices` selects `message` and an opaque
 * row id, so there is no name, no handle, no amount and no timestamp in the
 * answer. Sixteen unattributed sentences are not a directory of anybody.
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
import { heroVoices } from "../lib/gratitudeVoices";

type Deps = Pick<AppDeps, "getPool">;

export function register(app: Express, deps: Deps): void {
  const { getPool } = deps;

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
}
