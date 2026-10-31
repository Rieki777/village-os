/**
 * RECORDING A BANK TRANSFER AGAINST THE CASH A VILLAGE OWES (0285, 2026-10-30).
 *
 * Rye, 2026-10-30: "in admin for the finance roles we have a whole list of
 * cash that's yet to be paid out, so when a bank transfer is sent to pay out
 * that role we redeem their cash credits."
 *
 * Drives the real routes in server/routes/cashOwed.ts over HTTP, against a
 * scratch schema, with the REAL capability gate (`hasCapability` from
 * shared/capabilities.ts) deciding who holds `cash.pay`. What each case
 * defends:
 *
 *   a member holding no `cash.pay` reads nothing and pays nothing
 *   a transfer pays the picked lines and leaves the rest owed (partial)
 *   a second submit of the same transfer pays nothing twice, and says so
 *   two transfers racing on one line: exactly one wins
 *   the member gets one `cash_paid` notice per transfer
 *   the amounts are the rows' own, whatever the body says
 *   the CSV carries paid and unpaid lines
 */
import http from "node:http";
import express from "express";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasCapability, type CapabilityCtx } from "../shared/capabilities";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "./db/testDb";
import { register as registerCashOwed } from "./routes/cashOwed";
import { cashCsv, csvCell } from "./lib/cashOwed";

const configured = testDbConfigured();

const PEOPLE: Record<string, { id: string; name: string; caps: string[] }> = {
  treasurer: { id: "treasurer", name: "Tara", caps: ["cash.pay"] },
  second: { id: "second", name: "Sol", caps: ["cash.pay"] },
  ora: { id: "ora", name: "Ora", caps: [] },
  ben: { id: "ben", name: "Ben", caps: [] },
};

