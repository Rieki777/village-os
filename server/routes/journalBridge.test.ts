/**
 * The journal's doors and the bridge to organisational memory, together,
 * against a scratch schema.
 *
 * WHAT IS PINNED, each a promise made out loud:
 *
 *   1. QUEUEING NEVER FAILS A SAVE. With the outbox's tables refusing every
 *      statement, and again with the roster refusing to load, a save answers
 *      200, the entry is in the database, and the failure is logged.
 *   2. QUEUEING NEVER SLOWS A SAVE. The member has their answer while the
 *      queueing is still waiting on the roster; the handler finishes the
 *      queueing afterwards.
 *   3. An edit to private and a delete each withdraw the queued copy.
 *   4. The admin's read answers code-names, dates, lengths and statuses, and
 *      no word of any entry, and refuses without the panel's key.
 *
 * `register` runs against a fake Express that records handlers, the shape
 * server/routes/journal.test.ts uses, so the real handler bodies run.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({ lifecycle: { saberra: "public", journal: "public" } as Record<string, string> }));

vi.mock("../lib/modules", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    effectiveLifecycle: (id: string) => (id in ctl.lifecycle ? ctl.lifecycle[id] : actual.effectiveLifecycle(id)),
  };
});
vi.mock("../lib/identity", () => ({ instanceIdentity: () => ({ instanceId: "village-test", bornAt: "" }) }));

import type mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import { registeredJobs } from "../lib/scheduler";
import { SABERRA_BRIDGE_JOB, journalSourceRef } from "../lib/saberraOutbox";
import { rowBySourceRef } from "../repos/saberraOutbox";
import { register as registerJournal } from "./journal";
import { register as registerSaberra } from "./saberra";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => {} },
    handlers,
  };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader() {},
    send() {
      return res;
    },
  };
  return { res, out };
}

const PEOPLE = [
  { id: "m-ximena", name: "Ximena Quell", handle: "xquell", email: "ximena.quell@example.org" },
  { id: "m-bartholo", name: "Bartholo Vex", handle: "bvex", email: "bartholo@example.org" },
];

const ENTRY = {
  clientId: "c-1",
  practice: "free",
  depth: "light",
  writtenAt: "2026-10-13T18:00:00Z",
  answers: [{ questionKey: "free", prompt: "What is on your mind?", text: "Bartholo fixed the gate, and the quince jam is ready." }],
};

function journalDeps(pool: any, extra: Partial<Record<string, unknown>> = {}) {
  return {
    authedUser: async () => ({ id: "m-ximena", name: "Ximena Quell" }),
    getPool: () => pool,
    clientIp: () => "10.0.0.1",
    overLimit: async () => false,
    seasonState: () => ({ current: null, seasons: [], timezone: "UTC" }),
    projectName: () => "Riverbend",
    members: { byId: async (id: string) => PEOPLE.find((p) => p.id === id) ?? null, all: async () => PEOPLE },
    isPresent: () => true,
    claimsRepo: { forUser: async () => [] },
    ...extra,
  } as any;
}

/** A pool whose bridge tables refuse every statement, and whose journal works. */
function bridgeDownPool(real: mysql.Pool): mysql.Pool {
  return new Proxy(real, {
    get(target, key) {
      if (key === "query") {
        return async (sql: unknown, params?: unknown) => {
          if (/saberra_outbox|member_code_names/.test(String((sql as any)?.sql ?? sql))) throw new Error("the outbox table is unreachable");
          return target.query(sql as any, params as any);
        };
      }
      const v = (target as any)[key];
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as mysql.Pool;
}

const configured = testDbConfigured();

describe("the bridge job", () => {
  it("is registered by the journal's routes, every six hours", () => {
    const { app } = collect();
    registerJournal(app, journalDeps({ query: async () => [[], []] }));
    expect(registeredJobs().filter((j) => j.name === SABERRA_BRIDGE_JOB)[0]).toEqual({
      name: SABERRA_BRIDGE_JOB,
      everyMs: 6 * 60 * 60 * 1000,
    });
  });
});

describe.skipIf(!configured)("the journal's doors with the bridge open", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  let errors: { mock: { calls: unknown[][] }; mockRestore: () => void };

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    ctl.lifecycle = { saberra: "public", journal: "public" };
    for (const t of ["journal_entries", "journal_pulse", "saberra_outbox", "member_code_names"]) {
      await q(`DELETE FROM \`${t}\``); // module-review-ok: fixture reset of the scratch schema
    }
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
  });

  const call = async (handlers: Map<string, Handler>, key: string, req: any = {}) => {
    const { res, out } = makeRes();
    await handlers.get(key)!({ params: {}, body: {}, query: {}, ...req }, res);
    return out;
  };

  const entriesOf = async (userId: string) => q("SELECT `id`, `privacy` FROM `journal_entries` WHERE `user_id` = ?", [userId]); // module-review-ok: reading the scratch schema to prove the save landed

  it("QUEUES A SAVED ENTRY under a code-name, with the names swapped", async () => {
    const { app, handlers } = collect();
    registerJournal(app, journalDeps(pool));
    const out = await call(handlers, "POST /api/journal/entries", { body: ENTRY });
    expect(out.status).toBe(200);
    const row = (await rowBySourceRef(pool, journalSourceRef(out.body.id)))!;
    expect(row.status).toBe("queued");
    expect(String(row.payload)).not.toContain("Bartholo");
    expect(String(row.payload)).toContain("quince jam");
  });

  it("A SAVE STANDS WHEN THE OUTBOX IS DOWN: 200, the entry in the database, and the failure logged", async () => {
    const { app, handlers } = collect();
    registerJournal(app, journalDeps(bridgeDownPool(pool)));
    const out = await call(handlers, "POST /api/journal/entries", { body: ENTRY });
    expect(out.status).toBe(200);
    expect(out.body.id).toMatch(/^je-/);
    expect(await entriesOf("m-ximena")).toEqual([{ id: out.body.id, privacy: "internal" }]);
    expect(errors.mock.calls.map((c: unknown[]) => String(c[0])).some((line: string) => line.startsWith("[saberra-outbox] could not queue"))).toBe(true);
    // And a log line carries no word the member wrote.
    for (const c of errors.mock.calls) expect(String(c[0])).not.toContain("quince");
  });

  it("A SAVE STANDS WHEN THE ROSTER WILL NOT LOAD, and nothing is queued against a roster it never read", async () => {
    const { app, handlers } = collect();
    registerJournal(
      app,
      journalDeps(pool, { members: { byId: async () => null, all: async () => Promise.reject(new Error("users table locked")) } }),
    );
    const out = await call(handlers, "POST /api/journal/entries", { body: ENTRY });
    expect(out.status).toBe(200);
    expect(await entriesOf("m-ximena")).toHaveLength(1);
    expect(await rowBySourceRef(pool, journalSourceRef(out.body.id))).toBeNull();
    expect(errors.mock.calls.length).toBeGreaterThan(0);
  });

  it("AN EDIT AND A DELETE STAND WHEN THE OUTBOX IS DOWN", async () => {
    const { app, handlers } = collect();
    registerJournal(app, journalDeps(pool));
    const saved = await call(handlers, "POST /api/journal/entries", { body: ENTRY });
    const down = collect();
    registerJournal(down.app, journalDeps(bridgeDownPool(pool)));
    const edited = await call(down.handlers, "PATCH /api/journal/entries/:id", { params: { id: saved.body.id }, body: { privacy: "private" } });
    expect([edited.status, edited.body.privacy]).toEqual([200, "private"]);
    const gone = await call(down.handlers, "DELETE /api/journal/entries/:id", { params: { id: saved.body.id } });
    expect([gone.status, gone.body]).toEqual([200, { success: true }]);
    expect(await entriesOf("m-ximena")).toEqual([]);
  });

  it("NEVER MAKES THE MEMBER WAIT: the answer is out while the queueing is still waiting", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, handlers } = collect();
    registerJournal(
      app,
      journalDeps(pool, {
        members: { byId: async () => null, all: async () => (await gate, PEOPLE) },
      }),
    );
    const { res, out } = makeRes();
    let finished = false;
    const running = Promise.resolve(handlers.get("POST /api/journal/entries")!({ params: {}, body: ENTRY, query: {} }, res)).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(out.body?.id).toMatch(/^je-/), { timeout: 10_000 });
    expect(finished, "the handler is still queueing after it answered").toBe(false);
    expect(await rowBySourceRef(pool, journalSourceRef(out.body.id))).toBeNull();
    release();
    await running;
    expect((await rowBySourceRef(pool, journalSourceRef(out.body.id)))!.status).toBe("queued");
  });

  it("WITHDRAWS ON AN EDIT TO PRIVATE, and queues again when the author shares it again", async () => {
    const { app, handlers } = collect();
    registerJournal(app, journalDeps(pool));
    const saved = await call(handlers, "POST /api/journal/entries", { body: ENTRY });
    await call(handlers, "PATCH /api/journal/entries/:id", { params: { id: saved.body.id }, body: { privacy: "private" } });
    let row = (await rowBySourceRef(pool, journalSourceRef(saved.body.id)))!;
    expect([row.status, row.payload]).toEqual(["held", null]);
    await call(handlers, "PATCH /api/journal/entries/:id", { params: { id: saved.body.id }, body: { privacy: "clear" } });
    row = (await rowBySourceRef(pool, journalSourceRef(saved.body.id)))!;
    expect(row.status).toBe("queued");
    expect(JSON.parse(String(row.payload)).shared).toBe("clear");
  });

  it("WITHDRAWS ON A DELETE", async () => {
    const { app, handlers } = collect();
    registerJournal(app, journalDeps(pool));
    const saved = await call(handlers, "POST /api/journal/entries", { body: ENTRY });
    await call(handlers, "DELETE /api/journal/entries/:id", { params: { id: saved.body.id } });
    const row = (await rowBySourceRef(pool, journalSourceRef(saved.body.id)))!;
    expect([row.status, row.payload]).toEqual(["held", null]);
  });

  it("QUEUES NOTHING FOR A PRIVATE SAVE", async () => {
    const { app, handlers } = collect();
    registerJournal(app, journalDeps(pool));
    const saved = await call(handlers, "POST /api/journal/entries", { body: { ...ENTRY, privacy: "private" } });
    expect(saved.status).toBe(200);
    expect(await rowBySourceRef(pool, journalSourceRef(saved.body.id))).toBeNull();
  });

  describe("the admin's read of what would be sent", () => {
    const saberra = (may: boolean) => {
      const { app, handlers } = collect();
      registerSaberra(app, {
        guardCapability: (async (_req: unknown, res: any) => {
          if (may) return true;
          res.status(403).json({ error: "You do not hold that key." });
          return false;
        }) as never,
        getPool: (() => pool) as never,
        authedUser: (async () => ({ id: "m-founder" })) as never,
      });
      return handlers;
    };

    it("ANSWERS CODE-NAMES, DATES, LENGTHS AND STATUSES, AND NO WORD OF ANY ENTRY", async () => {
      const { app, handlers } = collect();
      registerJournal(app, journalDeps(pool));
      await call(handlers, "POST /api/journal/entries", { body: ENTRY });
      const out = await call(saberra(true), "GET /api/saberra/outbox");
      expect(out.status).toBe(200);
      expect(out.body.writePath).toBe(false);
      expect(out.body.counts.queued).toBe(1);
      expect(out.body.items).toHaveLength(1);
      expect(Object.keys(out.body.items[0]).sort()).toEqual(["attempts", "chars", "codeName", "createdAt", "id", "kind", "period", "status"]);
      const wire = JSON.stringify(out.body);
      for (const word of ["quince", "gate", "jam", "mind", "Bartholo", "Ximena", "m-ximena", "ximena.quell"]) {
        expect(wire.includes(word), `the admin read carries "${word}"`).toBe(false);
      }
    });

    it("refuses without the panel's key, before reading anything", async () => {
      const out = await call(saberra(false), "GET /api/saberra/outbox");
      expect(out.status).toBe(403);
      expect(out.body.items).toBeUndefined();
    });
  });
});
