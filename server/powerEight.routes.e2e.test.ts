/**
 * THE SEVEN THAT CROSSED IN 0103, DRIVEN ONE AT A TIME.
 *
 * Eight real powers could not be handed to a village, and the reason was
 * mechanical: their routes asked `hasCapability(cap, await
 * capabilityCtx(user))` inline. That call never sees the request, so it
 * cannot carry the break-glass, so `TRANSFERABLE` had to mark each of them
 * `false`. A `true` on an unconverted gate is a lockout with no way back
 * through the product.
 *
 * Seven of the eight were converted to `mayAct` / `guardCapability` and
 * flipped in the same commit. `ballot.vote` was not, and
 * `shared/capabilities.ts` carries the argument at length: nothing REFUSES on
 * that key, so there is no door for an operator to be turned away from and a
 * `true` would have been a promise with nothing under it. A case at the
 * bottom of this file pins that refusal so the next lane inherits an argument
 * instead of a silence.
 *
 * ── WHAT EACH KEY IS DRIVEN THROUGH ──────────────────────────────────────
 *
 * The same five beats, in order, for every one of them:
 *
 *   1. Nobody holds it. The seeded role does not carry it.
 *   2. The role is armed and the power crosses. A HOLDER acts with a member
 *      token: no admin password, no admin session, no founder role.
 *   3. A member who holds nothing is refused with the route's own sentence
 *      and never a bare 401, because a person who meets a gate should be told
 *      what they met.
 *   4. An admin who is not the holder gets 409 and a sentence naming who
 *      holds it and what to send. Then the break-glass, and the line lands on
 *      the PUBLIC pulse the village itself reads, IF the act completed. The
 *      glass round moved that line off the gate and onto the response, so
 *      `completes` below says which of the two things each block proves.
 *   5. The power goes back, and the admin passes again with no ceremony.
 *
 * ── AND THE ONE THAT IS NOT A ROUND TRIP ─────────────────────────────────
 *
 * Beat 5 is where an easy sentence would have been wrong. Handing a power
 * back deletes the holding row and nothing else: the ROLE still carries the
 * capability, so the holder still acts afterwards. Saying "the holder is
 * refused again" would have been a claim the code does not make, so this file
 * drives both halves and says which is which. Disarming the role is a second,
 * separate admin act, and the case that does it is the one where the holder
 * finally meets a refusal.
 *
 * ── THE LOOK TEST, WHICH IS THE POINT OF HALF THE WORK ───────────────────
 *
 * `mayAct` reads the break-glass and writes a PUBLIC event saying an
 * administrator reached past a power. That is right for an act and it is a
 * false record for a read, and a lane already shipped that defect once on the
 * RSVP route. So the last describe block sends `override: true` on the
 * READING surfaces of all seven keys and asserts the pulse does not grow by a
 * single line.
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
  console.warn("[powerEight.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 23102 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "power-eight-admin";
const PASSWORD = "PowerEight123!";
const ROLE = "steward-circle";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";
let founderId = "";
// Kira is seated in the Steward Circle and ends up doing every one of these
// jobs with no admin password anywhere. Otto holds nothing and is the control.
let kiraToken = "";
let kiraId = "";
let ottoToken = "";
let ottoId = "";
// Wren opens the decision threads. Every actor here shares one forum rate
// limit of five threads in ten minutes, and the founder spends two of hers on
// the announcement cases, so a fourth account is what keeps a 429 out of a
// suite about permissions. Nell exists only to be seated and unseated.
let wrenToken = "";
let nellId = "";
let category = "";

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

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** Every line the VILLAGE can read. Audience public, examples out. */
async function publicPulse(): Promise<string[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT text FROM health_events WHERE audience = 'public' AND is_example = 0 ORDER BY at DESC, id DESC LIMIT 60",
  );
  return rows.map((r) => String(r.text));
}

/**
 * How many times an administrator has been recorded reaching past a power.
 *
 * Counted in SQL and never off `publicPulse`, which is capped: a capped read
 * would silently stop growing partway through this suite and every
 * before-and-after comparison after that point would pass for the wrong
 * reason.
 */
async function reachCount(): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'public' AND is_example = 0 " +
      "AND text LIKE '%acted on a power this village holds%'",
  );
  return Number(row?.n ?? 0);
}