describe.skipIf(!configured)("recording a bank transfer against the cash owed", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let server: http.Server;
  let base = "";
  const notices: Array<{ userId: string; type: string; title: string; body?: string | null; dedupeKey: string }> = [];
  const viewer: { id: string | null } = { id: null };

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { // module-review-ok: the test client dialling its own in-process server on 127.0.0.1
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, body: json, text };
  };
  const as = (id: string | null) => { viewer.id = id; };

  const owe = async (id: string, userId: string, amountMinor: number, currency = "CRC", state = "owed") => {
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO `cash_owed` (`id`, `occurrence_key`, `user_id`, `work_kind`, `work_ref`, `work_title`, `amount_minor`, `currency`, `state`) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, `test:${id}`, userId, "role", "role-treasury", `Steward work ${id}`, amountMinor, currency, state],
    );
  };
  const stateOf = async (id: string) => {
    const [rows] = await pool.query<any[]>("SELECT * FROM `cash_owed` WHERE `id` = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return rows[0];
  };
  const transfer = (over: Record<string, unknown> = {}) => ({
    userId: "ora", ids: ["c1", "c2"], transferDate: "2026-10-29", reference: "BAC 77812", ...over,
  });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 6 });
    const app = express();
    app.use(express.json());
    const guardCapability = async (_req: any, res: any, cap: any) => {
      const who = viewer.id ? PEOPLE[viewer.id] : null;
      const ctx = { stageIndex: 0, stageIndexOf: () => 99, roleCapabilities: who?.caps ?? [] } as unknown as CapabilityCtx;
      if (who && hasCapability(cap, ctx)) return true;
      res.status(who ? 403 : 401).json({ error: who ? "forbidden" : "auth_required" });
      return false;
    };
    registerCashOwed(app, {
      authedUser: async () => (viewer.id ? { id: viewer.id, role: "member" } : null),
      getPool: () => pool,
      guardCapability,
      members: { byId: async (id: string) => PEOPLE[id] ?? null } as any,
      notify: async (n: any) => { notices.push(n); return { inserted: true } as any; },
      overLimit: async () => false,
      cashKeyHolders: async () => ["treasurer", "second"],
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `cash_owed`"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    notices.length = 0;
    await owe("c1", "ora", 2000000);
    await owe("c2", "ora", 500000, "CRC", "claimed");
    await owe("c3", "ora", 300000);
    await owe("c4", "ben", 100000, "USD");
  });

  it("refuses a member who holds no cash.pay, and pays nothing", async () => {
    as("ben");
    expect((await call("GET", "/api/cash-owed/queue")).status).toBe(403);
    expect((await call("GET", "/api/cash-owed/export.csv")).status).toBe(403);
    expect((await call("POST", "/api/cash-owed/transfers", transfer())).status).toBe(403);
    as(null);
    expect((await call("POST", "/api/cash-owed/transfers", transfer())).status).toBe(401);
    expect((await stateOf("c1")).state, "a refused transfer touched no row").toBe("owed");
    expect(notices).toEqual([]);
  });

  it("pays the picked lines and leaves the rest owed, recording who, when and the reference", async () => {
    as("treasurer");
    const out = await call("POST", "/api/cash-owed/transfers", transfer());
    expect(out.status).toBe(200);
    expect(out.body.paid).toBe(2);
    for (const id of ["c1", "c2"]) {
      const row = await stateOf(id);
      expect(row.state).toBe("paid");
      expect(row.paid_by).toBe("treasurer");
      expect(row.paid_at).not.toBeNull();
      expect(row.paid_note).toBe("Bank transfer on 2026-10-29. Reference: BAC 77812");
    }
    expect((await stateOf("c3")).state, "a partial transfer leaves the unpicked line owed").toBe("owed");
    expect(Number((await stateOf("c1")).amount_minor), "the amount is the row's own").toBe(2000000);

    const queue = await call("GET", "/api/cash-owed/queue?history=1");
    expect(queue.body.unpaid.map((e: any) => e.id).sort()).toEqual(["c3", "c4"]);
    expect(queue.body.paid.map((e: any) => e.id).sort()).toEqual(["c1", "c2"]);
    expect(queue.body.paid[0].paidByName).toBe("Tara");
  });

  it("sends the member one cash_paid notice per transfer", async () => {
    as("treasurer");
    await call("POST", "/api/cash-owed/transfers", transfer());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: "ora", type: "cash_paid" });
    expect(notices[0].title).toContain("2 pieces of work");
    expect(notices[0].body).toContain("BAC 77812");
    expect(notices[0].dedupeKey).toMatch(/^cash:transfer:/);

    await call("POST", "/api/cash-owed/transfers", transfer({ ids: ["c3"] }));
    expect(notices).toHaveLength(2);
    expect(notices[1].dedupeKey, "a one-line transfer keys like the one-line route").toBe("cash:c3:paid");
  });

  it("never pays a line twice: a second submit is a clear refusal and changes nothing", async () => {
    as("treasurer");
    expect((await call("POST", "/api/cash-owed/transfers", transfer())).status).toBe(200);
    const before = await stateOf("c1");
    const again = await call("POST", "/api/cash-owed/transfers", transfer({ reference: "again" }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_paid");
    expect(again.body.error).toMatch(/already recorded as paid/);
    expect((await stateOf("c1")).paid_note, "the first record stands").toBe(before.paid_note);
    expect(notices, "no second notice").toHaveLength(1);

    // A transfer overlapping a paid line pays none of it, not even the unpaid one.
    const overlap = await call("POST", "/api/cash-owed/transfers", transfer({ ids: ["c1", "c3"] }));
    expect(overlap.status).toBe(409);
    expect((await stateOf("c3")).state).toBe("owed");
  });

  it("lets exactly one of two racing transfers pay a line", async () => {
    as("treasurer");
    const [a, b] = await Promise.all([
      call("POST", "/api/cash-owed/transfers", transfer({ reference: "first" })),
      call("POST", "/api/cash-owed/transfers", transfer({ reference: "second" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(notices).toHaveLength(1);
  });

  it("refuses lines owed to another member, a missing reference, a future date, and paying yourself", async () => {
    as("treasurer");
    expect((await call("POST", "/api/cash-owed/transfers", transfer({ ids: ["c1", "c4"] }))).status).toBe(400);
    expect((await call("POST", "/api/cash-owed/transfers", transfer({ reference: "  " }))).status).toBe(400);
    expect((await call("POST", "/api/cash-owed/transfers", transfer({ transferDate: "2999-01-01" }))).status).toBe(400);
    expect((await call("POST", "/api/cash-owed/transfers", transfer({ transferDate: "2026-02-30" }))).status).toBe(400);
    expect((await call("POST", "/api/cash-owed/transfers", transfer({ ids: [] }))).status).toBe(400);
    await owe("c5", "treasurer", 1000);
    expect((await call("POST", "/api/cash-owed/transfers", { ...transfer(), userId: "treasurer", ids: ["c5"] })).status).toBe(409);
    expect((await stateOf("c1")).state).toBe("owed");
  });

  it("ignores any amount in the body: a transfer cannot edit what was owed", async () => {
    as("treasurer");
    await call("POST", "/api/cash-owed/transfers", { ...transfer({ ids: ["c1"] }), amountMinor: 1, amount_minor: 1 });
    expect(Number((await stateOf("c1")).amount_minor)).toBe(2000000);
  });

  it("exports paid and unpaid lines as CSV", async () => {
    as("treasurer");
    await call("POST", "/api/cash-owed/transfers", transfer({ ids: ["c1"] }));
    const csv = await call("GET", "/api/cash-owed/export.csv");
    expect(csv.status).toBe(200);
    const lines = csv.text.trim().split("\r\n");
    expect(lines[0]).toContain("member,member_id,work_kind");
    expect(lines).toHaveLength(5);
    expect(csv.text).toContain('"paid"');
    expect(csv.text).toContain('"owed"');
    expect(csv.text).toContain('"20000.00"');
  });

  it("defuses spreadsheet formulas and quotes in a CSV cell", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(cashCsv([])).toBe("member,member_id,work_kind,work,amount,amount_minor,currency,state,owed_at,claimed_at,paid_recorded_at,paid_by,payment_note,line_id\r\n");
  });
});
