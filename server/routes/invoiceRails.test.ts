import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { insertInvoice } from "../repos/moonRecaps";
import type { TreasuryDeps } from "../lib/holdingsReconcile";
import { minorToDecimal, register, SYNC_LIMIT } from "./invoiceRails";

describe("ledger minor units as an exact decimal", () => {
  it("divides by the token's decimals without floating point", () => {
    expect(minorToDecimal(1000, 2)).toBe("10.00");
    expect(minorToDecimal(5, 2)).toBe("0.05");
    expect(minorToDecimal(-5, 2)).toBe("-0.05");
    expect(minorToDecimal(42, 0)).toBe("42");
    expect(() => minorToDecimal(1.5, 2)).toThrow();
  });
});

describe.skipIf(!testDbConfigured())("the invoice rails' doors: the caller's own, the Treasurer's behind cash.pay, sync rate limited", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  const treasurers = new Set(["treasurer-1"]);
  const buckets = new Map<string, number>();
  let limitAsked: Array<[string, number, number]> = [];
  let seraClientCalls = 0;

  const treasury = (): TreasuryDeps => ({
    getPool: () => pool,
    ledgerTokens: async () => [],
    cashOwed: async () => [],
    chain: async () => ({ offered: false, tokens: [] }),
    seraClient: async () => { seraClientCalls++; return null; },
    resolveCodeName: async () => null,
    now: () => new Date("2026-11-06T12:00:00.000Z"),
    newId: () => `f-${Math.random()}`,
  });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 scratch-schema harness pool
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: (async (req: express.Request) => (req.header("x-user") ? { id: req.header("x-user"), role: "member" } : null)) as never,
      getPool: () => pool,
      members: { byId: async (id: string) => ({ id, name: id === "u1" ? "Ana" : id === "rick" ? "Rick Moss" : "Someone" }) } as never,
      rolesCarrying: () => [{ id: "treasury", name: "Treasury" }],
      roleHolders: () => [{ roleId: "treasury", userId: "rick" }],
      guardCapability: (async (req: express.Request, res: express.Response) => {
        if (treasurers.has(String(req.header("x-user")))) return true;
        res.status(req.header("x-user") ? 403 : 401).json({ error: "cash_pay_required" });
        return false;
      }) as never,
      overLimit: async (bucket, max, windowMs) => {
        limitAsked.push([bucket, max, windowMs]);
        const n = (buckets.get(bucket) ?? 0) + 1;
        buckets.set(bucket, n);
        return n > max;
      },
      treasury: treasury(),
      mail: { getPool: () => pool, post: async () => ({ status: "sent", messageId: null }) as never, seraInbox: async () => null, projectName: () => "T", identityOf: async () => ({ villageName: "V", codeName: null }), audit: async () => undefined },
      invoiceViewOf: async () => null,
    });
    server = await new Promise<http.Server>((ok) => { const s = app.listen(0, () => ok(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((ok) => server?.close(ok)); await pool?.end(); await db?.drop(); });
  beforeEach(async () => {
    for (const t of ["moon_invoices", "treasury_sync_views", "treasury_sync_flags", "health_events"]) await pool.query(`DELETE FROM \`${t}\` WHERE 1 = 1`); // module-review-ok: a test fixture on the scratch schema
    buckets.clear();
    limitAsked = [];
    await insertInvoice(pool, {
      id: "mv-1", recapId: "rc-1", userId: "u1", cycleId: "lunar-000328", payerKey: "us-llc", revision: 1, billRefSeq: 7, memberNumber: "N-1",
      currency: "USD", totalMinor: 120000, linesJson: "[]", fromJson: "{}", attestationJson: "{}", externalInvoiceKey: null, voidOf: null,
    });
  });

  const get = (path: string, user?: string) => fetch(base + path, { headers: user ? { "x-user": user } : {} }); // module-review-ok: a test fixture on the scratch schema
  const postTo = (path: string, user?: string) => fetch(base + path, { method: "POST", headers: user ? { "x-user": user } : {} }); // module-review-ok: a test fixture on the scratch schema

  it("a member reads their own invoice's track, and another member reads none of it", async () => {
    const mine = await (await get("/api/me/invoice-track", "u1")).json();
    expect(mine.tracks.map((t: any) => t.ref)).toEqual(["us-llc-0007"]);
    expect(mine.tracks[0].track.map((s: any) => s.step)).toEqual(["sent", "received", "approved", "paid"]);
    expect((await (await get("/api/me/invoice-track", "u2")).json()).tracks).toEqual([]);
    expect((await get("/api/me/invoice-track")).status).toBe(401);
  });

  it("the Treasurer's door is behind cash.pay: a member is refused, a holder reads every track", async () => {
    expect((await get("/api/cash-owed/invoice-track", "u1")).status).toBe(403);
    expect((await get("/api/cash-owed/invoice-track")).status).toBe(401);
    const r = await get("/api/cash-owed/invoice-track", "treasurer-1");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.tracks.map((t: any) => [t.invoiceId, t.memberName])).toEqual([["mv-1", "Ana"]]);
    expect(body).toHaveProperty("flags");
    expect(body).toHaveProperty("unmatched");
  });

  it("sync is one a minute per member, answers 429 with Retry-After, and another member is not limited", async () => {
    const first = await postTo("/api/me/treasury/sync", "u1");
    expect(first.status).toBe(200);
    const second = await postTo("/api/me/treasury/sync", "u1");
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    expect((await postTo("/api/me/treasury/sync", "u2")).status).toBe(200);
    expect(limitAsked[0]).toEqual(["treasury-sync:u1", SYNC_LIMIT.max, SYNC_LIMIT.windowMs]);
  });

  it("a sync is saved, read back without calling a source, and audited", async () => {
    const v = (await (await postTo("/api/me/treasury/sync", "u1")).json()).view;
    expect(v.sera).toBe("not_connected");
    expect(v.sources.sera.state).toBe("not_offered");
    const saved = (await (await get("/api/me/treasury", "u1")).json()).view;
    expect(saved.syncedAt).toBe(v.syncedAt);
    expect((await (await get("/api/me/treasury", "u2")).json()).view).toBeNull();
    await new Promise((ok) => setTimeout(ok, 50));
    const [rows] = await pool.query<any[]>("SELECT `text`, `audience`, `actor_user_id` FROM `health_events` WHERE `kind` = 'audit'"); // module-review-ok: a test fixture on the scratch schema
    expect(rows).toEqual([expect.objectContaining({ text: "treasury:synced:manual:flags-0", audience: "admin", actor_user_id: "u1" })]);
  });

  it("members pressing Sync inside a minute share one Sera read for the village", async () => {
    await postTo("/api/me/treasury/sync", "u1");
    await postTo("/api/me/treasury/sync", "u2");
    await postTo("/api/me/treasury/sync", "u3");
    expect(seraClientCalls).toBe(1);
  });

  it("names who approved as Role (FirstName) on the live doors, and stores no name in the sync view", async () => {
    await pool.query("UPDATE `moon_invoices` SET `status` = 'approved', `approved_at` = '2026-11-07 09:00:00', `approved_by` = 'rick' WHERE `id` = 'mv-1'"); // module-review-ok: a test fixture on the scratch schema
    const mine = await (await get("/api/me/invoice-track", "u1")).json();
    expect(mine.tracks[0].track[2]).toMatchObject({ step: "approved", done: true, actorLabel: "Treasury (Rick)" });
    const desk = await (await get("/api/cash-owed/invoice-track", "treasurer-1")).json();
    expect(desk.tracks[0].track[2].actorLabel).toBe("Treasury (Rick)");
    expect((await postTo("/api/me/treasury/sync", "u1")).status).toBe(200);
    const [rows] = await pool.query<any[]>("SELECT `view_json` FROM `treasury_sync_views`"); // module-review-ok: a test fixture on the scratch schema
    expect(rows.length).toBe(1);
    expect(String(rows[0].view_json)).toContain("us-llc-0007");
    expect(String(rows[0].view_json)).not.toContain("Rick");
  });
});