/**
 * How many times the glass has been broken FOR this key, act or no act.
 *
 * The admin trail carries the attempt and the public pulse carries the act,
 * and the two stopped being the same row in the glass round. Reading both is
 * what tells a refused-after-the-gate case apart from a gate that never
 * opened: the attempt is there, and the village was told nothing.
 *
 * No polling anywhere in this file, and that is a property of the ordering
 * and not luck. The attempt is awaited before the route runs, and the public
 * line is awaited before the response leaves, so a read that follows the
 * answer can never be ahead of either.
 */
async function attemptCount(cap: string): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'admin' AND text LIKE ?",
    [`capability:override:${cap}:%`],
  );
  return Number(row?.n ?? 0);
}

async function roleCapabilities(roleId: string): Promise<string[]> {
  const r = await call("GET", "/api/roles", undefined, "");
  const role = (r.json ?? []).find((x: any) => x.id === roleId);
  try {
    const raw = role?.capabilities;
    return Array.isArray(raw) ? raw.map(String) : JSON.parse(String(raw ?? "[]")).map(String);
  } catch {
    return [];
  }
}

/** Put a capability on the Steward Circle, answering the escalation prompt. */
async function armRole(cap: string): Promise<void> {
  const next = Array.from(new Set([...(await roleCapabilities(ROLE)), cap]));
  const done = await call("PUT", `/api/admin/roles/${ROLE}/capabilities`, {
    capabilities: next,
    grantedEscalations: [cap],
  });
  expect(done.status, done.text).toBe(200);
  expect(await roleCapabilities(ROLE)).toContain(cap);
}

/** Take it off again. The only writer that can, and an admin act on purpose. */
async function disarmRole(cap: string): Promise<void> {
  const next = (await roleCapabilities(ROLE)).filter((c) => c !== cap);
  const done = await call("PUT", `/api/admin/roles/${ROLE}/capabilities`, {
    capabilities: next,
    grantedEscalations: next,
  });
  expect(done.status, done.text).toBe(200);
  expect(await roleCapabilities(ROLE)).not.toContain(cap);
}

const cross = (cap: string) => call("PUT", `/api/admin/capabilities/${cap}/holding`, { roleId: ROLE });
/**
 * THE GLASS IS PART OF THE HAND-BACK NOW (Rye, 2026-09-23).
 *
 * Handing a village-held power back to the panel is the village's own
 * decision: the route refuses an administrator and names the `power_return`
 * ballot, and carries on only for a founder seated as a steward with the veto
 * who says they mean to reach past the village. This suite's founder is
 * exactly that person — the seat is written in the fixture below for the
 * 2026-09-21 ruling — so the header is what the hand-back costs here, and it
 * is written into the helper rather than at fourteen call sites.
 *
 * WHAT THAT CHANGES FOR THIS FILE, and it is nothing: each of these is a
 * teardown between scenarios, the village reads the reach as it reads every
 * other one, and the assertions this suite actually makes are about the
 * routes on the other side of the gate.
 */
const handBack = (cap: string) =>
  call("DELETE", `/api/admin/capabilities/${cap}/holding`, undefined, founderToken, { "x-capability-override": "true" });

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
      AUTH_TOKEN_SECRET: "power-eight-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the power eight route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-power-eight-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await bootServer();

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Eight Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public", examples: false });
  }

  const kira = await register("Kira Vance", "kira");
  kiraToken = kira.token; kiraId = kira.id;
  const otto = await register("Otto Brand", "otto");
  ottoToken = otto.token; ottoId = otto.id;
  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token;
  const nell = await register("Nell Corrow", "nell");
  nellId = nell.id;
  for (const [id, stage] of [
    [kiraId, "member"],
    [ottoId, "member"],
    [wren.id, "co-creator"],
    [nell.id, "member"],
  ] as const) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { stageId: stage });
    expect(r.status, `${id} reaches ${stage}`).toBe(200);
  }

  const seated = await call("POST", `/api/admin/roles/${ROLE}/holders`, { userId: kiraId, action: "add" });
  expect(seated.status, seated.text).toBe(200);

  const cats = await call("GET", "/api/forum/categories");
  category = String((cats.json ?? [])[0]?.id ?? "");
  expect(category, "the forum must offer a category to post into").toBeTruthy();

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

