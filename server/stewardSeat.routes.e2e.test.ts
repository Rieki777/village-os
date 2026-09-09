/**
 * THE STEWARD'S SEAT IS THE VILLAGE'S, AND THE ADMIN PANEL CANNOT REACH IT.
 *
 * The adversarial audit of 2026-09-03 opened with this, and it is the first
 * risk on its list. Once the steward is a veto rather than an approval, that
 * veto is the ONLY human brake on a Game change the village carried. It lives
 * on the roles plane, and the roles plane has an admin path: one route seats
 * people, another decides what a role can do, and any admin may make another
 * admin. So one account could seat itself as steward, unseat the elected one,
 * and stop whatever it liked, with a record that reads as ordinary
 * administration.
 *
 * The harm metric for this file is one sentence, driven over HTTP against the
 * built server, by a real administrator holding the real admin password:
 *
 *   An administrator cannot seat anybody into a steward-capable role, cannot
 *   seat THEMSELVES into one, cannot take the elected steward out of one, and
 *   cannot add or remove `steward.veto` on any role. The seat is filled and
 *   emptied by the role_seat and role_unseat ballots, and by nothing else.
 *
 * The second half is the other direction: the steward the village DID seat can
 * stop a decision it carried, has to say why, and the words can be taken back
 * later while the act stays.
 *
 * ── WHY THIS SUITE BOOTS THE SERVER TWICE ─────────────────────────────────
 *
 * `roles` and `role_holders` are served from an in-process cache built at
 * boot. There is no route that seats a steward, which is the whole point of
 * the file, so the seat has to be written underneath the cache and the process
 * has to come back up to see it. That is exactly what the Birthing closer does
 * in production, minus the reload it is told to call. Two boots is the honest
 * way to arrange the state this file asserts about; a raw INSERT with no
 * restart would leave the running server serving the old answer and every
 * assertion would be about a village that does not exist.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER; run the whole file, never a
 * `-t` slice.
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
  console.warn("[stewardSeat.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");

/**
 * This suite's window, in the band above every other suite.
 * `check-e2e-ports.mjs` is the survey.
 *
 * MOVED FROM 30402 ON MERGE. That window was claimed independently by
 * `profilePaths.routes.e2e.test.ts`, which landed on main while this branch
 * was building, and two suites on one window is two servers racing for a
 * bind. Neither side could have seen the other: the port guard compares the
 * working tree against its own base, which is the same blindness that let two
 * lanes hold one migration number. This branch moves because the other one is
 * already landed.
 */
const PORT = 30802 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "steward-seat-admin";
const PASSWORD = "StewardSeatTest123!";
const STEWARD_ROLE = "steward";
const OTHER_ROLE = "gardeners";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let adminToken = "";
let adminId = "";
/** Sol is the steward the village seated. */
let solToken = "";
let solId = "";
/** Tam holds nothing. The control. */
let tamId = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? adminToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

async function boot(): Promise<void> {
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: on its first tick every job with no
      // scheduled_jobs row is due, and this suite is asserting on the schema
      // those jobs would write into.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb!.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "steward-seat-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function stop(): Promise<void> {
  child?.kill();
  child = undefined;
  await new Promise((r) => setTimeout(r, 500));
}

