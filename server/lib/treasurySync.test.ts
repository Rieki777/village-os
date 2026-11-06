import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { insertInvoice } from "../repos/moonRecaps";
import { openFlags, openFlagsFor } from "../repos/invoiceRails";
import { balancesFor, memberAccount } from "./ledger";
import { unpaidCashOf } from "./formerMember";
import { SERA_INVOICE_TOOL, type SeraInvoiceClient } from "./seraInvoices";
import { syncTreasury, type TreasuryDeps } from "./treasurySync";

const configured = testDbConfigured();

/** A pool that records every statement it is asked to run, connections included. */
function spying(pool: Pool, seen: string[]): Pool {
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, prop, recv) {
        const v = Reflect.get(t, prop, recv);
        if (prop === "query" || prop === "execute") return (sql: unknown, ...rest: unknown[]) => { seen.push(typeof sql === "string" ? sql : String((sql as { sql?: string })?.sql ?? sql)); return (v as Function).call(t, sql, ...rest); };
        if (prop === "getConnection") return async () => wrap(await (v as Function).call(t));
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  return wrap(pool);
}

const SECRET_TOKEN = "sk-saberra-SECRET-9f8e7d";
const SECRET_RPC = "https://base-mainnet.example.test/v2/RPCKEY-123456";

