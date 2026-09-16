/**
 * Housing availability and reservations, over HTTP (0077).
 *
 * `server/lib/housing.ts` is proved by `server/lib/housing.test.ts` against a
 * fake pool: the example predicate, the taken/total pair, the absence rules.
 * That left the part an attacker and a founder actually meet untested. Before
 * this file, `grep -rn "/api/housing" --include=*.test.ts` RETURNED NOTHING:
 * 341 lines of route code, six routes, and every guard on them, guarded by
 * nothing.
 *
 * It was measured rather than assumed. A reviewer put six previously-fixed
 * defects back into `server/index.ts` and ran every gate:
 *
 *   1. deleted the honeypot on POST /api/housing/reservations
 *   2. deleted the per-IP cap on the same route
 *   3. removed hasCapability from GET /api/housing/availability
 *   4. swapped GET /api/housing/public to `housingRows`, so `updatedBy` and
 *      the unset rows rode an UNCREDENTIALED response
 *   5. broke the before-state `exceedsTotal` is checked against
 *   6. disabled the notify path, so a reservation told nobody
 *
 * 77 files, 1327 tests, 0 skipped, exit 0. Byte-identical counts to the clean
 * baseline fifteen minutes earlier. NOT ONE TEST MOVED. Every case in this
 * file exists because one of those six edits has to make it red, and each was
 * re-applied one at a time and watched go red before this file was believed.
 *
 * ── HOW THESE ASSERT ─────────────────────────────────────────────────────
 * Every refusal is checked WITH ITS POSITIVE CONTROL in the same case. A
 * route that 500s on everything refuses everything, and a suite made only of
 * refusals calls that a pass. So: the honeypot stores nothing AND the same
 * body without it stores a row; the cap refuses the seventh AND a different
 * address still gets through; the public entries omit identity AND the gated
 * read proves that identity is really there to omit.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, like
 * `loop.e2e.test.ts`, `examples.routes.e2e.test.ts` and
 * `messaging.routes.e2e.test.ts`. Run `pnpm build` first or you are testing
 * stale code. Skips loudly without TEST_DATABASE_URL.
 *
 * The cases run IN ORDER. The map module is off at the start (the shipped
 * default) and one case turns it on, which is itself under test. Run the
 * whole file, never a `-t` slice.
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
  // eslint-disable-next-line no-console
  console.warn("[housing.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's port window. It is checked, not asserted.
 *
 * A hand-written survey used to live here, ending with RE-GREP BEFORE
 * TRUSTING THIS. Nobody re-grepped, the tree moved, and the paragraph went on
 * claiming the window was clear when it had not been for over a week. Worse,
 * every one of those surveys grepped for `process.pid %` and so never saw the
 * stub ports (GOOGLE_PORT, BARE_PORT, STUB_PORT) or the fixed 8127 that
 * actually caused a failure.
 *
 * `scripts/check-e2e-ports.mjs` is that survey, executable, run in CI. It
 * refuses any two windows in different files that overlap at all, any fixed
 * port, and anything reaching into Linux's ephemeral range. Change the number
 * below and it will tell you.
 */
const PORT = 15000 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "housing-routes-admin";

/** The log line `sendResendEmail` prints for every send while no key is set. */
const RESEND_SKIP = "[RESEND] API key not set, skipping email";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
/** Every line the server printed, so the notify path has an observable. */
const logs: string[] = [];

let founderToken = "";
let founderId = "";
/** Holds map.publish through a BADGE and is not an admin. */
let cartographerToken = "";
/** An ordinary member. Holds nothing, and never will by climbing. */
let strangerToken = "";

interface Answer {
  status: number;
  json: any;
}

/**
 * One call. `ip` sets X-Forwarded-For, which `clientIp` reads because
 * TRUSTED_PROXY_HOPS defaults to 1 — that is what lets each case here spend
 * its own rate-limit budget instead of the suite sharing one bucket keyed on
 * 127.0.0.1 and going 429 in whichever case happens to run seventh.
 */
async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null; ip?: string } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email: `${slug}-${PORT}@example.test`, password: "HousingTest123!", paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** How many emails the server has tried to send since the process started. */
const resendAttempts = (): number =>
  logs.join("").split(RESEND_SKIP).length - 1;

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Poll a fire-and-forget effect into existence, or fail saying what was missing. */
async function waitUntil(what: string, ok: () => Promise<boolean> | boolean, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await settle(150);
  }
}

/** Rows this suite wrote, read straight off the table rather than off a route. */
async function reservationsFor(email: string): Promise<any[]> {
  const [rows] = await pool.query<any[]>(
    "SELECT id, structure_key, home_type, name, email, phone, notes, arrived_from, status " +
      "FROM housing_reservations WHERE email = ? ORDER BY created_at",
    [email],
  );
  return rows;
}