/**
 * One power, driven through all five beats.
 *
 * `act` is called with a token and returns the response. Each key picks the
 * cheapest act its route can be given that still crosses the gate: some of
 * them do the real thing (a housing count, a lead photograph, a measurement),
 * and two of them address a row that is not there, so the route answers 404
 * AFTER the gate let them through. A 404 there is the gate saying yes, and it
 * is a stronger reading than a 200 would be for a route whose success has
 * side effects this suite would then have to unwind.
 *
 * ── `completes`, AND WHY THOSE TWO NOW ASSERT THE OPPOSITE ────────────────
 *
 * The public line used to be written by the gate, before the route ran, so
 * both 404 cases left the village reading "acted on a power this village
 * holds" about an act that never happened. That was the second defect of the
 * glass round and it is fixed by moving the line to the response: the village
 * hears about a reach when the reach did something.
 *
 * So a 404 case is no longer weaker evidence than a 200 case, it is evidence
 * of a different thing, and the flag says which. `completes: true` asserts the
 * pulse grows by exactly one. `completes: false` asserts the pulse does NOT
 * grow AND the admin trail carries the attempt, which together are the whole
 * of the honest ordering, per key, on a real route.
 */
function drivePower(opts: {
  /** A name for the block, because one key can gate more than one act. */
  title: string;
  cap: string;
  /** The act. `extra` is merged into the body; `headers` carries the header hatch. */
  act: (
    token: string,
    extra?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; json: any; text: string }>;
  /** What "the gate said yes" looks like on this route. */
  passes: number[];
  /** A phrase from the route's own refusal, so a member is told what they met. */
  refusal: string;
  /** The status a member who holds nothing gets. */
  refusedStatus: number;
  /** Which break-glass this route's shape allows. */
  hatch: "body" | "header";
  /** Does the act this block drives actually complete? See the header. */
  completes: boolean;
}) {
  const { title, cap, act, passes, refusal, refusedStatus, hatch, completes } = opts;
  const glass = (token: string) =>
    hatch === "body"
      ? act(token, { override: true })
      : act(token, undefined, { "x-capability-override": "true" });

  describe.skipIf(!DB_CONFIGURED)(title, () => {
    it("starts with nobody holding it", async () => {
      /*
       * The premise, measured. NOBODY HOLDS IT is the part that matters and
       * the part every beat below depends on.
       *
       * Whether the seeded role already CARRIES it is a different fact and
       * this suite deliberately does not assert either way, because the
       * answer differs per key and asserting one shape would be a claim about
       * the seed rather than about the gate. `roles-seed.json` puts
       * `quest.consent`, `feed.announce` and `health.record` on the Steward
       * Circle and `proposal.decide` and `org.declare` on the Founders
       * Circle, so five of the seven are reachable from a fresh boot with no
       * admin arming anything. `map.publish` and `map.curatePhotos` are
       * carried by no seeded role at all, which is the state the runway
       * exists for. `armRole` below is a no-op on the ones already carried.
       */
      const holding = await call("GET", "/api/admin/capabilities/holding");
      expect(holding.status).toBe(200);
      const row = (holding.json?.powers ?? []).find((p: any) => p.capability === cap);
      expect(row?.heldBy ?? null, `${cap} must start unheld`).toBeNull();
    });

    it("arms the role and hands the power to the village", async () => {
      await armRole(cap);
      const moved = await cross(cap);
      expect(moved.status, moved.text).toBe(200);
    });

    it("THE HOLDER ACTS, with a member token and no admin anywhere in the request", async () => {
      const done = await act(kiraToken);
      expect(passes, `${cap}: ${done.text}`).toContain(done.status);
    });

    it("refuses a member who holds nothing, with the route's own sentence", async () => {
      const no = await act(ottoToken);
      expect(no.status, no.text).toBe(refusedStatus);
      expect(String(no.json?.error ?? no.text)).toContain(refusal);
    });

    it("refuses the admin, and the refusal names the holder and says what to send", async () => {
      const blocked = await act(founderToken);
      expect(blocked.status, blocked.text).toBe(409);
      expect(blocked.json?.requiresOverride).toBe(true);
      expect(blocked.json?.capability).toBe(cap);
      expect(String(blocked.json?.error)).toContain("Steward Circle");
      expect(String(blocked.json?.error)).toContain("override");
      /*
       * THE FACTS A BROWSER NEEDS, beside the sentence a terminal needs.
       *
       * `error` tells an operator to send a header, which is the only thing a
       * person with curl can act on and the only thing a control cannot use.
       * These three are what the dialog says its own sentence out of, and
       * every one of them comes off the registry or the holdings row.
       */
      expect(blocked.json?.holder, `${cap} must name its holder as a bare name`).toBe("Steward Circle");
      expect(typeof blocked.json?.title, `${cap} must carry the power's name`).toBe("string");
      expect(String(blocked.json?.title).length).toBeGreaterThan(0);
      expect(typeof blocked.json?.consequence, `${cap} must carry what a holder can do`).toBe("string");
    });

    if (completes) {
      it("goes through with the break-glass, and the village reads it on its own pulse", async () => {
        const before = await reachCount();
        const attempts = await attemptCount(cap);
        const forced = await glass(founderToken);
        expect(passes, `${cap} with the glass broken: ${forced.text}`).toContain(forced.status);
        expect(await reachCount(), `${cap} must leave exactly one public line`).toBe(before + 1);
        expect(await attemptCount(cap), `${cap} must leave the attempt in the admin trail`).toBe(attempts + 1);
        const line = (await publicPulse()).find((t) => t.includes("acted on a power this village holds"));
        expect(line).toContain("Eight Founder");
        expect(line).toContain("Steward Circle");
      });
    } else {
      it("opens on the break-glass, and the village hears nothing because nothing happened", async () => {
        /*
         * The gate said yes and the route then answered 404, so the act never
         * happened. The village's own pulse stays exactly where it was, and
         * the admin trail carries the attempt, which is the pair that lets an
         * operator tell an abandoned reach from a lost record.
         */
        const before = await reachCount();
        const attempts = await attemptCount(cap);
        const forced = await glass(founderToken);
        expect(passes, `${cap} with the glass broken: ${forced.text}`).toContain(forced.status);
        expect(forced.status, `${cap}: this block exists for a route that refuses after the gate`)
          .toBeGreaterThanOrEqual(400);
        expect(await reachCount(), `${cap} wrote a public line about an act that did not happen`).toBe(before);
        expect(await attemptCount(cap), `${cap} must still record the attempt`).toBe(attempts + 1);
      });
    }

    it("hands it back, and the admin passes again with no ceremony at all", async () => {
      expect((await handBack(cap)).status).toBe(200);
      const plain = await act(founderToken);
      expect(passes, `${cap} after the return: ${plain.text}`).toContain(plain.status);
    });

    it("and the holder still acts, because a return moves the holding and disarms nobody", async () => {
      // The honest half. `returnCapabilityToScaffolding` deletes one row and
      // touches no role, so Kira passes on the role grant she was given in
      // beat 2. A ballot that could strip a capability is a second way to
      // undo a handover, which the design refuses on purpose.
      const still = await act(kiraToken);
      expect(passes, `${cap} for the holder after the return: ${still.text}`).toContain(still.status);
    });

    it("takes a second, separate admin act to refuse her again", async () => {
      await disarmRole(cap);
      const refused = await act(kiraToken);
      expect(refused.status, refused.text).toBe(refusedStatus);
      expect(String(refused.json?.error ?? refused.text)).toContain(refusal);
    });
  });
}

