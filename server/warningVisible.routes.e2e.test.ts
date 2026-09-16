/**
 * A RECORD SHE CANNOT READ IS NOT A RECORD.
 *
 * A warning badge is placed on a member by a steward, and the route makes the
 * steward write a note because "the member deserves to know why". This suite
 * asks the next question: can she actually go and read it.
 *
 * Every case carries a CONTROL in the same run. A granted badge is placed on
 * the same member in the same setup, so a green here can never mean "the whole
 * surface is empty". If the granted badge is missing too, the control fails
 * first and says so.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE. Whether a warning may take a
 * capability away at all is a founder ruling and belongs to another lane, so
 * the fixture warning carries NO denies. That is the shape a warning is
 * heading toward anyway: Rye, 2026-08-29, "denying a voice is not a power
 * anyone should hold", and "when voice is earned it should never be force
 * taken away". A warning is a note about a concern somebody raised, and a note
 * about a person that the person cannot see is the thing this file is about.
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
  console.warn("[warningVisible.routes] TEST_DATABASE_URL not set, DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 29602 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "warning-visible-admin";
const PASSWORD = "WarningTest123!";

/** The note the steward has to write. It is the whole point of the record. */
const WARNING_NOTE = "Raised after the workshop about how the tool shed was left.";
const HONOUR_NOTE = "For carrying the water line through the dry month.";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let pool: mysql.Pool;
let dataDir = "";
let founderToken = "";
let founderId = "";
let memberToken = "";
let memberId = "";

async function call(method: string, route: string, body?: unknown, token = founderToken) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/** What the member's own badge page is handed when she opens it. */
async function herBadgePage() {
  const res = await call("GET", "/api/badges", undefined, memberToken);
  expect(res.status, res.text).toBe(200);
  return res.json;
}

/** Her own award on one badge, as her own page would find it. */
function herAward(page: any, badgeId: string) {
  return (page?.mine?.awards ?? []).find((a: any) => a.badgeId === badgeId) ?? null;
}

