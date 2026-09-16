/**
 * `POST /api/map/promise`, against the built server.
 *
 * The route's real job is not the database work; it is TRANSLATION. A person
 * standing on the map gets one line of text, and which line depends on a
 * reason this route picks from a status code, a capability answer and the
 * absence of a row. Every one of those reasons has a different remedy, so
 * getting the mapping wrong sends somebody to sign in when signing in cannot
 * help, or tells them a gathering was deleted when their village simply never
 * imported the scene.
 *
 * That translation is invisible to a unit test of the query layer, which is
 * why this boots the server and reads the words that come back.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
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
  console.warn("[map.promise.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 19902 + (process.pid % 900);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "map-promise-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let token = "";

async function call(method: string, route: string, body?: unknown, auth = token) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** One promise, as the shell relays it. */
const promise = (kind: "rsvp" | "claim", id: string, on: boolean, auth = token) =>
  call("POST", "/api/map/promise", { kind, id, on }, auth);

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the map promise route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-map-promise-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 });

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
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
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "map-promise-token-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // 180s, matching the other suites that boot this server: it pays the same
  // org-chart backfill before /health answers.
  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Promise Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "PromiseTest123!" }, "");
  token = String(setPw.json?.token ?? "");
  expect(token, "founder must hold a session").toBeTruthy();

  // The map module has to be on, or every promise is a module 404 and the
  // reasons below would never be reached.
  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* gone */ }
});

describe.skipIf(!DB_CONFIGURED)("a promise made on the map", () => {
  it("answers 200 with a reason, never a bare status code", async () => {
    // The shell relays a body, not a code. A 403 would leave the map guessing
    // whether to offer a way in, name a steward, or say it is full.
    const r = await promise("rsvp", "e1", true, "");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(false);
    expect(r.json.reason).toBe("anonymous");
    expect(r.json.href).toBe("/login");
    // And it says where to put the toggle back.
    expect(r.json.state).toBe("off");
  });

  it("reverts to the state the person was moving away from", async () => {
    const off = await promise("rsvp", "e1", false, "");
    expect(off.json.state).toBe("on");
  });

  it("says not-here while the village has imported no scene", async () => {
    // The default state of a fresh fork, and the most common answer the map
    // will ever get. Saying "gone" here would claim a deletion that never
    // happened.
    const r = await promise("rsvp", "e1", true);
    expect(r.json.reason).toBe("not-here");
    expect((await promise("claim", "some-quest-key", true)).json.reason).toBe("not-here");
  });

  it("says gone once the scene is here and this one is not", async () => {
    await pool.query(
      "INSERT INTO events (id, title, starts_at, status, map_key) VALUES (?,?,?,'scheduled',?)",
      ["ev-scene-e1", "Full-moon feast", new Date(Date.now() + 864e5), "e1"],
    );
    expect((await promise("rsvp", "e9", true)).json.reason).toBe("gone");
  });

  it("accepts a real answer and returns the authoritative count", async () => {
    const r = await promise("rsvp", "e1", true);
    expect(r.json.ok).toBe(true);
    expect(r.json.state).toBe("on");
    // The map's own number is sample data and yields to this.
    expect(r.json.count).toBe(1);
  });

  it("says a priced gathering asks for credits, and never that it is closed", async () => {
    /*
     * 0092 put a price on a seat and this route refuses to spend it through a
     * one-tap lantern, which is right. For one release it refused as `closed`,
     * and a member who was perfectly welcome read that the door was shut. The
     * artifact carries copy for `paid` now, so the refusal says the true
     * thing and carries the way to the room that prints the fee.
     */
    await pool.query( // module-review-ok: a fixture on the scratch schema this suite provisioned
      "INSERT INTO events (id, title, starts_at, status, map_key, seat_price, seat_token) VALUES (?,?,?,'scheduled',?,?,?)",
      ["ev-priced", "Solstice supper", new Date(Date.now() + 864e5), "e-priced", 25, "credits"],
    );
    const r = await promise("rsvp", "e-priced", true);
    expect(r.json.ok).toBe(false);
    expect(r.json.state).toBe("off");
    expect(r.json.reason, "a seat with a price is not a closed door").toBe("paid");
    expect(r.json.href, "the refusal names the remedy and carries the way to it").toBe("/events");
    expect(r.json.count).toBe(0);
    // Nothing moved: a refusal that charged would be the defect this guards.
    const [seats] = await pool.query<any[]>("SELECT COUNT(*) n FROM event_seat_charges WHERE event_id = 'ev-priced'"); // module-review-ok: a readback on the scratch schema this suite provisioned
    expect(Number(seats[0].n)).toBe(0);
  });

  it("is idempotent, so a repeated yes is still yes", async () => {
    const again = await promise("rsvp", "e1", true);
    expect(again.json.ok).toBe(true);
    expect(again.json.state).toBe("on");
    expect(again.json.count).toBe(1);
  });

  it("takes an answer back and says how many are left", async () => {
    const off = await promise("rsvp", "e1", false);
    expect(off.json.ok).toBe(true);
    expect(off.json.state).toBe("off");
    expect(off.json.count).toBe(0);
    // Withdrawing twice is not an error: the intent is already satisfied.
    expect((await promise("rsvp", "e1", false)).json.ok).toBe(true);
  });

  it("claims a quest by the key the map minted, and puts it back", async () => {
    await pool.query(
      "INSERT INTO quests (id, title, map_key) VALUES ('q-1','Plant the dry-season beds','plant-the-dry-season-beds')",
    );
    const on = await promise("claim", "plant-the-dry-season-beds", true);
    expect(on.json).toMatchObject({ ok: true, state: "on" });

    const [held] = await pool.query<any[]>("SELECT status FROM quest_claims WHERE quest_id = 'q-1'");
    expect(held[0]?.status).toBe("claimed");

    // Claiming twice is the same yes, not a 409 the map has to interpret.
    expect((await promise("claim", "plant-the-dry-season-beds", true)).json).toMatchObject({ ok: true, state: "on" });

    const off = await promise("claim", "plant-the-dry-season-beds", false);
    expect(off.json).toMatchObject({ ok: true, state: "off" });
    const [after] = await pool.query<any[]>("SELECT COUNT(*) n FROM quest_claims WHERE quest_id = 'q-1'");
    expect(Number(after[0].n)).toBe(0);
  });

  it("refuses to put back a claim that has work attached", async () => {
    await promise("claim", "plant-the-dry-season-beds", true);
    await pool.query("UPDATE quest_claims SET status = 'submitted' WHERE quest_id = 'q-1'");
    const off = await promise("claim", "plant-the-dry-season-beds", false);
    // Removing it now would erase something a steward is looking at, so the
    // toggle goes back to held and says why.
    expect(off.json.ok).toBe(false);
    expect(off.json.state).toBe("on");
    expect(off.json.reason).toBe("closed");
    const [still] = await pool.query<any[]>("SELECT COUNT(*) n FROM quest_claims WHERE quest_id = 'q-1'");
    expect(Number(still[0].n)).toBe(1);
  });

  it("refuses a shape it does not recognise", async () => {
    expect((await call("POST", "/api/map/promise", { kind: "nonsense", id: "e1", on: true })).status).toBe(400);
    // A key outside the stored shape never reaches a query.
    expect((await call("POST", "/api/map/promise", { kind: "rsvp", id: "'; DROP TABLE events; --", on: true })).status).toBe(400);
    expect((await call("POST", "/api/map/promise", { kind: "rsvp", on: true })).status).toBe(400);
  });
});
