/**
 * THE CHANGE REQUEST STORE against a real scratch schema (migration 0330).
 *
 * Pinned here because only MySQL can answer it: every NOT NULL column is
 * filled, a revision keeps the earlier revision's rows, an edit on a stale
 * revision loses, and only a gathering change request can be edited or
 * deleted.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { changeRequestStore, type ChangeRequestStore, type StoredChange } from "./changeRequests";

const configured = testDbConfigured();

const dial = (to: string): StoredChange => ({
  position: 0,
  item: { kind: "dial", key: "governance.vote_days", to },
  changeKey: "governance.vote_days",
  beforeValue: "7",
  addedBy: "u-ana",
});
const brand: StoredChange = {
  position: 1,
  item: { kind: "brand_field", field: "project.tagline", to: "Hello" },
  changeKey: "brand:project.tagline",
  beforeValue: "Hi",
  addedBy: "u-ana",
};

describe.skipIf(!configured)("change_requests, change_request_items", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let store: ChangeRequestStore;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
    store = changeRequestStore(() => pool as any);
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM change_request_notes");
    await pool.query("DELETE FROM change_request_items");
    await pool.query("DELETE FROM change_requests");
  });

  it("saves a change request with its changes and reads it back whole", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "Garden hours", why: "Winter.", changes: [dial("9"), brand] });
    const cr = await store.byId("cr-1");
    expect(cr).toMatchObject({ id: "cr-1", authorUserId: "u-ana", authorKind: "member", state: "gathering", revision: 1, relation: null });
    expect(cr!.changes.map((c) => c.changeKey)).toEqual(["governance.vote_days", "brand:project.tagline"]);
    expect(cr!.changes[0].item).toEqual({ kind: "dial", key: "governance.vote_days", to: "9" });
    expect(cr!.changes[0].beforeValue).toBe("7");
  });

  it("writes a new revision and keeps the earlier one's rows as the record", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "Garden hours", why: "Winter.", changes: [dial("9")] });
    expect(await store.revise("cr-1", 1, { changes: [dial("10"), brand], why: "Winter, and the light." })).toBe(true);
    const cr = await store.byId("cr-1");
    expect(cr!.revision).toBe(2);
    expect(cr!.why).toBe("Winter, and the light.");
    expect(cr!.changes.map((c) => (c.item as any).to)).toEqual(["10", "Hello"]);
    const [old] = await pool.query<any[]>("SELECT revision, COUNT(*) AS n FROM change_request_items WHERE change_request_id = 'cr-1' GROUP BY revision ORDER BY revision");
    expect(old.map((r) => [Number(r.revision), Number(r.n)])).toEqual([[1, 1], [2, 2]]);
  });

  it("keeps the changes when a revision only rewords", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "Garden hours", why: "Winter.", changes: [dial("9"), brand] });
    expect(await store.revise("cr-1", 1, { title: "Kitchen hours" })).toBe(true);
    const cr = await store.byId("cr-1");
    expect(cr!.title).toBe("Kitchen hours");
    expect(cr!.changes).toHaveLength(2);
  });

  it("lets exactly one of two edits on the same revision win", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "Garden hours", why: "Winter.", changes: [dial("9")] });
    const [a, b] = await Promise.all([
      store.revise("cr-1", 1, { changes: [dial("10")] }),
      store.revise("cr-1", 1, { changes: [dial("11")] }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await store.byId("cr-1"))!.revision).toBe(2);
  });

  it("refuses to edit or delete a change request in the vote, and to delete one in review", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "Garden hours", why: "Winter.", changes: [dial("9")] });
    await pool.query("UPDATE change_requests SET state = 'in_review' WHERE id = 'cr-1'");
    expect(await store.remove("cr-1", 1)).toBe(false);
    await pool.query("UPDATE change_requests SET state = 'voting' WHERE id = 'cr-1'");
    expect(await store.revise("cr-1", 1, { title: "x" })).toBe(false);
    expect(await store.remove("cr-1", 1)).toBe(false);
    expect(await store.byId("cr-1")).not.toBeNull();
  });

  it("counts a member's gathering change requests and lists the open ones", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "a", why: "a" });
    await store.create({ id: "cr-2", authorUserId: "u-ana", title: "b", why: "b" });
    await store.create({ id: "cr-3", authorUserId: "u-sol", title: "c", why: "c" });
    await pool.query("UPDATE change_requests SET state = 'in_review' WHERE id = 'cr-2'");
    expect(await store.countGathering("u-ana")).toBe(1);
    expect((await store.byAuthor("u-ana")).map((c) => c.id).sort()).toEqual(["cr-1", "cr-2"]);
    expect((await store.open()).map((c) => c.id)).toEqual(["cr-2"]);
  });

  it("deletes a gathering change request and its changes", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "a", why: "a", changes: [dial("9")] });
    expect(await store.remove("cr-1", 2)).toBe(false);
    expect(await store.remove("cr-1", 1)).toBe(true);
    expect(await store.byId("cr-1")).toBeNull();
    const [left] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM change_request_items");
    expect(Number(left[0].n)).toBe(0);
  });

  it("opens review once, remembers the review length, and still lets the author revise in review", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "a", why: "a", changes: [dial("9")] });
    expect(await store.openReview("cr-1", 2, 3)).toBe(false);
    expect(await store.openReview("cr-1", 1, 3)).toBe(true);
    expect(await store.openReview("cr-1", 1, 3)).toBe(false);
    const open = (await store.byId("cr-1"))!;
    expect(open).toMatchObject({ state: "in_review", reviewDaysAtOpen: 3 });
    expect(open.reviewOpenedAt).not.toBeNull();
    await pool.query("UPDATE change_requests SET review_opened_at = '2026-01-01 00:00:00' WHERE id = 'cr-1'");
    expect(await store.revise("cr-1", 1, { title: "b" })).toBe(true);
    expect((await store.byId("cr-1"))!.reviewOpenedAt).toContain("2026-01-01");
    expect(await store.revise("cr-1", 2, { changes: [dial("10")] })).toBe(true);
    expect((await store.byId("cr-1"))!.reviewOpenedAt).not.toContain("2026-01-01");
  });

  it("takes notes only while in review, settles each once, and counts openings", async () => {
    await store.create({ id: "cr-1", authorUserId: "u-ana", title: "a", why: "a", changes: [dial("9")] });
    const note = { id: "n-1", changeRequestId: "cr-1", revision: 1, kind: "objection" as const, authorUserId: "u-sol", body: "It harms the kitchen." };
    expect(await store.addNote(note)).toBe(false);
    await store.openReview("cr-1", 1, 3);
    expect(await store.addNote(note)).toBe(true);
    expect(await store.addNote({ id: "n-2", changeRequestId: "cr-1", revision: 1, kind: "edit", authorUserId: "u-sol", position: 0, body: "Five.", proposedItem: { op: "replace", position: 0, change: { key: "governance.vote_days", to: "5" } } })).toBe(true);
    expect(await store.addNote({ id: "n-3", changeRequestId: "cr-1", revision: 1, kind: "system", authorUserId: "u-ana", body: "opened for review" })).toBe(true);
    const notes = await store.notesOf("cr-1");
    expect(notes.map((n) => [n.id, n.kind, n.outcome])).toEqual([["n-1", "objection", "open"], ["n-2", "edit", "open"], ["n-3", "system", "open"]]);
    expect(notes[1].proposedItem).toEqual({ op: "replace", position: 0, change: { key: "governance.vote_days", to: "5" } });
    expect(await store.settleNote("n-1", "answered")).toBe(true);
    expect(await store.settleNote("n-1", "answered")).toBe(false);
    expect(await store.openedForReviewSince("u-ana", new Date("2000-01-01"))).toBe(1);
    await pool.query("UPDATE change_requests SET state = 'voting' WHERE id = 'cr-1'");
    expect(await store.addNote({ ...note, id: "n-4" })).toBe(false);
  });
});