/** One hamlet as the gated founder view reports it. */
async function founderRow(structureKey: string, token = founderToken): Promise<any> {
  const r = await call("GET", "/api/housing/availability", { token });
  expect(r.status, "the founder view must answer").toBe(200);
  return (r.json?.rows ?? []).find((x: any) => x.structureKey === structureKey) ?? null;
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the housing route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-housing-"));
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
      AUTH_TOKEN_SECRET: "housing-routes-token-secret",
      // Deliberately blank. `sendResendEmail` then prints RESEND_SKIP and
      // returns instead of reaching the network, which is what makes "did
      // this route try to tell anybody" observable without a live inbox.
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Housing Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: "HousingTest123!" },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const stranger = await register("Sam Reed", "stranger");
  strangerToken = stranger.token;

  /*
   * A NON-ADMIN who holds map.publish. Without this the capability tests
   * would pass just as well against `isAdmin(req)`, and swapping the one gate
   * for an admin check is exactly the shape of edit this file is here to
   * catch. map.publish is absent from STAGE_UNLOCKS on purpose, so a badge
   * (or a role) is the only way anyone but an admin ever holds it.
   */
  const carto = await register("Cara Diaz", "cartographer");
  cartographerToken = carto.token;
  expect((await call("PUT", "/api/admin/modules/badges/lifecycle", { body: { lifecycle: "public" } })).status).toBe(200);
  const badge = await call("POST", "/api/admin/badges", {
    body: { name: `Housing Cartographer ${PORT}`, kind: "granted", capabilities: ["map.publish"] },
  });
  expect(badge.status, "the founder can define a badge that carries map.publish").toBe(200);
  const badgeId = String(badge.json?.badge?.id ?? "");
  expect(badgeId).toBeTruthy();
  const awarded = await call("POST", `/api/admin/badges/${badgeId}/award`, { body: { userId: carto.id } });
  expect(awarded.status, "the founder can award it").toBe(200);
  // NO local hook budget: inherit the global from vitest.config.ts, which
  // carries the provisioning arithmetic and grows with the migration count.
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("housing routes: the guards nothing was testing", () => {
  it("puts counts on the public route and identity nowhere near it", async () => {
    // A hamlet that is fully set, and one a founder has only named. Builder
    // mode writes the second shape every time someone types a key, so it is
    // ordinary rather than an edge case.
    expect(
      (await call("PUT", "/api/housing/availability/pubSet", {
        body: { total: 6, taken: 2, label: "Ridge Hamlet North" },
      })).status,
    ).toBe(200);
    expect((await call("PUT", "/api/housing/availability/pubUnset", { body: {} })).status).toBe(200);

    // UNCREDENTIALED, which is how the map and the reservation form read it.
    const pub = await call("GET", "/api/housing/public", { token: null });
    expect(pub.status).toBe(200);
    expect(pub.json?.configured).toBe(true);

    const entries: any[] = pub.json?.entries ?? [];
    const set = entries.find((e) => e.structureKey === "pubSet");
    expect(set, "a fully set hamlet is published").toBeTruthy();
    expect(set).toMatchObject({ total: 6, taken: 2, open: 4, label: "Ridge Hamlet North" });

    /*
     * EXACT key set, not a spot check. `allRows` differs from `publicEntries`
     * by four keys (storedTaken, updatedBy, updatedAt, reservedCount) and two
     * of them name a person. Swapping this route to the founder's reader is
     * one identifier, and a `not.toContain("updatedBy")` on its own would
     * still pass if some other identity field were added later.
     */
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(
        ["label", "open", "structureKey", "taken", "takenSource", "total"],
      );
    }
    expect(
      entries.find((e) => e.structureKey === "pubUnset"),
      "a hamlet that was named but never numbered is NOT published",
    ).toBeUndefined();
    expect(JSON.stringify(pub.json), "no member id may ride this response").not.toContain(founderId);

    /*
     * The positive control that makes the absences above mean something. The
     * identity IS on the row; the public route is filtering it, rather than
     * the table simply being empty of it.
     */
    const gated = await call("GET", "/api/housing/availability");
    expect(gated.status).toBe(200);
    const rows: any[] = gated.json?.rows ?? [];
    const gatedSet = rows.find((r) => r.structureKey === "pubSet");
    expect(gatedSet?.updatedBy, "the gated view names who wrote the row").toBe(founderId);
    expect(gatedSet?.updatedAt).toBeTruthy();
    expect(gatedSet?.storedTaken).toBe(2);
    const gatedUnset = rows.find((r) => r.structureKey === "pubUnset");
    expect(gatedUnset, "the gated view keeps the unset row the public one dropped").toBeTruthy();
    expect(gatedUnset?.total).toBeNull();
    expect(gatedUnset?.storedTaken).toBeNull();
    expect(gatedUnset?.open).toBeNull();
  });

  it("answers while the map module is off, and agrees with it once it is on", async () => {
    /*
     * The reason these routes are not under /api/map. That prefix carries
     * `app.use("/api/map", requireModule("map"))`, so a village that never
     * turns the map on, or switches it off for an afternoon, would lose the
     * ability to sell a home. This case runs before anything enables the map,
     * so it proves the SHIPPED default rather than a state it arranged.
     */
    const offConfig = await call("GET", "/api/map/config", { token: null });
    expect(offConfig.status, "the map config is behind the map module").toBe(404);
    expect(offConfig.json?.error).toBe("module_disabled");

    const stillThere = await call("GET", "/api/housing/public", { token: null });
    expect(stillThere.status, "housing does not go down with the map").toBe(200);
    expect((stillThere.json?.entries ?? []).length).toBeGreaterThan(0);

    expect((await call("PUT", "/api/admin/modules/map/lifecycle", { body: { lifecycle: "public" } })).status).toBe(200);
    const onConfig = await call("GET", "/api/map/config", { token: null });
    expect(onConfig.status).toBe(200);
    /*
     * THE SAME HAMLET ANSWER FROM BOTH TRANSPORTS, deep-equal. Two readers of
     * one predicate is the whole design; two readers that have drifted is
     * three lanes disagreeing about which hamlets are examples.
     *
     * This used to compare the WHOLE public body to the map block, which said
     * the same thing while `entries` and `configured` were all the body had.
     * 0131 gave the public route a second subject, `homes`, and the two are
     * deliberately not the same list: the map paints hamlets and knows
     * nothing about what a home is called or what it costs, so shipping the
     * home descriptions on every uncredentialed map fetch would be paying for
     * them where nothing draws them. The invariant this case exists for is
     * named field by field below, which is stronger than a deep-equal that
     * has to be relaxed every time either side grows a key.
     */
    expect(onConfig.json?.housing?.entries).toEqual(stillThere.json?.entries);
    expect(onConfig.json?.housing?.configured).toEqual(stillThere.json?.configured);
    expect(
      onConfig.json?.housing?.homes,
      "the map block carries hamlet counts and no home descriptions",
    ).toBeUndefined();
  });

  it("holds the founder's view behind the capability and not behind a login", async () => {
    const anon = await call("GET", "/api/housing/availability", { token: null });
    expect(anon.status).toBe(401);
    expect(anon.json?.rows, "a refusal carries no rows").toBeUndefined();

    // Registered, signed in, and still not appointed. map.publish is absent
    // from STAGE_UNLOCKS, so no amount of climbing reaches this.
    const member = await call("GET", "/api/housing/availability", { token: strangerToken });
    expect(member.status, "an ordinary member cannot read who set the numbers").toBe(403);
    expect(member.json?.rows).toBeUndefined();

    // The positive control, and the one that matters: a NON-ADMIN who holds
    // the capability through a badge is let in. Without this case, replacing
    // hasCapability with isAdmin would pass every assertion above.
    const carto = await call("GET", "/api/housing/availability", { token: cartographerToken });
    expect(carto.status, "a cartographer holds map.publish and is not an admin").toBe(200);
    expect(Array.isArray(carto.json?.rows)).toBe(true);
    expect((carto.json?.rows ?? []).length).toBeGreaterThan(0);

    expect((await call("GET", "/api/housing/availability")).status, "an admin passes at step 1").toBe(200);
  });

  it("holds the write behind the same capability, and changes nothing when it refuses", async () => {
    const before = await founderRow("pubSet");
    expect(before?.label).toBe("Ridge Hamlet North");

    expect((await call("PUT", "/api/housing/availability/pubSet", { body: { label: "Stolen" }, token: null })).status).toBe(401);
    expect((await call("PUT", "/api/housing/availability/pubSet", { body: { label: "Stolen" }, token: strangerToken })).status).toBe(403);

    const after = await founderRow("pubSet");
    expect(after?.label, "a refused write writes nothing").toBe("Ridge Hamlet North");
    expect(after?.total).toBe(6);

    // And the cartographer, who is not an admin, CAN write.
    expect(
      (await call("PUT", "/api/housing/availability/pubSet", {
        body: { label: "Ridge Hamlet North" },
        token: cartographerToken,
      })).status,
    ).toBe(200);
  });

  it("checks taken against total across the pair, not across the body", async () => {
    /*
     * `taken > total` is a rule about the ROW, and every control now sends
     * one field. Checking only what the body carries lets a founder send
     * taken 9 on its own to a hamlet with five homes; checking against a
     * before-state that is always null does the same thing more quietly.
     */
    expect((await call("PUT", "/api/housing/availability/pairKey", { body: { total: 5 } })).status).toBe(200);

    const lone = await call("PUT", "/api/housing/availability/pairKey", { body: { taken: 9 } });
    expect(lone.status, "a lone taken above the row's stored total").toBe(400);
    expect(lone.json?.error).toContain("more than the total");
    expect((await founderRow("pairKey"))?.storedTaken, "the refusal wrote nothing").toBeNull();

    expect((await call("PUT", "/api/housing/availability/pairKey", { body: { taken: 5 } })).status).toBe(200);

    const lowered = await call("PUT", "/api/housing/availability/pairKey", { body: { total: 4 } });
    expect(lowered.status, "a lone total below the row's stored taken").toBe(400);
    expect((await founderRow("pairKey"))?.total, "and that refusal wrote nothing either").toBe(5);

    // The pair moving together is allowed, which is the control: the two
    // refusals above are about the merged row and not about refusing counts.
    expect((await call("PUT", "/api/housing/availability/pairKey", { body: { total: 4, taken: 4 } })).status).toBe(200);
    const settled = await founderRow("pairKey");
    expect(settled?.total).toBe(4);
    expect(settled?.storedTaken).toBe(4);
  });

  it("still lets a founder edit a hamlet whose live count has passed its total", async () => {
    /*
     * The lockout this route has already been fixed for once. Six people can
     * reserve five homes, so on a hamlet counted by reservations the EFFECTIVE
     * taken legitimately sits above the total. Checking the pair against that
     * number instead of the stored one refuses every edit to the row,
     * including the rename and the flip back that are the only ways to fix it.
     */
    expect((await call("PUT", "/api/housing/availability/liveKey", { body: { total: 1, taken: 0 } })).status).toBe(200);

    const ids: string[] = [];
    for (const who of ["ada", "bo"]) {
      const made = await call("POST", "/api/housing/reservations", {
        body: {
          homeType: "casita",
          name: `${who} Live`,
          email: `${who}-live-${PORT}@example.test`,
          structureKey: "liveKey",
        },
        token: null,
        ip: `10.9.0.${who === "ada" ? 1 : 2}`,
      });
      expect(made.status).toBe(200);
      ids.push(String(made.json?.id));
    }
    for (const id of ids) {
      expect((await call("PUT", `/api/housing/reservations/${id}/status`, { body: { status: "reserved" } })).status).toBe(200);
    }

    expect((await call("PUT", "/api/housing/availability/liveKey", { body: { takenSource: "reservations" } })).status).toBe(200);

    const row = await founderRow("liveKey");
    expect(row?.taken, "the effective count is live").toBe(2);
    expect(row?.storedTaken, "the typed number survives the flip").toBe(0);
    expect(row?.reservedCount).toBe(2);
    expect(row?.total).toBe(1);

    // What a visitor sees: clamped, never negative and never unlimited.
    const pub = await call("GET", "/api/housing/public", { token: null });
    const seen = (pub.json?.entries ?? []).find((e: any) => e.structureKey === "liveKey");
    expect(seen).toMatchObject({ total: 1, taken: 2, open: 0, takenSource: "reservations" });

    // THE CASE. taken 2 is above total 1 and the rename must still land.
    const renamed = await call("PUT", "/api/housing/availability/liveKey", { body: { label: "Pond Homes" } });
    expect(renamed.status, "a rename on a row whose live count passed its total").toBe(200);
    expect((await founderRow("liveKey"))?.label).toBe("Pond Homes");

    // And so must a correction to the stored number, which is what a founder
    // reaches for next. 1 against total 1 is a legal pair.
    expect((await call("PUT", "/api/housing/availability/liveKey", { body: { taken: 1 } })).status).toBe(200);
    expect((await founderRow("liveKey"))?.storedTaken).toBe(1);
  });

  it("reads a patch the way the contract says: absent leaves, null clears", async () => {
    expect(
      (await call("PUT", "/api/housing/availability/patchKey", {
        body: { total: 8, taken: 3, label: "Meadow Hamlet" },
      })).status,
    ).toBe(200);

    // A rename that never mentions the counts. This is the edit that used to
    // be a whole-row clobber, and the absent label that used to be a wipe.
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { label: "Meadow" } })).status).toBe(200);
    let row = await founderRow("patchKey");
    expect(row).toMatchObject({ label: "Meadow", total: 8, storedTaken: 3, takenSource: "founder" });

    // A count edit that never mentions the label.
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { total: 9 } })).status).toBe(200);
    row = await founderRow("patchKey");
    expect(row?.label, "an absent label is not a cleared label").toBe("Meadow");
    expect(row?.total).toBe(9);

    // `{}` is legal, and is what Add hamlet sends. On a key that exists it
    // must cost a founder nothing.
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: {} })).status).toBe(200);
    row = await founderRow("patchKey");
    expect(row).toMatchObject({ label: "Meadow", total: 9, storedTaken: 3 });

    // null CLEARS, and unset is what makes a hamlet read as an example again.
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { taken: null } })).status).toBe(200);
    row = await founderRow("patchKey");
    expect(row?.storedTaken).toBeNull();
    expect(row?.open).toBeNull();
    const pub = await call("GET", "/api/housing/public", { token: null });
    expect(
      (pub.json?.entries ?? []).find((e: any) => e.structureKey === "patchKey"),
      "a cleared count puts the hamlet back to being an example",
    ).toBeUndefined();

    // Loud refusals, rather than a coercion that would clear a count.
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { total: "nine" } })).status).toBe(400);
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { total: 2.5 } })).status).toBe(400);
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { total: -1 } })).status).toBe(400);
    expect((await call("PUT", "/api/housing/availability/patchKey", { body: { takenSource: "whoever" } })).status).toBe(400);
    expect((await founderRow("patchKey"))?.total, "none of those wrote anything").toBe(9);

    // A key the map could never have minted.
    expect((await call("PUT", "/api/housing/availability/ridge%20A!", { body: {} })).status).toBe(400);
  });

  it("calls a hamlet an example until a founder types BOTH numbers, whatever counts them", async () => {
    /*
     * The example predicate is about the two COLUMNS: the contract says
     * `row missing OR homes_total IS NULL OR homes_taken IS NULL`, applied
     * once, and every surface then tests only whether its structure key is in
     * `entries`. A key that appears is a promise that a founder set it.
     *
     * The implementation filtered on the EFFECTIVE taken instead. The two
     * agree on every row except a flipped one: `effectiveTaken` returns the
     * live reserved count for a `reservations` row, and a count is a number
     * even when it is zero, so `homes_taken IS NULL` never survived to be
     * tested and a hamlet nobody had numbered published as configured with a
     * confident `taken: 0`.
     *
     * THREE ORDINARY ONE-FIELD SAVES, each of them one click in the Admin
     * panel, and each of them the patch contract working exactly as designed.
     * That is what makes this worth a case: no misuse reaches it.
     */
    expect((await call("PUT", "/api/housing/availability/exKey", { body: {} })).status).toBe(200);
    expect((await call("PUT", "/api/housing/availability/exKey", { body: { total: 5 } })).status).toBe(200);
    expect(
      (await call("PUT", "/api/housing/availability/exKey", { body: { takenSource: "reservations" } })).status,
    ).toBe(200);

    const published = async () => {
      const pub = await call("GET", "/api/housing/public", { token: null });
      expect(pub.status).toBe(200);
      return (pub.json?.entries ?? []).find((e: any) => e.structureKey === "exKey") ?? null;
    };

    // The founder view still holds the row, and says plainly that the typed
    // number is missing. This is the positive control for the absence below:
    // the row exists, so the public route is FILTERING it rather than there
    // being nothing to filter.
    const row = await founderRow("exKey");
    expect(row?.total).toBe(5);
    expect(row?.storedTaken, "no founder ever typed a taken here").toBeNull();
    expect(row?.takenSource).toBe("reservations");
    expect(row?.taken, "the effective count is a number, which is the trap").toBe(0);

    expect(await published(), "an untyped taken is unset, whatever the authority").toBeNull();

    // And with a real reservation on the books, so the live count is not
    // zero. It is the COLUMN that decides, never the derived number.
    const made = await call("POST", "/api/housing/reservations", {
      body: { homeType: "casita", name: "Elm Ask", email: `elm-${PORT}@example.test`, structureKey: "exKey" },
      token: null,
      ip: "10.5.0.1",
    });
    expect(made.status).toBe(200);
    expect(
      (await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "reserved" } })).status,
    ).toBe(200);
    expect(await published(), "a live count is not a founder typing a number").toBeNull();

    // The control that makes both absences mean something: type the number
    // and the hamlet publishes, counted the flipped way.
    expect((await call("PUT", "/api/housing/availability/exKey", { body: { taken: 0 } })).status).toBe(200);
    expect(await published(), "typed, so it is set").toMatchObject({ total: 5, taken: 1, open: 4 });

    // Both transports agree, because both call the one predicate.
    const cfg = await call("GET", "/api/map/config", { token: null });
    expect(cfg.status).toBe(200);
    expect(
      (cfg.json?.housing?.entries ?? []).find((e: any) => e.structureKey === "exKey"),
    ).toMatchObject({ total: 5, taken: 1, open: 4 });
  });

  it("answers a honeypot with success and stores nothing at all", async () => {
    const trapped = `bot-${PORT}@example.test`;
    const caught = await call("POST", "/api/housing/reservations", {
      body: {
        homeType: "tiny-home",
        name: "Bot",
        email: trapped,
        notes: "buy pills",
        hp: "https://example.invalid",
      },
      token: null,
      ip: "10.1.0.1",
    });
    // Success, so a script cannot learn it was caught.
    expect(caught.status).toBe(200);
    expect(caught.json?.ok).toBe(true);
    expect(caught.json?.id, "nothing was written, so there is no id to hand back").toBeUndefined();
    expect(await reservationsFor(trapped), "the row must not exist").toEqual([]);

    /*
     * The positive control. Without it, a route that refused every
     * reservation would satisfy the assertion above, and this whole case
     * would be green about a form nobody can use.
     */
    const real = `person-${PORT}@example.test`;
    const through = await call("POST", "/api/housing/reservations", {
      body: {
        homeType: "tiny-home",
        name: "Real Person",
        email: real,
        phone: "555 0100",
        notes: "we would like the ridge",
        structureKey: "pubSet",
        arrivedFrom: "map",
        hp: "",
      },
      token: null,
      ip: "10.1.0.2",
    });
    expect(through.status).toBe(200);
    expect(through.json?.id, "a real request gets an id").toBeTruthy();
    const stored = await reservationsFor(real);
    expect(stored).toHaveLength(1);
    // Everything the form collects reaches the table, including the two
    // fields that were stored and rendered nowhere for a while.
    expect(stored[0]).toMatchObject({
      home_type: "tiny-home",
      name: "Real Person",
      phone: "555 0100",
      notes: "we would like the ridge",
      structure_key: "pubSet",
      arrived_from: "map",
      status: "new",
    });

    // The refusals a real person can hit, which are not the honeypot.
    expect((await call("POST", "/api/housing/reservations", { body: { homeType: "mansion", name: "A", email: real }, token: null, ip: "10.1.0.3" })).status).toBe(400);
    expect((await call("POST", "/api/housing/reservations", { body: { homeType: "villa", name: "", email: real }, token: null, ip: "10.1.0.3" })).status).toBe(400);
    expect((await call("POST", "/api/housing/reservations", { body: { homeType: "villa", name: "A", email: "not-an-address" }, token: null, ip: "10.1.0.3" })).status).toBe(400);
  });

  it("caps how hard one address can hit the public form", async () => {
    /*
     * The house cap from POST /api/forms/submit: 6 per 10 minutes per IP.
     * This route is an UNAUTHENTICATED insert carrying a name, an email, a
     * phone number and two thousand characters of notes, so an uncapped one
     * is a write-anything endpoint. Its own address, so nothing else in this
     * file spends its budget and it spends nobody else's.
     */
    const ip = "10.2.0.7";
    const email = `flood-${PORT}@example.test`;
    const post = () =>
      call("POST", "/api/housing/reservations", {
        body: { homeType: "villa", name: "Flood", email },
        token: null,
        ip,
      });

    for (let i = 1; i <= 6; i++) {
      expect((await post()).status, `request ${i} of the allowance`).toBe(200);
    }
    const refused = await post();
    expect(refused.status, "the seventh from one address").toBe(429);
    expect(String(refused.json?.error)).toContain("Too many requests");
    expect(await reservationsFor(email), "exactly the allowance landed").toHaveLength(6);

    // Per address, not global: a different person is not locked out by a
    // flood from somewhere else. This is also the control that says the route
    // is still working at all.
    const other = `neighbour-${PORT}@example.test`;
    const ok = await call("POST", "/api/housing/reservations", {
      body: { homeType: "villa", name: "Neighbour", email: other },
      token: null,
      ip: "10.2.0.8",
    });
    expect(ok.status, "another address is unaffected").toBe(200);
    expect(await reservationsFor(other)).toHaveLength(1);
  });

  it("tells the person and tells the village, and puts it in the history", async () => {
    /*
     * The guards were copied from POST /api/forms/submit and the DELIVERY was
     * not, so this form wrote a row and told nobody while the success screen
     * promised the founding team would be in touch.
     *
     * With no key configured, `sendResendEmail` prints RESEND_SKIP once per
     * send and returns. Counting those lines is how many emails this route
     * actually tried to send, which is the observable the notify path leaves.
     *
     * Two phases, so each half of the delivery has its own number:
     *   no inbox configured  -> 1  (the person's acknowledgement, alone)
     *   resident inbox set   -> 2  (the pathway inbox, and the person)
     * Deleting either half changes one of those counts.
     */
    const before = resendAttempts();
    const soloEmail = `notify-solo-${PORT}@example.test`;
    const solo = await call("POST", "/api/housing/reservations", {
      body: { homeType: "family-home", name: "Nadia Solo", email: soloEmail, structureKey: "pubSet" },
      token: null,
      ip: "10.3.0.1",
    });
    expect(solo.status).toBe(200);
    const soloId = String(solo.json?.id);

    await waitUntil("the acknowledgement to the person", () => resendAttempts() >= before + 1);
    await settle(1200);
    expect(
      resendAttempts() - before,
      "with no pathway inbox configured, exactly one email: the person's own copy",
    ).toBe(1);

    /*
     * The village's own history. `recordEvent` is fire-and-forget by
     * contract, so this is polled rather than read once. Audience admin,
     * because the text carries a person's name and the public Pulse is read
     * by everyone.
     */
    await waitUntil("the reservation to reach the village history", async () => {
      const [rows] = await pool.query<any[]>(
        "SELECT text, audience, entity_type FROM health_events WHERE kind = ? AND entity_ref = ?",
        ["housing_reservation", soloId],
      );
      if (!rows.length) return false;
      expect(rows[0].audience, "a person's name never reaches the public Pulse").toBe("admin");
      expect(rows[0].entity_type).toBe("housing_reservation");
      expect(String(rows[0].text)).toContain("Nadia Solo");
      return true;
    });

    // Now give the village a resident inbox, and the pathway email appears.
    expect(
      (await call("PUT", "/api/admin/email-config", { body: { resident: `resident-${PORT}@example.test` } })).status,
    ).toBe(200);

    const withInbox = resendAttempts();
    const pairEmail = `notify-pair-${PORT}@example.test`;
    expect(
      (await call("POST", "/api/housing/reservations", {
        body: { homeType: "family-home", name: "Owen Pair", email: pairEmail, structureKey: "pubSet" },
        token: null,
        ip: "10.3.0.2",
      })).status,
    ).toBe(200);

    await waitUntil("both emails", () => resendAttempts() >= withInbox + 2);
    await settle(1200);
    expect(
      resendAttempts() - withInbox,
      "the resident pathway inbox AND the person, two sends",
    ).toBe(2);
  });

  it("keeps the intents themselves behind the appointment", async () => {
    expect((await call("GET", "/api/housing/reservations", { token: null })).status).toBe(401);
    const member = await call("GET", "/api/housing/reservations", { token: strangerToken });
    expect(member.status, "these rows carry a name, an email and a phone number").toBe(403);
    expect(member.json?.rows).toBeUndefined();

    const carto = await call("GET", "/api/housing/reservations", { token: cartographerToken });
    expect(carto.status).toBe(200);
    expect((carto.json?.rows ?? []).length).toBeGreaterThan(0);

    const one = (carto.json?.rows ?? [])[0];
    expect((await call("PUT", `/api/housing/reservations/${one.id}/status`, { body: { status: "contacted" }, token: strangerToken })).status).toBe(403);
    expect((await call("PUT", `/api/housing/reservations/${one.id}/status`, { body: { status: "maybe" } })).status).toBe(400);
    expect((await call("PUT", "/api/housing/reservations/hres-not-real/status", { body: { status: "contacted" } })).status).toBe(404);
    expect((await call("PUT", `/api/housing/reservations/${one.id}/status`, { body: { status: "contacted" } })).status).toBe(200);
  });

  it("writes to the person when their request moves, and only when it moves", async () => {
    /*
     * SWEEP (the incomplete loop). This route called setReservationStatus and
     * answered {ok:true}. The CREATE route two screens up had already promised
     * this person that "someone from the founding team will read it and get in
     * touch", and the moment that promise came due was the silent one.
     *
     * WHY EMAIL. The person who filled in the public form usually has no
     * account: `user_id` is nullable and the form takes a name, an address and
     * a phone number. The notify spine keys on a member id, so an in-app row
     * would be one nobody can ever open. The create route already answers this
     * family by email, so this follows it.
     *
     * WHAT STANDS IN FOR A DEDUPE KEY, since a raw send has none: only a real
     * transition writes. RESEND_SKIP counts the sends, and `notified` is the
     * same fact said back to the founder's panel.
     */
    const askEmail = `moves-${PORT}@example.test`;
    const made = await call("POST", "/api/housing/reservations", {
      body: { homeType: "casita", name: "Rowan Ask", email: askEmail, structureKey: "moveKey" },
      token: null,
      ip: "10.6.0.1",
    });
    expect(made.status).toBe(200);
    await settle(1200); // let the create route's own sends land and be counted

    // `contacted` is a founder recording a conversation they already had.
    // A letter saying "we have contacted you" arrives after the human one it
    // describes, so this move stays quiet.
    const quiet = resendAttempts();
    const contacted = await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "contacted" } });
    expect(contacted.status).toBe(200);
    expect(contacted.json.notified, "a founder's own filing is not news").toBe(false);
    await settle(600);
    expect(resendAttempts() - quiet, "nothing was sent").toBe(0);

    // Holding a home for somebody is the thing they have been waiting on.
    const beforeHold = resendAttempts();
    const reserved = await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "reserved" } });
    expect(reserved.status).toBe(200);
    expect(reserved.json.notified, "a home held for you reaches you").toBe(true);
    await waitUntil("the reserved letter to leave", () => resendAttempts() - beforeHold >= 1);
    await settle(400);
    expect(resendAttempts() - beforeHold, "one letter, to the person who asked").toBe(1);

    // Re-selecting the status a row already holds is a mis-click. It answers
    // 200 (the reservation plainly exists, which the old affectedRows check
    // reported as 404) and sends nothing.
    const beforeRepeat = resendAttempts();
    const repeat = await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "reserved" } });
    expect(repeat.status, "an unchanged status is not a missing reservation").toBe(200);
    expect(repeat.json.notified).toBe(false);
    await settle(600);
    expect(resendAttempts() - beforeRepeat, "one letter per move, however many times the dropdown fires").toBe(0);

    // Closing a request reaches them too: silence there reads as a home still
    // on the way.
    const beforeClose = resendAttempts();
    const withdrawn = await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "withdrawn" } });
    expect(withdrawn.json.notified).toBe(true);
    await waitUntil("the closing letter to leave", () => resendAttempts() - beforeClose >= 1);
    await settle(400);
    expect(resendAttempts() - beforeClose).toBe(1);

    // And a reservation that does not exist is still a 404.
    expect((await call("PUT", "/api/housing/reservations/hres-ghost/status", { body: { status: "reserved" } })).status).toBe(404);
  });

  it("counts a home against a hamlet only once someone is actually reserved", async () => {
    /*
     * Only `reserved` consumes a home, so an unanswered enquiry never
     * silently takes one off the map. The public numbers are the assertion,
     * because they are what a visitor reads.
     */
    expect(
      (await call("PUT", "/api/housing/availability/countKey", {
        body: { total: 3, taken: 0, takenSource: "reservations" },
      })).status,
    ).toBe(200);

    const openNow = async () => {
      const pub = await call("GET", "/api/housing/public", { token: null });
      return (pub.json?.entries ?? []).find((e: any) => e.structureKey === "countKey");
    };
    expect(await openNow()).toMatchObject({ total: 3, taken: 0, open: 3 });

    const made = await call("POST", "/api/housing/reservations", {
      body: { homeType: "casita", name: "Ivy Ask", email: `ivy-${PORT}@example.test`, structureKey: "countKey" },
      token: null,
      ip: "10.4.0.1",
    });
    expect(made.status).toBe(200);
    expect(await openNow(), "an enquiry is not a home taken").toMatchObject({ taken: 0, open: 3 });

    expect((await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "contacted" } })).status).toBe(200);
    expect(await openNow(), "nor is a conversation").toMatchObject({ taken: 0, open: 3 });

    expect((await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "reserved" } })).status).toBe(200);
    expect(await openNow(), "reserved is the one that counts").toMatchObject({ taken: 1, open: 2 });

    expect((await call("PUT", `/api/housing/reservations/${made.json.id}/status`, { body: { status: "withdrawn" } })).status).toBe(200);
    expect(await openNow(), "and it gives the home back").toMatchObject({ taken: 0, open: 3 });
  });

  /* ── THE HOMES A VILLAGE OFFERS (0131) ────────────────────────────────────
   *
   * The four tiers were a module constant in client/src/pages/Housing.tsx
   * with a second copy of their sizes in client/src/pages/ReserveHome.tsx, so
   * every village that deployed this platform published one American
   * village's dollars and square footage under its own name with no field
   * able to change them. These cases hold the two routes that replaced them,
   * over HTTP, where a founder and a stranger actually meet them.
   *
   * The cases below use the `homeKey` home types in a fixed order and run
   * after every hamlet case, so nothing here disturbs the counts above.
   */

  it("publishes no homes at all until a village describes one", async () => {
    // THE STATE THIS CHANGE EXISTS TO PRODUCE, over the wire. Every fork
    // starts here and the live village lands here the moment 0131 applies.
    const pub = await call("GET", "/api/housing/public", { token: null });
    expect(pub.status).toBe(200);
    expect(pub.json.homes, "a village that has described nothing publishes nothing").toEqual([]);

    // And the founder still gets all four rows to type into.
    const founderView = await call("GET", "/api/housing/home-types");
    expect(founderView.status).toBe(200);
    expect(founderView.json.rows.map((r: any) => r.homeType)).toEqual([
      "tiny-home",
      "casita",
      "family-home",
      "villa",
    ]);
    expect(founderView.json.rows.every((r: any) => r.isPublished === false)).toBe(true);
  });

  it("keeps both home-type routes behind the same appointment as the counts", async () => {
    // Every refusal with its positive control in the same case: a route that
    // 500s on everything refuses everything, and a suite of refusals alone
    // calls that a pass.
    expect((await call("GET", "/api/housing/home-types", { token: null })).status).toBe(401);
    expect(
      (await call("PUT", "/api/housing/home-types/casita", { body: { name: "X" }, token: null })).status,
    ).toBe(401);

    // Signed in and not appointed. map.publish is absent from STAGE_UNLOCKS,
    // so nobody reaches it by climbing.
    expect((await call("GET", "/api/housing/home-types", { token: strangerToken })).status).toBe(403);
    expect(
      (await call("PUT", "/api/housing/home-types/casita", { body: { name: "X" }, token: strangerToken })).status,
    ).toBe(403);

    // The cartographer holds map.publish through a badge and is not an admin.
    expect((await call("GET", "/api/housing/home-types", { token: cartographerToken })).status).toBe(200);
    expect(
      (await call("PUT", "/api/housing/home-types/tiny-home", {
        body: { name: "Cabina" },
        token: cartographerToken,
      })).status,
      "the same key that sets a hamlet's numbers describes a home",
    ).toBe(200);
  });

  it("does not publish a home that has only a name", async () => {
    // The cartographer named tiny-home above and gave it neither a size nor a
    // price. A card with a heading and nothing under it is the empty
    // scaffolding this change removes.
    const pub = await call("GET", "/api/housing/public", { token: null });
    expect(pub.json.homes.find((h: any) => h.homeType === "tiny-home")).toBeUndefined();
    const rows = (await call("GET", "/api/housing/home-types")).json.rows;
    expect(rows.find((r: any) => r.homeType === "tiny-home")).toMatchObject({
      name: "Cabina",
      isPublished: false,
    });
  });

  it("publishes a non-imperial size and a non-USD price exactly as typed", async () => {
    /*
     * THE POINT OF THE WHOLE CHANGE, end to end. The platform has no opinion
     * about a village's units or its currency: nothing converts, rounds,
     * reformats or appends a symbol anywhere between the founder's keyboard
     * and a stranger's screen.
     */
    const size = "0,5 hectáreas";
    const price = "₡45.000.000 a ₡60.000.000";
    expect(
      (await call("PUT", "/api/housing/home-types/casita", {
        body: { name: "Casita", size, price, features: "Covered patio\nKitchen, bathroom and a porch" },
      })).status,
    ).toBe(200);

    const pub = await call("GET", "/api/housing/public", { token: null });
    const home = pub.json.homes.find((h: any) => h.homeType === "casita");
    expect(home).toMatchObject({ name: "Casita", size, price });
    // A comma inside a feature stays inside it: the list splits on newlines
    // and on nothing else.
    expect(home.features).toEqual(["Covered patio", "Kitchen, bathroom and a porch"]);
  });

  it("carries no identity on the uncredentialed read, and does carry it on the gated one", async () => {
    const pub = await call("GET", "/api/housing/public", { token: null });
    const home = pub.json.homes.find((h: any) => h.homeType === "casita");
    expect(Object.keys(home).sort()).toEqual([
      "description",
      "features",
      "homeType",
      "name",
      "price",
      "size",
    ]);
    // The positive control: the identity really is there to omit.
    const rows = (await call("GET", "/api/housing/home-types")).json.rows;
    expect(rows.find((r: any) => r.homeType === "casita").updatedBy).toBe(founderId);
  });

  it("writes only the field it was sent and leaves the others alone", async () => {
    // A control that sends one field cannot revert the four it never
    // mentioned. Restating the row is what silently destroyed a founder's
    // hamlet name on the availability route before the absence rule landed.
    const before = (await call("GET", "/api/housing/home-types")).json.rows
      .find((r: any) => r.homeType === "casita");
    expect((await call("PUT", "/api/housing/home-types/casita", { body: { price: "ask us" } })).status).toBe(200);
    const after = (await call("GET", "/api/housing/home-types")).json.rows
      .find((r: any) => r.homeType === "casita");
    expect(after.price).toBe("ask us");
    expect(after.name, "the name survived a price edit").toBe(before.name);
    expect(after.size, "and so did the size").toBe(before.size);
    expect(after.features, "and so did the features").toBe(before.features);
  });

  it("unpublishes a home when the founder clears its name", async () => {
    // The empty state again, reached the way a founder actually reaches it.
    expect((await call("PUT", "/api/housing/home-types/casita", { body: { name: null } })).status).toBe(200);
    const pub = await call("GET", "/api/housing/public", { token: null });
    expect(pub.json.homes.find((h: any) => h.homeType === "casita")).toBeUndefined();

    // And putting the name back publishes it again, with the size and price
    // that were never cleared.
    expect((await call("PUT", "/api/housing/home-types/casita", { body: { name: "Casita" } })).status).toBe(200);
    const again = await call("GET", "/api/housing/public", { token: null });
    expect(again.json.homes.find((h: any) => h.homeType === "casita")).toMatchObject({
      name: "Casita",
      price: "ask us",
    });
  });

  it("refuses a home type it does not know, and a value that is not text", async () => {
    // A free-text home type is a typo that quietly becomes a category nobody
    // reports on, and it is also a home whose Reserve button the POST refuses.
    expect((await call("PUT", "/api/housing/home-types/mansion", { body: { name: "Mansion" } })).status).toBe(400);
    // A coercion here would store a number as though it were a founder's own
    // words about their own price.
    expect((await call("PUT", "/api/housing/home-types/villa", { body: { price: 150000 } })).status).toBe(400);
  });

  it("makes every home it publishes a home a stranger can actually ask for", async () => {
    // The two lists have to be one list, or a founder publishes a card whose
    // button meets a 400 on the last click.
    const pub = await call("GET", "/api/housing/public", { token: null });
    expect(pub.json.homes.length).toBeGreaterThan(0);
    for (const home of pub.json.homes) {
      const asked = await call("POST", "/api/housing/reservations", {
        body: {
          homeType: home.homeType,
          name: "Wren Ask",
          email: `wren-${home.homeType}-${PORT}@example.test`,
        },
        token: null,
        ip: "10.9.0.1",
      });
      expect(asked.status, `a published ${home.homeType} is a reservable ${home.homeType}`).toBe(200);
    }
  });
});
