/**
 * WHO MAY BREAK THE GLASS, DRIVEN AGAINST THE BUILT SERVER (Rye, 2026-09-21).
 *
 * The ruling, answering whether a founder keeps an override once a village
 * holds a power such as `dial.set`: "Only if the founder is holding the
 * Steward role and has the power to veto." Before it, every admin and every
 * founder could send `x-capability-override` past any power a village held.
 *
 * The harm this file measures is one sentence: an override is accepted from a
 * founder seated in a live role carrying `steward.veto`, and from nobody else,
 * and nobody else is ever OFFERED one. Each person below is one row of the
 * ruling, and each one is asked the same question on the same route:
 * `PUT /api/admin/variables/:key`, gated on `dial.set`, which the village
 * holds through the Steward Circle.
 *
 *   Ada    founder, seated as a steward, term running     the only yes
 *   Bruno  founder, never seated
 *   Cel    founder, seated as a steward, term ended       lapsed seat
 *   Dov    member, seated as a steward                    not a founder
 *   Eme    admin, seated as a steward                     not a founder
 *   Fin    admin, never seated                            not a founder
 *
 * "Offered" is measured at the protocol the browser reads: the 409 carries
 * `overrideAvailable`, and `readOverrideRefusal` from the client's own wrapper
 * is run over the body, so the server's answer and the client's decision to
 * ask are asserted in one place.
 *
 * ── WHY THE SERVER BOOTS TWICE ────────────────────────────────────────────
 *
 * A seat carrying `steward.veto` is filled by a `role_seat` ballot and by no
 * admin route (`stewardSeatRefusal`), and `roles` and `role_holders` are served
 * from a cache built at boot. So the seats are written underneath the cache
 * and the process comes back up to read them, which is the method
 * `server/stewardSeat.routes.e2e.test.ts` uses and argues for.
 *
 * Boots the BUILT `dist/index.js`, so run `pnpm build` first. The cases run IN
 * ORDER; run the whole file, never a `-t` slice. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, testPool, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { BREAK_GLASS_WAY_THROUGH } from "../shared/capabilities";
import { readOverrideRefusal } from "../client/src/lib/breakGlass";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[founderOverride.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here.
const PORT = 2100 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "founder-override-admin";
const PASSWORD = "FounderOverride123!";
/** The dial every row asks about. Open ring, owned by a module card. */
const OPEN_DIAL = "gratitude.base_budget";
/** A founder-ring dial: the ring check refuses it to an override as well. */
const FOUNDER_DIAL = "auth.session_days";
const GLASS = { "x-capability-override": "true" };
const DAY = 864e5;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

interface Person { id: string; token: string }
const people: Record<"ada" | "bruno" | "cel" | "dov" | "eme" | "fin" | "kira", Person> = {
  ada: { id: "", token: "" },
  bruno: { id: "", token: "" },
  cel: { id: "", token: "" },
  dov: { id: "", token: "" },
  eme: { id: "", token: "" },
  fin: { id: "", token: "" },
  kira: { id: "", token: "" },
};

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = people.ada.token,
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

async function boot(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: on its first tick every job with no
      // scheduled_jobs row is due, and this suite asserts on that schema.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "founder-override-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  await waitForHealth({ base: BASE, logs, child });
}

async function stop(): Promise<void> {
  child?.kill();
  child = undefined;
  await new Promise((r) => setTimeout(r, 500));
}