/*
 * ── THE SEVEN ─────────────────────────────────────────────────────────────
 *
 * Each `act` is written so the same call works for every actor, and so the
 * `override` variant is the same call with the hatch added. Two of them carry
 * the hatch in a header instead of a body, and the reason is stated at each.
 */

drivePower({
  title: "health.record crosses, and the land's own measurements are the act",
  cap: "health.record",
  act: (token, extra, headers) =>
    call("POST", "/api/admin/health/regen", { metricKey: "trees_planted", value: 3, ...extra }, token, headers),
  passes: [200],
  // This route always answered a bare 401 and still does. The 409 is added on
  // top of what it said, never in place of it.
  refusal: "auth_required",
  refusedStatus: 401,
  hatch: "body",
  completes: true,
});

drivePower({
  title: "map.publish crosses, and a hamlet's count is the act",
  cap: "map.publish",
  act: (token, extra, headers) =>
    call("PUT", "/api/housing/availability/hamlet-north", { total: 12, ...extra }, token, headers),
  passes: [200],
  refusal: "Setting housing numbers is an appointment",
  refusedStatus: 403,
  hatch: "body",
  completes: true,
});

drivePower({
  title: "map.curatePhotos crosses, and a place's lead shot is the act",
  cap: "map.curatePhotos",
  // Clearing a place's pinned lead shot: a real act that needs no photograph.
  act: (token, extra, headers) =>
    call("PUT", "/api/places/hearth/hero", { photoId: null, ...extra }, token, headers),
  passes: [200],
  refusal: "needs the capability to curate them",
  refusedStatus: 403,
  hatch: "body",
  completes: true,
});

