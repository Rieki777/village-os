/**
 * THE STARTER QUEST BOARD, AND THE ONLY TWO WAYS THE SEED REACHES A VILLAGE.
 *
 * `server/seeds/quests-seed.json` is what a fresh village's quest board starts
 * with. Two boot paths read it, and both used to live inline in
 * server/index.ts, where no test could reach them:
 *
 *   1. `seedEmptyQuestBoard`: the whole seed goes in, on an EMPTY table only.
 *      A village that has any quest is never handed the seed again, so one
 *      that deleted a starter quest on purpose does not get it back, and a
 *      village running since before a seed edit keeps every word of its own
 *      board. (The one edge: a village that deletes EVERY quest has an empty
 *      table, and gets the whole seed on its next boot.)
 *   2. `fillQuestStoriesFromSeed`: the story layer (0068), matched by id, and
 *      written ONLY into a field that is empty on the live row. A written
 *      subtitle, story or step is never touched. server/index.ts runs it under
 *      two `runOnce` ids from 2026-08-10, so on any village that booted since
 *      then it never runs again.
 *
 * WHY THIS MATTERS NOW (2026-09-27). The seed was one village's own board:
 * "our food forests", a watch team with "a current watch member", circles to
 * meet and rotate through, and a circle name on every quest, which the board
 * turns into a filter chip. A fresh fork served all of it as its own, which
 * is the never-build rule "seeding aspirational structure"
 * (docs/COORDINATION_SUBSTRATE.md). The seed now says what each practice is,
 * names no place, team or circle the village has not made, and carries no
 * circle. The village that board came from keeps its own rows: rule 1 never
 * reaches a table that has quests, and rule 2 fills nothing a row already
 * says. server/lib/questSeed.test.ts holds both against a board that already
 * exists.
 *
 * (The third reader of the seed, the 2026-08-01 voice sweep in
 * server/index.ts, is a `runOnce` too, and it only rewrites a field whose
 * WORDS are the seed's and differ in punctuation alone, so a rewritten
 * sentence can never match it.)
 */
import type { QuestRecord, QuestsRepo } from "../repos/quests";

/** A seed entry: whatever the file holds, checked for an id and a title before it is written. */
type SeedQuest = Partial<QuestRecord> & Record<string, unknown>;

/**
 * Put the whole seed on the board, if and only if the board is empty.
 * Returns how many quests were written: zero when the village already has any.
 */
export async function seedEmptyQuestBoard(repo: Pick<QuestsRepo, "all" | "add">, seed: unknown): Promise<number> {
  if (!Array.isArray(seed)) return 0;
  if ((await repo.all()).length > 0) return 0;
  let written = 0;
  for (const q of seed as SeedQuest[]) {
    if (!q?.id || !q?.title) continue;
    await repo.add({ tags: [], order: 0, status: "open", gratitude: "", ...q } as QuestRecord);
    written += 1;
  }
  return written;
}

const PROSE_FIELDS = ["subtitle", "story", "firstStep", "deliverable", "imageUrl"] as const;
const LIST_FIELDS = ["steps", "tips"] as const;
const seedHasProse = (v: unknown) => typeof v === "string" && v.trim() !== "";
const seedHasList = (v: unknown) => Array.isArray(v) && v.length > 0;
const liveProseEmpty = (v: unknown) => String(v ?? "").trim() === "";
const liveListEmpty = (v: unknown) => !(Array.isArray(v) && v.length > 0);

/**
 * Fill each seeded quest's story fields from the seed, ONLY where the live
 * value is empty: an admin who already wrote their own subtitle or story keeps
 * every word. Returns how many quests gained a field.
 */
export async function fillQuestStoriesFromSeed(
  repo: Pick<QuestsRepo, "byId" | "update">,
  seed: readonly unknown[],
): Promise<number> {
  let filled = 0;
  for (const s of seed as SeedQuest[]) {
    if (!s?.id) continue;
    const live = (await repo.byId(String(s.id))) as Record<string, unknown> | null;
    if (!live) continue;
    // Nothing to fill is not a write. The first version opened a transaction
    // and ran a full column UPDATE for every seeded quest either way.
    const wanted =
      PROSE_FIELDS.some((f) => seedHasProse(s[f]) && liveProseEmpty(live[f])) ||
      LIST_FIELDS.some((f) => seedHasList(s[f]) && liveListEmpty(live[f]));
    if (!wanted) continue;
    await repo.update(String(live.id), (q) => {
      const row = q as unknown as Record<string, unknown>;
      for (const f of PROSE_FIELDS) {
        if (seedHasProse(s[f]) && liveProseEmpty(row[f])) row[f] = s[f];
      }
      for (const f of LIST_FIELDS) {
        if (seedHasList(s[f]) && liveListEmpty(row[f])) row[f] = (s[f] as unknown[]).map((x) => String(x));
      }
    });
    filled += 1;
  }
  return filled;
}
