/**
 * The land routes, exercised as handlers against a stub pool.
 *
 * WHY NOT THE E2E HARNESS. What these routes contain worth testing is decision
 * logic: the privacy boundary, the unset-is-not-zero rule, the refusal to
 * accept a transposed pair, and the licence refusal. None of that needs a
 * database, and running it without one makes it fast and deterministic.
 *
 * An e2e suite over HTTP IS possible here (TEST_DATABASE_URL is set, and the
 * DB-backed suites do run on this machine), and it would be worth adding
 * alongside this one when the admin screen lands, because it would cover the
 * upsert and the volume write that this file stubs. It is not a substitute
 * for these cases; it is a second, slower angle on them.
 *
 * The database work these routes do is one SELECT and one upsert. The upsert's
 * correctness under two concurrent writers is the UNIQUE KEY's job, asserted
 * in migration 0123 and enforced by MySQL, not by this file.
 *
 * `register` is called against a fake Express that records handlers by method
 * and path, so what is tested is the real registration and the real handler
 * bodies.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedFrame } from "../../shared/land";
import { register } from "./land";

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
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

/**
 * A pool that answers the one SELECT and remembers what was written.
 *
 * `row` is what the SELECT returns, so a test can set up "no row at all" and
 * "a row with NULL coordinates" separately. Those are different states and
 * the routes have to tell them apart.
 */
function stubPool(row: Record<string, unknown> | null) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const pool: any = {
    async query(sql: string, params: unknown[]) {
      if (/^\s*SELECT/i.test(sql)) return [row ? [row] : [], []];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }, []];
    },
  };
  return { pool, writes };
}

const alwaysAdmin = async () => true;
const alwaysAllowed = async () => true;

function mount(row: Record<string, unknown> | null, over: Partial<Record<string, any>> = {}) {
  const { app, handlers } = collect();
  const { pool, writes } = stubPool(row);
  register(app, {
    isAdmin: over.isAdmin ?? alwaysAdmin,
    authedUser: over.authedUser ?? (async () => ({ id: "founder-1" })),
    guardCapability: over.guardCapability ?? alwaysAllowed,
    getPool: () => pool,
    uploadsDir: over.uploadsDir ?? "/tmp/does-not-matter",
  } as any);
  return { handlers, writes };
}

const call = async (
  handlers: Map<string, Handler>,
  key: string,
  req: any = {},
): Promise<{ status: number; body: any }> => {
  const handler = handlers.get(key);
  if (!handler) throw new Error(`no handler registered for ${key}`);
  const { res, out } = makeRes();
  await handler(req, res);
  return out;
};

/** A saved village: Dominicalito, exact visibility, with a kept picture. */
const SAVED = {
  centre_lat: "9.234500",
  centre_lon: "-83.841200",
  span_m: 800,
  visibility: "exact",
  source_text: "9.2345, -83.8412",
  source_format: "decimal",
  imagery_provider: "sentinel2",
  imagery_filename: "land-sentinel2-123-abcde.jpg",
  imagery_attribution: "Contains modified Copernicus Sentinel data 2026",
  imagery_fetched_at: "2026-08-31 10:00:00",
  imagery_error: null,
};

describe("the five routes register", () => {
  it("registers exactly the routes the admin screen will call", () => {
    const { handlers } = mount(null);
    expect([...handlers.keys()].sort()).toEqual([
      "DELETE /api/admin/land/imagery",
      "GET /api/admin/land",
      "GET /api/land",
      "POST /api/admin/land/imagery",
      "PUT /api/admin/land",
    ]);
  });
});

describe("the public route is the privacy boundary", () => {
  it("publishes nothing about a village that chose hidden", async () => {
    const { handlers } = mount({ ...SAVED, visibility: "hidden" });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.centre).toBeNull();
    // The picture still renders. The coordinates are the sensitive fact.
    expect(r.body.imageryUrl).toBe("/api/uploads/land-sentinel2-123-abcde.jpg");
  });

  it("rounds to two decimals when the village chose approximate", async () => {
    const { handlers } = mount({ ...SAVED, visibility: "approximate" });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.centre).toEqual({ lat: 9.23, lon: -83.84 });
  });

  it("publishes the exact point only when the village chose exact", async () => {
    const { handlers } = mount(SAVED);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.centre).toEqual({ lat: 9.2345, lon: -83.8412 });
  });

  it("treats an unknown visibility as hidden, failing closed", async () => {
    const { handlers } = mount({ ...SAVED, visibility: "public-everywhere" });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.visibility).toBe("hidden");
    expect(r.body.centre).toBeNull();
  });

  it("never leaks the pasted source text to a stranger", async () => {
    // source_text can hold a Google Maps link with a place name in it.
    const { handlers } = mount(SAVED);
    const r = await call(handlers, "GET /api/land");
    expect(JSON.stringify(r.body)).not.toContain("source");
  });
});

