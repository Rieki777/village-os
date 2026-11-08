/**
 * The moon review's village settings over HTTP (server/routes/moonReviewSettings.ts),
 * decision 22.
 *
 *   - Every door asks `cash.pay` first: without it nothing is read or written.
 *   - A fresh install answers empty documents and names what is missing.
 *   - A PUT validates with the contract's parser, writes the whole document,
 *     and writes one `moon_review_events` row with the old and new value of
 *     every field that moved; a PUT that changes nothing writes no event.
 *   - A bad document is refused and the stored one is left as it was.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { register, SETTINGS_ROUTES, changeNote } from "./moonReviewSettings";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect() {
  const handlers = new Map<string, Handler>();
  const mounted: string[] = [];
  const record = (method: string) => (p: string, handler: Handler) => handlers.set(`${method} ${p}`, handler);
  return { app: { get: record("GET"), put: record("PUT"), post: record("POST"), use: (p: string) => mounted.push(p) } as any, handlers, mounted };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  };
  return { res, out };
}

const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return out;
};

/** `holdsKey` decides the gate, the way `guardCapability` answers: it sends the 403 itself. */
const deps = (pool: any, holdsKey: () => boolean) => ({
  authedUser: async () => ({ id: "u-fin" }),
  getPool: () => pool,
  members: { all: async () => [] } as any,
  notify: async () => ({}) as any,
  inboxSigners: async () => [] as string[],
  overLimit: async () => false,
  guardCapability: async (_req: any, res: any) => {
    if (holdsKey()) return true;
    res.status(403).json({ error: "cash_pay_required" });
    return false;
  },
});

const DOORS = SETTINGS_ROUTES.flatMap((p) => [`GET ${p}`, `PUT ${p}`]);

describe("the settings doors without a database", () => {
  it("mounts each prefix behind the module, and refuses every door without cash.pay", async () => {
    const c = collect();
    register(c.app, deps(null, () => false));
    expect(c.mounted).toEqual([...SETTINGS_ROUTES]);
    for (const d of DOORS) expect((await call(c.handlers, d, { body: { document: {} } })).status, d).toBe(403);
  });

  it("caps a change note to fit its column", () => {
    expect(changeNote([{ field: "x", from: 1, to: 2 }])).toBe('[{"field":"x","from":1,"to":2}]');
    expect(changeNote([{ field: "x", from: "a".repeat(70_000), to: "" }]).length).toBeLessThanOrEqual(60_001);
  });
});

const configured = testDbConfigured();

