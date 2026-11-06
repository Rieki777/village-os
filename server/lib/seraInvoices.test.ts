import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { insertInvoice } from "../repos/moonRecaps";
import { openFlags, seraReportsForInvoices, unmatchedSeraReports } from "../repos/invoiceRails";
import { readSeraInvoices, SERA_INVOICE_TOOL, type SeraInvoiceClient } from "./seraInvoices";

const configured = testDbConfigured();

const rec = (over: Record<string, unknown> = {}) => ({
  id: "sera-1", reference: "us-llc-0007", member: "cn-otter-12", moon: "lunar-000328", currency: "USD", amountMinor: 120000,
  status: "received", receivedAt: "2026-11-06T10:05:00.000Z", statusAt: "2026-11-06T10:05:00.000Z", changedAt: "2026-11-06T10:05:00.000Z", ...over,
});

describe.skipIf(!configured)("Sera's invoice records are read typed, stored once, and attached to one invoice or none", () => {
  let db: TestDb;
  let pool: Pool;
  let records: unknown[];
  let offered: boolean;
  let calls: Array<Record<string, unknown>>;
  let n = 0;
  const client = (): SeraInvoiceClient => ({
    toolNames: async () => ({ ok: true, names: offered ? ["list_records", SERA_INVOICE_TOOL] : ["list_records", "get_record"] }),
    list: async (args) => { calls.push(args); return { ok: true, value: { invoices: records } }; },
  });
  const codes: Record<string, string> = { "cn-otter-12": "u1" };
  const deps = { resolveCodeName: async (c: string) => codes[c] ?? null, now: () => new Date("2026-11-06T12:00:00.000Z"), newId: () => `f-${++n}` };

  const invoice = (id: string, userId: string, seq: number, totalMinor: number, payerKey = "us-llc", revision = 1) =>
    insertInvoice(pool, {
      id, recapId: `rc-${id}`, userId, cycleId: "lunar-000328", payerKey, revision, billRefSeq: seq, memberNumber: `N-${id}`,
      currency: "USD", totalMinor, linesJson: "[]", fromJson: "{}", attestationJson: "{}", externalInvoiceKey: null, voidOf: null,
    });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });
  beforeEach(async () => {
    for (const t of ["sera_invoice_reports", "treasury_sync_flags", "moon_invoices"]) await pool.query(`DELETE FROM \`${t}\` WHERE 1 = 1`); // module-review-ok: a test fixture on the scratch schema
    records = [rec()]; offered = true; calls = [];
    await invoice("mv-1", "u1", 7, 120000);
  });

  it("answers not offered while Sera lists no invoice tool, and calls nothing else", async () => {
    offered = false;
    expect(await readSeraInvoices(pool, client(), deps)).toEqual({ state: "not_offered" });
    expect(calls).toEqual([]);
  });

  it("answers not connected with no client, never a zero", async () => {
    expect(await readSeraInvoices(pool, null, deps)).toEqual({ state: "not_connected" });
  });

  it("matches by reference and stores the typed fields only", async () => {
    records = [{ ...rec(), body: "Dear Sera, my bank details are 12345678", note: "prose" }];
    expect(await readSeraInvoices(pool, client(), deps)).toMatchObject({ state: "read", read: 1, matched: 1 });
    const [r] = await seraReportsForInvoices(pool, ["mv-1"]);
    expect(r).toMatchObject({ id: "sera-1", matchBy: "reference", amountMinor: 120000 });
    const [raw] = await pool.query<any[]>("SELECT * FROM `sera_invoice_reports`"); // module-review-ok: a test fixture on the scratch schema
    expect(JSON.stringify(raw)).not.toContain("bank details");
  });

  it("reading the same record twice is one row, and the match stands", async () => {
    await readSeraInvoices(pool, client(), deps);
    records = [rec({ status: "approved", changedAt: "2026-11-07T00:00:00.000Z" })];
    await readSeraInvoices(pool, client(), deps);
    const [rows] = await pool.query<any[]>("SELECT * FROM `sera_invoice_reports`"); // module-review-ok: a test fixture on the scratch schema
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "approved", matched_invoice_id: "mv-1" });
  });

  it("asks only for what changed since the newest record it holds", async () => {
    await readSeraInvoices(pool, client(), deps);
    await readSeraInvoices(pool, client(), deps);
    expect(calls).toEqual([{}, { since: "2026-11-06T10:05:00.000Z" }]);
  });

  it("matches a direct email with no reference by code-name, moon, currency and exact amount", async () => {
    records = [rec({ id: "sera-2", reference: null })];
    expect(await readSeraInvoices(pool, client(), deps)).toMatchObject({ matched: 1 });
    expect((await seraReportsForInvoices(pool, ["mv-1"]))[0]).toMatchObject({ matchBy: "details" });
  });

  it("an unknown reference is kept unmatched and flagged to the Treasurer, never attached", async () => {
    records = [rec({ id: "sera-3", reference: "us-llc-0999" })];
    expect(await readSeraInvoices(pool, client(), deps)).toMatchObject({ unmatched: 1, matched: 0 });
    expect(await seraReportsForInvoices(pool, ["mv-1"])).toEqual([]);
    expect((await openFlags(pool)).map((f) => [f.kind, f.subject, f.userId])).toEqual([["sera_unmatched", "sera-3", null]]);
  });

  it("two invoices that fit is ambiguous, and nothing is attached", async () => {
    await invoice("mv-2", "u1", 8, 120000, "cr-srl");
    records = [rec({ id: "sera-4", reference: null })];
    expect(await readSeraInvoices(pool, client(), deps)).toMatchObject({ ambiguous: 1, matched: 0 });
    expect((await openFlags(pool))[0]).toMatchObject({ kind: "sera_unmatched", village: "2 invoices fit" });
  });

  it("an unmatched record is attached once the invoice it names is sent, and its flag resolves", async () => {
    records = [rec({ id: "sera-5", reference: "us-llc-0009" })];
    await readSeraInvoices(pool, client(), deps);
    expect(await openFlags(pool)).toHaveLength(1);
    await invoice("mv-9", "u1", 9, 120000, "us-llc", 2);
    records = [];
    await readSeraInvoices(pool, client(), deps);
    expect(await unmatchedSeraReports(pool)).toEqual([]);
    expect(await openFlags(pool)).toEqual([]);
    expect((await seraReportsForInvoices(pool, ["mv-9"]))[0]?.id).toBe("sera-5");
  });

  it("a record that breaks the contract is skipped and counted", async () => {
    records = [rec({ amountMinor: 1.5 }), rec({ id: "sera-6", status: "lost" }), "junk"];
    expect(await readSeraInvoices(pool, client(), deps)).toMatchObject({ read: 0, skipped: 3 });
  });

  it("a failed call is a named failure", async () => {
    const failing: SeraInvoiceClient = { ...client(), list: async () => ({ ok: false, why: "vendor-error" }) };
    expect(await readSeraInvoices(pool, failing, deps)).toEqual({ state: "failed", why: "vendor-error" });
  });

  it("a reference to another member's invoice from a record naming someone else is not attached", async () => {
    codes["cn-heron-40"] = "u2";
    records = [rec({ id: "sera-7", member: "cn-heron-40" })];
    expect(await readSeraInvoices(pool, client(), deps)).toMatchObject({ matched: 0, unmatched: 1 });
    expect(await seraReportsForInvoices(pool, ["mv-1"])).toEqual([]);
  });

  it("a record whose reference Sera corrects moves to the invoice it now names", async () => {
    await invoice("mv-8", "u1", 8, 120000, "cr-srl");
    records = [rec({ id: "sera-8" })];
    await readSeraInvoices(pool, client(), deps);
    expect((await seraReportsForInvoices(pool, ["mv-1"]))[0]?.id).toBe("sera-8");
    records = [rec({ id: "sera-8", reference: "cr-srl-0008", changedAt: "2026-11-07T00:00:00.000Z" })];
    await readSeraInvoices(pool, client(), deps);
    expect(await seraReportsForInvoices(pool, ["mv-1"])).toEqual([]);
    expect((await seraReportsForInvoices(pool, ["mv-8"]))[0]?.id).toBe("sera-8");
  });

  it("a stored unmatched record that matches on its next read closes its flag", async () => {
    records = [rec({ id: "sera-9", reference: "us-llc-0010" })];
    await readSeraInvoices(pool, client(), deps);
    expect(await openFlags(pool)).toHaveLength(1);
    await invoice("mv-10", "u1", 10, 120000, "us-llc", 2);
    records = [rec({ id: "sera-9", reference: "us-llc-0010", changedAt: "2026-11-07T00:00:00.000Z" })];
    await readSeraInvoices(pool, client(), deps);
    expect(await openFlags(pool)).toEqual([]);
  });

  it("one record that cannot be stored is skipped and never stops the read", async () => {
    records = [rec({ id: "sera-boom", reference: null, member: "cn-boom-1" }), rec({ id: "sera-ok" })];
    const throwing = { ...deps, resolveCodeName: async (c: string) => { if (c === "cn-boom-1") throw new Error("lookup failed"); return codes[c] ?? null; } };
    const out = await readSeraInvoices(pool, client(), throwing);
    expect(out).toMatchObject({ state: "read", matched: 1, skipped: 1 });
  });
});
