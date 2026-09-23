/**
 * THE GLASS ROUND: THE HANDLE, THE ORDERING, AND THE SEVEN READS.
 *
 * Three things this suite drives against the built server, each one a defect
 * that shipped and passed every gate at the time.
 *
 * ── 1. THE 409 CARRIES WHAT A BROWSER NEEDS ──────────────────────────────
 *
 * The refusal named the holder and said "send override with this request, or
 * the x-capability-override header". That is the only thing a person holding
 * a terminal can act on and the only thing a control cannot use, and no
 * client file in the repo mentioned `requiresOverride` at all. So fifteen
 * powers had an escape hatch nobody could reach from the product. The body
 * now carries the holder, the power's name and what a holder can do, as
 * separate facts, and `client/src/lib/breakGlass.ts` turns them into a
 * question. The sentence is unchanged for curl.
 *
 * ── 2. THE RECORD WAITS FOR THE ACT ──────────────────────────────────────
 *
 * `mayAct` wrote "acted on a power this village holds" to the PUBLIC pulse
 * before the route ran, so an admin who broke the glass and then failed
 * validation left the village a permanent record of an act that never
 * happened. `POST /api/admin/health/regen` is the cleanest place to prove
 * both halves: the gate, then a 400 for a value out of range, then a 200 for
 * a good one, on one route and one key.
 *
 * ── 3. SEVEN READS WERE ASKING THE ACT PATH ──────────────────────────────
 *
 * The 0103 sweep audited the seven keys it converted and left the eight that
 * shipped with 0098 unswept. `GET /api/forum/threads`,
 * `GET /api/forum/threads/:id`, `GET /api/admin/exchange` and the four
 * calendar GETs under `/api/admin/events` all still asked `mayAct`, which
 * reads the break-glass and writes the public line. So an operator with the
 * header on a GET wrote a false record for looking at a list, and an operator
 * without one was refused a READ on a village-held key. Both halves are
 * driven below.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. The cases run IN ORDER.
 * Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[glassHandle.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 13800 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "glass-handle-admin";
const PASSWORD = "GlassHandle123!";
const ROLE = "steward-circle";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";
let kiraId = "";
let threadId = "";
let eventId = "";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/** The header hatch, which is the one a GET can carry. */
const GLASS = { "x-capability-override": "true" };

/**
 * Lines the VILLAGE reads about somebody reaching past a power.
 *
 * Counted in SQL against the whole table, never off a capped list: a capped
 * read stops growing partway through a suite and every comparison after that
 * passes for the wrong reason.
 */
async function reachCount(): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'public' AND is_example = 0 " +
      "AND text LIKE '%acted on a power this village holds%'",
  );
  return Number(row?.n ?? 0);
}

/** Admin-trail rows whose text starts with this, whatever follows. */
async function trailCount(prefix: string): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'admin' AND LEFT(text, ?) = ?",
    [prefix.length, prefix],
  );
  return Number(row?.n ?? 0);
}

async function roleCapabilities(): Promise<string[]> {
  const r = await call("GET", "/api/roles", undefined, "");
  const role = (r.json ?? []).find((x: any) => x.id === ROLE);
  try {
    const raw = role?.capabilities;
    return Array.isArray(raw) ? raw.map(String) : JSON.parse(String(raw ?? "[]")).map(String);
  } catch {
    return [];
  }
}

/** Put a capability on the Steward Circle and hand the power to the village. */
async function hold(cap: string): Promise<void> {
  const next = Array.from(new Set([...(await roleCapabilities()), cap]));
  const armed = await call("PUT", `/api/admin/roles/${ROLE}/capabilities`, {
    capabilities: next,
    grantedEscalations: [cap],
  });
  expect(armed.status, armed.text).toBe(200);
  const moved = await call("PUT", `/api/admin/capabilities/${cap}/holding`, { roleId: ROLE });
  expect(moved.status, `${cap}: ${moved.text}`).toBe(200);
}

/** The server's own output, kept across restarts so a failed boot can print it. */
const serverLogs: string[] = [];

async function bootServer(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "glass-handle-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child!.stdout?.on("data", (d) => serverLogs.push(String(d)));
  child!.stderr?.on("data", (d) => serverLogs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs: serverLogs, child });
}

/**
 * RYE, 2026-09-21: only a founder seated as a steward with the veto may break
 * the glass (`BREAK_GLASS_SEAT` in shared/capabilities.ts). This suite drives
 * the glass on purpose, so its founder sits in that seat. A seat carrying the
 * veto is filled by a role_seat ballot and by no admin route, so it is written
 * underneath the role cache and the server comes back up to read it.
 * `server/founderOverride.routes.e2e.test.ts` drives everybody the glass
 * refuses.
 */