describe.skipIf(!configured)("the settings doors against a real schema", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let c: ReturnType<typeof collect>;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 harness pool against the scratch schema
    c = collect();
    register(c.app, deps(pool, () => true));
  });

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const events = async (kind: string) => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT `actor_user_id`, `note` FROM `moon_review_events` WHERE `kind` = ? ORDER BY `id`", [kind]); // module-review-ok: fixture read against the S5 scratch schema
    return rows.map((r) => ({ actor: String(r.actor_user_id), note: JSON.parse(String(r.note)) }));
  };

  it("answers empty documents on a fresh install, and names what is missing", async () => {
    const p = await call(c.handlers, "GET /api/moon-review/payers");
    expect(p.body).toEqual({ document: { payers: [] }, gaps: [{ key: "payer", words: expect.stringContaining("Name who you pay") }] });
    const s = await call(c.handlers, "GET /api/moon-review/settings");
    expect(s.body.document.hostCountry).toBeNull();
    expect(s.body.gaps.map((g: any) => g.key)).toEqual(["country", "pilotAck"]);
    const r = await call(c.handlers, "GET /api/moon-review/rhythm");
    expect(r.body).toEqual({ document: { sendHour: 9, guideUrl: "", cycles: {} } });
  });

  it("saves a payer, records old and new values once, and writes nothing for a save that changes nothing", async () => {
    const payer = { key: "payer-a", legalName: "Example Payer", address: "1 Main St", country: "US", currencies: ["USD"], invoiceTo: "x@example.org", invoicing: true, routes: ["abroad"] };
    const first = await call(c.handlers, "PUT /api/moon-review/payers", { body: { document: { payers: [payer] } } });
    expect([first.status, first.body.changed, first.body.gaps]).toEqual([200, 1, []]);
    const again = await call(c.handlers, "PUT /api/moon-review/payers", { body: { document: { payers: [payer] } } });
    expect(again.body.changed).toBe(0);
    await call(c.handlers, "PUT /api/moon-review/payers", { body: { document: { payers: [{ ...payer, invoicing: false }] } } });
    const log = await events("payers_changed");
    expect(log.map((e) => e.actor)).toEqual(["u-fin", "u-fin"]);
    expect(log[1].note).toEqual([{ key: "payer-a", field: "invoicing", from: true, to: false }]);
    expect((await call(c.handlers, "GET /api/moon-review/payers")).body.document.payers[0].invoicing).toBe(false);
  });

  it("refuses a bad document and leaves the stored one as it was", async () => {
    const bad = await call(c.handlers, "PUT /api/moon-review/settings", { body: { document: { pilotAck: { text: "", version: "v1" } } } });
    expect(bad.status).toBe(400);
    expect((await call(c.handlers, "GET /api/moon-review/settings")).body.document.pilotAck).toBeNull();
    expect(await events("settings_changed")).toEqual([]);
  });

  it("saves the settings and the rhythm, each with its own event", async () => {
    const settings = { hostCountry: { code: "XX", name: "Examplia" }, pilotAck: { text: "This pay process is a pilot.", version: "v1" } };
    const s = await call(c.handlers, "PUT /api/moon-review/settings", { body: { document: settings } });
    expect([s.status, s.body.gaps]).toEqual([200, []]);
    expect((await events("settings_changed"))[0].note.map((x: any) => x.field)).toEqual(["hostCountry", "pilotAck"]);
    const r = await call(c.handlers, "PUT /api/moon-review/rhythm", { body: { document: { sendHour: 8, guideUrl: "https://example.org/guide", cycles: { "lunar-000333": { walkthrough: "2027-01-04", circle: "2027-01-04" } } } } });
    expect(r.status).toBe(200);
    expect((await events("rhythm_changed"))[0].note.map((x: any) => x.field)).toEqual(["sendHour", "guideUrl", "cycles.lunar-000333"]);
    expect((await call(c.handlers, "PUT /api/moon-review/rhythm", { body: { document: { guideUrl: "http://example.org" } } })).status).toBe(400);
  });
});

describe.skipIf(!configured)("a settings save that changes Sera's inbox waits for a second signer (C7)", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let c: ReturnType<typeof collect>;
  let who = "u-fin";
  const told: string[] = [];

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 }); // module-review-ok: the S5 harness pool against the scratch schema
    c = collect();
    register(c.app, {
      ...deps(pool, () => true),
      authedUser: async () => ({ id: who }),
      members: { all: async () => [{ id: "m1" }, { id: "m2" }] } as any,
      notify: async (n: { userId: string }) => { told.push(n.userId); return {} as any; },
      inboxSigners: async () => ["u-fin", "u-steward"],
    });
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });

  it("keeps the old inbox, shows the waiting one, and applies it only on a second signer's confirm", async () => {
    const saved = await call(c.handlers, "PUT /api/moon-review/settings", { body: { document: { seraInbox: "new@example.test" } } });
    expect(saved.status).toBe(200);
    expect(saved.body.document.seraInbox).toBeNull();
    expect(saved.body.pendingSeraInbox).toMatchObject({ address: "new@example.test", proposedBy: "u-fin" });
    expect((await call(c.handlers, "POST /api/moon-review/settings/sera-inbox/confirm")).status).toBe(409);
    expect(told).toEqual([]);
    who = "u-steward";
    const ok = await call(c.handlers, "POST /api/moon-review/settings/sera-inbox/confirm");
    expect(ok.status).toBe(200);
    expect((await call(c.handlers, "GET /api/moon-review/settings")).body).toMatchObject({ document: { seraInbox: "new@example.test" }, pendingSeraInbox: null });
    expect(told.sort()).toEqual(["m1", "m2"]);
  });
});