/** What a role carries, read from the table and never from a payload. */
async function roleCapabilities(roleId: string): Promise<string[]> {
  const [rows] = await pool.query<any[]>("SELECT capabilities FROM roles WHERE id = ?", [roleId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  if (!rows[0]) return [];
  const raw = rows[0].capabilities;
  try {
    return Array.isArray(raw) ? raw.map(String) : JSON.parse(String(raw ?? "[]")).map(String);
  } catch {
    return [];
  }
}

/** Who sits in a role, read raw. */
async function seatedIn(roleId: string): Promise<string[]> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT user_id FROM role_holders WHERE role_id = ? ORDER BY user_id",
    [roleId],
  );
  return rows.map((r) => String(r.user_id));
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the steward seat route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-steward-seat-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

  await boot();

  const bootstrap = await call("POST", "/api/admin/bootstrap", {
    token: "",
    body: { password: ADMIN, email: `admin-${PORT}@example.test`, name: "Seat Administrator" },
  });
  const claim = decodeURIComponent(String(bootstrap.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  adminToken = String(setPw.json?.token ?? "");
  adminId = String(setPw.json?.user?.id ?? "");
  expect(adminToken, "the administrator must hold a session").toBeTruthy();

  const sol = await register("Sol Amery", "sol");
  solToken = sol.token; solId = sol.id;
  const tam = await register("Tam Orr", "tam");
  tamId = tam.id;
  for (const id of [solId, tamId]) {
    const r = await call("PUT", `/api/admin/players/${id}/stage`, { body: { stageId: "member" } });
    expect(r.status, `${id} reaches member`).toBe(200);
  }

  /*
   * THE VILLAGE'S OWN SEATING, written the way the Birthing closer writes it
   * and then picked up by a fresh process, because there is no admin route
   * that can do this and that is the property this file exists to prove.
   */
  await stop();
  await pool.query( // module-review-ok: fixture SQL standing in for the Birthing closer, against the scratch schema
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    [STEWARD_ROLE, "Steward", "Can stop a carried decision inside its window.", JSON.stringify(["steward.veto"]), 0],
  );
  await pool.query( // module-review-ok: fixture SQL against the scratch schema
    "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?)",
    [OTHER_ROLE, "Gardeners", "Keeps the beds.", JSON.stringify(["forum.post"]), 1],
  );
  await pool.query( // module-review-ok: fixture SQL against the scratch schema
    "INSERT INTO role_holders (id, role_id, user_id, granted_by) VALUES (?,?,?,?)",
    ["rh-steward-sol", STEWARD_ROLE, solId, "bal-birthing"],
  );
  /*
   * AND THE HOLDING, which the Birthing closer moves in the same breath.
   * Without this row `isVillageHeld` answers false, every administrator walks
   * the gate as an ordinary admin, and the veto is not the village's last word
   * at all. Leaving it out of the fixture would have made this suite assert
   * about a village the seating never produces.
   */
  await pool.query( // module-review-ok: fixture SQL standing in for the Birthing closer, against the scratch schema
    "INSERT INTO capability_holding (capability, holder_role_id, moved_by_ballot_id) VALUES (?,?,?)",
    ["steward.veto", STEWARD_ROLE, "bal-birthing"],
  );
  await boot();

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", {
    body: { lifecycle: "members", examples: false },
  });
  expect(on.status, "governance must be on for this suite").toBe(200);
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("an administrator meets the seat and cannot move it", () => {
  it("cannot seat THEMSELVES into the steward's role", async () => {
    // The one move that needs no conspiracy. Before this guard it was a POST.
    const r = await call("POST", `/api/admin/roles/${STEWARD_ROLE}/holders`, {
      body: { userId: adminId, action: "add" },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("role_seat");
    expect(await seatedIn(STEWARD_ROLE), "and nobody was seated").toEqual([solId]);
  });

  it("cannot seat anybody ELSE into it either, which is the same door one step over", async () => {
    const r = await call("POST", `/api/admin/roles/${STEWARD_ROLE}/holders`, {
      body: { userId: tamId, action: "add" },
    });
    expect(r.status).toBe(409);
    expect(await seatedIn(STEWARD_ROLE)).toEqual([solId]);
  });

  it("cannot take the elected steward OUT of it", async () => {
    // Removal is how a captured account would clear the room, and it was an
    // ordinary admin act until the audit read it beside the veto.
    const r = await call("POST", `/api/admin/roles/${STEWARD_ROLE}/holders`, {
      body: { userId: solId, action: "remove" },
    });
    expect(r.status).toBe(409);
    expect(r.json?.code).toBe("steward_seat_is_the_villages");
    expect(await seatedIn(STEWARD_ROLE), "Sol still holds the seat").toEqual([solId]);
  });

  it("cannot ADD the veto to a role it can otherwise edit", async () => {
    const r = await call("PUT", `/api/admin/roles/${OTHER_ROLE}/capabilities`, {
      body: { capabilities: ["forum.post", "steward.veto"], grantedEscalations: ["steward.veto"] },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("role_unseat");
    expect(await roleCapabilities(OTHER_ROLE)).toEqual(["forum.post"]);
  });

  it("cannot STRIP the veto off the steward's role by writing a list without it", async () => {
    const r = await call("PUT", `/api/admin/roles/${STEWARD_ROLE}/capabilities`, {
      body: { capabilities: [], grantedEscalations: [] },
    });
    expect(r.status).toBe(409);
    expect(await roleCapabilities(STEWARD_ROLE)).toEqual(["steward.veto"]);
  });

  it("still edits every role that does not carry the veto, so the guard is narrow", async () => {
    const r = await call("PUT", `/api/admin/roles/${OTHER_ROLE}/capabilities`, {
      body: { capabilities: ["forum.post", "feed.announce"], grantedEscalations: ["feed.announce"] },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await roleCapabilities(OTHER_ROLE)).sort()).toEqual(["feed.announce", "forum.post"]);
  });

  it("still seats people into every role that does not carry the veto", async () => {
    const r = await call("POST", `/api/admin/roles/${OTHER_ROLE}/holders`, {
      body: { userId: tamId, action: "add" },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await seatedIn(OTHER_ROLE)).toEqual([tamId]);
  });
});

describe.skipIf(!DB_CONFIGURED)("the steward the village seated can stop a decision, and say why", () => {
  const BALLOT = "bal-e2e-carried";

  beforeAll(async () => {
    if (!DB_CONFIGURED) return;
    /*
     * A CARRIED GAME CHANGE, STAMPED, which is the only state a veto has
     * anything to say about. The fixture writes `lands_at` two days out and
     * `landing_status` pending because that is what the close path writes on a
     * decision that changes the Game: it does not execute at the close, it is
     * given an instant, and the window before that instant is the door this
     * whole describe block is about. A row with a NULL `lands_at` is a decision
     * that took effect the moment it carried, and the route is right to refuse
     * a veto on one.
     */
    await pool.query( // module-review-ok: fixture SQL against the scratch schema, standing in for a carried ballot
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, " +
        "unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status, " +
        "lands_at, veto_closes_at, landing_status) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),?," +
        "DATE_ADD(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending')",
      [BALLOT, "mechanics", "ref", `mechanics:${BALLOT}`, "Turn the mint up", "body", "custom", "equal",
        80, 20, 3, 3, tamId, "passed"],
    );
  });

  it("reads the seat, and says nothing is waiting on it", async () => {
    const r = await call("GET", "/api/governance/stewardship", { token: solToken });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.seated).toBe(true);
    expect(r.json?.council).toBe(false);
    expect(String(r.json?.sentence)).toContain("can stop a decision inside its window");
    // The dispatcher registers its window check at boot, so the instant is
    // readable and a surface may render the countdown. On a build without it
    // this answers false, which is its own answer and never a yes.
    expect(r.json?.windowKnown).toBe(true);
    expect(String(r.json?.notice)).toContain("public and permanent");
  });

  it("refuses an ADMINISTRATOR, who has to break the glass in the open", async () => {
    /*
     * The other half of risk 1. Refusing the admin ROUTES is not enough if the
     * admin can simply call the veto route: they would stop a decision the
     * village carried with a record that reads as ordinary administration.
     * `capability_holding` is what turns that into a break-glass with a public
     * line on it, and the Birthing seating is what writes the row.
     */
    const r = await call("POST", `/api/governance/ballots/${BALLOT}/veto`, {
      token: adminToken,
      body: { reason: "I would rather not." },
    });
    expect(r.status).toBe(409);
    expect(r.json?.needsOverride).toBe(true);
    expect(r.json?.holder, "and it names who does hold it").toBeTruthy();
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM ballot_vetoes"); // module-review-ok: fixture SQL against the scratch schema
    expect(Number(rows[0].n), "and nothing was written").toBe(0);
  });

  it("refuses a veto with no reason, and writes nothing", async () => {
    const r = await call("POST", `/api/governance/ballots/${BALLOT}/veto`, {
      token: solToken,
      body: { reason: "   " },
    });
    expect(r.status).toBe(400);
    expect(String(r.json?.error)).toContain("carries a reason");
    expect(String(r.json?.notice)).toContain("public and permanent");
  });

  it("records the veto, names the steward, and says it stands", async () => {
    const r = await call("POST", `/api/governance/ballots/${BALLOT}/veto`, {
      token: solToken,
      body: { reason: "This turns the mint on before the ledger is settled." },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.stands).toBe(true);
    expect(r.json?.standing?.needed).toBe(1);
    expect(r.json?.acts?.[0]?.decidedBy).toBe("Sol");
    expect(String(r.json?.acts?.[0]?.reason)).toContain("ledger is settled");
  });

  it("refuses a veto on a decision that never carried", async () => {
    await pool.query("UPDATE ballots SET status = 'open' WHERE id = ?", [BALLOT]); // module-review-ok: fixture SQL against the scratch schema
    const r = await call("POST", `/api/governance/ballots/${BALLOT}/veto`, {
      token: solToken,
      body: { reason: "Too early." },
    });
    expect(r.status).toBe(409);
    expect(String(r.json?.error)).toContain("votes no on it while it is open");
    await pool.query("UPDATE ballots SET status = 'passed' WHERE id = ?", [BALLOT]); // module-review-ok: fixture SQL against the scratch schema
  });

  it("REFUSES a veto on a change set that edits a limit on the seat, and names the key", async () => {
    /*
     * The bundle hole, over HTTP. The route used to ask about the SUBJECT type
     * alone, so a change set carrying the window length beside an ordinary dial
     * answered "vetoable" and the seat could stop the village shortening its
     * own window by travelling with anything else. The elements are read now.
     *
     * The window and the timing are untouched: this decision waits out its
     * window like any other Game change, and the only door it loses is this
     * one.
     */
    const LOCKED = "bal-e2e-locked";
    await pool.query( // module-review-ok: fixture SQL against the scratch schema, standing in for a carried proposal
      "INSERT INTO mechanics_proposals (id, title, rationale, change_set, proposer_user_id, status) VALUES (?,?,?,?,?,?)",
      [
        "prop-e2e-locked",
        "Shorten the window",
        "why",
        JSON.stringify([{ kind: "dial", key: "gratitude.pool" }, { kind: "dial", key: "governance.veto_hours" }]),
        tamId,
        "passed_onsite",
      ],
    );
    await pool.query( // module-review-ok: fixture SQL against the scratch schema, standing in for a carried ballot
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, weight_mode, " +
        "unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, closes_at, status, " +
        "lands_at, veto_closes_at, landing_status) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),?," +
        "DATE_ADD(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending')",
      [LOCKED, "mechanics", "prop-e2e-locked", `mechanics:${LOCKED}`, "Shorten the window", "body", "custom", "equal",
        80, 20, 3, 3, tamId, "passed"],
    );

    const r = await call("POST", `/api/governance/ballots/${LOCKED}/veto`, {
      token: solToken,
      body: { reason: "I would rather keep my three days." },
    });
    expect(r.status, JSON.stringify(r.json)).toBe(409);
    expect(String(r.json?.error)).toContain("governance.veto_hours");
    expect(String(r.json?.error)).toContain("waits out its window");
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM ballot_vetoes WHERE ballot_id = ?", [LOCKED]); // module-review-ok: fixture SQL against the scratch schema
    expect(Number(rows[0].n), "and nothing was written").toBe(0);
  });

  it("blanks the words on a redaction and leaves the veto standing", async () => {
    const [rows] = await pool.query<any[]>("SELECT id FROM ballot_vetoes WHERE ballot_id = ?", [BALLOT]); // module-review-ok: fixture SQL against the scratch schema
    const r = await call("POST", `/api/governance/vetoes/${String(rows[0].id)}/redact`, { token: solToken });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.act?.reason).toBe("");
    expect(r.json?.act?.redacted).toBe(true);
    expect(r.json?.act?.decidedByUserId, "the author stays on the record").toBe(solId);
  });
});
