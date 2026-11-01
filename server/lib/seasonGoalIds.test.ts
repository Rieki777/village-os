/**
 * THE BACKFILL THAT REPLACED 0298's SQL (2026-11-01).
 *
 * 0298 shipped statements 7 and 8 computing a goal's derived id with
 * `CONCAT('g', LEFT(LOWER(SHA1(TRIM(`serves_goal`))), 11))`. The production
 * database answered `FUNCTION railway.SHA1 does not exist` and the deploy
 * failed after 15.5 minutes; CI's mysql:8 had accepted it in every run.
 *
 * So these cases hold two things at once: that the TypeScript backfill writes
 * THE SAME ID the SQL would have written, digit for digit, and that running it
 * twice, or on a database that never saw the old statements, changes nothing
 * the second time.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { goalIdFor } from "./seasonGoals";
import { backfillSeasonGoalIds } from "./seasonGoalIds";
import { GOAL_LINK_TABLES } from "../repos/sessionTemplates";

/** What the migration's SQL computed, written out here independently of goalIdFor. */
function sqlWouldHaveWritten(serves_goal: string): string {
  const sha1 = createHash("sha1").update(serves_goal.trim(), "utf8").digest("hex").toLowerCase();
  return "g" + sha1.slice(0, 11);
}

/**
 * A Queryable that stands in for the two tables, enforcing the one thing the
 * backfill's safety rests on: an UPDATE only touches rows whose id IS NULL.
 */
function fakeDb(rows: Record<string, { id: number; serves_goal: string | null; serves_goal_id: string | null }[]>) {
  const log: { sql: string; params: unknown[] }[] = [];
  const q = {
    async query(sql: string, params: unknown[] = []) {
      log.push({ sql, params });
      const table = /`(live_session_\w+)`/.exec(sql)?.[1] as string;
      const table_rows = rows[table] ?? [];
      if (sql.startsWith("SELECT DISTINCT")) {
        const words = new Set(
          table_rows
            .filter((r) => r.serves_goal_id === null && r.serves_goal !== null && r.serves_goal !== "")
            .map((r) => r.serves_goal as string),
        );
        return [[...words].map((serves_goal) => ({ serves_goal })), []];
      }
      const [goalId, words] = params as [string, string];
      let affectedRows = 0;
      for (const r of table_rows) {
        if (r.serves_goal_id === null && r.serves_goal === words && r.serves_goal !== "") {
          r.serves_goal_id = goalId;
          affectedRows += 1;
        }
      }
      return [{ affectedRows }, []];
    },
  };
  return { q: q as never, log, rows };
}

describe("the season-goal id backfill (0298, in TypeScript)", () => {
  it("writes exactly the id the migration's SQL would have written", () => {
    for (const text of ["Grow the garden", "  padded  ", "Ünïcøde goal", "one", ""]) {
      expect(goalIdFor(text)).toBe(sqlWouldHaveWritten(text));
    }
    // The shape the season editor and its tests pin.
    expect(goalIdFor("Grow the garden")).toMatch(/^g[0-9a-f]{11}$/);
  });

  it("gives every link that names a goal by words the id those words derive", async () => {
    const db = fakeDb({
      live_session_priorities: [
        { id: 1, serves_goal: "Grow the garden", serves_goal_id: null },
        { id: 2, serves_goal: "Grow the garden", serves_goal_id: null },
        { id: 3, serves_goal: "Open the barn", serves_goal_id: null },
      ],
      live_session_shares: [{ id: 9, serves_goal: "Grow the garden", serves_goal_id: null }],
    });
    const r = await backfillSeasonGoalIds(db.q);
    // Two distinct texts in one table, one in the other.
    expect(r).toEqual({ words: 3, rows: 4 });
    expect(db.rows.live_session_priorities.map((x) => x.serves_goal_id)).toEqual([
      goalIdFor("Grow the garden"),
      goalIdFor("Grow the garden"),
      goalIdFor("Open the barn"),
    ]);
    expect(db.rows.live_session_shares[0].serves_goal_id).toBe(goalIdFor("Grow the garden"));
    // One UPDATE per distinct text, not one per row: 3 SELECT-less updates + 2 selects.
    expect(db.log.filter((l) => l.sql.startsWith("UPDATE")).length).toBe(3);
  });

  it("is idempotent: a second run writes nothing and issues no UPDATE", async () => {
    const db = fakeDb({
      live_session_priorities: [{ id: 1, serves_goal: "Grow the garden", serves_goal_id: null }],
      live_session_shares: [],
    });
    const first = await backfillSeasonGoalIds(db.q);
    expect(first.rows).toBe(1);
    const before = db.rows.live_session_priorities[0].serves_goal_id;
    db.log.length = 0;
    const second = await backfillSeasonGoalIds(db.q);
    expect(second).toEqual({ words: 0, rows: 0 });
    expect(db.log.filter((l) => l.sql.startsWith("UPDATE")).length).toBe(0);
    expect(db.rows.live_session_priorities[0].serves_goal_id).toBe(before);
  });

  it("leaves a link that already has an id alone, whoever gave it one", async () => {
    const db = fakeDb({
      live_session_priorities: [
        // A member saved the season: the stored id is theirs, not the derived one.
        { id: 1, serves_goal: "Grow the garden", serves_goal_id: "gdeadbeef123" },
        { id: 2, serves_goal: "Grow the garden", serves_goal_id: null },
      ],
      live_session_shares: [],
    });
    await backfillSeasonGoalIds(db.q);
    expect(db.rows.live_session_priorities[0].serves_goal_id).toBe("gdeadbeef123");
    expect(db.rows.live_session_priorities[1].serves_goal_id).toBe(goalIdFor("Grow the garden"));
  });

  it("skips a goal with no words, and never writes an id for empty text", async () => {
    const db = fakeDb({
      live_session_priorities: [
        { id: 1, serves_goal: null, serves_goal_id: null },
        { id: 2, serves_goal: "", serves_goal_id: null },
        { id: 3, serves_goal: "   ", serves_goal_id: null },
      ],
      live_session_shares: [],
    });
    const r = await backfillSeasonGoalIds(db.q);
    expect(r).toEqual({ words: 0, rows: 0 });
    expect(db.rows.live_session_priorities.every((x) => x.serves_goal_id === null)).toBe(true);
  });

  it("names the two tables the migration named, and not the one it could not have filled", () => {
    // `live_session_entries`.`serves_goal` is NEW in 0298, so no row there can
    // carry words without an id and the SQL backfill never touched it either.
    expect([...GOAL_LINK_TABLES]).toEqual(["live_session_priorities", "live_session_shares"]);
  });
});