describe("the honest empty state", () => {
  it("answers configured false for a village with no row at all", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "GET /api/land");
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
    expect(r.body.centre).toBeNull();
    expect(r.body.imageryUrl).toBeNull();
  });

  it("answers configured false for a row that exists with no coordinates", async () => {
    // A founder can have a failed imagery attempt recorded before ever
    // pasting a location. A row existing is not a location being set.
    const { handlers } = mount({
      ...SAVED,
      centre_lat: null,
      centre_lon: null,
      imagery_filename: null,
    });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.configured).toBe(false);
  });

  it("gives a null image address rather than a broken one", async () => {
    const { handlers } = mount({ ...SAVED, imagery_filename: null });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.imageryUrl).toBeNull();
  });
});

describe("zero is a real place and unset is not zero", () => {
  it("reports a village at latitude 0, longitude 0 as CONFIGURED", async () => {
    // The Gulf of Guinea. A falsiness check would call this village unset,
    // and this assertion is the whole reason the columns are nullable.
    const { handlers } = mount({
      ...SAVED,
      centre_lat: "0.000000",
      centre_lon: "0.000000",
      visibility: "exact",
    });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.configured).toBe(true);
    expect(r.body.centre).toEqual({ lat: 0, lon: 0 });
  });

  it("keeps a zero span distinguishable from an absent one", async () => {
    const { handlers } = mount({ ...SAVED, span_m: null });
    const r = await call(handlers, "GET /api/land");
    expect(r.body.spanM).toBeNull();
  });
});

describe("saving a location", () => {
  it("accepts a pasted decimal pair and writes it", async () => {
    const { handlers, writes } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "9.2345, -83.8412", spanM: 800, visibility: "approximate" },
    });
    expect(r.status).toBe(200);
    expect(r.body.centre).toEqual({ lat: 9.2345, lon: -83.8412 });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(writes[0].params).toContain(9.2345);
  });

  it("accepts a Google Maps link", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "https://www.google.com/maps/@9.2345,-83.8412,17z" },
    });
    expect(r.status).toBe(200);
    expect(r.body.centre.lat).toBeCloseTo(9.2345, 6);
  });

  it("defaults visibility to hidden when the founder did not choose", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "9.2345, -83.8412" },
    });
    expect(r.body.visibility).toBe("hidden");
  });

  it("REFUSES a transposed pair and offers the other reading", async () => {
    const { handlers, writes } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "-83.8412, 9.2345" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("swap-suspected");
    expect(r.body.suggestion).toEqual({ lat: 9.2345, lon: -83.8412 });
    // Nothing was written. A refusal that saved anyway is not a refusal.
    expect(writes).toHaveLength(0);
  });

  it("accepts the transposed pair once the founder confirms it", async () => {
    const { handlers, writes } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "-83.8412, 9.2345", confirmSwapped: true },
    });
    expect(r.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it("refuses an unreadable string with copy that says what works", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "the top field by the mango tree" },
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/plus code/i);
    expect(r.body.message.toLowerCase()).not.toContain("invalid");
  });

  it("refuses a span outside the range and names the range", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "9.2345, -83.8412", spanM: 999999 },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("span-range");
  });

  it("refuses an empty body and says where to find the numbers", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", { body: {} });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/long-press/i);
  });

  it("survives a request with no body at all", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "PUT /api/admin/land", {});
    expect(r.status).toBe(400);
  });

  it("records who changed it", async () => {
    const { handlers, writes } = mount(null);
    await call(handlers, "PUT /api/admin/land", { body: { text: "9.2345, -83.8412" } });
    expect(writes[0].params).toContain("founder-1");
  });

  it("stores null rather than a placeholder when the actor cannot be resolved", async () => {
    const { handlers, writes } = mount(null, { authedUser: async () => null });
    await call(handlers, "PUT /api/admin/land", { body: { text: "9.2345, -83.8412" } });
    expect(writes[0].params).toContain(null);
  });

  it("does not write when the capability gate refuses", async () => {
    const { handlers, writes } = mount(null, { guardCapability: async () => false });
    await call(handlers, "PUT /api/admin/land", { body: { text: "9.2345, -83.8412" } });
    expect(writes).toHaveLength(0);
  });
});