drivePower({
  title: "quest.consent crosses, and the consent route is the act",
  cap: "quest.consent",
  /*
   * Addressed at a claim that does not exist. `consentActor` runs before the
   * route reads the body or looks the claim up, so a 404 here is the gate
   * saying yes and nothing has been minted to unwind. Releasing real value on
   * a real claim is driven by the loop test, which owns that path.
   */
  act: (token, extra, headers) =>
    call("POST", "/api/admin/quest-claims/no-such-claim/consent", { approve: true, ...extra }, token, headers),
  passes: [404],
  refusal: "Consenting to finished work is for stewards",
  refusedStatus: 403,
  hatch: "body",
  completes: false,
});

drivePower({
  title: "map.publish covers the reservations route too, on the header hatch",
  cap: "map.publish",
  // A second surface behind the same key, driven on the OTHER hatch so both
  // ways in are exercised.
  act: (token, extra, headers) =>
    call(
      "PUT", "/api/housing/reservations/no-such-reservation/status",
      { status: "reserved", ...extra }, token, headers,
    ),
  passes: [404],
  refusal: "Updating reservations is an appointment",
  refusedStatus: 403,
  hatch: "header",
  completes: false,
});

describe.skipIf(!DB_CONFIGURED)("org.declare crosses, and its hatch is the header", () => {
  /*
   * `villagePowerProblem` refuses any key it does not know by name, which is
   * right for a declaration: what a village says about itself should not
   * carry residue. It also meant the body hatch was unusable here until 0103
   * stripped the key after the gate had read it. Both routes take the header
   * as well, so this block drives the header and the declaration route below
   * proves the body works too.
   */
  const shape = { shape: "circle", decidesBy: "consent" };
  const declare = (token: string, headers: Record<string, string> = {}) =>
    call("PUT", "/api/org/village/power", shape, token, headers);

  it("starts unheld", async () => {
    expect(await roleCapabilities(ROLE)).not.toContain("org.declare");
  });

  it("arms the role, crosses, and the holder declares the village's shape", async () => {
    await armRole("org.declare");
    expect((await cross("org.declare")).status).toBe(200);
    const done = await declare(kiraToken);
    expect(done.status, done.text).toBe(200);
  });

  it("refuses a member who holds nothing", async () => {
    const no = await declare(ottoToken);
    expect(no.status).toBe(403);
    expect(String(no.json?.error)).toContain("belongs to org.declare holders and admins");
  });

  it("refuses the admin with the 409 and the sentence", async () => {
    const blocked = await declare(founderToken);
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.json?.requiresOverride).toBe(true);
    expect(String(blocked.json?.error)).toContain("Steward Circle");
  });

  it("the header opens it, and the pulse carries the line", async () => {
    const before = await reachCount();
    const forced = await declare(founderToken, { "x-capability-override": "true" });
    expect(forced.status, forced.text).toBe(200);
    expect(await reachCount()).toBe(before + 1);
  });

  it("the body opens it too, because the hatch comes off before the words are checked", async () => {
    const before = await reachCount();
    const viaBody = await call(
      "PUT", "/api/org/village/power", { ...shape, override: true }, founderToken,
    );
    expect(viaBody.status, viaBody.text).toBe(200);
    expect(await reachCount()).toBe(before + 1);
  });

  it("hands it back and disarms the role, and the holder is refused", async () => {
    expect((await handBack("org.declare")).status).toBe(200);
    expect((await declare(founderToken)).status).toBe(200);
    await disarmRole("org.declare");
    const refused = await declare(kiraToken);
    expect(refused.status).toBe(403);
  });
});

