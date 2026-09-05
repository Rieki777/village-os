/**
 * Claiming and dropping a path, over HTTP, against the BUILT server.
 *
 * WHY THIS SUITE EXISTS. `PUT /api/profile` has accepted a `paths` array since
 * the route was written, and until the profile grew a claim control nothing in
 * the client had ever sent one. A member could not choose or change their
 * paths anywhere in the product, and two whole populations were stuck with an
 * empty list and no way out: anyone who signed in through Google, and the
 * account the founder bootstrap creates. So the round trip this file asserts
 * is the one nobody had ever run.
 *
 * The second half is the hardening. `if (paths) u.paths = paths` wrote
 * whatever JSON arrived into the column: a bare string, an object, ids nothing
 * has ever defined. `claimPaths` (shared/gameConfig.ts) now decides, and the
 * refusals below are what a unit test of that function cannot prove, because
 * the question is whether the ROUTE reaches it and whether a refusal leaves
 * the stored row untouched.
 *
 * Every assertion re-reads GET /api/profile rather than trusting the PUT's own
 * echo. A route that answered from the request body would pass an echo-only
 * test while writing nothing.
 *
 * Order-dependent (each case builds on the list the last one left): run the
 * whole file, never a -t slice. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[profilePaths.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/**
 * Its own window at the top of the range. Every window from 6000 to 30401 is
 * spoken for, the 7400 gap included: that one is agent.routes STUB_PORT, which
 * is PORT + 500 and therefore invisible to a grep for a literal.
 *
 * MOVED from 30002 during integration. This suite took 30002 when that was the
 * first free base; `review.routes.e2e.test.ts` landed on main with the same
 * base while this branch was out, so the two windows were identical and
 * check-e2e-ports.mjs refused. The suite that was already on main keeps the
 * number. 30801 is still well clear of the 32768 ephemeral floor the guard
 * enforces.
 */
const PORT = 30402 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let mira = { token: "", id: "" };

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = mira.token,
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json };
}