describe("the admin read", () => {
  it("refuses without an admin", async () => {
    const { handlers } = mount(SAVED, { isAdmin: async () => false });
    const r = await call(handlers, "GET /api/admin/land");
    expect(r.status).toBe(401);
  });

  it("says what this deployment is configured to do, before anything is pressed", async () => {
    const { handlers } = mount(SAVED);
    const r = await call(handlers, "GET /api/admin/land");
    expect(r.body.configured).toHaveProperty("ready");
    expect(r.body.configured).toHaveProperty("missingEnv");
  });

  it("hands over the provider catalogue with its licence readings", async () => {
    const { handlers } = mount(SAVED);
    const r = await call(handlers, "GET /api/admin/land");
    const ids = r.body.providers.map((p: any) => p.id);
    expect(ids).toContain("village-upload");
    expect(ids).toContain("sentinel2");
    for (const p of r.body.providers) {
      expect(["permitted", "forbidden"]).toContain(p.caching);
      expect(typeof p.licenceNote).toBe("string");
    }
  });

  it("shows the founder the exact point, because they are the founder", async () => {
    const { handlers } = mount({ ...SAVED, visibility: "hidden" });
    const r = await call(handlers, "GET /api/admin/land");
    expect(r.body.land.centre).toEqual({ lat: 9.2345, lon: -83.8412 });
  });
});

describe("fetching the picture", () => {
  it("refuses before the network when no location is set", async () => {
    const { handlers } = mount(null);
    const r = await call(handlers, "POST /api/admin/land/imagery", { body: {} });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("no-location");
  });

  it("says plainly that no provider is set up, and does not pretend", async () => {
    const before = process.env.SATELLITE_PROVIDER;
    delete process.env.SATELLITE_PROVIDER;
    try {
      const { handlers } = mount(SAVED);
      const r = await call(handlers, "POST /api/admin/land/imagery", { body: {} });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("no-provider");
      expect(r.body.message).toMatch(/empty frame/i);
    } finally {
      if (before === undefined) delete process.env.SATELLITE_PROVIDER;
      else process.env.SATELLITE_PROVIDER = before;
    }
  });

  it("names the missing key when a provider is chosen without one", async () => {
    const beforeP = process.env.SATELLITE_PROVIDER;
    const beforeK = process.env.MAPBOX_TOKEN;
    process.env.SATELLITE_PROVIDER = "mapbox";
    delete process.env.MAPBOX_TOKEN;
    try {
      const { handlers } = mount(SAVED);
      const r = await call(handlers, "POST /api/admin/land/imagery", { body: {} });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("provider-not-ready");
      expect(r.body.message).toContain("MAPBOX_TOKEN");
    } finally {
      if (beforeP === undefined) delete process.env.SATELLITE_PROVIDER;
      else process.env.SATELLITE_PROVIDER = beforeP;
      if (beforeK !== undefined) process.env.MAPBOX_TOKEN = beforeK;
    }
  });

  it("refuses on the licence when a forbidden provider is fully configured", async () => {
    const beforeP = process.env.SATELLITE_PROVIDER;
    const beforeK = process.env.MAPBOX_TOKEN;
    process.env.SATELLITE_PROVIDER = "mapbox";
    process.env.MAPBOX_TOKEN = "pk.test";
    try {
      const { handlers, writes } = mount(SAVED);
      const r = await call(handlers, "POST /api/admin/land/imagery", { body: {} });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/Product Terms/i);
      // The reason is recorded so the screen can show it later without
      // spending another request to rediscover it.
      expect(writes.some((w) => /imagery_error/.test(w.sql))).toBe(true);
    } finally {
      if (beforeP === undefined) delete process.env.SATELLITE_PROVIDER;
      else process.env.SATELLITE_PROVIDER = beforeP;
      if (beforeK === undefined) delete process.env.MAPBOX_TOKEN;
      else process.env.MAPBOX_TOKEN = beforeK;
    }
  });
});
/**
 * A pool that answers with SEVERAL parcels.
 *
 * Separate from `stubPool` rather than folded into it, because "one row" and
 * "several rows" are the two states the parcel work has to tell apart and a
 * single helper with an optional array hides which one a test is exercising.
 */
function stubRows(rows: Array<Record<string, unknown>>) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const pool: any = {
    async query(sql: string, params: unknown[]) {
      if (/^\s*SELECT/i.test(sql)) return [rows, []];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }, []];
    },
  };
  return { pool, writes };
}