async function register(name: string, slug: string): Promise<Person> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register: ${r.text}`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/** Lines the VILLAGE reads about somebody reaching past a power, counted whole. */
async function reachCount(): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'public' AND is_example = 0 " +
      "AND text LIKE '%acted on a power this village holds%'",
  );
  return Number(row?.n ?? 0);
}

/** Attempts on the admin trail by one actor, whatever followed them. */
async function glassAttempts(userId: string): Promise<number> {
  const [[row]] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "SELECT COUNT(*) AS n FROM health_events WHERE audience = 'admin' AND actor_user_id = ? " +
      "AND LEFT(text, 29) = 'capability:override:dial.set:'",
    [userId],
  );
  return Number(row?.n ?? 0);
}

async function dialValue(key: string): Promise<string> {
  const r = await call("GET", "/api/admin/variables");
  const flat: any[] = Array.isArray(r.json) ? r.json : (r.json?.categories ?? []).flatMap((c: any) => c.variables ?? []);
  return String(flat.find((v) => v.key === key)?.value ?? "");
}

const setDial = (key: string, value: string, token: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  call("PUT", `/api/admin/variables/${key}`, { value, ...extra }, token, headers);

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the founder override route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-founder-override-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned
  await boot();

  const bootstrap = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `ada-${PORT}@example.test`, name: "Ada Founder",
  }, "");
  const claim = decodeURIComponent(String(bootstrap.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  people.ada = { token: String(setPw.json?.token ?? ""), id: String(setPw.json?.user?.id ?? "") };
  expect(people.ada.token, "the first founder must hold a session").toBeTruthy();

  people.bruno = await register("Bruno Founder", "bruno");
  people.cel = await register("Cel Founder", "cel");
  people.dov = await register("Dov Steward", "dov");
  people.eme = await register("Eme Admin", "eme");
  people.fin = await register("Fin Admin", "fin");
  people.kira = await register("Kira Keeper", "kira");
  for (const p of [people.bruno, people.cel, people.dov, people.eme, people.fin, people.kira]) {
    const r = await call("PUT", `/api/admin/players/${p.id}/stage`, { stageId: "member" });
    expect(r.status, r.text).toBe(200);
  }
  // Two administrators, through the route. The two extra FOUNDERS are written
  // underneath below, because a scratch village reads as started and after
  // launch the route refuses to make anybody a founder (R90), which is its
  // own rule and not this file's subject.
  for (const p of [people.eme, people.fin]) {
    const r = await call("PUT", `/api/admin/users/${p.id}/role`, { role: "admin" });
    expect(r.status, `${p.id} becomes an admin: ${r.text}`).toBe(200);
  }

  // Badges on, so the badge rows at the end reach the gate at all.
  const badgesOn = await call("PUT", "/api/admin/modules/badges/lifecycle", { lifecycle: "public", examples: false });
  expect(badgesOn.status, badgesOn.text).toBe(200);

  // The village takes `dial.set` onto the Steward Circle, where Kira sits.
  const roles = await call("GET", "/api/roles", undefined, "");
  const circle = (roles.json ?? []).find((r: any) => r.id === "steward-circle");
  const armed = await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
    capabilities: [...(circle?.capabilities ?? []), "dial.set"], grantedEscalations: ["dial.set"],
  });
  expect(armed.status, armed.text).toBe(200);
  const seated = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: people.kira.id, action: "add" });
  expect(seated.status, seated.text).toBe(200);
  const moved = await call("PUT", "/api/admin/capabilities/dial.set/holding", { roleId: "steward-circle" });
  expect(moved.status, moved.text).toBe(200);

  /*
   * THE STEWARD'S SEATS, as a carried role_seat ballot leaves them: a role
   * carrying the veto, and holdings with terms. Cel's term ended yesterday,
   * which is the only thing separating her from Ada.
   */
  await stop();
  await pool.query( // module-review-ok: fixture SQL standing in for founders made before launch, against the scratch schema
    "UPDATE users SET role = 'founder' WHERE id IN (?, ?)",
    [people.bruno.id, people.cel.id],
  );
  await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    ["steward", "Steward", "Can stop a carried decision inside its window.", JSON.stringify(["steward.veto"]), 0],
  );
  const ahead = new Date(Date.now() + 30 * DAY);
  const behind = new Date(Date.now() - DAY);
  for (const [p, ends] of [[people.ada, ahead], [people.cel, behind], [people.dov, ahead], [people.eme, ahead]] as const) {
    await pool.query( // module-review-ok: fixture SQL standing in for a carried role_seat ballot, against the scratch schema
      "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at) VALUES (?,?,?,?,?)",
      [`rh-steward-${p.id}`.slice(0, 64), "steward", p.id, "bal-role-seat", ends],
    );
  }
  await boot();
}, 300_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the premise, measured", () => {
  it("the village holds dial.set through the Steward Circle, and Kira acts with a member token", async () => {
    const holding = await call("GET", "/api/admin/capabilities/holding");
    const row = (holding.json?.powers ?? []).find((p: any) => p.capability === "dial.set");
    expect(row?.heldBy, JSON.stringify(row)).toBeTruthy();
    const kira = await setDial(OPEN_DIAL, "41", people.kira.token);
    expect(kira.status, kira.text).toBe(200);
  });

  it("three founders, two admins and a member, read back from the table", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT id, role FROM users WHERE id IN (?, ?, ?, ?, ?, ?)",
      [people.ada.id, people.bruno.id, people.cel.id, people.dov.id, people.eme.id, people.fin.id],
    );
    const role = new Map(rows.map((r) => [String(r.id), String(r.role)]));
    expect([people.ada, people.bruno, people.cel].map((p) => role.get(p.id))).toEqual(["founder", "founder", "founder"]);
    expect([people.eme, people.fin].map((p) => role.get(p.id))).toEqual(["admin", "admin"]);
    expect(role.get(people.dov.id)).not.toMatch(/admin|founder/);
  });

  it("the seats are really there, and Cel's is the one that has run out", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT user_id, term_ends_at < NOW() AS lapsed FROM role_holders WHERE role_id = 'steward' ORDER BY user_id",
    );
    const lapsed = new Map(rows.map((r) => [String(r.user_id), Number(r.lapsed) === 1]));
    expect(lapsed.get(people.ada.id)).toBe(false);
    expect(lapsed.get(people.cel.id)).toBe(true);
    expect(lapsed.get(people.dov.id)).toBe(false);
    expect(lapsed.get(people.eme.id)).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("a founder seated as a steward with the veto", () => {
  it("is refused without the glass, and the refusal offers the question", async () => {
    const r = await setDial(OPEN_DIAL, "42", people.ada.token);
    expect(r.status, r.text).toBe(409);
    expect(r.json?.requiresOverride).toBe(true);
    expect(r.json?.overrideAvailable).toBe(true);
    expect(String(r.json?.error)).toContain("x-capability-override");
    expect(readOverrideRefusal(r.status, r.json), "the browser asks the question").not.toBeNull();
    expect(await dialValue(OPEN_DIAL)).toBe("41");
  });

  it("is let through with the header, and the village reads a line naming her", async () => {
    const before = await reachCount();
    const r = await setDial(OPEN_DIAL, "43", people.ada.token, {}, GLASS);
    expect(r.status, r.text).toBe(200);
    expect(await dialValue(OPEN_DIAL)).toBe("43");
    expect(await reachCount(), "one act, one public line").toBe(before + 1);
    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT text FROM health_events WHERE audience = 'public' AND text LIKE '%acted on a power this village holds%' " +
        "ORDER BY at DESC, id DESC LIMIT 1",
    );
    expect(String(rows[0]?.text)).toContain("Ada");
  });

  it("is let through with override in the body as well", async () => {
    const r = await setDial(OPEN_DIAL, "44", people.ada.token, { override: true });
    expect(r.status, r.text).toBe(200);
    expect(await dialValue(OPEN_DIAL)).toBe("44");
  });

  it("is offered NO question on a founder-ring dial, because the ring refuses an override too", async () => {
    const before = await dialValue(FOUNDER_DIAL);
    const asked = await setDial(FOUNDER_DIAL, "19", people.ada.token);
    expect(asked.status, asked.text).toBe(409);
    expect(asked.json?.overrideAvailable).toBe(false);
    expect(readOverrideRefusal(asked.status, asked.json), "no door that refuses after it opens").toBeNull();
    expect(String(asked.json?.error)).toContain("An override does not reach it");
    // And the claim is true: the glass sent anyway meets the ring.
    const reach = await reachCount();
    const forced = await setDial(FOUNDER_DIAL, "19", people.ada.token, {}, GLASS);
    expect(forced.status, forced.text).toBe(403);
    expect(await dialValue(FOUNDER_DIAL)).toBe(before);
    expect(await reachCount(), "an act that did not happen writes no public line").toBe(reach);
  });
});

/*
 * EVERYBODY ELSE. Each row sends the dial twice more after the plain ask: once
 * with the header and once with `override: true` in the body, because the
 * server reads both and either one is a door.
 */
const REFUSED: Array<{ who: "bruno" | "cel" | "dov" | "eme" | "fin"; why: string; admin: boolean }> = [
  { who: "bruno", why: "a founder with no steward's seat", admin: true },
  { who: "cel", why: "a founder whose steward's seat has lapsed", admin: true },
  { who: "dov", why: "a steward holding the veto who is not a founder", admin: false },
  { who: "eme", why: "an admin seated as a steward who is not a founder", admin: true },
  { who: "fin", why: "an admin who is not a founder", admin: true },
];

for (const row of REFUSED) {
  describe.skipIf(!DB_CONFIGURED)(`${row.why} is refused, and offered no door`, () => {
    it("gets the plain refusal, which names the way through", async () => {
      const r = await setDial(OPEN_DIAL, "90", people[row.who].token);
      if (row.admin) {
        expect(r.status, r.text).toBe(409);
        expect(r.json?.requiresOverride).toBe(true);
        expect(r.json?.overrideAvailable).toBe(false);
        expect(String(r.json?.error)).toContain(BREAK_GLASS_WAY_THROUGH);
        expect(String(r.json?.error)).not.toContain("x-capability-override");
      } else {
        // A member meets the ordinary refusal; there was never a door for them.
        expect(r.status, r.text).toBe(401);
      }
      expect(readOverrideRefusal(r.status, r.json), "the browser asks nothing").toBeNull();
    });

    it("sends the glass anyway, both ways, and it is refused with nothing written", async () => {
      const before = await dialValue(OPEN_DIAL);
      const reach = await reachCount();
      const attempts = await glassAttempts(people[row.who].id);
      const viaHeader = await setDial(OPEN_DIAL, "91", people[row.who].token, {}, GLASS);
      const viaBody = await setDial(OPEN_DIAL, "92", people[row.who].token, { override: true });
      for (const r of [viaHeader, viaBody]) {
        expect(r.status, r.text).toBe(row.admin ? 409 : 401);
        if (row.admin) expect(r.json?.overrideAvailable).toBe(false);
      }
      expect(await dialValue(OPEN_DIAL), "the dial did not move").toBe(before);
      expect(await reachCount(), "the village reads nothing about it").toBe(reach);
      expect(await glassAttempts(people[row.who].id), "no attempt reached the trail").toBe(attempts);
    });
  });
}

describe.skipIf(!DB_CONFIGURED)("badges, as the gate's order says", () => {
  it("a badge granting the veto does not seat a founder", async () => {
    const made = await call("POST", "/api/admin/badges", {
      name: `Veto Badge ${PORT}`, kind: "granted", capabilities: ["steward.veto"],
    });
    expect(made.status, made.text).toBe(200);
    const award = await call("POST", `/api/admin/badges/${made.json.badge.id}/award`, { userId: people.bruno.id });
    expect(award.status, award.text).toBe(200);
    const r = await setDial(OPEN_DIAL, "93", people.bruno.token, {}, GLASS);
    expect(r.status, r.text).toBe(409);
    expect(r.json?.overrideAvailable).toBe(false);
    expect(await dialValue(OPEN_DIAL)).toBe("44");
  });

  it("a warning badge cannot deny the veto at all, so it cannot switch the seat off", async () => {
    const made = await call("POST", "/api/admin/badges", {
      name: `No Veto ${PORT}`, kind: "warning", denies: ["steward.veto"],
    });
    expect(made.status, made.text).toBe(400);
  });

  it("a warning badge denying the power itself does not stop the seated founder's glass", async () => {
    /*
     * The break-glass step sits ABOVE the deny step, which is the order the
     * gate writes and docs/CAPABILITIES.md prints. So a founder-steward under a
     * warning on `dial.set` still reaches past it in the open, and without the
     * glass she meets the deny like anybody else.
     */
    const made = await call("POST", "/api/admin/badges", {
      name: `No Dials ${PORT}`, kind: "warning", denies: ["dial.set"],
    });
    expect(made.status, made.text).toBe(200);
    const award = await call("POST", `/api/admin/badges/${made.json.badge.id}/award`, {
      userId: people.ada.id, note: "A pause on turning dials while the village talks it over.",
    });
    expect(award.status, award.text).toBe(200);

    const plain = await setDial(OPEN_DIAL, "45", people.ada.token);
    expect(plain.status, plain.text).toBe(409);
    expect(plain.json?.overrideAvailable).toBe(true);
    const through = await setDial(OPEN_DIAL, "45", people.ada.token, {}, GLASS);
    expect(through.status, through.text).toBe(200);
    expect(await dialValue(OPEN_DIAL)).toBe("45");
  });
});