describe.skipIf(!DB_CONFIGURED)("feed.announce crosses, and an announcement is the act", () => {
  const announce = (token: string, extra: Record<string, unknown> = {}) =>
    call("POST", "/api/forum/threads", {
      category,
      kind: "announcement",
      title: `A notice ${Math.random().toString(36).slice(2, 8)}`,
      body: "The village hears this one.",
      ...extra,
    }, token);

  it("arms the role, crosses, and the holder announces with a member token", async () => {
    await armRole("feed.announce");
    expect((await cross("feed.announce")).status).toBe(200);
    const done = await announce(kiraToken);
    expect(done.status, done.text).toBe(200);
  });

  it("refuses a member who holds nothing, and says which capability", async () => {
    const no = await announce(ottoToken);
    expect(no.status).toBe(403);
    expect(String(no.json?.error)).toContain("feed.announce");
  });

  it("refuses the admin, then goes through on the glass and leaves the line", async () => {
    const blocked = await announce(founderToken);
    expect(blocked.status, blocked.text).toBe(409);
    expect(String(blocked.json?.error)).toContain("Steward Circle");

    const before = await reachCount();
    const forced = await announce(founderToken, { override: true });
    expect(forced.status, forced.text).toBe(200);
    expect(await reachCount()).toBe(before + 1);
  });

  it("a plain discussion is untouched, because forum.post is a personal act", async () => {
    // The key that moved gates announcements and nothing else. An admin who
    // cannot announce can still talk, and so can Otto.
    const talk = await call("POST", "/api/forum/threads", {
      category, kind: "discussion", title: "Just talking", body: "Nothing official here.",
    }, ottoToken);
    expect(talk.status, talk.text).toBe(200);
  });

  it("hands it back and disarms, and the holder is refused", async () => {
    expect((await handBack("feed.announce")).status).toBe(200);
    expect((await announce(founderToken)).status).toBe(200);
    await disarmRole("feed.announce");
    expect((await announce(kiraToken)).status).toBe(403);
  });
});

describe.skipIf(!DB_CONFIGURED)("proposal.decide crosses, and recording an outcome is the act", () => {
  let threadIds: string[] = [];

  async function openDecision(): Promise<string> {
    // Opening a decision takes `proposal.open`, which is a personal act and
    // permanently non-transferable. Wren opens them because she reached
    // co-creator, and because the forum's five-threads-in-ten-minutes rate
    // limit is shared with the announcement cases above.
    const r = await call("POST", "/api/forum/threads", {
      category, kind: "decision", title: `A question ${Math.random().toString(36).slice(2, 8)}`,
      body: "Something for the village to settle.",
    }, wrenToken);
    expect(r.status, r.text).toBe(200);
    return String(r.json?.id ?? r.json?.thread?.id ?? "");
  }

  const decide = (id: string, token: string, extra: Record<string, unknown> = {}) =>
    call("POST", `/api/forum/threads/${id}/decide`, { outcome: "The village said yes.", ...extra }, token);

  it("opens four decisions to settle, one per actor", async () => {
    threadIds = [await openDecision(), await openDecision(), await openDecision(), await openDecision()];
    for (const id of threadIds) expect(id).toBeTruthy();
  });

  it("arms the role, crosses, and the holder records an outcome with a member token", async () => {
    await armRole("proposal.decide");
    expect((await cross("proposal.decide")).status).toBe(200);
    const done = await decide(threadIds[0], kiraToken);
    expect(done.status, done.text).toBe(200);
  });

  it("refuses a member who holds nothing", async () => {
    const no = await decide(threadIds[1], ottoToken);
    expect(no.status).toBe(403);
    expect(String(no.json?.error)).toContain("proposal.decide");
  });

  it("refuses the admin, then goes through on the glass and leaves the line", async () => {
    const blocked = await decide(threadIds[1], founderToken);
    expect(blocked.status, blocked.text).toBe(409);
    expect(String(blocked.json?.error)).toContain("Steward Circle");

    const before = await reachCount();
    const forced = await decide(threadIds[1], founderToken, { override: true });
    expect(forced.status, forced.text).toBe(200);
    expect(await reachCount()).toBe(before + 1);
  });

  it("reaches the appointment route too, which used to pass an admin for being one", async () => {
    // `POST /api/admin/roles/:id/holders` opened with `isAdminActor ||
    // mayDecide`, so a village holding this key would have read that it seats
    // its own stewards while the panel carried on seating them.
    // Nell and never Otto: seating the control account in the Steward Circle
    // would hand it every capability this suite is about, and a later "a
    // member who holds nothing is refused" would be measuring nothing.
    const blocked = await call("POST", `/api/admin/roles/${ROLE}/holders`, { userId: nellId, action: "add" });
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.json?.capability).toBe("proposal.decide");

    const forced = await call("POST", `/api/admin/roles/${ROLE}/holders`, {
      userId: nellId, action: "add", override: true,
    });
    expect(forced.status, forced.text).toBe(200);
    const off = await call("POST", `/api/admin/roles/${ROLE}/holders`, {
      userId: nellId, action: "remove", override: true,
    });
    expect(off.status, off.text).toBe(200);
  });

  it("hands it back and disarms, and the holder is refused", async () => {
    expect((await handBack("proposal.decide")).status).toBe(200);
    expect((await decide(threadIds[2], founderToken)).status).toBe(200);
    await disarmRole("proposal.decide");
    expect((await decide(threadIds[3], kiraToken)).status).toBe(403);
  });
});

