/**
 * Task boards on by default (spec section 17, A6), on a real database.
 *
 *   40 With no access row a member's board is on; a steward's off row keeps
 *      it off; with `memberTasks.listDefault` false, behaviour matches the
 *      earlier one exactly (no row means off).
 *   41 `syncableLinks` includes a linked member who has no access row, and the
 *      steward panel's counts (`membersWithListOn`, `bridgeLists`) match
 *      `listIsOn` for every member.
 *
 * Every count has a bystander: a member with an explicit off row, who must
 * stay off under both defaults.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { listIsOn, membersWithListOn, setListOn } from "./memberTasks";
import { redirectPeople, syncableLinks } from "./memberTaskFeedback";
import { bridgeLists } from "./saberraBridge";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

describe.skipIf(!configured)("task boards on by default (A6) on a real database", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 harness pool against the scratch schema
    for (const [id, name] of [["u-none", "No row"], ["u-on", "On row"], ["u-off", "Off row"]]) {
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?, ?, ?, 'x')", [id, name, `${id}@example.org`]); // module-review-ok: fixture SQL against the S5 scratch schema
    }
    await setListOn(pool, "u-on", true, "steward");
    await setListOn(pool, "u-off", false, "steward");
    for (const [owner, uid] of [["o-none", "u-none"], ["o-on", "u-on"], ["o-off", "u-off"]]) {
      await pool.query("INSERT INTO `sera_person_links` (`sera_owner_id`, `user_id`, `how`) VALUES (?, ?, 'steward')", [owner, uid]); // module-review-ok: fixture SQL against the S5 scratch schema
    }
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("ships the variable on, in the words the addendum gives", () => {
    const def = VARIABLES_BY_KEY["memberTasks.listDefault"];
    expect([def?.type, def?.default, def?.label]).toEqual(["boolean", "true", "Every member has a task board unless a steward turns one off"]);
  });

  it("check 40: no row means on, a steward's off stays off, and the old default restores the old behaviour", async () => {
    expect([await listIsOn(pool, "u-none", true), await listIsOn(pool, "u-on", true), await listIsOn(pool, "u-off", true)]).toEqual([true, true, false]);
    expect([await listIsOn(pool, "u-none", false), await listIsOn(pool, "u-on", false), await listIsOn(pool, "u-off", false)]).toEqual([false, true, false]);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM `member_task_access`"); // module-review-ok: fixture read against the S5 scratch schema
    expect(Number(rows[0].n)).toBe(2);
  });

  it("check 41: the sync, the redirect list and the steward panel count by the same rule", async () => {
    for (const dflt of [true, false]) {
      const on = (await Promise.all(["u-none", "u-on", "u-off"].map(async (u) => ((await listIsOn(pool, u, dflt)) ? u : null)))).filter(Boolean);
      expect((await syncableLinks(pool, dflt)).map((l) => l.userId).sort()).toEqual(on);
      expect(await membersWithListOn(pool, dflt)).toEqual(on);
      expect((await redirectPeople(pool, "nobody", dflt)).map((p) => p.id).sort()).toEqual(on);
      const have = new Set(["member_tasks", "member_task_access", "sera_person_links"]);
      const lists = await bridgeLists(pool, have, dflt);
      expect(lists.listsOn).toBe(on.length);
      expect(Object.fromEntries((lists.people ?? []).map((p) => [p.name, p.listOn]))).toEqual({ "No row": dflt, "On row": true, "Off row": false });
    }
  });
});
