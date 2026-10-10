/**
 * The village's own seat presets (seat settings PR3): who may read them, and
 * the founding write's one hard rule.
 *
 * THE READ IS THE OPEN BOOK'S GATE. A village's presets carry its figures, so
 * `GET /api/seat-presets` answers a reader holding `terms.read` (the member
 * rung) and answers a visitor and a signed-in guest 401 with nothing in the
 * body. The 401s are checked with a pool that THROWS, which proves the refusal
 * comes before the document is ever read. The member's 200 is the positive
 * control and runs against a scratch schema.
 *
 * Every figure is fake: XTS is the ISO 4217 code reserved for testing.
 */
import http from "node:http";
import express from "express";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CapabilityCtx } from "../../shared/capabilities";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { register } from "./seatPresets";

const LADDER = ["visitor", "guest", "member"];
const at = (stage: string): CapabilityCtx => ({
  stageIndex: LADDER.indexOf(stage),
  stageIndexOf: (id: string) => LADDER.indexOf(id),
  roleCapabilities: [],
});

const FAKE_ROW = {
  id: "custom:test-stipend",
  group: "pay",
  label: "Test stipend",
  blurb: "A made-up figure for tests.",
  version: 1,
  values: { kind: "fixed", currency: "XTS", amountMinor: 100000, per: "month" },
  retiredAt: null,
};

/** One loopback server, with the reader and the pool swappable per case. */
function harness() {
  const state: { viewer: { id: string; stage: string } | null; admin: boolean; pool: () => any } = {
    viewer: null,
    admin: false,
    pool: () => {
      throw new Error("the document was read before the gate answered");
    },
  };
  let server: http.Server;
  let base = "";
  const start = async () => {
    const app = express();
    app.use(express.json());
    register(app, {
      authedUser: async () => (state.viewer ? { id: state.viewer.id } : null) as any,
      isAdmin: async () => state.admin,
      capabilityCtx: async () => at(state.viewer?.stage ?? "visitor"),
      getPool: () => state.pool(),
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
    base = `http://127.0.0.1:${addr.port}`;
  };
  const stop = () => new Promise<void>((resolve) => server?.close(() => resolve()));
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, { // module-review-ok: this suite's own loopback server, not an outbound call
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { state, start, stop, call };
}

describe("GET /api/seat-presets refuses everyone below the member rung", () => {
  const h = harness();
  beforeAll(h.start);
  afterAll(h.stop);

  it("a visitor gets 401 and no presets", async () => {
    h.state.viewer = null;
    const r = await h.call("GET", "/api/seat-presets");
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("presets");
  });

  it("a signed-in guest gets 401 and no presets, though a guest reads names on the map", async () => {
    h.state.viewer = { id: "u-guest", stage: "guest" };
    const r = await h.call("GET", "/api/seat-presets");
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("presets");
  });

  it("the admin routes refuse a non-admin, member or not", async () => {
    h.state.viewer = { id: "u-member", stage: "member" };
    h.state.admin = false;
    expect((await h.call("GET", "/api/admin/seat-presets")).status).toBe(401);
    expect((await h.call("PUT", "/api/admin/seat-presets", { presets: [FAKE_ROW] })).status).toBe(401);
  });
});

describe.skipIf(!testDbConfigured())("the presets document, read and written", () => {
  const h = harness();
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
    h.state.pool = () => pool;
    await h.start();
  });

  afterAll(async () => {
    await h.stop();
    await pool?.end();
    await db?.drop();
  });

  it("a member reads an empty library before anything is saved (the positive control)", async () => {
    h.state.viewer = { id: "u-member", stage: "member" };
    const r = await h.call("GET", "/api/seat-presets");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ presets: [] });
  });

  it("an admin saves a preset and a member reads it back, figures included", async () => {
    h.state.admin = true;
    const saved = await h.call("PUT", "/api/admin/seat-presets", { presets: [FAKE_ROW] });
    expect(saved.status).toBe(200);
    h.state.admin = false;
    const r = await h.call("GET", "/api/seat-presets");
    expect(r.body.presets.map((p: any) => p.id)).toEqual(["custom:test-stipend"]);
    expect(r.body.presets[0].values.amountMinor).toBe(100000);
  });

  it("a guest still reads nothing once the library exists", async () => {
    h.state.viewer = { id: "u-guest", stage: "guest" };
    const r = await h.call("GET", "/api/seat-presets");
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toContain("100000");
  });

  it("refuses deleting a preset, and accepts retiring it", async () => {
    h.state.admin = true;
    const gone = await h.call("PUT", "/api/admin/seat-presets", { presets: [] });
    expect(gone.status).toBe(400);
    expect(gone.body.message).toMatch(/retired, never deleted/);
    const retired = await h.call("PUT", "/api/admin/seat-presets", { presets: [{ ...FAKE_ROW, retiredAt: "2026-10-09" }] });
    expect(retired.status).toBe(200);
    expect((await h.call("GET", "/api/admin/seat-presets")).body.presets[0].retiredAt).toBe("2026-10-09");
  });

  it("stores only a preset's known fields, so nothing rides along in an unknown key (red team S7)", async () => {
    h.state.admin = true;
    const r = await h.call("PUT", "/api/admin/seat-presets", {
      presets: [{ ...FAKE_ROW, retiredAt: "2026-10-09", iban: "GB33BUKB20201555555555", payTo: "card 4111 1111 1111 1111" }],
    });
    expect(r.status).toBe(200);
    const stored = (await h.call("GET", "/api/admin/seat-presets")).body.presets[0];
    expect(Object.keys(stored).sort()).toEqual(["group", "id", "label", "retiredAt", "values", "version"].concat("blurb" in FAKE_ROW ? ["blurb"] : []).sort());
    expect(JSON.stringify(stored)).not.toMatch(/GB33|4111/);
    // CONTROL: the known fields are kept as sent.
    expect(stored.values.amountMinor).toBe(100000);
  });
});
