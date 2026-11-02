/**
 * THE FROZEN QUEST SEED, AND THE TWO PASSES THAT STILL READ IT.
 *
 * `server/seeds/quests-seed.json` used to be the starter board: on an empty
 * `quests` table the boot wrote all fourteen as LIVE rows, claimable and paid
 * from the ledger, and nobody reviewed them. Since 2026-10-31 (sheet A8 / 19g,
 * "a new village starts with a neutral, fully editable starter set") a fresh
 * village gets its starters from the `quests` section of
 * `server/seeds/examples-seed.json` instead, as labelled standing examples a
 * founder keeps or clears. That section is the ONE source of truth for what a
 * new village starts with.
 *
 * This file is no longer a source for anything new. It stays, byte for byte,
 * because villages seeded from it are running today (the first tenant's
 * fourteen are real, live and in use), and two one-shot passes match their
 * rows to it by id:
 *
 *   - `backfillQuestStories` (runOnce `quest-story-2026-08-10` and
 *     `quest-posters-2026-08-10`) fills a story field ONLY where the live row
 *     is empty, so admin-written copy is never overwritten;
 *   - `repairSeededQuestCopy` (inside runOnce `voice-sweep-2026-08-01`)
 *     replaces a field ONLY where the live text is the same words as the seed
 *     and differs in punctuation alone.
 *
 * Both have already run on every village that booted since August, and a
 * runOnce never repeats. What they would write anywhere else is decided by
 * this file's words, so the words never change: `legacyQuestSeed.test.ts`
 * pins the file's hash, and a fork that wants different starters edits the
 * examples seed. The two functions moved here from `server/index.ts` so that
 * promise could be tested at all.
 */
import fs from "node:fs";
import type { QuestRecord, QuestsRepo } from "../repos/quests";

/** The frozen file's name under `server/seeds`. */
export const LEGACY_QUESTS_SEED = "quests-seed.json";

/**
 * Same words, ignoring case and every non-alphanumeric character. The voice
 * sweep (2026-08-01) changed punctuation only, so this matches exactly the
 * footprint it left and nothing else: the moment a human has changed a word,
 * the normalised forms differ and the row is left alone.
 */
export function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * The string fields of `row` that are the same words as the default and differ
 * only in punctuation. Empty when the row is already correct or has been
 * genuinely edited.
 */
export function copyRepairsFor(row: any, def: any): Array<[string, string]> {
  const patches: Array<[string, string]> = [];
  for (const [key, want] of Object.entries(def)) {
    if (typeof want !== "string") continue;
    const have = row?.[key];
    if (typeof have !== "string" || have === want) continue;
    if (sameWords(have, want)) patches.push([key, want]);
  }
  return patches;
}

/** Apply the repairs in place. Returns true if anything changed. */
export function repairRowCopy(row: any, def: any): boolean {
  const patches = copyRepairsFor(row, def);
  for (const [key, want] of patches) row[key] = want;
  return patches.length > 0;
}

/**
 * Fill each matching row's story fields from the frozen seed, ONLY where the
 * live value is empty (0068 gave quests a story layer after villages were
 * already running).
 *
 * Fails loud on a missing or unreadable seed. Returning quietly let runOnce
 * record the job as applied while nothing had been filled, and a throw leaves
 * the id unrecorded so the next boot tries again. Both outcomes get a log
 * line, so "filled nothing" and "never ran" stop looking identical.
 */
export async function backfillQuestStories(
  repo: Pick<QuestsRepo, "byId" | "update">,
  seedFile: string,
  jobId: string,
): Promise<number> {
  if (!fs.existsSync(seedFile)) {
    throw new Error(`quest seed file missing at ${seedFile}`);
  }
  const seed = JSON.parse(fs.readFileSync(seedFile, "utf-8"));
  if (!Array.isArray(seed)) throw new Error("quest seed file is not an array");

  const PROSE_FIELDS = ["subtitle", "story", "firstStep", "deliverable", "imageUrl"] as const;
  const LIST_FIELDS = ["steps", "tips"] as const;
  const seedHasProse = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const seedHasList = (v: unknown) => Array.isArray(v) && v.length > 0;
  const liveProseEmpty = (v: unknown) => String(v ?? "").trim() === "";
  const liveListEmpty = (v: unknown) => !(Array.isArray(v) && v.length > 0);

  let filled = 0;
  for (const s of seed) {
    if (!s?.id) continue;
    const live: any = await repo.byId(String(s.id));
    if (!live) continue;
    // Nothing to fill is not a write.
    const wanted =
      PROSE_FIELDS.some((f) => seedHasProse(s[f]) && liveProseEmpty(live[f])) ||
      LIST_FIELDS.some((f) => seedHasList(s[f]) && liveListEmpty(live[f]));
    if (!wanted) continue;
    await repo.update(live.id, (q: any) => {
      for (const f of PROSE_FIELDS) {
        if (seedHasProse(s[f]) && liveProseEmpty(q[f])) q[f] = s[f];
      }
      for (const f of LIST_FIELDS) {
        if (seedHasList(s[f]) && liveListEmpty(q[f])) q[f] = s[f].map((x: any) => String(x));
      }
    });
    filled += 1;
  }
  console.log(
    filled
      ? `[MIGRATION] ${jobId} filled ${filled} quest(s) from the seed`
      : `[MIGRATION] ${jobId} found nothing to fill`,
  );
  return filled;
}

/**
 * The quest half of the voice sweep: a row paired to its frozen seed entry by
 * id has a field replaced only where it is the same words with different
 * punctuation. Returns how many rows changed. A missing file repairs nothing.
 */
export async function repairSeededQuestCopy(
  repo: Pick<QuestsRepo, "all" | "update">,
  seedFile: string,
): Promise<number> {
  if (!fs.existsSync(seedFile)) return 0;
  const defaults = new Map<string, any>(
    (JSON.parse(fs.readFileSync(seedFile, "utf-8")) as any[]).map((r) => [String(r?.id), r]),
  );
  let repaired = 0;
  for (const row of (await repo.all()) as QuestRecord[]) {
    const def = defaults.get(String(row?.id));
    if (!def) continue;
    const patches = copyRepairsFor(row, def);
    if (!patches.length) continue;
    // update takes a MUTATOR, not a row.
    await repo.update(row.id, (q: any) => {
      for (const [key, want] of patches) q[key] = want;
    });
    repaired++;
  }
  return repaired;
}