/** The badge's own entry in the list her page renders. */
function catalogEntry(page: any, badgeId: string) {
  return (page?.badges ?? []).find((b: any) => b.id === badgeId) ?? null;
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the warning visibility test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-warning-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema

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
      AUTH_TOKEN_SECRET: "warning-visible-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Ada Warden",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: PASSWORD }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();
  const [fRows] = await pool.query<any[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [`founder-${PORT}@example.test`]);
  founderId = String(fRows[0]?.id ?? "");

  const reg = await call("POST", "/api/auth/register", {
    name: "Wren Ash", email: `wren-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
  }, "");
  expect(reg.status, reg.text).toBe(200);
  memberToken = String(reg.json?.token ?? "");
  memberId = String(reg.json?.user?.id ?? "");
  expect(memberToken && memberId, "the member must hold a session").toBeTruthy();

  const mods = await call("GET", "/api/admin/modules");
  const badges = (mods.json?.modules ?? []).find((m: any) => m.id === "badges");
  expect(badges, "the badges module must exist in the registry").toBeTruthy();
  const on = await call("PUT", "/api/admin/modules/badges/lifecycle", { lifecycle: "public" });
  expect(on.status, on.text).toBe(200);

  // The warning, with no denies: this is about the note, not about a power.
  const warn = await call("POST", "/api/admin/badges", {
    name: "Shed care", description: "A concern raised about how shared tools are left.",
    kind: "warning", capabilities: [], denies: [],
  });
  expect(warn.status, warn.text).toBe(200);
  // And the control, on the same member in the same run.
  const honour = await call("POST", "/api/admin/badges", {
    name: "Water keeper", description: "Kept the line running through the dry month.",
    kind: "granted", capabilities: [],
  });
  expect(honour.status, honour.text).toBe(200);

  const placed = await call("POST", "/api/admin/badges/shed-care/award", { userId: memberId, note: WARNING_NOTE });
  expect(placed.status, placed.text).toBe(200);
  const given = await call("POST", "/api/admin/badges/water-keeper/award", { userId: memberId, note: HONOUR_NOTE });
  expect(given.status, given.text).toBe(200);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a member can read a warning that is about her", () => {
  it("the control renders, or nothing below means anything", async () => {
    const page = await herBadgePage();
    expect(catalogEntry(page, "water-keeper"), "the granted badge must be on her page").toBeTruthy();
    const mine = herAward(page, "water-keeper");
    expect(mine, "the granted badge must be marked as hers").toBeTruthy();
    expect(mine.note).toBe(HONOUR_NOTE);
  });

  it("the warning is on her own badge page at all", async () => {
    const page = await herBadgePage();
    expect(catalogEntry(page, "shed-care"), "the warning must be on her page").toBeTruthy();
    expect(herAward(page, "shed-care"), "the warning must be marked as hers").toBeTruthy();
  });

  it("carries the note the steward had to write", async () => {
    const page = await herBadgePage();
    expect(herAward(page, "shed-care")?.note).toBe(WARNING_NOTE);
  });

  it("says who placed it, by name, and when", async () => {
    const page = await herBadgePage();
    const mine = herAward(page, "shed-care");
    // An id is not an answer to "who". She needs the person.
    expect(mine?.awardedByName, "the warning must name who placed it").toBe("Ada");
    expect(mine?.awardedAt, "the warning must say when it was placed").toBeTruthy();
    expect(Number.isNaN(Date.parse(String(mine?.awardedAt)))).toBe(false);
  });

  it("says the same about the honour, so the two records read alike", async () => {
    const page = await herBadgePage();
    const mine = herAward(page, "water-keeper");
    expect(mine?.awardedByName).toBe("Ada");
    expect(mine?.awardedAt).toBeTruthy();
  });

  it("keeps her warning off every public surface", async () => {
    // The privacy line is unchanged: a warning is between the member and the
    // stewards. Her own page shows it. Nobody else's read does.
    const ofHer = await call("GET", `/api/badges/of/${memberId}`, undefined, "");
    expect(ofHer.status, ofHer.text).toBe(200);
    expect(ofHer.text).not.toContain("shed-care");
    expect(ofHer.text, "the control must still travel").toContain("water-keeper");

    const match = await call("GET", "/api/badges/match?badge=shed-care", undefined, "");
    expect(match.status, match.text).toBe(200);
    expect(JSON.stringify(match.json)).not.toContain(memberId);

    // And another signed-in member is told nothing about who holds it.
    const other = await call("POST", "/api/auth/register", {
      name: "Tomas Reed", email: `tomas-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
    }, "");
    const theirs = await call("GET", "/api/badges", undefined, String(other.json?.token ?? ""));
    expect(theirs.status, theirs.text).toBe(200);
    /*
     * PROVE THE NEGATIVE AGAINST A PRESENT CONTROL, IN THE SAME BLOCK. My own
     * first draft read `catalogEntry(...)?.holders ?? []` and `herAward(...)
     * ?? null`, both of which pass just as happily when the whole payload is
     * missing. An empty answer and a correct answer looked identical.
     */
    const theirWarning = catalogEntry(theirs.json, "shed-care");
    expect(theirWarning, "the warning definition is public, so his page has the card").toBeTruthy();
    expect(theirWarning.holders, "and it names nobody").toEqual([]);
    expect(Array.isArray(theirs.json?.mine?.awards), "he holds an awards list").toBe(true);
    expect(catalogEntry(theirs.json, "water-keeper"), "the control card is on his page too").toBeTruthy();
    expect(herAward(theirs.json, "shed-care"), "somebody else's page must not carry her award").toBeNull();
    expect(herAward(theirs.json, "water-keeper"), "nor her honour").toBeNull();
  });

  it("never names the steward to anybody but the member the warning is about", async () => {
    const other = await call("GET", "/api/badges", undefined, "");
    expect(other.status, other.text).toBe(200);
    expect(other.json?.mine, "a signed-out reader holds no awards").toBeNull();
    expect(JSON.stringify(other.json)).not.toContain(founderId);
  });
});
