/**
 * A SEASON GOAL KEEPS ITS NAME (0298). Every goal on a season carries an id,
 * so whatever serves it (a weekly priority, a win in a meeting) stays linked
 * when the goal is reworded, and a goal that is removed leaves its links
 * reading as what they served.
 *
 * THE ID OF A GOAL WRITTEN BEFORE IDS EXISTED IS DERIVED FROM ITS WORDS:
 * `g` and the first eleven hex digits of the SHA-1 of the trimmed text. The
 * migration's backfill computes exactly that in SQL for the links that named
 * a goal by its words (`CONCAT('g', LEFT(SHA1(serves_goal), 11))`), so a link
 * and its goal agree from the first read, before anybody saves the season
 * again. Once saved, the id is stored and a rewording keeps it: the season
 * editor sends each goal back whole, id included.
 *
 * TWO GOALS ON ONE SEASON NEVER SHARE AN ID. Stored ids claim their place
 * first, then each derived id takes the next free `-2`, `-3`. That keeps a
 * renamed goal's links on it when a new goal is added with its old words.
 */
import { createHash } from "node:crypto";

export interface SeasonGoal {
  id: string;
  text: string;
  done: boolean;
}

/** A stored id this file would have written: `g`, hex, and an optional `-n`. */
const ID = /^g[0-9a-f]{11}(-\d{1,3})?$/;

/** The id a goal's words derive. The migration's backfill computes the same in SQL. */
export function goalIdFor(text: string): string {
  return `g${createHash("sha1").update(String(text ?? "").trim(), "utf8").digest("hex").slice(0, 11)}`;
}

/** Every goal with its id: stored ids first, then derived ones, none shared. */
export function assignGoalIds(raw: readonly unknown[]): SeasonGoal[] {
  const goals = raw.map((g: any) => ({
    stored: typeof g?.id === "string" && ID.test(g.id) ? (g.id as string) : null,
    text: String(g?.text ?? ""),
    done: !!g?.done,
  }));
  const taken = new Set<string>();
  const ids: (string | null)[] = goals.map((g) => {
    if (!g.stored || taken.has(g.stored)) return null;
    taken.add(g.stored);
    return g.stored;
  });
  return goals.map((g, i) => {
    let id = ids[i];
    if (id == null) {
      const base = goalIdFor(g.text);
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
    }
    return { id, text: g.text, done: g.done };
  });
}
