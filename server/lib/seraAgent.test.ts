/**
 * Sera's agent account, undoable actions only (addendum v6, B7), on a real
 * database. What each case pins:
 *
 *   55  every tool writes an action row with what puts it back, and its undo
 *       restores the state exactly; an undo after a person touched the thing
 *       is refused with the reason
 *   56  nothing here notifies a member: no notification row is written by any
 *       tool or undo
 *   57  link_sera_person never replaces a steward link and never links one
 *       owner to two members, or one member to two owners
 *   plus the 30-day window, and an agent undoing only its own actions
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { runSeraTool, seraDigest, seraDigestLink, undoSeraAction, type SeraActor } from "./seraAgent";
import { ensureRecap } from "../repos/moonRecaps";
import { listAgentActions } from "../repos/agentAccounts";
import { setListOn } from "../repos/memberTasks";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const sera: SeraActor = { userId: "u-sera", tokenId: "atk-sera", tokenPrefix: "vat_sera" };
const deps = { listDefault: true, today: "2026-11-03" };

async function one(sql: string, params: unknown[] = []): Promise<any> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, params); // module-review-ok: fixture read against the S5 scratch schema
  return rows[0];
}
const notifications = async () => Number((await one("SELECT COUNT(*) AS n FROM `notifications`")).n);

describe.skipIf(!configured)("Sera's agent: undoable actions only (B7)", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 harness pool against the scratch schema
    for (const [id, name] of [["u-sera", "Sera (agent)"], ["u-ana", "Ana"], ["u-ben", "Ben"], ["u-cara", "Cara"]]) {
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES (?, ?, ?, 'x')", [id, name, `${id}@example.org`]); // module-review-ok: fixture SQL against the S5 scratch schema
    }
    // Ben's link is a steward's.
    await pool.query("INSERT INTO `sera_person_links` (`sera_owner_id`, `user_id`, `how`) VALUES ('owner-ben-0001', 'u-ben', 'steward')"); // module-review-ok: fixture SQL against the S5 scratch schema
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("check 57: never replaces a steward link, never doubles an owner or a member", async () => {
    const before = await notifications();
    const steal = await runSeraTool(pool, sera, "link_sera_person", { userId: "u-ana", seraOwnerId: "owner-ben-0001" }, deps);
    expect(steal.ok).toBe(false);
    expect(await one("SELECT `user_id`, `how` FROM `sera_person_links` WHERE `sera_owner_id` = 'owner-ben-0001'")).toMatchObject({ user_id: "u-ben", how: "steward" });
    const second = await runSeraTool(pool, sera, "link_sera_person", { userId: "u-ben", seraOwnerId: "owner-other-01" }, deps);
    expect(second.ok).toBe(false);

    const made = await runSeraTool(pool, sera, "link_sera_person", { userId: "u-ana", seraOwnerId: "owner-ana-0001" }, deps);
    expect(made.ok).toBe(true);
    expect(await one("SELECT `user_id`, `how`, `linked_by_user_id` FROM `sera_person_links` WHERE `sera_owner_id` = 'owner-ana-0001'")).toMatchObject({ user_id: "u-ana", how: "sera", linked_by_user_id: null });
    const twice = await runSeraTool(pool, sera, "link_sera_person", { userId: "u-cara", seraOwnerId: "owner-ana-0001" }, deps);
    expect(twice.ok).toBe(false);
    expect(await notifications()).toBe(before);
  });

  it("check 55: a link's undo removes exactly that link, and is refused once a steward rewrote it", async () => {
    const made = await runSeraTool(pool, sera, "link_sera_person", { userId: "u-cara", seraOwnerId: "owner-cara-001" }, deps);
    expect(made.ok).toBe(true);
    const id = made.ok ? String(made.result.actionId) : "";
    expect(await undoSeraAction(pool, id, "u-steward", null)).toEqual({ ok: true });
    expect(await one("SELECT COUNT(*) AS n FROM `sera_person_links` WHERE `sera_owner_id` = 'owner-cara-001'")).toMatchObject({ n: 0 });
    expect(await undoSeraAction(pool, id, "u-steward", null)).toMatchObject({ ok: false, status: 409 });

    const ana = (await listAgentActions(pool, { scope: "sera.undoable" })).find((a) => a.tool === "link_sera_person" && a.subjectUserId === "u-ana" && a.state === "done")!;
    await pool.query("UPDATE `sera_person_links` SET `how` = 'steward', `linked_by_user_id` = 'u-steward' WHERE `sera_owner_id` = 'owner-ana-0001'"); // module-review-ok: a steward rewriting the link, as the import does
    const refused = await undoSeraAction(pool, ana.id, "u-steward", null);
    expect(refused).toMatchObject({ ok: false, status: 409 });
    if (!refused.ok) expect(refused.error).toContain("steward");
    expect(await one("SELECT `how` FROM `sera_person_links` WHERE `sera_owner_id` = 'owner-ana-0001'")).toMatchObject({ how: "steward" });
  });

  it("check 55: a suggestion's undo removes it while untouched, and is refused once the member kept it", async () => {
    const before = await notifications();
    const a = await runSeraTool(pool, sera, "suggest_task", { userId: "u-ana", title: "Check the water tank" }, deps);
    const b = await runSeraTool(pool, sera, "suggest_task", { userId: "u-ana", title: "Sort the seed store" }, deps);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await one("SELECT `source`, `status`, `version` FROM `member_tasks` WHERE `id` = ?", [a.result.taskId])).toMatchObject({ source: "assistant", status: "open", version: 1 });

    expect(await undoSeraAction(pool, String(a.result.actionId), "u-steward", null)).toEqual({ ok: true });
    expect(await one("SELECT COUNT(*) AS n FROM `member_tasks` WHERE `id` = ?", [a.result.taskId])).toMatchObject({ n: 0 });

    // Ana edits the second one: it is hers now.
    await pool.query("UPDATE `member_tasks` SET `version` = `version` + 1, `member_edited` = 1 WHERE `id` = ?", [b.result.taskId]); // module-review-ok: the member's own edit, as patchTask writes it
    const refused = await undoSeraAction(pool, String(b.result.actionId), "u-steward", null);
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect(await one("SELECT COUNT(*) AS n FROM `member_tasks` WHERE `id` = ?", [b.result.taskId])).toMatchObject({ n: 1 });
    expect(await notifications()).toBe(before);
  });

  it("check 55: a board switch's undo puts back the row that was there, or no row", async () => {
    const off = await runSeraTool(pool, sera, "set_board_access", { userId: "u-cara", on: false }, deps);
    expect(off.ok).toBe(true);
    expect(await one("SELECT `list_on` FROM `member_task_access` WHERE `user_id` = 'u-cara'")).toMatchObject({ list_on: 0 });
    if (off.ok) expect(await undoSeraAction(pool, String(off.result.actionId), "u-steward", null)).toEqual({ ok: true });
    expect(await one("SELECT COUNT(*) AS n FROM `member_task_access` WHERE `user_id` = 'u-cara'")).toMatchObject({ n: 0 });

    await setListOn(pool, "u-ben", true, "u-steward");
    const benOff = await runSeraTool(pool, sera, "set_board_access", { userId: "u-ben", on: false }, deps);
    if (benOff.ok) expect(await undoSeraAction(pool, String(benOff.result.actionId), "u-steward", null)).toEqual({ ok: true });
    expect(await one("SELECT `list_on`, `set_by_user_id` FROM `member_task_access` WHERE `user_id` = 'u-ben'")).toMatchObject({ list_on: 1, set_by_user_id: "u-steward" });

    const again = await runSeraTool(pool, sera, "set_board_access", { userId: "u-ben", on: false }, deps);
    await setListOn(pool, "u-ben", true, "u-steward");
    if (again.ok) expect(await undoSeraAction(pool, String(again.result.actionId), "u-steward", null)).toMatchObject({ ok: false, status: 409 });
  });

  it("undoes only within 30 days, and an agent only its own actions", async () => {
    const made = await runSeraTool(pool, sera, "suggest_task", { userId: "u-ben", title: "Old one" }, deps);
    if (!made.ok) throw new Error("fixture");
    const id = String(made.result.actionId);
    expect(await undoSeraAction(pool, id, "u-other", "u-other")).toMatchObject({ ok: false, status: 404 });
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await undoSeraAction(pool, id, "u-steward", null, later)).toMatchObject({ ok: false, status: 410 });
    expect(await undoSeraAction(pool, id, "u-sera", "u-sera")).toEqual({ ok: true });
  });

  it("refuses its own account and an unknown member", async () => {
    expect((await runSeraTool(pool, sera, "set_board_access", { userId: "u-sera", on: true }, deps)).ok).toBe(false);
    expect((await runSeraTool(pool, sera, "set_board_access", { userId: "u-nobody", on: true }, deps)).ok).toBe(false);
  });

  it("writes an undo row for every undo", async () => {
    const undos = (await listAgentActions(pool, { scope: "sera.undoable", limit: 500 })).filter((a) => a.tool === "undo_sera_action");
    expect(undos.length).toBe(5);
  });

  it("check 55: an agenda draft lands as a waiting library item from Sera's agent, and its undo removes it while untouched", async () => {
    const made = await runSeraTool(pool, sera, "draft_agenda_item", { title: "Water rota for the dry season", note: "From three members' tasks" }, deps);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const id = Number(made.result.libraryId);
    expect(await one("SELECT `status`, `brought_by_no` FROM `live_session_library` WHERE `id` = ?", [id])).toMatchObject({ status: "waiting", brought_by_no: 0 });
    expect(await one("SELECT `kind` FROM `live_session_library_sources` WHERE `library_id` = ?", [id])).toMatchObject({ kind: "sera_agent" });
    expect(await undoSeraAction(pool, String(made.result.actionId), "u-steward", null)).toEqual({ ok: true });
    expect(await one("SELECT COUNT(*) AS n FROM `live_session_library` WHERE `id` = ?", [id])).toMatchObject({ n: 0 });

    const kept = await runSeraTool(pool, sera, "draft_agenda_item", { title: "Seed exchange" }, deps);
    if (!kept.ok) throw new Error("fixture");
    await pool.query("UPDATE `live_session_library` SET `edited_by_no` = 7 WHERE `id` = ?", [kept.result.libraryId]); // module-review-ok: a person editing the draft, as the library route does
    expect(await undoSeraAction(pool, String(kept.result.actionId), "u-steward", null)).toMatchObject({ ok: false, status: 409 });
    expect((await runSeraTool(pool, sera, "draft_agenda_item", { title: "x", circleId: "no-such-circle" }, deps)).ok).toBe(false);
  });

  it("check 55: a moon suggestion goes only on a Draft recap, and its undo removes it while it is still a suggestion", async () => {
    expect((await runSeraTool(pool, sera, "suggest_moon_item", { userId: "u-ana", cycleId: "2026-10", text: "Fixed the pump" }, deps)).ok).toBe(false);
    const recap = await ensureRecap(pool, { id: "mr-ana", userId: "u-ana", cycleId: "2026-10", seasonId: null });
    const made = await runSeraTool(pool, sera, "suggest_moon_item", { userId: "u-ana", cycleId: "2026-10", text: "Fixed the pump" }, deps);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(await one("SELECT `origin`, `state`, `visibility` FROM `moon_recap_items` WHERE `id` = ?", [made.result.itemId])).toMatchObject({ origin: "sera", state: "suggested", visibility: "approvers" });
    expect(await undoSeraAction(pool, String(made.result.actionId), "u-steward", null)).toEqual({ ok: true });

    const kept = await runSeraTool(pool, sera, "suggest_moon_item", { userId: "u-ana", cycleId: "2026-10", text: "Cleared the drain" }, deps);
    if (!kept.ok) throw new Error("fixture");
    await pool.query("UPDATE `moon_recap_items` SET `state` = 'kept' WHERE `id` = ?", [kept.result.itemId]); // module-review-ok: the member keeping it, as the item route does
    expect(await undoSeraAction(pool, String(kept.result.actionId), "u-steward", null)).toMatchObject({ ok: false, status: 409 });

    await pool.query("UPDATE `moon_recaps` SET `status` = 'waiting' WHERE `id` = ?", [recap.id]); // module-review-ok: the member sending the recap
    expect((await runSeraTool(pool, sera, "suggest_moon_item", { userId: "u-ana", cycleId: "2026-10", text: "Late one" }, deps)).ok).toBe(false);
  });

  it("check 59: the digest counts the day's actions and says nothing on a quiet day", async () => {
    const d = await seraDigest(pool);
    expect(d?.count).toBeGreaterThan(0);
    // It says what the agent changed: refusals and undos are not counted, and the words name who can undo.
    expect(d?.body).not.toContain("undid");
    expect(d?.body).toContain("an admin can undo");
    const done = (await listAgentActions(pool, { scope: "sera.undoable", limit: 500 })).filter((a) => a.state === "done" && a.tool !== "undo_sera_action");
    expect(d?.count).toBe(done.length);
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await seraDigest(pool, later)).toBeNull();
    // From the last summary on: nothing after "now" is counted twice.
    expect(await seraDigest(pool, new Date(Date.now() + 60_000), new Date(Date.now() + 1000))).toBeNull();
  });

  describe("the hardening from the adversarial reviews", () => {
    beforeAll(async () => {
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `is_agent`) VALUES ('u-bot', 'Ops bot', 'u-bot@example.org', 'x', 1)"); // module-review-ok: fixture SQL against the S5 scratch schema
      await pool.query("INSERT INTO `users` (`id`, `name`, `email`, `password_hash`) VALUES ('u-gone', 'Gone', 'gone-1@anonymized.invalid', 'x'), ('u-dee', 'Dee', 'u-dee@example.org', 'x'), ('u-eli', 'Eli', 'u-eli@example.org', 'x')"); // module-review-ok: fixture SQL against the S5 scratch schema
    });

    it("acts only on a member who stands and is a person", async () => {
      const gone = await runSeraTool(pool, sera, "suggest_task", { userId: "u-gone", title: "Nothing" }, deps);
      expect(gone).toMatchObject({ ok: false, error: "There is no member with that id." });
      const bot = await runSeraTool(pool, sera, "set_board_access", { userId: "u-bot", on: true }, deps);
      expect(bot.ok).toBe(false);
      if (!bot.ok) expect(bot.error).toContain("agent");
    });

    it("writes nothing into a module that is not open to members", async () => {
      const closed = { ...deps, moduleOpen: (id: string) => id !== "saberra" && id !== "sessions" && id !== "moon-review" };
      for (const [tool, args] of [
        ["link_sera_person", { userId: "u-dee", seraOwnerId: "owner-dee-0001" }],
        ["draft_agenda_item", { title: "Closed" }],
        ["suggest_moon_item", { userId: "u-dee", cycleId: "2026-10", text: "Closed" }],
      ] as const) {
        const out = await runSeraTool(pool, sera, tool, args as Record<string, unknown>, closed);
        expect(out.ok, tool).toBe(false);
      }
      expect(await one("SELECT COUNT(*) AS n FROM `sera_person_links` WHERE `user_id` = 'u-dee'")).toMatchObject({ n: 0 });
      // The board has no module: it still answers.
      expect((await runSeraTool(pool, sera, "suggest_task", { userId: "u-dee", title: "Still open" }, closed)).ok).toBe(true);
    });

    it("refuses words past the limits and shapes it does not know, and never cuts them", async () => {
      const long = "x".repeat(121);
      expect((await runSeraTool(pool, sera, "suggest_task", { userId: "u-dee", title: long }, deps)).ok).toBe(false);
      expect((await runSeraTool(pool, sera, "draft_agenda_item", { title: long }, deps)).ok).toBe(false);
      expect((await runSeraTool(pool, sera, "draft_agenda_item", { title: "Fine", note: "y".repeat(601) }, deps)).ok).toBe(false);
      expect((await runSeraTool(pool, sera, "draft_agenda_item", { title: "Fine", aim: "shout" }, deps)).ok).toBe(false);
      expect((await runSeraTool(pool, sera, "link_sera_person", { userId: "u-dee", seraOwnerId: "o/../x" }, deps)).ok).toBe(false);
      const fine = await runSeraTool(pool, sera, "draft_agenda_item", { title: "Fine", aim: "decide" }, deps);
      expect(fine.ok).toBe(true);
    });

    it("links as `sera`, which the steward panel names", async () => {
      const made = await runSeraTool(pool, sera, "link_sera_person", { userId: "u-dee", seraOwnerId: "owner-dee-0001" }, deps);
      expect(made.ok).toBe(true);
      const { memberLinks } = await import("../repos/seraPersonLinks");
      const rows = await memberLinks(pool);
      expect(rows.find((r) => r.userId === "u-dee")?.how).toBe("sera");
    });

    it("leaves alone a board a person switched", async () => {
      await setListOn(pool, "u-eli", false, "u-ana");
      const out = await runSeraTool(pool, sera, "set_board_access", { userId: "u-eli", on: true }, deps);
      expect(out.ok).toBe(false);
      expect(await one("SELECT `list_on`, `set_by_user_id` FROM `member_task_access` WHERE `user_id` = 'u-eli'")).toMatchObject({ list_on: 0, set_by_user_id: "u-ana" });
    });

    it("undoes the later of two board switches on one member first, and two suggestions each alone", async () => {
      const first = await runSeraTool(pool, sera, "set_board_access", { userId: "u-dee", on: false }, deps);
      if (!first.ok) throw new Error("fixture");
      await pool.query("UPDATE `agent_actions` SET `created_at` = `created_at` - INTERVAL 5 SECOND WHERE `id` = ?", [first.result.actionId]); // module-review-ok: the first action, a moment earlier
      // The same switch again: the row reads exactly as the first left it, so only the order check stops the first undo.
      const second = await runSeraTool(pool, sera, "set_board_access", { userId: "u-dee", on: false }, deps);
      if (!second.ok) throw new Error("fixture");
      const early = await undoSeraAction(pool, String(first.result.actionId), "u-steward", null);
      expect(early).toMatchObject({ ok: false, status: 409 });
      expect(await undoSeraAction(pool, String(second.result.actionId), "u-steward", null)).toEqual({ ok: true });
      expect(await undoSeraAction(pool, String(first.result.actionId), "u-steward", null)).toEqual({ ok: true });
      expect(await one("SELECT COUNT(*) AS n FROM `member_task_access` WHERE `user_id` = 'u-dee'")).toMatchObject({ n: 0 });

      const a = await runSeraTool(pool, sera, "suggest_task", { userId: "u-dee", title: "First suggestion" }, deps);
      if (!a.ok) throw new Error("fixture");
      await pool.query("UPDATE `agent_actions` SET `created_at` = `created_at` - INTERVAL 5 SECOND WHERE `id` = ?", [a.result.actionId]); // module-review-ok: the first action, a moment earlier
      const b = await runSeraTool(pool, sera, "suggest_task", { userId: "u-dee", title: "Second suggestion" }, deps);
      if (!b.ok) throw new Error("fixture");
      expect(await undoSeraAction(pool, String(a.result.actionId), "u-steward", null)).toEqual({ ok: true });
    });

    it("leaves a moon item the member reworded, and an agenda draft a room took", async () => {
      await ensureRecap(pool, { id: "mr-dee", userId: "u-dee", cycleId: "2026-10", seasonId: null });
      const item = await runSeraTool(pool, sera, "suggest_moon_item", { userId: "u-dee", cycleId: "2026-10", text: "Mended the fence" }, deps);
      if (!item.ok) throw new Error("fixture");
      await pool.query("UPDATE `moon_recap_items` SET `text` = 'Mended the long fence' WHERE `id` = ?", [item.result.itemId]); // module-review-ok: the member rewording it, still a suggestion
      expect(await undoSeraAction(pool, String(item.result.actionId), "u-steward", null)).toMatchObject({ ok: false, status: 409 });

      const draft = await runSeraTool(pool, sera, "draft_agenda_item", { title: "Taken once" }, deps);
      if (!draft.ok) throw new Error("fixture");
      await pool.query("INSERT INTO `live_session_library_takes` (`session_id`, `library_id`, `item_id`, `taken_by_no`) VALUES (1, ?, 1, 3)", [draft.result.libraryId]); // module-review-ok: a session taking the draft, as the agenda route does
      expect(await undoSeraAction(pool, String(draft.result.actionId), "u-steward", null)).toMatchObject({ ok: false, status: 409 });
    });
  });
});

describe("where the daily summary opens", () => {
  it("opens the panel with each Undo for an admin, and gives an approver who is not an admin no admin link", () => {
    expect(seraDigestLink(true)).toBe("/admin?tab=players");
    expect(seraDigestLink(false)).toBeNull();
  });
});