/** What the SERVER says this member's paths are, read back from its own row. */
async function storedPaths(): Promise<string[]> {
  const r = await call("GET", "/api/profile");
  expect(r.status, "the member must be able to read their own profile").toBe(200);
  return r.json?.paths ?? [];
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the profile paths route test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-profile-paths-"));
  testDb = await provisionTestDb();
  // Only to WRITE the legacy rows the old route produced. There is no other
  // way to make one now, which is the point of the fix.
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: 28 jobs fall due on the first tick and run in
      // series against the scratch schema this suite is asserting on.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: "profile-paths-admin",
      AUTH_TOKEN_SECRET: "profile-paths-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
      RESEND_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s. Output:\n${logs.join("")}`);
    }
    try { const res = await fetch(`${BASE}/health`); if (res.ok) break; } catch { /* not up */ } // module-review-ok: the boot poll against the local test server
    await new Promise((r) => setTimeout(r, 400));
  }

  const reg = await call(
    "POST",
    "/api/auth/register",
    { name: "Mira Solis", email: `mira-${PORT}@example.test`, password: "PathClaim123!", paths: ["resident"] },
    "",
  );
  expect(reg.status, "the member must register").toBe(200);
  mira = { token: String(reg.json?.token ?? ""), id: String(reg.json?.user?.id ?? "") };
  expect(mira.token).toBeTruthy();
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("claiming and dropping a path", () => {
  it("starts from what registration chose", async () => {
    expect(await storedPaths()).toEqual(["resident"]);
  });

  it("claims a second path and keeps it across a re-read", async () => {
    const put = await call("PUT", "/api/profile", { paths: ["resident", "investor"] });
    expect(put.status).toBe(200);
    // The route's own echo, and then the row, which is the claim that matters.
    expect(put.json?.paths).toEqual(["resident", "investor"]);
    expect(await storedPaths()).toEqual(["resident", "investor"]);
  });

  it("drops one and keeps the other", async () => {
    const put = await call("PUT", "/api/profile", { paths: ["investor"] });
    expect(put.status).toBe(200);
    expect(await storedPaths()).toEqual(["investor"]);
  });

  it("drops the last one, which an empty array has to mean", async () => {
    // `if (paths)` would have accepted this by accident, because [] is truthy
    // in JavaScript. It is now deliberate, and it is the state every Google
    // signup and the bootstrap founder start in.
    const put = await call("PUT", "/api/profile", { paths: [] });
    expect(put.status).toBe(200);
    expect(await storedPaths()).toEqual([]);
  });

  it("claims from empty, which is the way out those two populations never had", async () => {
    const put = await call("PUT", "/api/profile", { paths: ["steward", "prosperity-creator"] });
    expect(put.status).toBe(200);
    expect(await storedPaths()).toEqual(["steward", "prosperity-creator"]);
  });

  it("collapses a repeated id instead of storing it twice", async () => {
    const put = await call("PUT", "/api/profile", { paths: ["steward", "steward"] });
    expect(put.status).toBe(200);
    expect(await storedPaths()).toEqual(["steward"]);
  });

  it("leaves the list alone when the field is absent, which is what a bio save sends", async () => {
    const put = await call("PUT", "/api/profile", { bio: "Water and soil." });
    expect(put.status).toBe(200);
    expect(put.json?.bio).toBe("Water and soil.");
    expect(await storedPaths()).toEqual(["steward"]);
  });
});

describe.skipIf(!DB_CONFIGURED)("what the route refuses to write", () => {
  it("refuses an id this village does not offer, and writes nothing", async () => {
    const put = await call("PUT", "/api/profile", { paths: ["steward", "wizard"] });
    expect(put.status).toBe(400);
    expect(String(put.json?.error)).toContain("wizard");
    expect(await storedPaths()).toEqual(["steward"]);
  });

  it("refuses a bare string where a list belongs", async () => {
    const put = await call("PUT", "/api/profile", { paths: "investor" });
    expect(put.status).toBe(400);
    expect(await storedPaths()).toEqual(["steward"]);
  });

  it("refuses an object in the list", async () => {
    const put = await call("PUT", "/api/profile", { paths: [{ id: "investor" }] });
    expect(put.status).toBe(400);
    expect(await storedPaths()).toEqual(["steward"]);
  });

  it("refuses null, which used to slip past the truthiness check untouched", async () => {
    const put = await call("PUT", "/api/profile", { paths: null });
    expect(put.status).toBe(400);
    expect(await storedPaths()).toEqual(["steward"]);
  });

  it("refuses a stranger outright", async () => {
    const put = await call("PUT", "/api/profile", { paths: ["investor"] }, "");
    expect(put.status).toBe(401);
    expect(await storedPaths()).toEqual(["steward"]);
  });

  it("refuses an unknown id at registration, which is the door a stranger can open", async () => {
    // The OTHER writer of this column, and the only one reachable without an
    // account. It checked `Array.isArray` and nothing else, so a junk id went
    // straight into a brand new member's row.
    const bad = await call(
      "POST",
      "/api/auth/register",
      { name: "A Stranger", email: `stranger-${PORT}@example.test`, password: "PathClaim123!", paths: ["wizard"] },
      "",
    );
    expect(bad.status).toBe(400);
    expect(String(bad.json?.error)).toContain("wizard");
  });

  it("recovers a row the old route already spoiled, without a 500", async () => {
    /*
     * THE ROWS THAT ARE ALREADY OUT THERE. For as long as `if (paths) u.paths
     * = paths` stood, a bare string went into this column and came back out of
     * `fromJsonCol` as a bare string, because that helper returns whatever
     * JSON it finds and never asks for an array. Two readers would then have
     * met it: `claimPaths` doing `held.map` (a 500 on the member's first
     * claim) and the profile page doing `user.paths.filter` (a blank page).
     * Both now check. Written with SQL because the route that used to make one
     * cannot any more.
     */
    const spoil = async (value: unknown) => {
      await pool.query("UPDATE users SET paths = ? WHERE id = ?", [JSON.stringify(value), mira.id]); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
    };

    // An OBJECT. mysql2 hands a JSON column back already parsed, so this
    // reaches both readers exactly as it is stored.
    await spoil({ chosen: "investor" });
    expect(await storedPaths()).toEqual([]);
    const fromObject = await call("PUT", "/api/profile", { paths: ["steward"] });
    expect(fromObject.status, "a spoiled row must not answer a claim with a 500").toBe(200);
    expect(await storedPaths()).toEqual(["steward"]);

    // A LIST that is only partly ids. The array survives `Array.isArray`, so
    // the number is what the page would have tried to render.
    await spoil(["investor", 7]);
    expect(await storedPaths()).toEqual(["investor"]);
    const fromMixed = await call("PUT", "/api/profile", { paths: ["investor"] });
    expect(fromMixed.status).toBe(200);
    expect(await storedPaths()).toEqual(["investor"]);

    // And back to a clean list for the case that follows.
    expect((await call("PUT", "/api/profile", { paths: ["steward"] })).status).toBe(200);
  });

  it("still keeps the rest of the profile working after the move out of index.ts", async () => {
    // The three /api/profile routes now live in server/routes/profile.ts. A
    // route that stopped being registered answers 404, so this asks each one.
    expect((await call("GET", "/api/profile")).status).toBe(200);
    const note = await call("POST", "/api/profile/contribution", { type: "note", description: "Planted the swale." });
    expect(note.status).toBe(200);
    expect(note.json?.contribution?.description).toBe("Planted the swale.");
    const handle = await call("PUT", "/api/profile", { handle: "mira-solis" });
    expect(handle.status).toBe(200);
    expect(handle.json?.handle).toBe("mira-solis");
    expect((await call("PUT", "/api/profile", { handle: "no" })).status).toBe(400);
  });
});

/**
 * THE LADDER UNDER THE PATH, over HTTP, against the built server.
 *
 * The derivation has its own suite and the SQL has its own; neither of them can
 * say the route is MOUNTED, that it refuses a stranger, or that a position
 * really does fall out of the database with nothing written to make it. That is
 * what these ask, and they ask it here because Mira already exists and already
 * walks a path.
 *
 * The seating is written with SQL because nothing in the product seats a
 * member without an admin session, and the admin door is a different suite's
 * subject. `season_id` is left NULL on purpose: `isLapsed` short-circuits on a
 * seating with no season, so these cases turn on the seating alone and not on
 * whichever season this village happens to be running when they run.
 *
 * Runs last, so it changes nothing the cases above depend on.
 */
describe.skipIf(!DB_CONFIGURED)("where the member stands on the path", () => {
  it("refuses a stranger", async () => {
    const r = await call("GET", "/api/paths/ladders", undefined, "");
    expect(r.status).toBe(401);
    expect(r.json?.error).toBe("auth_required");
  });

  it("serves one ladder per walked path, and names the mechanic when it is bare", async () => {
    // Mira walks the steward path and nothing else at this point.
    const r = await call("GET", "/api/paths/ladders");
    expect(r.status).toBe(200);
    expect(r.json?.ladders?.map((l: any) => l.pathId)).toEqual(["steward"]);
    const steward = r.json.ladders[0];
    expect(steward.position).toBe(0);
    expect(steward.rungs).toHaveLength(3);
    expect(steward.empty?.doorHref).toBe("/roles");
  });

  it("climbs when the village seats her, with nothing but the seating written", async () => {
    await pool.query( // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
      "INSERT INTO org_roles (id, name) VALUES ('ladder-seat', 'Water Steward')",
    );
    await pool.query( // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
      "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key) " +
        "VALUES ('ladder-seating', 'ladder-seat', 'member', ?, ?)",
      [mira.id, mira.id],
    );
    const r = await call("GET", "/api/paths/ladders");
    const steward = r.json.ladders[0];
    expect(steward.position).toBe(2);
    expect(steward.rungs.filter((x: any) => x.lit).map((x: any) => x.id)).toEqual(["seated", "mandate"]);
    expect(steward.empty).toBeNull();
  });

  /*
   * THE REQUIREMENT, end to end. One `ended_at` and the position falls on the
   * next read. No job ran, no cache was cleared, no rung was written anywhere,
   * and the record still says what happened.
   */
  it("drops every rung when the seating ends, and keeps the history", async () => {
    await pool.query( // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
      "UPDATE org_role_assignments SET ended_at = NOW(), ended_reason = ? WHERE id = 'ladder-seating'",
      ["stood down at the turn"],
    );
    const r = await call("GET", "/api/paths/ladders");
    const steward = r.json.ladders[0];
    expect(steward.position).toBe(0);
    expect(steward.rungs[0].fell).toBe(true);
    expect(steward.rungs[0].note).toBe("stood down at the turn");
    // A moon, never a cycle id, and never a raw timestamp.
    expect(steward.rungs[0].moon === null || typeof steward.rungs[0].moon.ordinal !== "undefined").toBe(true);
  });

  it("adds a ladder when she claims a second path, and none for a path she drops", async () => {
    expect((await call("PUT", "/api/profile", { paths: ["steward", "resident"] })).status).toBe(200);
    const both = await call("GET", "/api/paths/ladders");
    expect(both.json?.ladders?.map((l: any) => l.pathId)).toEqual(["steward", "resident"]);

    expect((await call("PUT", "/api/profile", { paths: ["resident"] })).status).toBe(200);
    const one = await call("GET", "/api/paths/ladders");
    expect(one.json?.ladders?.map((l: any) => l.pathId)).toEqual(["resident"]);
  });

  it("hands back nothing at all to a member who walks no path", async () => {
    expect((await call("PUT", "/api/profile", { paths: [] })).status).toBe(200);
    const r = await call("GET", "/api/paths/ladders");
    expect(r.status).toBe(200);
    expect(r.json?.ladders).toEqual([]);
  });
});