describe.skipIf(!DB_CONFIGURED)("a LOOK writes nothing, whatever the request carries", () => {
  /*
   * THE DEFECT THIS BLOCK GUARDS ALREADY SHIPPED ONCE. The RSVP route asked
   * the act path to decide whether to include drafts in a payload, so an
   * administrator merely LOOKING at an event, with `override` anywhere in the
   * body, would have written "acted on a power this village holds" to the
   * public pulse and notified the holders. A record of a thing that did not
   * happen is worse than no record, because the village cannot tell it from
   * the ones that did.
   *
   * So every reading surface of all seven converted keys is asked with the
   * break-glass set, both ways, while the village holds every one of them.
   * The pulse may not grow by a single line.
   */
  const READS: Array<[string, string]> = [
    ["GET", "/api/admin/quest-claims"],
    ["GET", "/api/housing/availability"],
    ["GET", "/api/housing/reservations"],
    ["GET", "/api/map/draft"],
    ["GET", "/api/places"],
    ["GET", "/api/places/reports"],
    ["GET", "/api/places/hearth/photos"],
    ["GET", "/api/governance/standing"],
    ["GET", "/api/map"],
    ["GET", "/api/admin/resources"],
    ["GET", "/api/village/powers"],
  ];

  it("holds all seven, so every read below is a read on a village-held key", async () => {
    for (const cap of [
      "quest.consent", "proposal.decide", "map.publish", "map.curatePhotos",
      "feed.announce", "health.record", "org.declare",
    ]) {
      await armRole(cap);
      const moved = await cross(cap);
      expect(moved.status, `${cap}: ${moved.text}`).toBe(200);
    }
  });

  it("an admin reading with the glass in the request writes nothing at all", async () => {
    /*
     * The header and not a body, because a GET cannot carry one: fetch
     * refuses to build the request at all. That is exactly why the header
     * hatch exists for the routes that carry no body, and it is exactly why
     * the header is the vector a reading surface has to be safe against.
     */
    const before = await reachCount();
    for (const [method, route] of READS) {
      const looked = await call(method, route, undefined, founderToken, {
        "x-capability-override": "true",
      });
      expect(looked.status, `${route} with an override header: ${looked.text}`).toBeLessThan(500);
    }
    expect(await reachCount(), "a look must never reach past anything").toBe(before);
  });

  it("and neither does the one reading surface that CAN carry a body", async () => {
    /*
     * `POST /api/village/powers/read` does not exist, and no converted
     * reading surface is a POST, so this drives the closest thing there is: a
     * reading route asked with a body-bearing method it does not mount. The
     * point is the pulse, and the pulse is measured either way.
     *
     * The defect this whole block guards was a POST whose body was a member's
     * own RSVP, and the fix for that class is structural: `mayLook` cannot
     * write, whatever arrives with the request.
     */
    const before = await reachCount();
    const odd = await call("POST", "/api/village/powers", { override: true }, founderToken);
    expect(odd.status).toBeGreaterThanOrEqual(400);
    expect(await reachCount()).toBe(before);
  });

  it("and the operator can still SEE every one of those, because a GET has no hatch", async () => {
    // A village taking a power on takes the act. Taking the operator's eyes
    // with it would be a lockout with nothing to open it, so the reads that
    // refuse keep the admin short-circuit and the reads that report do not.
    for (const route of [
      "/api/admin/quest-claims",
      "/api/housing/availability",
      "/api/housing/reservations",
      "/api/places/reports",
    ]) {
      const r = await call("GET", route, undefined, founderToken);
      expect(r.status, `${route}: ${r.text}`).toBe(200);
    }
  });

  it("hands all seven back, so the suite leaves the village where it found it", async () => {
    for (const cap of [
      "quest.consent", "proposal.decide", "map.publish", "map.curatePhotos",
      "feed.announce", "health.record", "org.declare",
    ]) {
      expect((await handBack(cap)).status, cap).toBe(200);
    }
  });
});

