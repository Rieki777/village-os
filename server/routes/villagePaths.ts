/**
 * Admin, Make it yours, Paths & Stages: the village's own words for the paths
 * a newcomer picks when they join and for the stages members climb.
 *
 *   GET /api/admin/village-paths   what the village saved, and the words in force
 *   PUT /api/admin/village-paths   replace what the village saved
 *
 * The rules (fixed ids, limits, back-fill on read) are in
 * shared/villagePaths.ts; the cache every reader answers from is
 * server/lib/villagePaths.ts. What reads the words, so a save here is seen:
 * `/api/game/config` (`paths`, `ladder`, `stages`), which the join form, the
 * profile and every ladder render from; `/api/game/me` and
 * `/api/game/progression`; the stage named in an activity line, a notification
 * and a refusal; and the path named in the path emails (`{{path.name}}`) and
 * in Comms.
 *
 * THE POWER IS `story.tell`, the one the Pages editor beside this writes with
 * (`PUT /api/admin/content/:section`). What a village calls the ways into it
 * and the steps of belonging is what it says about itself in public. A village
 * that holds that power answers through its own holder, and the gate decides
 * that, not this file.
 *
 * THE PUT REPLACES THE DOCUMENT. The editor holds the whole of what the village
 * saved and sends it back, so a box handed back to its default disappears from
 * the store instead of lingering. The body is checked first against the same
 * `villagePathsProblems` the editor asks before Save lights up: known path and
 * stage ids only, known fields only, text only, every word within its limit.
 *
 * The module also re-exports what `server/index.ts` reads, so that file
 * imports it on the same line as the register binding: the boot load, the
 * served slice of the public config, and a stage's name.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { pageVarsFrom, type PageVarSource } from "../../shared/pageContent/vars";
import { setVillageVars, saveVillagePaths, storedVillagePaths, villagePathWords } from "../lib/villagePaths";
import { storableVillagePaths, villagePathsProblems } from "../../shared/villagePaths";

export { loadVillagePaths, servedPathWords, stageName } from "../lib/villagePaths";

type Deps = Pick<AppDeps, "isAdmin" | "guardCapability"> & {
  /** The merged brand config (`mergedConfig` in server/index.ts), which the `{words}` are read from. */
  config(): PageVarSource;
  /** The value token's name, as `/api/game/config` serves it, for `{value}`. */
  valueTokenName(): string;
};

export function register(app: Express, deps: Deps): void {
  const { isAdmin, guardCapability } = deps;
  // The same `{words}` the pages fill (usePageVars reads /api/game/config, which
  // carries the value token's name beside the merged config), so a path's
  // sentence says `{village}` the way the page beside it does.
  setVillageVars(() => {
    const m = deps.config();
    return pageVarsFrom({ ...m, currency: { ...(m.currency ?? {}), value: { name: deps.valueTokenName() } } });
  });

  /** Both answers carry the same shape, so the editor reads a save the way it reads a load. */
  const view = () => ({ stored: storedVillagePaths(), words: villagePathWords() });

  app.get("/api/admin/village-paths", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json(view());
  });

  app.put("/api/admin/village-paths", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const problems = villagePathsProblems(req.body);
    if (problems.length) return res.status(400).json({ error: problems[0], problems });
    await saveVillagePaths(storableVillagePaths(req.body));
    res.json(view());
  });
}
