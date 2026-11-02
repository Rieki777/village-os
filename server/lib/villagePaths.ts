/**
 * The village's own words for its paths and its stage ladder, as the server
 * reads them. The rules (what may change, the limits, the back-fill) live in
 * shared/villagePaths.ts and are not restated here.
 *
 * Loaded once at boot (`initStores`) into a write-through cache, the way the
 * story pages switch is (server/lib/brochurePages.ts), so every reader answers
 * synchronously: the public config, the ladder on `/api/game/me` and
 * `/api/game/progression`, the stage named in an activity line or a refusal,
 * and the path named in an email. Admin, Make it yours, Paths & Stages writes
 * it (server/routes/villagePaths.ts) and the very next request reads the new
 * words. No restart.
 *
 * ONE CACHE FOR PAGES AND EMAILS, on purpose. The comms renderer reads the
 * brand document fresh from the pool because that cache lives inside
 * `server/index.ts`, out of its reach. This one lives here, beside both, so a
 * founder who renames a path sees the same name on the join form and in the
 * path's welcome email, and never one before the other.
 *
 * Before boot has loaded it (a unit test, a script) every reader answers
 * today's words, which is also what a village that never saved reads.
 *
 * THE `{words}`. Path and stage words may use the page `{words}` (`{village}`,
 * `{commitment}`, ...). Their values come from the merged brand config, which
 * is built inside `server/index.ts`, so the route module hands this file a
 * reader for them at registration (`setVillageVars`). Unset, the words fall
 * back to the platform's own (`pageVarsFrom({})`).
 */
import type { Pool } from "mysql2/promise";
import { dbDocument, type DbDocument } from "../repos/store-db";
import { getStage } from "../../shared/gameConfig";
import { pageVarsFrom } from "../../shared/pageContent/vars";
import type { PageVars } from "../../shared/pageContent/types";
import {
  resolveVillagePathWords,
  servedPaths,
  servedStageWords,
  VILLAGE_PATHS_DOCUMENT,
  type ServedPath,
  type StageWords,
  type VillagePathsDocument,
  type VillagePathWords,
} from "../../shared/villagePaths";
import { fillVars } from "../../shared/pageContent/resolve";

let repo: DbDocument<Record<string, unknown>> | null = null;
let varsReader: (() => PageVars) | null = null;

/** Read the stored words once, at boot. */
export async function loadVillagePaths(pool: Pool): Promise<void> {
  const next = dbDocument<Record<string, unknown>>(pool, VILLAGE_PATHS_DOCUMENT, {});
  await next.load();
  repo = next;
}

/** Where the `{words}` come from. Set once, by the route module's registration. */
export function setVillageVars(reader: () => PageVars): void {
  varsReader = reader;
}

/**
 * The village's `{words}`. A reader that throws (the brand cache not loaded
 * yet) costs the words their village values, never the page.
 */
export function villageVars(): PageVars {
  if (varsReader) {
    try {
      return varsReader();
    } catch (err) {
      console.error("[village-paths] the village's words could not be read; using the platform's", err);
    }
  }
  return pageVarsFrom({});
}

/** Exactly what this village saved. Empty when it never has. */
export function storedVillagePaths(): Record<string, unknown> {
  return repo ? repo.get() : {};
}

/** Every path's and stage's words, back-filled from today's words field by field. */
export function villagePathWords(): VillagePathWords {
  return resolveVillagePathWords(repo ? repo.get() : null);
}

/** Store a document `storableVillagePaths` produced, and answer the words now in force. */
export async function saveVillagePaths(doc: VillagePathsDocument): Promise<VillagePathWords> {
  if (!repo) throw new Error("the village's path and stage words are not loaded yet");
  await repo.put(doc as Record<string, unknown>);
  return villagePathWords();
}

/** Every path as pages and emails read it, in the platform's order. */
export function villagePaths(): ServedPath[] {
  return servedPaths(villagePathWords(), villageVars());
}

/** A path's name as the village shows it, or null for an id this build does not offer. */
export function villagePathLabel(pathId: string): string | null {
  return villagePaths().find((p) => p.id === pathId)?.label ?? null;
}

/** The id and name of every path, for the admin lists that pick one. */
export function villagePathChoices(): Array<{ id: string; label: string }> {
  return villagePaths().map((p) => ({ id: p.id, label: p.label }));
}

/**
 * A reader for the stages' words as the village shows them, with the stored
 * words and the `{words}` read once for a whole ladder rather than once a
 * rung. `commitmentName`, when a caller has it, wins over the reader's, so a
 * payload built with an explicit word says that word. An unknown id reads as
 * the first stage, as `getStage` does.
 */
export function villageStageReader(commitmentName?: string): (stageId: string | null | undefined) => StageWords {
  const words = villagePathWords();
  const base = villageVars();
  const vars = commitmentName === undefined ? base : { ...base, commitment: commitmentName };
  return (stageId) => servedStageWords(words, getStage(stageId).id, vars);
}

/** A stage's name as the village shows it. An unknown id reads as the first stage, as `getStage` does. */
export function stageName(stageId: string | null | undefined): string {
  return villageStageReader()(stageId).name;
}

/** The ladder's name as the village shows it. */
export function ladderTitle(): string {
  return fillVars(villagePathWords().ladder.title, villageVars());
}

/**
 * The slice of `/api/game/config` this file owns, spread into that payload:
 * the paths with their sentences, and the ladder's name. The stages
 * themselves ride on `servedLadder`, which reads the same words.
 */
export function servedPathWords(): { paths: ServedPath[]; ladder: { title: string } } {
  return { paths: villagePaths(), ladder: { title: ladderTitle() } };
}