describe.skipIf(!DB_CONFIGURED)("ballot.vote did not cross, and the refusal says the true reason", () => {
  /*
   * The eighth key. `shared/capabilities.ts` carries the argument; this pins
   * the two things a next lane would otherwise have to rediscover.
   */
  it("refuses the handover, and never calls it a personal act", async () => {
    const r = await call("PUT", "/api/admin/capabilities/ballot.vote/holding", { roleId: ROLE });
    expect(r.status).toBe(409);
    const why = String(r.json?.error ?? "");
    // The old fallback sentence, which is false about this key.
    expect(why).not.toContain("names something a member does for themselves");
    // The true one.
    expect(why).toContain("Who votes here is a rule of the game");
    expect(why).toContain("who is on the roll");
  });

  it("still refuses it on the runway, by name, for the capture argument", async () => {
    const r = await call("PUT", "/api/admin/capabilities/member.vouch/holding", { roleId: ROLE });
    expect(r.status).toBe(409);
    // member.vouch gates nothing anywhere, so the ordinary sentence is right
    // for it and the specific one is not.
    expect(String(r.json?.error)).toContain("not a power that can move");
  });

  it("and a member can still see their own standing, which is what the key is read for", async () => {
    const mine = await call("GET", "/api/governance/standing", undefined, kiraToken);
    expect(mine.status, mine.text).toBe(200);
    expect(mine.json?.eligible).toBe(true);
  });

  /*
   * The three map editors, and the widening they are shaped to prevent.
   *
   * Styling the map, writing the newcomer's walk and naming its paths and
   * waters are moving off the admin page onto /map, so each needs the payload
   * to say whether this reader may use it. Every endpoint behind them is
   * gated by isAdmin and nothing else, and shared/capabilities.ts has no key
   * about style, brand, look or identity, so the flags read `admin`: the
   * panels change WHERE they live, never WHO may use them.
   *
   * THIS SUITE IS THE RIGHT PLACE because of the state it has already built.
   * By now the village HOLDS seven real capabilities and kira is an ordinary
   * member under them. So asserting she gets false is not the trivial case of
   * a member with no powers at all; it is the case that reaching for the
   * nearest existing key would have broken.
   */
  it("hands the three map editors to an admin", async () => {
    const r = await call("GET", "/api/map");
    expect(r.status, r.text).toBe(200);
    expect(r.json?.viewer?.mayStyleMap).toBe(true);
    expect(r.json?.viewer?.mayEditWalk).toBe(true);
    expect(r.json?.viewer?.mayNameMapThings).toBe(true);
  });

  it("withholds all three from a member, even one standing under seven held powers", async () => {
    const r = await call("GET", "/api/map", undefined, kiraToken);
    expect(r.status, r.text).toBe(200);
    expect(r.json?.viewer?.mayStyleMap ?? false).toBe(false);
    expect(r.json?.viewer?.mayEditWalk ?? false).toBe(false);
    expect(r.json?.viewer?.mayNameMapThings ?? false).toBe(false);
    // The reader still gets the map itself; only the editing chrome is withheld.
    expect(r.json?.viewer).toBeTruthy();
  });
});
