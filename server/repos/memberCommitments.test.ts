/**
 * Commitment as data against a real schema (0383, lane E1).
 *
 *   - a member's word is a dated history: a new word is a new row, and the
 *     earlier word is still there, unchanged, after it;
 *   - the word that holds today is the latest one on or before today;
 *   - erasure leaves nothing;
 *   - a quest carries its percent through add, select and update;
 *   - a role carries its percent and its required flag through the admin write.
 *
 * Runs against the S5 harness. No TEST_DATABASE_URL: the suite skips (harness rule).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { commitmentHistory, commitmentNow, forgetCommitments, recordCommitment } from "./memberCommitments";
import { questsRepo } from "./quests";
import { createOrgRole, listOrgRoles, updateOrgRole } from "../lib/orgChart";
import { roleCard } from "../lib/roleCardProjection";

describe.skipIf(!testDbConfigured())("commitment percent against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 2 });
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM `member_commitments`"); // module-review-ok: fixture SQL against the scratch schema
  });

  it("keeps every word: a change is a new row and the earlier one is untouched", async () => {
    const first = await recordCommitment(pool, "m-wren", { pct: 80, period: "season", fromDate: "2026-09-01", note: "a quiet season" });
    const [[before]]: any = await pool.query("SELECT * FROM `member_commitments` WHERE `id` = ?", [first]); // module-review-ok: fixture SQL reads the row back whole
    await recordCommitment(pool, "m-wren", { pct: 40, period: "moon", fromDate: "2026-11-01", note: null });
    await recordCommitment(pool, "m-wren", { pct: 30, period: "week", fromDate: "2026-11-10", note: "harvest" });
    const history = await commitmentHistory(pool, "m-wren");
    expect(history.map((h) => h.pct)).toEqual([30, 40, 80]);
    const [[after]]: any = await pool.query("SELECT * FROM `member_commitments` WHERE `id` = ?", [first]); // module-review-ok: fixture SQL reads the row back whole
    expect(after).toEqual(before);
    const [[count]]: any = await pool.query("SELECT COUNT(*) AS n FROM `member_commitments` WHERE `user_id` = 'm-wren'"); // module-review-ok: fixture SQL counts rows
    expect(Number(count.n)).toBe(3);
  });

  it("the word that holds today is the latest on or before it; a later day waits", async () => {
    await recordCommitment(pool, "m-wren", { pct: 80, period: "season", fromDate: "2026-09-01", note: null });
    await recordCommitment(pool, "m-wren", { pct: 40, period: "moon", fromDate: "2026-11-01", note: null });
    await recordCommitment(pool, "m-wren", { pct: 100, period: "season", fromDate: "2026-12-01", note: null });
    expect((await commitmentNow(pool, "m-wren", "2026-11-12"))?.pct).toBe(40);
    expect((await commitmentNow(pool, "m-wren", "2026-12-02"))?.pct).toBe(100);
    expect(await commitmentNow(pool, "m-wren", "2026-08-01")).toBeNull();
    expect(await commitmentNow(pool, "m-other", "2026-11-12")).toBeNull();
  });

  it("erasure leaves nothing of the member's history and nothing of anyone else's goes", async () => {
    await recordCommitment(pool, "m-wren", { pct: 80, period: "season", fromDate: "2026-09-01", note: "mine" });
    await recordCommitment(pool, "m-kai", { pct: 50, period: "season", fromDate: "2026-09-01", note: null });
    await forgetCommitments(pool, "m-wren");
    expect(await commitmentHistory(pool, "m-wren")).toEqual([]);
    expect((await commitmentHistory(pool, "m-kai")).length).toBe(1);
  });

  it("a quest carries its percent through add, select and an update of another field", async () => {
    const quests = questsRepo(pool);
    await quests.add({ id: "q-sized", title: "Mulch the beds", gratitude: "", status: "Open", tags: [], order: 1, commitmentPct: 25 });
    expect((await quests.byId("q-sized"))?.commitmentPct).toBe(25);
    await quests.update("q-sized", (q) => { q.title = "Mulch the long beds"; });
    expect((await quests.byId("q-sized"))?.commitmentPct).toBe(25);
    await quests.update("q-sized", (q) => { q.commitmentPct = null; });
    expect((await quests.byId("q-sized"))?.commitmentPct).toBeNull();
    await quests.add({ id: "q-unsized", title: "Unsized", gratitude: "", status: "Open", tags: [], order: 2 });
    expect((await quests.byId("q-unsized"))?.commitmentPct).toBeNull();
  });

  it("a role carries its percent and whether it is required, and the card reads the stored value first", async () => {
    const id = await createOrgRole(pool as any, { name: "Land steward", commitmentPct: 100, commitmentRequired: true });
    let role = (await listOrgRoles(pool as any)).find((r) => r.id === id)!;
    expect(role.commitmentPct).toBe(100);
    expect(role.commitmentRequired).toBe(true);
    let card = roleCard(role, 0, "open", { terms: false, editing: false }, { words: { showPayRanges: false } });
    expect(card.commitmentPct).toBe(100);
    expect(card.commitmentRequired).toBe(true);
    await updateOrgRole(pool as any, id, { commitmentRequired: false, commitmentPct: 60 });
    role = (await listOrgRoles(pool as any)).find((r) => r.id === id)!;
    expect(role.commitmentPct).toBe(60);
    expect(role.commitmentRequired).toBe(false);
    card = roleCard(role, 0, "open", { terms: false, editing: false }, { words: { showPayRanges: false } });
    expect(card.commitmentRequired).toBe(false);
  });
});
