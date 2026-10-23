/**
 * The obstacle, reproduced, and the read path that is not subject to it.
 *
 * Two halves, for two different questions.
 *
 * THE FIRST HALF needs no database. It drives the registered handlers against
 * a stub pool, the way server/routes/land.test.ts does, and asks what the
 * routes answer: the gate, the three planes, and the resync's report.
 *
 * THE SECOND HALF needs a real MySQL, because the thing being asserted is a
 * property of `dbDocument` against a live row and nothing short of a database
 * can show it. It reproduces, in order:
 *
 *   1. `put()` IS write-through. The docblock this lane was handed said there
 *      is no invalidation on write, and that turns out to be half true: the
 *      same process sees its own save. Worth pinning, because the fix for the
 *      production symptom depends on which half is wrong.
 *   2. A raw SQL write leaves `get()` answering the boot value, silently, with
 *      no error and no way for a caller to tell.
 *   3. A SECOND process over the same row does not see the first's `put()`,
 *      which is the deploy-overlap and multi-replica shape.
 *   4. `load()` recovers, which is what the resync route calls.
 *   5. `load()` turns an unparseable row into the same state a missing row
 *      produces, so a corrupt document reads as a village that saved nothing.
 *      `readStoredBrand` refuses that fold, which is the reason it exists.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { dbDocument } from "../repos/store-db";
import { readStoredBrand, register } from "./brandPreview";

// ── Half one: the handlers, against a stub ──────────────────────────────────

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, handler: Handler) => {
    handlers.set(`${method} ${path}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

/** Captures what a handler answered. */
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: any) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

/** A `brandRepo` stand-in whose cache is whatever the test says it is. */
function fakeRepo(initial: any, onLoad?: () => any) {
  let cache = initial;
  return {
    repo: {
      get: () => cache,
      exists: () => cache !== null,
      async load() {
        cache = onLoad ? onLoad() : cache;
      },
      async put(doc: any) {
        cache = doc;
        return doc;
      },
    },
    current: () => cache,
  };
}

function handlersFor(opts: {
  isAdmin?: boolean;
  rows?: any[];
  queryThrows?: boolean;
  serving?: any;
  onLoad?: () => any;
}) {
  const { app, handlers } = collect();
  const repo = fakeRepo(opts.serving ?? { images: {} }, opts.onLoad);
  const pool: any = {
    async query() {
      if (opts.queryThrows) throw new Error("connection lost");
      return [opts.rows ?? [], []];
    },
  };
  register(app, {
    isAdmin: async () => opts.isAdmin !== false,
    getPool: () => pool,
    brandRepo: repo.repo as any,
  });
  return { handlers, repo };
}

describe("the two routes register", () => {
  it("registers the read and the resync at their documented paths", () => {
    const { handlers } = handlersFor({});
    expect([...handlers.keys()].sort()).toEqual([
      "GET /api/admin/brand/preview",
      "POST /api/admin/brand/resync",
    ]);
  });

  it("refuses a caller the gate turns down", async () => {
    const { handlers } = handlersFor({ isAdmin: false });
    for (const key of handlers.keys()) {
      const { res, out } = makeRes();
      await handlers.get(key)!({}, res);
      expect(out.status, key).toBe(401);
    }
  });
});

describe("the preview answer", () => {
  it("hands over the saved row, the served document and the platform defaults", async () => {
    const { handlers } = handlersFor({
      rows: [{ value: { images: { hero: "/saved.webp" } } }],
      serving: { images: { hero: "/being-served.webp" } },
    });
    const { res, out } = makeRes();
    await handlers.get("GET /api/admin/brand/preview")!({}, res);
    expect(out.status).toBe(200);
    expect(out.body.stored).toEqual({
      readable: true,
      present: true,
      document: { images: { hero: "/saved.webp" } },
      error: "",
    });
    expect(out.body.serving).toEqual({ images: { hero: "/being-served.webp" } });
    expect(out.body.defaults.images).toBeDefined();
    expect(out.body.defaults.project).toBeDefined();
  });

  it("answers with an unreadable verdict instead of failing, when the database does not answer", async () => {
    const { handlers } = handlersFor({ queryThrows: true });
    const { res, out } = makeRes();
    await handlers.get("GET /api/admin/brand/preview")!({}, res);
    // 200 on purpose. The founder still needs the served plane and a sentence
    // saying which half could not be read; a 500 collapses both into "error".
    expect(out.status).toBe(200);
    expect(out.body.stored.readable).toBe(false);
    expect(out.body.stored.document).toBeNull();
    expect(out.body.stored.error.length).toBeGreaterThan(0);
  });
});