async function seatFounderAsSteward(founderId: string): Promise<void> {
  child?.kill();
  await new Promise((r) => setTimeout(r, 500));
  await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    ["steward", "Steward", "Can stop a carried decision inside its window.", JSON.stringify(["steward.veto"]), 0],
  );
  await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
    "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?,?,?,?,?)",
    [`rh-steward-${founderId}`.slice(0, 64), "steward", founderId, "bal-role-seat", new Date(Date.now() + 365 * 864e5)],
  );
  await bootServer();
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the glass handle test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-glass-handle-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await bootServer();

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Glass Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  const founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "the founder must hold a session").toBeTruthy();

  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }

  // Kira sits in the Steward Circle, so every power below has a real holder
  // and the 409 has a real name to say.
  const kira = await call("POST", "/api/auth/register", {
    name: "Kira Vance", email: `kira-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
  }, "");
  kiraId = String(kira.json?.user?.id ?? "");
  expect(kiraId).toBeTruthy();
  // The seeded role asks for the Member stage, and a fresh registration is
  // below it. Advancing her is a fixture step and never part of what this
  // suite is about.
  const stage = await call("PUT", `/api/admin/players/${kiraId}/stage`, { stageId: "member" });
  expect(stage.status, stage.text).toBe(200);
  const seated = await call("POST", `/api/admin/roles/${ROLE}/holders`, { userId: kiraId, action: "add" });
  expect(seated.status, seated.text).toBe(200);

  // One thread and one gathering to read back, made while the panel still
  // holds everything, so the reads below have something to answer with.
  const cats = await call("GET", "/api/forum/categories", undefined, "");
  const category = String((cats.json ?? [])[0]?.id ?? (cats.json ?? [])[0]?.slug ?? "");
  const thread = await call("POST", "/api/forum/threads", {
    category, title: "A thread the operator can still read", body: "It stays readable either way.",
  });
  expect(thread.status, thread.text).toBe(200);
  threadId = String(thread.json?.id ?? "");
  const gathering = await call("POST", "/api/admin/events", {
    title: "A gathering", startsAt: "2027-03-01T18:00:00.000Z", status: "published",
  });
  expect(gathering.status, gathering.text).toBe(200);
  eventId = String(gathering.json?.id ?? gathering.json?.event?.id ?? "");
  expect(eventId, "the calendar write must hand back an id").toBeTruthy();

  // The founder breaks the glass below, so the founder sits where the
  // ruling says the glass is kept. See seatFounderAsSteward.
  await seatFounderAsSteward(founderId);
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the 409 says enough for a control to ask the question", () => {
  it("hands the power to the village", async () => {
    await hold("health.record");
  });

  it("names the holder, the power and the consequence as facts, beside the curl sentence", async () => {
    const blocked = await call("POST", "/api/admin/health/regen", { metricKey: "trees_planted", value: 3 });
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.json?.requiresOverride).toBe(true);
    expect(blocked.json?.capability).toBe("health.record");
    // The three the browser composes its own sentence out of.
    expect(blocked.json?.holder).toBe("Steward Circle");
    expect(String(blocked.json?.title).length).toBeGreaterThan(0);
    expect(String(blocked.json?.consequence)).toContain("measurements");
    // And the sentence a terminal reads is untouched.
    expect(String(blocked.json?.error)).toContain("x-capability-override");
    expect(String(blocked.json?.error)).toContain("Steward Circle");
  });
});

describe.skipIf(!DB_CONFIGURED)("the record waits for the act, and says nothing when there was none", () => {
  it("writes NO public line when the route refuses after the gate let them through", async () => {
    /*
     * THE DEFECT, DRIVEN. The glass is broken and the route then refuses the
     * value. Nothing was measured, nothing was written, and the village is
     * told nothing. Before the ordering moved, this left a permanent line
     * saying an administrator acted on a power the village holds.
     */
    const before = await reachCount();
    const attempts = await trailCount("capability:override:health.record:");
    const incompletes = await trailCount("capability:override-incomplete:health.record:");

    const refused = await call("POST", "/api/admin/health/regen", {
      metricKey: "trees_planted", value: -5, override: true,
    });
    expect(refused.status, refused.text).toBe(400);

    expect(await reachCount(), "the village must not read about an act that did not happen").toBe(before);
    // The admin trail carries BOTH halves, which is what lets an operator
    // tell an abandoned reach from a lost record.
    expect(await trailCount("capability:override:health.record:")).toBe(attempts + 1);
    expect(await trailCount("capability:override-incomplete:health.record:")).toBe(incompletes + 1);
  });

  it("nor when the route refuses the metric itself", async () => {
    const before = await reachCount();
    const nope = await call("POST", "/api/admin/health/regen", {
      metricKey: "no-such-metric", value: 3, override: true,
    });
    expect(nope.status, nope.text).toBe(400);
    expect(await reachCount()).toBe(before);
  });

  it("writes exactly one public line when the act goes through", async () => {
    const before = await reachCount();
    const attempts = await trailCount("capability:override:health.record:");
    const done = await call("POST", "/api/admin/health/regen", {
      metricKey: "trees_planted", value: 3, override: true,
    });
    expect(done.status, done.text).toBe(200);
    /*
     * READ WITH NO POLLING, ON PURPOSE. The public line is written before the
     * response leaves, so an answer in hand means the record is committed. A
     * suite that had to poll here would be describing a record that can be
     * lost, which is the ordering this round decided against.
     */
    expect(await reachCount(), "one act, one line").toBe(before + 1);
    expect(await trailCount("capability:override:health.record:")).toBe(attempts + 1);
    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 " +
        "AND text LIKE '%acted on a power this village holds%' ORDER BY at DESC, id DESC LIMIT 1",
    );
    expect(String(rows[0]?.text)).toContain("Glass Founder");
    expect(String(rows[0]?.text)).toContain("Steward Circle");
  });

  it("tells the person who holds it, and only for the act that happened", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT type, body FROM notifications WHERE user_id = ? AND type = 'capability_override'",
      [kiraId],
    );
    expect(rows.length, "the holder hears about the reach that landed").toBeGreaterThan(0);
    expect(String(rows[0]?.body)).toContain("Glass Founder");
  });

  it("hands it back so the rest of the suite starts clean", async () => {
    expect((await call("DELETE", "/api/admin/capabilities/health.record/holding")).status).toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("the seven reads the 0103 sweep did not reach", () => {
  /*
   * `forum.moderate`, `exchange.manage` and `event.manage` shipped with 0098
   * and were never swept, so seven GETs were still asking the ACT path. Each
   * one was wrong in both directions at once and this block drives both.
   */
  const READS = (): Array<[string, string]> => [
    ["GET", "/api/forum/threads"],
    ["GET", `/api/forum/threads/${threadId}`],
    ["GET", "/api/admin/exchange"],
    ["GET", "/api/admin/events"],
    ["GET", "/api/admin/events/month-names"],
    ["GET", `/api/admin/events/${eventId}/rsvps`],
    ["GET", `/api/admin/events/${eventId}/slots`],
  ];

  it("hands all three powers to the village", async () => {
    for (const cap of ["forum.moderate", "exchange.manage", "event.manage"]) await hold(cap);
  });

  it("the operator can still read every one of them, with nothing in the request", async () => {
    /*
     * THE HALF THAT WAS A LOCKOUT. The four calendar GETs asked
     * `guardCapability`, so an operator on a village-held key met a 409
     * telling them to break glass to look at a list. A village taking the act
     * on never took the operator's eyes.
     */
    for (const [method, route] of READS()) {
      const r = await call(method, route);
      expect(r.status, `${route}: ${r.text}`).toBe(200);
    }
  });

  it("and reading them with the glass in the request writes nothing at all", async () => {
    /*
     * THE HALF THAT WAS A FALSE RECORD. A GET cannot carry a body, which is
     * exactly why the header hatch exists and exactly why the header is the
     * vector a reading surface has to be safe against.
     */
    const before = await reachCount();
    for (const [method, route] of READS()) {
      const looked = await call(method, route, undefined, founderToken, GLASS);
      expect(looked.status, `${route} with the header: ${looked.text}`).toBe(200);
    }
    expect(await reachCount(), "a look must never reach past anything").toBe(before);
  });

  it("while the ACT behind the same key still refuses and still records", async () => {
    // The reads went to the helper that cannot write. The act did not move,
    // so the key is still a real power with a real door.
    const blocked = await call("POST", "/api/admin/exchange/stock", { tokenSlug: "nothing", quantity: 1 });
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.json?.requiresOverride).toBe(true);
    expect(blocked.json?.capability).toBe("exchange.manage");
  });

  it("hands all three back, so the suite leaves the village where it found it", async () => {
    for (const cap of ["forum.moderate", "exchange.manage", "event.manage"]) {
      expect((await call("DELETE", `/api/admin/capabilities/${cap}/holding`)).status, cap).toBe(200);
    }
  });
});