function mountRows(rows: Array<Record<string, unknown>>) {
  const { app, handlers } = collect();
  const { pool, writes } = stubRows(rows);
  register(app, {
    isAdmin: alwaysAdmin,
    authedUser: async () => ({ id: "founder-1" }),
    guardCapability: alwaysAllowed,
    getPool: () => pool,
    uploadsDir: "/tmp/does-not-matter",
  } as any);
  return { handlers, writes };
}

const RIDGE = {
  ...SAVED,
  slug: "the-ridge",
  label: "The ridge",
  sort_order: 1,
  created_at: "2026-09-02 09:00:00",
  imagery_filename: "land-ridge.jpg",
};
const HOME = { ...SAVED, slug: "home", label: "", sort_order: 0, created_at: "2026-09-01 09:00:00" };

describe("a project may hold more than one piece of ground", () => {
  it("answers every parcel, each with its own picture", async () => {
    const { handlers } = mountRows([RIDGE, HOME]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.parcels.map((p: any) => p.slug)).toEqual(["home", "the-ridge"]);
    expect(r.body.parcels[1].imageryUrl).toBe("/api/uploads/land-ridge.jpg");
  });

  it("opens the lowest sort_order regardless of the order the rows arrive in", async () => {
    const { handlers } = mountRows([RIDGE, HOME]);
    const r = await call(handlers, "GET /api/land");
    // The top-level fields are the FIRST parcel, and 'home' sorts first.
    expect(r.body.parcels[0].slug).toBe("home");
  });

  it("settles an equal sort_order by which parcel is older, not by row order", async () => {
    const a = { ...HOME, slug: "later", sort_order: 0, created_at: "2026-09-05 09:00:00" };
    const b = { ...HOME, slug: "earlier", sort_order: 0, created_at: "2026-09-01 09:00:00" };
    const { handlers } = mountRows([a, b]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.parcels.map((p: any) => p.slug)).toEqual(["earlier", "later"]);
  });

  it("hides EVERY parcel's coordinates at hidden, not just the first", async () => {
    const { handlers } = mountRows([
      { ...HOME, visibility: "hidden" },
      { ...RIDGE, visibility: "hidden" },
    ]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.parcels.every((p: any) => p.centre === null)).toBe(true);
  });

  it("still serves every parcel's picture at hidden, which is the documented rule", async () => {
    const { handlers } = mountRows([
      { ...HOME, visibility: "hidden" },
      { ...RIDGE, visibility: "hidden" },
    ]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.parcels.every((p: any) => p.imageryUrl !== null)).toBe(true);
  });

  it("writes to 'home' when the caller says nothing about parcels", async () => {
    const { handlers, writes } = mountRows([]);
    const r = await call(handlers, "PUT /api/admin/land", { body: { text: "9.2345, -83.8412" } });
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe("home");
    expect(writes[0].params).toContain("home");
  });

  it("refuses a malformed parcel name instead of repairing it into a different address", async () => {
    const { handlers, writes } = mountRows([]);
    const r = await call(handlers, "PUT /api/admin/land", {
      body: { text: "9.2345, -83.8412", slug: "North Field!" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bad-parcel");
    expect(writes).toHaveLength(0);
  });

  it("does not blank a parcel's name when only its coordinates are saved", async () => {
    const { handlers, writes } = mountRows([RIDGE]);
    await call(handlers, "PUT /api/admin/land", {
      body: { text: "9.2345, -83.8412", slug: "the-ridge" },
    });
    // The upsert keeps the stored label when this call carried none.
    expect(writes[0].sql).toContain("IF(VALUES(label) = '', label, VALUES(label))");
  });

  it("puts a new parcel after the ones that already exist", async () => {
    const { handlers, writes } = mountRows([HOME, RIDGE]);
    await call(handlers, "PUT /api/admin/land", {
      body: { text: "9.2345, -83.8412", slug: "south-block", label: "South block" },
    });
    expect(writes[0].params).toContain(2);
  });

  it("points a picture fetch at the parcel it names, never at the whole village", async () => {
    const { handlers } = mountRows([HOME, RIDGE]);
    const r = await call(handlers, "POST /api/admin/land/imagery", { body: { slug: "not-a-parcel-here" } });
    // No such parcel: the centre is unknown, so there is nothing to photograph.
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("no-location");
  });
});
describe("the public route says whether a picture shows the seed's own rectangle", () => {
  const f = seedFrame();
  const at = (lat: number, lon: number, span: number, visibility = "exact") => ({
    ...SAVED, centre_lat: String(lat), centre_lon: String(lon), span_m: span, visibility,
    slug: "home", label: "", sort_order: 0, created_at: "2026-09-01 09:00:00",
  });

  it("says yes for the seed's own frame, so the map keeps that place's coast", async () => {
    const { handlers } = mountRows([at(f.centre.lat, f.centre.lon, 2592)]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.seedFrame).toBe(true);
    expect(r.body.parcels[0].seedFrame).toBe(true);
  });

  it("says no for the pin itself, 345 m from the frame's centre", async () => {
    const { handlers } = mountRows([at(9.2320128, -83.8343203, 2592)]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.seedFrame).toBe(false);
  });

  it("answers at 'hidden' without ever sending the coordinates it compared", async () => {
    const { handlers } = mountRows([at(f.centre.lat, f.centre.lon, 2592, "hidden")]);
    const r = await call(handlers, "GET /api/land");
    expect(r.body.seedFrame).toBe(true);
    expect(r.body.centre).toBeNull();
    expect(r.body.parcels[0].centre).toBeNull();
    // Nothing else in the payload may carry the point either.
    expect(JSON.stringify(r.body)).not.toContain(String(f.centre.lat).slice(0, 7));
  });
});

describe("taking the picture down", () => {
  /** A real directory, because this route deletes a real file. */
  function withVolume(row: Record<string, unknown> | null, fileName: string | null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "land-rm-"));
    if (fileName) fs.writeFileSync(path.join(dir, fileName), "jpeg bytes");
    const writes: Array<{ sql: string; params: unknown[]; fileStillThere: boolean | null }> = [];
    const pool: any = {
      async query(sql: string, params: unknown[]) {
        if (/^\s*SELECT/i.test(sql)) return [row ? [row] : [], []];
        writes.push({ sql, params, fileStillThere: fileName ? fs.existsSync(path.join(dir, fileName)) : null });
        return [{ affectedRows: 1 }, []];
      },
    };
    const { app, handlers } = collect();
    register(app, {
      isAdmin: alwaysAdmin, authedUser: async () => ({ id: "f" }), guardCapability: alwaysAllowed,
      getPool: () => pool, uploadsDir: dir,
    } as any);
    return { handlers, writes, dir };
  }
  const ROW = (file: string | null) => ({ ...SAVED, slug: "home", label: "", sort_order: 0, imagery_filename: file });

  it("deletes the file, so the picture is private and not merely unlinked", async () => {
    const { handlers, dir } = withVolume(ROW("land-x.jpg"), "land-x.jpg");
    const r = await call(handlers, "DELETE /api/admin/land/imagery", { query: {} });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, removed: true, fileRemoved: true });
    expect(fs.existsSync(path.join(dir, "land-x.jpg"))).toBe(false);
  });

  it("clears the reference BEFORE the file goes, so a failure never leaves a broken picture", async () => {
    const { handlers, writes } = withVolume(ROW("land-y.jpg"), "land-y.jpg");
    await call(handlers, "DELETE /api/admin/land/imagery", { query: {} });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/imagery_filename = NULL/);
    // The file was still on disk at the moment the reference was cleared.
    expect(writes[0].fileStillThere).toBe(true);
  });

  it("refuses a stored name that could climb out of the uploads directory", async () => {
    const { handlers } = withVolume(ROW("../../etc/passwd"), null);
    const r = await call(handlers, "DELETE /api/admin/land/imagery", { query: {} });
    expect(r.status).toBe(200);
    expect(r.body.fileRemoved).toBe(false);
  });

  it("is a no-op, not an error, when there is no picture to take down", async () => {
    const { handlers } = withVolume(ROW(null), null);
    const r = await call(handlers, "DELETE /api/admin/land/imagery", { query: {} });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ removed: false, fileRemoved: false });
  });

  it("targets only the parcel it names", async () => {
    const { handlers, writes } = withVolume(ROW("land-z.jpg"), "land-z.jpg");
    await call(handlers, "DELETE /api/admin/land/imagery", { query: { slug: "home" } });
    expect(writes[0].sql).toMatch(/WHERE village_id = \? AND slug = \?/);
    expect(writes[0].params).toContain("home");
  });

  it("refuses a malformed parcel name", async () => {
    const { handlers, writes } = withVolume(ROW("land-z.jpg"), "land-z.jpg");
    const r = await call(handlers, "DELETE /api/admin/land/imagery", { query: { slug: "North Field!" } });
    expect(r.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});
