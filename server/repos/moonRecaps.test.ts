/**
 * The end-of-moon review's store (server/repos/moonRecaps.ts) on a real
 * database: drizzle/0313 and 0314 applied by the S5 harness, every claim
 * about rows. No TEST_DATABASE_URL and the suite skips (harness rule); CI
 * runs it on the pull_request run.
 *
 * Named checks from the build spec, section 12, that the store holds:
 *   5  the same piece of work never arrives twice in one recap, and a done
 *      task's private detail and minutes never leave member_tasks;
 *   6  a key another recap of the member holds is reported, so gather skips it;
 *   8  the SQL itself refuses the member's own approval and the same person
 *      giving both, unless the caller passes the widening approvalDecision
 *      granted, and a self-approval is marked on the row;
 *   9  Take back, and an edit after an approval, clear both approvals;
 *   16 erasure clears words and the route, and keeps amounts, numbers and events.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import {
  clearApprovals, confirmPayRoute, doneTasksBetween, ensureRecap, forgetMoonReviews, insertInvoice, insertItem, insertReviewEvent,
  invoiceById, itemsOf, keysInOtherRecaps, markRecapSent, memberNumbersOf, nextBillRefSeq, payRouteOf, recapById,
  setFinanceApproved, setInvoiceApproved, setWorkApproved, takeBackRecap, upsertPayRoute, type ItemInsert,
  goalsFor, insertGoal, scoreGoal, updateItem, writeScoreSnapshot, claimNudge, itemKeysOf, mergePackItem,
} from "./moonRecaps";

const configured = testDbConfigured();
let db: TestDb;
let pool: mysql.Pool;

const item = (over: Partial<ItemInsert>): ItemInsert => ({
  id: "mi-0000000000000001", recapId: "mr-0000000000000001", origin: "task", dedupeKey: "task:t1", text: "Wrote the water plan",
  originNote: null, doneOn: null, evidenceUrl: null, roleId: "r1", seasonGoalId: null, state: "suggested", visibility: "members", position: 0, ...over,
});

const ROUTE = {
  route: "abroad" as const, payerKey: "us-payer", currency: "USD", legalName: "A Member", address: "Somewhere", statusValidUntil: null,
  taxFormKind: "form-a", taxFormSignedOn: "2026-01-01", taxFormExpiresOn: null, taxFormFiledWhere: "Finance drive",
};

describe.skipIf(!configured)("moon review store on a real database", () => {
  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 harness pool against the scratch schema
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("makes one recap per member per moon, and a second ensure returns the first", async () => {
    const a = await ensureRecap(pool, { id: "mr-0000000000000001", userId: "u1", cycleId: "lunar-000331", seasonId: "s1" });
    const b = await ensureRecap(pool, { id: "mr-00000000000000ff", userId: "u1", cycleId: "lunar-000331", seasonId: "s1" });
    expect(b.id).toBe(a.id);
    expect(a.status).toBe("draft");
  });

  it("never holds one piece of work twice in a recap (check 5)", async () => {
    expect(await insertItem(pool, item({}))).toBe(true);
    expect(await insertItem(pool, item({ id: "mi-0000000000000002" }))).toBe(false);
    expect(await insertItem(pool, item({ id: "mi-0000000000000003", origin: "sera", dedupeKey: "sera:ext-1" }))).toBe(true);
    expect(await insertItem(pool, item({ id: "mi-0000000000000004", origin: "sera", dedupeKey: "sera:ext-1" }))).toBe(false);
    expect((await itemsOf(pool, "mr-0000000000000001")).map((i) => i.id)).toEqual(["mi-0000000000000001", "mi-0000000000000003"]);
  });

  it("reports the keys the member's other recaps hold (check 6)", async () => {
    await ensureRecap(pool, { id: "mr-0000000000000002", userId: "u1", cycleId: "lunar-000332", seasonId: "s1" });
    const held = await keysInOtherRecaps(pool, "u1", "mr-0000000000000002", ["task:t1", "task:t9"]);
    expect([...held]).toEqual(["task:t1"]);
    expect([...(await keysInOtherRecaps(pool, "u2", "mr-0000000000000002", ["task:t1"]))]).toEqual([]);
  });

  it("reads a done task's title and tags, never its private detail or minutes (check 5)", async () => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `member_tasks` (`id`, `user_id`, `title`, `private_detail`, `minutes`, `status`, `source`, `created_on`, `done_at`, `role_id`) " +
        "VALUES ('t1', 'u1', 'Water plan', 'my private journal words', 90, 'done', 'self', '2026-10-20', '2026-10-21 12:00:00', 'r1')",
    );
    const tasks = await doneTasksBetween(pool, "u1", null, "2026-11-09T07:03:00Z");
    expect(tasks).toEqual([{ id: "t1", title: "Water plan", source: "self", externalId: null, doneAt: "2026-10-21T12:00:00.000Z", roleId: "r1", servesGoalId: null }]);
    expect(await doneTasksBetween(pool, "u1", "2026-10-22T00:00:00Z", "2026-11-09T07:03:00Z")).toEqual([]);
  });

  it("refuses the member's own approval and one person giving both, in the SQL (check 8)", async () => {
    expect(await markRecapSent(pool, "mr-0000000000000001", 0)).toBe(1);
    expect(await markRecapSent(pool, "mr-0000000000000001", 0)).toBe(0);
    expect(await setWorkApproved(pool, { id: "mr-0000000000000001", by: "u1", hash: "h", nextStatus: "waiting" })).toBe(0);
    expect(await setWorkApproved(pool, { id: "mr-0000000000000001", by: "ops", hash: "h", nextStatus: "waiting" })).toBe(1);
    expect(await setFinanceApproved(pool, { id: "mr-0000000000000001", by: "ops", hash: "h" })).toBe(0);
    expect(await setFinanceApproved(pool, { id: "mr-0000000000000001", by: "fin", hash: "other" })).toBe(0);
    expect(await setFinanceApproved(pool, { id: "mr-0000000000000001", by: "fin", hash: "h" })).toBe(1);
    expect((await recapById(pool, "mr-0000000000000001"))?.status).toBe("approved");
  });

  it("clears both approvals on an edit after approval, and on Take back (check 9)", async () => {
    expect(await clearApprovals(pool, "mr-0000000000000001")).toBe(1);
    const r = await recapById(pool, "mr-0000000000000001");
    expect([r?.status, r?.workApprovedBy, r?.financeApprovedBy, r?.approvalHash]).toEqual(["waiting", null, null, null]);
    await setWorkApproved(pool, { id: "mr-0000000000000001", by: "ops", hash: "h2", nextStatus: "waiting" });
    expect(await takeBackRecap(pool, "mr-0000000000000001")).toBe(1);
    const t = await recapById(pool, "mr-0000000000000001");
    expect([t?.status, t?.workApprovedBy, t?.approvalHash]).toEqual(["draft", null, null]);
  });

  it("confirms a route only for somebody else, and a change can clear the confirmation", async () => {
    await upsertPayRoute(pool, "u1", ROUTE, true);
    expect(await confirmPayRoute(pool, "u1", "u1")).toBe(0);
    expect(await confirmPayRoute(pool, "u1", "fin")).toBe(1);
    expect((await payRouteOf(pool, "u1"))?.confirmedBy).toBe("fin");
    await upsertPayRoute(pool, "u1", { ...ROUTE, address: "Elsewhere" }, true);
    expect((await payRouteOf(pool, "u1"))?.confirmedBy).toBeNull();
  });

  it("keeps the member's own invoice number, refuses reusing it, and numbers bill refs per payer", async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      expect(await nextBillRefSeq(conn, "us-payer")).toBe(1);
      await insertInvoice(conn, {
        id: "mv-0000000000000001", recapId: "mr-0000000000000001", userId: "u1", cycleId: "lunar-000331", payerKey: "us-payer", revision: 1,
        billRefSeq: 1, memberNumber: "2026-001", currency: "USD", totalMinor: 100_000, linesJson: "[]", fromJson: "{\"legalName\":\"A Member\"}",
        attestationJson: "{\"workCountries\":[\"US\"]}", externalInvoiceKey: null, voidOf: null,
      });
      await conn.commit();
      expect(await nextBillRefSeq(conn, "us-payer")).toBe(2);
    } finally {
      conn.release();
    }
    expect(await memberNumbersOf(pool, "u1")).toEqual(["2026-001"]);
    await expect(insertInvoice(pool, {
      id: "mv-0000000000000002", recapId: "mr-0000000000000002", userId: "u1", cycleId: "lunar-000332", payerKey: "us-payer", revision: 1,
      billRefSeq: 2, memberNumber: "2026-001", currency: "USD", totalMinor: 1, linesJson: "[]", fromJson: "{}", attestationJson: "{}", externalInvoiceKey: null, voidOf: null,
    })).rejects.toThrow(/Duplicate/);
  });

  it("a widening the rule granted passes the SQL and marks the row; without it the SQL refuses (decisions 18 and 19)", async () => {
    await ensureRecap(pool, { id: "mr-0000000000000005", userId: "fin", cycleId: "lunar-000331", seasonId: null });
    expect(await markRecapSent(pool, "mr-0000000000000005", 0)).toBe(1);
    expect(await setWorkApproved(pool, { id: "mr-0000000000000005", by: "fin", hash: "h", nextStatus: "waiting" })).toBe(0);
    expect(await setWorkApproved(pool, { id: "mr-0000000000000005", by: "fin", hash: "h", nextStatus: "waiting", selfApproved: true })).toBe(1);
    expect(await setFinanceApproved(pool, { id: "mr-0000000000000005", by: "fin", hash: "h", selfApproved: true })).toBe(0);
    expect(await setFinanceApproved(pool, { id: "mr-0000000000000005", by: "fin", hash: "h", selfApproved: true, alone: true })).toBe(1);
    const r = await recapById(pool, "mr-0000000000000005");
    expect([r?.status, r?.selfApproved]).toEqual(["approved", true]);
    await ensureRecap(pool, { id: "mr-0000000000000006", userId: "u6", cycleId: "lunar-000331", seasonId: null });
    await markRecapSent(pool, "mr-0000000000000006", 0);
    await setWorkApproved(pool, { id: "mr-0000000000000006", by: "st", hash: "h", nextStatus: "waiting" });
    expect(await setFinanceApproved(pool, { id: "mr-0000000000000006", by: "st", hash: "h", alone: true })).toBe(1);
    expect((await recapById(pool, "mr-0000000000000006"))?.selfApproved).toBe(false);
    await insertInvoice(pool, {
      id: "mv-0000000000000005", recapId: "mr-0000000000000005", userId: "fin", cycleId: "lunar-000331", payerKey: "us-payer", revision: 1,
      billRefSeq: 5, memberNumber: "F-1", currency: "USD", totalMinor: 10, linesJson: "[]", fromJson: "{}", attestationJson: "{}", externalInvoiceKey: null, voidOf: null,
    });
    const approve = { id: "mv-0000000000000005", by: "fin", hash: "h", expectedOn: "2026-11-20", linesJson: "[]", fxRate: null, fxSource: null, fxDate: null };
    expect(await setInvoiceApproved(pool, approve)).toBe(0);
    expect(await setInvoiceApproved(pool, { ...approve, selfApproved: true })).toBe(1);
    expect((await invoiceById(pool, "mv-0000000000000005"))?.selfApproved).toBe(true);
  });

  it("keeps an item's task status and set day, and writes the score snapshot in half-points (decision 20)", async () => {
    await insertItem(pool, item({ id: "mi-0000000000000010", dedupeKey: "task:t10", setOn: "2026-10-15" }));
    expect(await updateItem(pool, "mi-0000000000000010", { taskStatus: "let_go", letGoReason: "No longer needed", belongsToRoleId: "r9" })).toBe(1);
    const it10 = (await itemsOf(pool, "mr-0000000000000001")).find((i) => i.id === "mi-0000000000000010");
    expect([it10?.setOn, it10?.taskStatus, it10?.letGoReason, it10?.belongsToRoleId, it10?.dedupeKey]).toEqual(["2026-10-15", "let_go", "No longer needed", "r9", "task:t10"]);
    await writeScoreSnapshot(pool, "mr-0000000000000001", { taskNumHalves: 25, taskDen: 18, seatOn: 3, seatTotal: 4, goalNumHalves: 5, goalDen: 4 });
    expect((await recapById(pool, "mr-0000000000000001"))?.score).toEqual({ taskNumHalves: 25, taskDen: 18, seatOn: 3, seatTotal: 4, goalNumHalves: 5, goalDen: 4 });
  });

  it("holds one goal per position, carries a goal once, and scores it (check 21's rows)", async () => {
    const g = { userId: "u1", cycleId: "lunar-000332", text: "Goal 1", doneWhen: null, seasonGoalId: null, carriedFromId: null, carryCount: 0 };
    expect(await insertGoal(pool, { ...g, id: "mg-1", position: 0 })).toBe(true);
    expect(await insertGoal(pool, { ...g, id: "mg-2", position: 0 })).toBe(false);
    expect(await insertGoal(pool, { ...g, id: "mg-3", position: 1, carriedFromId: "mg-old", carryCount: 2 })).toBe(true);
    expect(await insertGoal(pool, { ...g, id: "mg-4", position: 2, carriedFromId: "mg-old", carryCount: 2 })).toBe(false);
    expect(await scoreGoal(pool, "mg-1", "u1", "done", null)).toBe(1);
    expect((await goalsFor(pool, "u1", "lunar-000332")).map((x) => [x.id, x.status, x.carryCount])).toEqual([["mg-1", "done", 0], ["mg-3", "open", 2]]);
  });

  it("writes a deep-dive item with its proof kind and day, and merges a pack's Sera task into the one already held (A1, check 25)", async () => {
    expect(await insertItem(pool, item({
      id: "mi-0000000000000020", origin: "claude", dedupeKey: "claude:0123456789abcdef0123456789abcdef", state: "kept", visibility: "approvers",
      taskStatus: "partly", evidenceKind: "mail", evidenceOn: "2026-10-20", belongsToSeatWords: "Land role", roleId: null,
    }))).toBe(true);
    await insertItem(pool, item({ id: "mi-0000000000000021", origin: "sera", dedupeKey: "sera:ext-21", text: "From the sync" }));
    const keys = await itemKeysOf(pool, "mr-0000000000000001");
    expect(keys.get("sera:ext-21")).toBe("mi-0000000000000021");
    expect(await mergePackItem(pool, "mi-0000000000000021", "mr-0000000000000001", { text: "From the pack", taskStatus: "done", redirectTo: null, letGoReason: null, evidenceKind: "sera", evidenceUrl: null, evidenceOn: "2026-10-22", roleId: "r1", seasonGoalId: null })).toBe(1);
    const all = await itemsOf(pool, "mr-0000000000000001");
    const deep = all.find((i) => i.id === "mi-0000000000000020");
    expect([deep?.origin, deep?.evidenceKind, deep?.evidenceOn, deep?.belongsToSeatWords, deep?.visibility, deep?.taskStatus]).toEqual(["claude", "mail", "2026-10-20", "Land role", "approvers", "partly"]);
    const merged = all.filter((i) => i.dedupeKey === "sera:ext-21");
    expect(merged.map((i) => [i.text, i.taskStatus, i.state, i.evidenceOn])).toEqual([["From the pack", "done", "kept", "2026-10-22"]]);
  });

  it("claims each reminder once per member, cycle and kind (B1, check 28's store)", async () => {
    expect(await claimNudge(pool, "u1", "lunar-000331", "eom_prep")).toBe(true);
    expect(await claimNudge(pool, "u1", "lunar-000331", "eom_prep")).toBe(false);
    expect(await claimNudge(pool, "u1", "lunar-000331", "eom_day")).toBe(true);
    expect(await claimNudge(pool, "u2", "lunar-000331", "eom_prep")).toBe(true);
  });

  it("erasure clears words and the route, and keeps amounts, numbers and events (check 16)", async () => {
    await insertReviewEvent(pool, { recapId: "mr-0000000000000001", invoiceId: "mv-0000000000000001", userId: "u1", kind: "sent", actorUserId: "u1", actorRole: null, amountMinor: 100_000, currency: "USD", hash: null, note: "a note" });
    await insertReviewEvent(pool, { recapId: "mr-0000000000000005", invoiceId: null, userId: "fin", kind: "self_approved", actorUserId: "fin", actorRole: "treasury", amountMinor: null, currency: null, hash: "h", note: null, selfApproved: true });
    const [mark] = await pool.query<mysql.RowDataPacket[]>("SELECT `self_approved` FROM `moon_review_events` WHERE `kind` = 'self_approved'"); // module-review-ok: fixture read against the S5 scratch schema
    expect(mark.map((m) => Number(m.self_approved))).toEqual([1]);
    await ensureRecap(pool, { id: "mr-0000000000000009", userId: "bystander", cycleId: "lunar-000331", seasonId: null });
    await insertItem(pool, item({ id: "mi-0000000000000009", recapId: "mr-0000000000000009", text: "Bystander's work" }));
    expect((await itemsOf(pool, "mr-0000000000000001"))[0].text).toBe("Wrote the water plan");
    expect(await forgetMoonReviews(pool, "u1")).toBeGreaterThan(0);
    expect((await itemsOf(pool, "mr-0000000000000001")).every((i) => i.text === "" && i.letGoReason === null)).toBe(true);
    expect((await goalsFor(pool, "u1", "lunar-000332")).every((x) => x.text === "")).toBe(true);
    const [nudges] = await pool.query<mysql.RowDataPacket[]>("SELECT `user_id` FROM `moon_nudges` ORDER BY `user_id`"); // module-review-ok: fixture read against the S5 scratch schema
    expect(nudges.map((r) => String(r.user_id))).toEqual(["u2"]);
    expect(await payRouteOf(pool, "u1")).toBeNull();
    const inv = await invoiceById(pool, "mv-0000000000000001");
    expect([inv?.totalMinor, inv?.memberNumber, inv?.billRefSeq, inv?.fromJson, inv?.attestation]).toEqual([100_000, "2026-001", 1, null, null]);
    const [ev] = await pool.query<mysql.RowDataPacket[]>("SELECT `amount_minor`, `note` FROM `moon_review_events` WHERE `user_id` = 'u1'"); // module-review-ok: fixture read against the S5 scratch schema
    expect(ev.map((e) => [Number(e.amount_minor), e.note])).toEqual([[100_000, null]]);
    expect((await itemsOf(pool, "mr-0000000000000009"))[0].text).toBe("Bystander's work");
  });
});