describe("the resync", () => {
  it("reports that the served document moved", async () => {
    const { handlers } = handlersFor({
      serving: { images: { hero: "" } },
      onLoad: () => ({ images: { hero: "/caught-up.webp" } }),
    });
    const { res, out } = makeRes();
    await handlers.get("POST /api/admin/brand/resync")!({}, res);
    expect(out.body).toEqual({ success: true, changed: true });
  });

  it("reports that it did not, so a founder is not told a fix happened when none did", async () => {
    const { handlers } = handlersFor({ serving: { images: { hero: "/same.webp" } } });
    const { res, out } = makeRes();
    await handlers.get("POST /api/admin/brand/resync")!({}, res);
    expect(out.body).toEqual({ success: true, changed: false });
  });

  it("answers 503 when the reload fails, and leaves the served document alone", async () => {
    const { app, handlers } = collect();
    const repo = {
      get: () => ({ images: { hero: "/before.webp" } }),
      exists: () => true,
      async load() {
        throw new Error("connection lost");
      },
      async put(d: any) {
        return d;
      },
    };
    register(app, { isAdmin: async () => true, getPool: () => ({}) as any, brandRepo: repo as any });
    const { res, out } = makeRes();
    await handlers.get("POST /api/admin/brand/resync")!({}, res);
    expect(out.status).toBe(503);
    expect(repo.get()).toEqual({ images: { hero: "/before.webp" } });
  });
});

// ── Half two: the cache, against a real database ────────────────────────────

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[brandPreview.test] TEST_DATABASE_URL not set, so DB-backed tests are SKIPPED.");
}

describe.skipIf(!configured)("what the brand document does against a live row", () => {
  let db: TestDb;
  let pool: mysql.Pool;

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM `app_config` WHERE `config_key` = 'brand'");
  });

  /** A repo that has just booted: loaded once, from whatever the row holds. */
  const booted = async () => {
    const repo = dbDocument<any>(pool, "brand", { images: {} });
    await repo.load();
    return repo;
  };

  const rawWrite = (doc: unknown) =>
    pool.query(
      "INSERT INTO `app_config` (`config_key`, `value`) VALUES ('brand', ?) " +
        "ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [JSON.stringify(doc)],
    );

  it("updates its own cache on put, so a save through the API is visible at once", async () => {
    const repo = await booted();
    await repo.put({ images: { hero: "/saved.webp" } });
    expect(repo.get().images.hero).toBe("/saved.webp");
    expect(repo.exists()).toBe(true);
  });

  it("keeps serving the boot value after a raw SQL write, with nothing to signal it", async () => {
    // THE PRODUCTION CASE. Six correct image paths went into the row, and
    // /api/game/config kept answering with empty strings until a deploy.
    const repo = await booted();
    expect(repo.get().images.hero).toBeUndefined();

    await rawWrite({ images: { hero: "/written-by-hand.webp" } });

    expect(repo.get().images.hero, "the cache answers the boot value").toBeUndefined();
    expect(repo.exists(), "and still reports no document at all").toBe(false);

    const stored = await readStoredBrand(pool);
    expect(stored.readable).toBe(true);
    expect((stored.document as any).images.hero, "the read-through sees the truth").toBe(
      "/written-by-hand.webp",
    );
  });

  it("does not reach a second process holding the same row", async () => {
    // A Railway deploy runs two containers against one database until the new
    // one passes its health check. Two caches, one row.
    const containerA = await booted();
    const containerB = await booted();

    await containerA.put({ images: { hero: "/saved-on-a.webp" } });

    expect(containerA.get().images.hero).toBe("/saved-on-a.webp");
    expect(containerB.get().images.hero, "B never heard about it").toBeUndefined();

    const stored = await readStoredBrand(pool);
    expect((stored.document as any).images.hero).toBe("/saved-on-a.webp");
  });

  it("catches up on load, which is the call the resync route makes", async () => {
    const repo = await booted();
    await rawWrite({ images: { hero: "/written-by-hand.webp" } });
    expect(repo.get().images.hero).toBeUndefined();

    await repo.load();

    expect(repo.get().images.hero).toBe("/written-by-hand.webp");
    expect(repo.exists()).toBe(true);
  });

  /*
   * `app_config`.`value` is a JSON column, so MySQL refuses a row that is not
   * JSON at all and the parse branch cannot be reached with rubbish. What it
   * DOES accept is any valid JSON value, including an array and a bare
   * scalar, and `dbDocument.load()` turns both of those into `cache = null`,
   * which is the state a MISSING row produces. The two cases below are the
   * reachable ones, written as a recorded fact about the shared module rather
   * than as a change request.
   */
  it.each([
    ["a JSON array", [1, 2, 3]],
    ["a JSON string", "hero: /somewhere.webp"],
  ])("reads a row holding %s as a village that saved nothing", async (_name, payload) => {
    await rawWrite(payload);

    const repo = dbDocument<any>(pool, "brand", { images: {} });
    await repo.load();
    expect(repo.exists(), "a present row reported as absent").toBe(false);

    const stored = await readStoredBrand(pool);
    expect(stored.readable, "the preview refuses that fold").toBe(false);
    expect(stored.present).toBe(true);
    expect(stored.document).toBeNull();
    expect(stored.error.length).toBeGreaterThan(0);
  });

  it("calls a genuinely missing row readable and absent", async () => {
    const stored = await readStoredBrand(pool);
    expect(stored.readable).toBe(true);
    expect(stored.present).toBe(false);
    expect(stored.document).toBeNull();
    expect(stored.error).toBe("");
  });
});