describe.skipIf(!configured)("the treasury sync reconciles three sources, flags every difference, and moves nothing", () => {
  let db: TestDb;
  let base: Pool;
  let seen: string[];
  let chainAnswer: () => Promise<Awaited<ReturnType<TreasuryDeps["chain"]>>>;
  let seraRecords: unknown[];
  let seraOffered: boolean;
  let n = 0;

  const client = (): SeraInvoiceClient => ({
    toolNames: async () => ({ ok: true, names: seraOffered ? [SERA_INVOICE_TOOL] : ["list_records"] }),
    list: async () => ({ ok: true, value: seraRecords }),
  });
  const deps = (pool: Pool): TreasuryDeps => ({
    getPool: () => pool,
    ledgerTokens: async (uid) => Object.entries(await balancesFor(pool, memberAccount(uid))).map(([slug, amount]) => ({ slug, name: slug, amount: String(amount) })),
    cashOwed: async (uid) => (await unpaidCashOf(pool, uid)).map((c) => ({ currency: c.currency, owedMinor: c.amountMinor })),
    chain: () => chainAnswer(),
    seraClient: async () => client(),
    resolveCodeName: async () => null,
    now: () => new Date("2026-11-06T12:00:00.000Z"),
    newId: () => `flag-${++n}`,
  });

  beforeAll(async () => {
    db = await provisionTestDb();
    base = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
  });
  afterAll(async () => { await base?.end(); await db?.drop(); });
  beforeEach(async () => {
    for (const t of ["sera_invoice_reports", "treasury_sync_flags", "treasury_sync_views", "moon_invoices", "invoice_mail"]) await base.query(`DELETE FROM \`${t}\` WHERE 1 = 1`);
    seen = [];
    seraOffered = true;
    seraRecords = [];
    chainAnswer = async () => ({ offered: true, tokens: [{ slug: "equity", formatted: "0", readAt: "2026-11-06T12:00:00.000Z", stale: false }] });
    await insertInvoice(base, {
      id: "mv-1", recapId: "rc-1", userId: "u1", cycleId: "lunar-000328", payerKey: "us-llc", revision: 1, billRefSeq: 7, memberNumber: "N-1",
      currency: "USD", totalMinor: 120000, linesJson: "[]", fromJson: "{}", attestationJson: "{}", externalInvoiceKey: null, voidOf: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("a sync writes nothing to the ledger, the balances or cash owed, over every statement it sends", async () => {
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 99, status: "approved", receivedAt: "2026-11-06T10:00:00.000Z" }];
    chainAnswer = async () => ({ offered: true, tokens: [{ slug: "equity", formatted: "5", readAt: "2026-11-06T12:00:00.000Z", stale: false }] });
    await base.query("INSERT INTO `token_balances` (`account_id`, `token`, `balance`) VALUES (?, 'equity', 3) ON DUPLICATE KEY UPDATE `balance` = 3", [memberAccount("u1")]).catch(() => undefined);
    const spy = spying(base, seen);
    await syncTreasury(deps(spy), "u1", "manual");
    expect(seen.length).toBeGreaterThan(5);
    const writes = seen.filter((s) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP)\b/i.test(s));
    const touched = writes.filter((s) => /`?(token_ledger|token_balances|cash_owed|ledger_entries|transfers)`?/i.test(s));
    expect(touched).toEqual([]);
    expect(writes.every((s) => /(treasury_sync_views|treasury_sync_flags|sera_invoice_reports)/.test(s))).toBe(true);
  });

  it("shows Sera's amount beside Amora's and flags the difference, keeping Amora's as the figure", async () => {
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 110000, status: "received", receivedAt: "2026-11-06T10:00:00.000Z" }];
    const v = await syncTreasury(deps(base), "u1", "manual");
    expect(v.invoices[0]).toMatchObject({ ref: "us-llc-0007", amoraMinor: 120000, seraMinor: 110000, disagree: true });
    expect(v.tracks[0].track[1]).toMatchObject({ step: "received", done: true, by: "sera" });
    expect((await openFlagsFor(base, "u1")).map((f) => f.kind)).toEqual(["sera_amount_differs"]);
  });

  it("a second sync seeing the same difference writes no second flag", async () => {
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 110000, status: "received", receivedAt: "2026-11-06T10:00:00.000Z" }];
    await syncTreasury(deps(base), "u1", "manual");
    await syncTreasury(deps(base), "u1", "daily");
    const [rows] = await base.query<any[]>("SELECT COUNT(*) AS n FROM `treasury_sync_flags` WHERE `user_id` = 'u1'");
    expect(Number(rows[0].n)).toBe(1);
  });

  it("a flag resolves only when a sync read both sides and the difference is gone", async () => {
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 110000, status: "received", receivedAt: "2026-11-06T10:00:00.000Z", changedAt: "2026-11-06T10:00:00.000Z" }];
    await syncTreasury(deps(base), "u1", "manual");
    // Sera fails: the flag stays open.
    const failing = { ...deps(base), seraClient: async () => ({ ...client(), list: async () => ({ ok: false as const, why: "vendor-error" }) }) };
    const v = await syncTreasury(failing, "u1", "manual");
    expect(v.sources.sera.state).toBe("not_read");
    expect(await openFlagsFor(base, "u1")).toHaveLength(1);
    // Sera now agrees: the flag resolves.
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 120000, status: "received", receivedAt: "2026-11-06T10:00:00.000Z", changedAt: "2026-11-06T11:00:00.000Z" }];
    await syncTreasury(deps(base), "u1", "manual");
    expect(await openFlagsFor(base, "u1")).toEqual([]);
  });

  it("a chain balance that differs from the ledger is flagged; a failed chain read is not read and resolves nothing", async () => {
    chainAnswer = async () => ({ offered: true, tokens: [{ slug: "equity", formatted: "7", readAt: "2026-11-06T12:00:00.000Z", stale: false }] });
    const ledgerWithEquity = { ...deps(base), ledgerTokens: async () => [{ slug: "equity", name: "Equity", amount: "5" }] };
    const v = await syncTreasury(ledgerWithEquity, "u1", "manual");
    expect(v.tokens[0]).toMatchObject({ amora: "5", chain: "7", disagree: true });
    expect((await openFlagsFor(base, "u1")).map((f) => f.kind)).toEqual(["chain_differs"]);
    chainAnswer = async () => { throw new Error(`rpc down at ${SECRET_RPC}`); };
    const after = await syncTreasury(ledgerWithEquity, "u1", "manual");
    expect(after.sources.chain.state).toBe("not_read");
    expect(after.tokens[0].chain).toBeNull();
    expect(await openFlagsFor(base, "u1")).toHaveLength(1);
  });

  it("a ledger that could not be read resolves no chain flag", async () => {
    chainAnswer = async () => ({ offered: true, tokens: [{ slug: "equity", formatted: "7", readAt: "2026-11-06T12:00:00.000Z", stale: false }] });
    await syncTreasury({ ...deps(base), ledgerTokens: async () => [{ slug: "equity", name: "Equity", amount: "5" }] }, "u1", "manual");
    const v = await syncTreasury({ ...deps(base), ledgerTokens: async () => { throw new Error("db"); } }, "u1", "manual");
    expect(v.sources.amora.state).toBe("not_read");
    expect(await openFlagsFor(base, "u1")).toHaveLength(1);
  });

  it("Sera not offering invoices reads as not offered, and the rest still syncs", async () => {
    seraOffered = false;
    const v = await syncTreasury(deps(base), "u1", "manual");
    expect(v.sera).toBe("not_offered");
    expect(v.sources.sera.state).toBe("not_offered");
    expect(v.tracks).toHaveLength(1);
    expect(await openFlags(base)).toEqual([]);
  });

  it("two members with the same difference keep two flags", async () => {
    await insertInvoice(base, {
      id: "mv-2", recapId: "rc-2", userId: "u2", cycleId: "lunar-000328", payerKey: "us-llc", revision: 1, billRefSeq: 8, memberNumber: "N-2",
      currency: "USD", totalMinor: 120000, linesJson: "[]", fromJson: "{}", attestationJson: "{}", externalInvoiceKey: null, voidOf: null,
    });
    const d = { ...deps(base), ledgerTokens: async () => [{ slug: "equity", name: "Equity", amount: "5" }], chain: async () => ({ offered: true, tokens: [{ slug: "equity", formatted: "7", readAt: "x", stale: false }] }) };
    await syncTreasury(d, "u1", "manual");
    await syncTreasury(d, "u2", "manual");
    expect((await openFlags(base)).filter((f) => f.kind === "chain_differs")).toHaveLength(2);
  });

  it("logs neither the Saberra token nor the RPC address", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
    const bad = {
      ...deps(base),
      chain: async () => { throw new Error(`rpc down at ${SECRET_RPC}`); },
      seraClient: async () => ({ toolNames: async () => { throw new Error(`401 for token ${SECRET_TOKEN}`); }, list: async () => ({ ok: true as const, value: [] }) }),
    };
    const v = await syncTreasury(bad, "u1", "manual");
    expect(v.sources.chain.state).toBe("not_read");
    expect(JSON.stringify(v)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(v)).not.toContain("RPCKEY");
    expect(lines.join("\n")).not.toContain(SECRET_TOKEN);
    expect(lines.join("\n")).not.toContain("RPCKEY");
  });

  it("Sera paying an invoice the village voided is flagged, never dropped", async () => {
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 120000, status: "received", receivedAt: "2026-11-06T10:00:00.000Z" }];
    await syncTreasury(deps(base), "u1", "manual");
    await base.query("UPDATE `moon_invoices` SET `status` = 'void' WHERE `id` = 'mv-1'");
    seraRecords = [{ id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 120000, status: "paid", receivedAt: "2026-11-06T10:00:00.000Z", changedAt: "2026-11-07T10:00:00.000Z" }];
    const v = await syncTreasury(deps(base), "u1", "manual");
    expect(v.tracks).toEqual([]);
    expect(v.invoices[0]).toMatchObject({ ref: "us-llc-0007", status: "void", seraStatus: "paid", disagree: true });
    expect((await openFlagsFor(base, "u1")).map((f) => f.kind)).toEqual(["sera_status_differs"]);
  });

  it("two Sera records on one invoice are flagged, and the newest is the one compared", async () => {
    seraRecords = [
      { id: "s1", reference: "us-llc-0007", currency: "USD", amountMinor: 120000, status: "received", receivedAt: "2026-11-06T10:00:00.000Z", changedAt: "2026-11-06T10:00:00.000Z" },
      { id: "s2", reference: "us-llc-0007", currency: "USD", amountMinor: 120000, status: "paid", receivedAt: "2026-11-06T11:00:00.000Z", changedAt: "2026-11-06T11:00:00.000Z" },
    ];
    const v = await syncTreasury(deps(base), "u1", "manual");
    expect(v.invoices[0].seraStatus).toBe("paid");
    expect((await openFlagsFor(base, "u1")).map((f) => f.kind).sort()).toEqual(["sera_duplicate", "sera_status_differs"]);
  });

  it("a token the chain could not read, or a stale one, closes no flag", async () => {
    const d = (chain: Awaited<ReturnType<TreasuryDeps["chain"]>>) => ({ ...deps(base), ledgerTokens: async () => [{ slug: "equity", name: "Equity", amount: "5" }], chain: async () => chain });
    await syncTreasury(d({ offered: true, tokens: [{ slug: "equity", formatted: "7", readAt: "x", stale: false }] }), "u1", "manual");
    await syncTreasury(d({ offered: true, tokens: [{ slug: "equity", formatted: null, readAt: "x", stale: false }] }), "u1", "manual");
    expect(await openFlagsFor(base, "u1")).toHaveLength(1);
    await syncTreasury(d({ offered: true, tokens: [{ slug: "equity", formatted: "5", readAt: "x", stale: true }] }), "u1", "manual");
    expect(await openFlagsFor(base, "u1")).toHaveLength(1);
    await syncTreasury(d({ offered: true, tokens: [{ slug: "equity", formatted: "5", readAt: "x", stale: false }] }), "u1", "manual");
    expect(await openFlagsFor(base, "u1")).toEqual([]);
  });
});
