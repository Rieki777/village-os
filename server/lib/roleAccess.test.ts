/**
 * START RAISES GRANT TASKS, END RAISES REVOKE TASKS, RENEWAL WRITES THE NEXT
 * MOON, against a real scratch schema.
 */
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { LUNAR_CLOCK } from "../../shared/cycleClock";
import { configureAccessNotices, raiseGrantTasks, raiseRevokeTasks } from "./roleAccess";
import { endSeating, releaseSeatingsForUser } from "./orgChart";
import { runTermWatch } from "./stewardship";
import { carryOnCardsFor, fileCarryOn, renewAllFiled } from "./moonRenewal";
import { tasksForAssignment } from "../repos/roleAccess";

const configured = testDbConfigured();
const DAY = 86_400_000;

describe.skipIf(!configured)("access tasks and moon renewal", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  // The one raw query door of this fixture; the scratch schema is the test's own.
  const q = (sql: string, args?: unknown[]) => pool.query(sql, args); // module-review-ok: test fixture on a scratch schema
  const sent: Array<{ userId: string; dedupeKey: string; title: string }> = [];
  const admins: string[] = [];
  const deps = {
    notify: async (i: any) => void sent.push(i),
    notifyAdmins: async (_t: string, _title: string, key: string) => void admins.push(key),
  };

  const n = LUNAR_CLOCK.cycleNumberAt(new Date("2026-11-20T00:00:00Z"));
  const starts = LUNAR_CLOCK.startOf(n);
  const ends = LUNAR_CLOCK.startOf(n + 1);

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    // access_bundle is added by the role card's own migration; add it here when this tree predates it.
    const [cols]: any = await q("SHOW COLUMNS FROM org_roles LIKE 'access_bundle'");
    if (!cols.length) await q("ALTER TABLE org_roles ADD COLUMN access_bundle json NULL");
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });
  beforeEach(async () => {
    sent.length = 0;
    admins.length = 0;
    await q("DELETE FROM role_access_tasks");
    await q("DELETE FROM role_moon_renewals");
    await q("DELETE FROM org_role_assignments");
    await q("DELETE FROM org_roles");
    const bundle = JSON.stringify([
      { label: "Shared drive for the finance circle", grantingRoleId: "r-techops" },
      { label: "Bank portal, view only" },
    ]);
    await q("INSERT INTO org_roles (id, name, access_bundle) VALUES ('r-fin','Lead Financial Steward',?),('r-techops','Technical Operations',NULL)", [bundle]);
    await q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, started_at, term_ends_at) VALUES ('a-fin','r-fin','member','u-new','u-new',?,?)", [starts, ends]);
    await q("INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key) VALUES ('a-ops','r-techops','member','u-ops','u-ops')");
  });

  it("the start raises one grant task per item, told to the granting role or the admins, once", async () => {
    expect(await raiseGrantTasks(pool, "a-fin", deps)).toBe(2);
    const tasks = await tasksForAssignment(pool, "a-fin");
    expect(tasks.map((t) => [t.kind, t.state, t.itemLabel]).sort()).toEqual([
      ["grant", "open", "Bank portal, view only"],
      ["grant", "open", "Shared drive for the finance circle"],
    ]);
    expect(sent.map((s) => s.userId)).toEqual(["u-ops"]);
    expect(admins).toHaveLength(1);
    // A second start (a retry) raises nothing and tells nobody again.
    expect(await raiseGrantTasks(pool, "a-fin", deps)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("the end raises a revoke task for each item that was granted", async () => {
    await raiseGrantTasks(pool, "a-fin", deps);
    const tasks = await tasksForAssignment(pool, "a-fin");
    await q("UPDATE role_access_tasks SET state = 'not_needed' WHERE id = ?", [tasks.find((t) => t.itemLabel.startsWith("Bank"))!.id]);
    await q("UPDATE org_role_assignments SET ended_at = NOW() WHERE id = 'a-fin'");
    expect(await raiseRevokeTasks(pool, "a-fin", deps)).toBe(1);
    const revokes = (await tasksForAssignment(pool, "a-fin")).filter((t) => t.kind === "revoke");
    expect(revokes.map((t) => t.itemLabel)).toEqual(["Shared drive for the finance circle"]);
    expect(await raiseRevokeTasks(pool, "a-fin", deps)).toBe(0);
  });

  it("a role with no bundle raises nothing", async () => {
    expect(await raiseGrantTasks(pool, "a-ops", deps)).toBe(0);
  });

  it("the carry-on card shows only in the last week, and renewal writes the next moon", async () => {
    const early = new Date(starts.getTime() + 3 * DAY);
    expect(await carryOnCardsFor(pool, "u-new", early, LUNAR_CLOCK)).toEqual([]);
    expect((await fileCarryOn(pool, "u-new", "a-fin", "More of the same", early, LUNAR_CLOCK)).ok).toBe(false);

    const lateWeek = new Date(ends.getTime() - 3 * DAY);
    const cards = await carryOnCardsFor(pool, "u-new", lateWeek, LUNAR_CLOCK);
    expect(cards).toHaveLength(1);
    expect(cards[0].nextTermEndsAt).toBe(LUNAR_CLOCK.startOf(n + 2).toISOString());
    expect((await fileCarryOn(pool, "u-new", "a-fin", "Close the books for the moon", lateWeek, LUNAR_CLOCK)).ok).toBe(true);
    // Someone else's seating cannot be filed for.
    expect((await fileCarryOn(pool, "u-ops", "a-fin", "x", lateWeek, LUNAR_CLOCK)).ok).toBe(false);

    // Filing alone writes nothing.
    const [[before]]: any = await q("SELECT term_ends_at FROM org_role_assignments WHERE id = 'a-fin'");
    expect(new Date(before.term_ends_at).getTime()).toBe(ends.getTime());

    const out = await renewAllFiled(pool, "u-steward", LUNAR_CLOCK, deps.notify);
    expect(out.renewed).toHaveLength(1);
    const [[after]]: any = await q("SELECT term_ends_at FROM org_role_assignments WHERE id = 'a-fin'");
    expect(new Date(after.term_ends_at).getTime()).toBe(LUNAR_CLOCK.startOf(n + 2).getTime());
    // A second press renews nothing.
    expect((await renewAllFiled(pool, "u-steward", LUNAR_CLOCK)).renewed).toHaveLength(0);
  });
  describe("revoke tasks on EVERY way a role ends", () => {
    const revokesOf = async () => (await tasksForAssignment(pool, "a-fin")).filter((t) => t.kind === "revoke");
    beforeEach(async () => {
      configureAccessNotices(deps);
      await raiseGrantTasks(pool, "a-fin", deps);
      sent.length = 0;
      admins.length = 0;
    });

    it("the admin end door (endSeating)", async () => {
      expect(await endSeating(pool, "a-fin", "stepped down")).toBe(true);
      expect((await revokesOf()).map((t) => t.state)).toEqual(["open", "open"]);
      expect(sent.length + admins.length).toBeGreaterThan(0);
    });

    it("the holder leaving (releaseSeatingsForUser)", async () => {
      await releaseSeatingsForUser(pool, "u-new", "member left the village");
      expect(await revokesOf()).toHaveLength(2);
    });

    it("a term that ran out without renewal, until it is renewed", async () => {
      const lapsed = [{ id: "a-fin", orgRoleId: "r-fin", holderKind: "member", userId: "u-new", roleName: "Lead Financial Steward", daysLeft: null, lapsed: true, termEndsAt: ends, startedAt: starts }];
      await runTermWatch({ pool, clock: LUNAR_CLOCK, now: new Date(ends.getTime() + DAY), season: { current: { id: "s" } }, seatings: lapsed, notify: async () => ({ fresh: true }), notifyAdmins: async () => undefined });
      expect((await revokesOf()).map((t) => t.state)).toEqual(["open", "open"]);
      // The holder filed late and the role was renewed: the reminders are withdrawn.
      const late = new Date(ends.getTime() - 3 * DAY);
      await fileCarryOn(pool, "u-new", "a-fin", "Carry on", late, LUNAR_CLOCK);
      await renewAllFiled(pool, "u-steward", LUNAR_CLOCK);
      expect((await revokesOf()).map((t) => t.state)).toEqual(["not_needed", "not_needed"]);
    });
  });
});
