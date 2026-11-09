import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { SETTINGS_DOC_KEY } from "../../shared/moonRecap";
import { cancelInboxChange, confirmInboxChange, decideInbox, pendingInbox, type InboxDeps } from "./seraInboxChange";

const configured = testDbConfigured();

describe.skipIf(!configured)("changing Sera's inbox takes a second signer when two or more can sign (Rye, 6 Nov, C7)", () => {
  let db: TestDb;
  let pool: Pool;
  let signers: string[];
  let notified: Array<{ address: string; actor: string }>;
  let audits: string[];
  const deps = (): InboxDeps => ({
    getPool: () => pool,
    signers: async () => signers,
    notifyAll: async (address, actor) => { notified.push({ address, actor }); return 3; },
    audit: async (text) => { audits.push(text); },
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });
  const inboxNow = async () => ((await readConfigDocument<{ seraInbox?: string | null }>(pool, SETTINGS_DOC_KEY)) ?? {}).seraInbox ?? null;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });
  beforeEach(async () => {
    await pool.query("DELETE FROM `app_config` WHERE `config_key` IN (?, ?)", [SETTINGS_DOC_KEY, "sera-inbox-pending"]); // module-review-ok: a test fixture on the scratch schema
    await writeConfigDocument(pool, SETTINGS_DOC_KEY, { seraInbox: "old@example.test" });
    signers = ["t1", "t2"];
    notified = [];
    audits = [];
  });

  it("with two signers, a new address waits: the old one stays, nobody is told yet", async () => {
    const d = await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    expect(d.apply).toBe("old@example.test");
    expect(d.pending).toMatchObject({ address: "new@example.test", proposedBy: "t1" });
    expect(await pendingInbox(pool)).toMatchObject({ address: "new@example.test" });
    expect(notified).toEqual([]);
    expect(audits).toEqual(["sera-inbox:proposed"]);
  });

  it("the same signer cannot confirm their own change", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    expect(await confirmInboxChange(deps(), "t1")).toMatchObject({ ok: false, status: 409 });
    expect(await inboxNow()).toBe("old@example.test");
  });

  it("someone who cannot sign cannot confirm", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    expect(await confirmInboxChange(deps(), "member-9")).toMatchObject({ ok: false, status: 403 });
    expect(await inboxNow()).toBe("old@example.test");
  });

  it("a second signer's confirm applies it and tells every member the new address", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    expect(await confirmInboxChange(deps(), "t2")).toMatchObject({ ok: true, address: "new@example.test", notified: 3 });
    expect(await inboxNow()).toBe("new@example.test");
    expect(await pendingInbox(pool)).toBeNull();
    expect(notified).toEqual([{ address: "new@example.test", actor: "t2" }]);
    expect(audits).toEqual(["sera-inbox:proposed", "sera-inbox:confirmed"]);
  });

  it("with one signer or none, the change applies at once and every member is told", async () => {
    signers = ["t1"];
    const d = await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    expect(d).toMatchObject({ apply: "new@example.test", pending: null });
    expect(notified).toEqual([{ address: "new@example.test", actor: "t1" }]);
  });

  it("clearing the inbox applies at once, since it only stops mail, and drops any pending change", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    const d = await decideInbox(deps(), "old@example.test", null, "t2");
    expect(d).toMatchObject({ apply: null, pending: null });
    expect(await pendingInbox(pool)).toBeNull();
  });

  it("an unchanged address keeps a pending change as it is", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    const d = await decideInbox(deps(), "old@example.test", "old@example.test", "t2");
    expect(d.apply).toBe("old@example.test");
    expect(d.pending).toMatchObject({ address: "new@example.test" });
  });

  it("any signer may cancel a pending change; nothing to confirm afterwards", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    expect(await cancelInboxChange(deps(), "member-9")).toMatchObject({ ok: false, status: 403 });
    expect(await cancelInboxChange(deps(), "t2")).toMatchObject({ ok: true });
    expect(await confirmInboxChange(deps(), "t2")).toMatchObject({ ok: false, status: 409 });
    expect(await inboxNow()).toBe("old@example.test");
  });

  it("a change proposed while the settings moved on applies to the settings as they are now", async () => {
    await decideInbox(deps(), "old@example.test", "new@example.test", "t1");
    await writeConfigDocument(pool, SETTINGS_DOC_KEY, { seraInbox: "old@example.test", hostRateSource: "kept" });
    await confirmInboxChange(deps(), "t2");
    expect(await readConfigDocument(pool, SETTINGS_DOC_KEY)).toMatchObject({ seraInbox: "new@example.test", hostRateSource: "kept" });
  });
});
