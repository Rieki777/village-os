/**
 * GOAL THREADS AND PLACE (Phase C, decision 5: the open work board).
 *
 * Each quest can name the season goal it grows and where the work happens.
 * The season goals then read back how many open quests grow each of them
 * ("12 open quests grow Clean water all year"). That count is the village's,
 * never a person's: it counts quests, and no claim or claimant reaches it.
 *
 * WHERE IT LIVES: one `app_config` document, `quest-threads`, keyed by quest
 * id (config plane 4). No column and no migration: the link is a founder's
 * curation laid over the board, the same way the season goals themselves live
 * in a document. A quest that is deleted leaves an orphan key, which reads as
 * nothing; a goal that is removed leaves its quests naming an id no season
 * holds, which also reads as nothing (`goalOf` answers null).
 *
 * The goal is named by its id (server/lib/seasonGoals.ts, 0298), so a goal
 * that is reworded keeps its quests.
 *
 * Pure: the server routes and the board both read these functions.
 */

/** Where the work happens. */
export type QuestPlace = "land" | "remote" | "both";

export const QUEST_PLACES: readonly QuestPlace[] = ["land", "remote", "both"];

/** The app_config key the threads live under. */
export const QUEST_THREADS_KEY = "quest-threads";

export interface QuestThread {
  /** The season goal this quest grows, by its id. */
  goalId: string | null;
  place: QuestPlace | null;
}

export interface QuestThreadsDoc {
  v: 1;
  quests: Record<string, QuestThread>;
}

export const EMPTY_THREADS: QuestThreadsDoc = { v: 1, quests: {} };

/** A goal id as server/lib/seasonGoals.ts writes it, or a legacy index id. Kept short and plain. */
const GOAL_ID = /^[A-Za-z0-9_-]{1,40}$/;

const isPlace = (v: unknown): v is QuestPlace => typeof v === "string" && (QUEST_PLACES as readonly string[]).includes(v);

/** Every quest's thread from the stored document. Junk degrades to "no thread", never a throw. */
export function readThreads(raw: unknown): Record<string, QuestThread> {
  const quests = raw && typeof raw === "object" ? (raw as { quests?: unknown }).quests : null;
  const out: Record<string, QuestThread> = {};
  if (!quests || typeof quests !== "object" || Array.isArray(quests)) return out;
  for (const [id, t] of Object.entries(quests as Record<string, unknown>)) {
    const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
    const goalId = typeof o.goalId === "string" && GOAL_ID.test(o.goalId) ? o.goalId : null;
    const place = isPlace(o.place) ? o.place : null;
    if (goalId || place) out[id] = { goalId, place };
  }
  return out;
}

export type ThreadCheck =
  | { ok: true; thread: QuestThread }
  | { ok: false; field: "goalId" | "place"; error: string };

/**
 * What a founder sends, checked: the goal must be one the current season
 * holds (by id), the place one of the three. Either may be null to clear it.
 */
export function checkThread(body: unknown, seasonGoalIds: readonly string[]): ThreadCheck {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawGoal = b.goalId == null || b.goalId === "" ? null : String(b.goalId);
  if (rawGoal !== null && !seasonGoalIds.includes(rawGoal)) {
    return { ok: false, field: "goalId", error: "That goal is not on this season. Pick one of this season's goals, or none." };
  }
  const rawPlace = b.place == null || b.place === "" ? null : b.place;
  if (rawPlace !== null && !isPlace(rawPlace)) {
    return { ok: false, field: "place", error: "A quest happens on the land, remotely, or both." };
  }
  return { ok: true, thread: { goalId: rawGoal, place: rawPlace } };
}

/** The document with one quest's thread set; a thread with nothing in it is removed. */
export function withThread(doc: unknown, questId: string, thread: QuestThread): QuestThreadsDoc {
  const quests = { ...readThreads(doc) };
  if (thread.goalId || thread.place) quests[questId] = thread;
  else delete quests[questId];
  return { v: 1, quests };
}

export interface GoalLike {
  id: string;
  text: string;
  done: boolean;
}

export interface GoalThread extends GoalLike {
  /** Open quests that grow this goal: not closed, not standing examples. The village's count. */
  openQuests: number;
}

/**
 * Each season goal with the count of open quests that grow it, in the
 * season's own order. A closed quest and a standing example never count.
 */
export function openQuestsPerGoal(
  quests: readonly { id: string; status?: string | null; isExample?: boolean }[],
  threads: Record<string, QuestThread>,
  goals: readonly GoalLike[],
): GoalThread[] {
  const counts = new Map<string, number>();
  for (const q of quests) {
    if (q.isExample) continue;
    if (String(q.status ?? "").trim().toLowerCase() === "closed") continue;
    const g = threads[q.id]?.goalId;
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return goals.map((g) => ({ id: g.id, text: g.text, done: g.done, openQuests: counts.get(g.id) ?? 0 }));
}

/** The goal a quest grows, if the season still holds it. */
export function goalOf<G extends { id: string }>(goalId: string | null | undefined, goals: readonly G[]): G | null {
  if (!goalId) return null;
  return goals.find((g) => g.id === goalId) ?? null;
}
