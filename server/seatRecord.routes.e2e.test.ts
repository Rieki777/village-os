/**
 * THE RECORD AND THE SEAT, DRIVEN AGAINST THE BUILT SERVER.
 *
 * Four things this suite exists for, and every one of them was a fact the
 * database already held that no surface and no test ever asked for.
 *
 *  1. THE TERM THE SEATING ROUTE NEVER WROTE. `seatHolder` has taken
 *     `termEndsAt` and inserted the column since 0049, and
 *     `POST /api/admin/org/roles/:id/holders`, which is the only route in the
 *     tree that seats anybody, never passed it. So `term_ends_at` was NULL on
 *     every seating on every deployment and FOUR readers were dark. This file
 *     drives each of the four rather than asserting that they exist: the term
 *     on the map payload, the seat's own lapse, the calendar's `seat-term`
 *     entries, and the row `term-watch` reads. A test that only checked the
 *     column would have passed against a fix that lit nothing up.
 *
 *  2. THE SEAT'S HISTORY IS FOR MEMBERS. `GET /api/org/roles/:id/history` sits
 *     behind `map.viewPeople`, which unlocks at `guest`, so an ordinary
 *     account with no admin password reads who has held a seat. That is the
 *     harm metric, so it is driven with a member token and never the founder's.
 *
 *  3. WHAT A DECISION CHANGED, ON A COLD LOAD. The outcome card read `applied`
 *     off the close response, so it knew what a decision changed only inside
 *     the browser session that closed it. The read below happens in a session
 *     that did not close the ballot, with a token that is not the closer's,
 *     which is the case that was broken.
 *
 *  4. THE RECORD DOES NOT END AT A HUNDRED ROWS. The list route served a bare
 *     `LIMIT 100` with no way to ask for row 101, so a village four years in
 *     lost its founding decisions off the end of its own record, silently.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL. The cases run IN ORDER.
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
  console.warn("[seatRecord.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 26002 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "seat-record-admin";
const PASSWORD = "SeatRecord123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
/** An ordinary account. No admin password, no stage bump, no role. */
let memberToken = "";
let memberId = "";
let secondMemberId = "";

interface Answer { status: number; json: any }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
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

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isoIn = (days: number): string => new Date(Date.now() + days * 86400000).toISOString();

/** The column itself, read from the table the route writes. */
async function termOnRow(assignmentId: string): Promise<Date | null> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT term_ends_at FROM org_role_assignments WHERE id = ?",
    [assignmentId],
  );
  return rows[0]?.term_ends_at ?? null;
}

async function newestSeating(roleId: string): Promise<string> {
  const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "SELECT id FROM org_role_assignments WHERE org_role_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
    [roleId],
  );
  return String(rows[0]?.id ?? "");
}

async function register(name: string, email: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    body: { name, email, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the seat record test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-seat-record-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

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
      AUTH_TOKEN_SECRET: "seat-record-secret",
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
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
    try {
      const res = await fetch(`${BASE}/health`); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch { /* not up yet */ }
    await settle(400);
  }

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Seat Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", {
    body: { token: claim, password: PASSWORD },
    token: null,
  });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const member = await register("Wren Ash", `wren-${PORT}@example.test`);
  memberToken = member.token;
  memberId = member.id;
  secondMemberId = (await register("Tomas Reed", `tomas-${PORT}@example.test`)).id;
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("the term a seating never carried", () => {
  const PAST_SEAT = "record-water-keeper";
  const SOON_SEAT = "record-hearth-keeper";
  let pastSeating = "";
  let soonSeating = "";

  it("still seats somebody with no term, which is every seating that exists today", async () => {
    expect((await call("POST", "/api/admin/org/roles", { body: { id: PAST_SEAT, name: "Water keeper", seats: 2 } })).status).toBe(200);
    const seated = await call("POST", `/api/admin/org/roles/${PAST_SEAT}/holders`, {
      body: { displayName: "Ada Brook", focus: "the spring line" },
    });
    expect(seated.status, JSON.stringify(seated.json)).toBe(200);
    // The route's old behaviour, unbroken: leaving it out leaves it null.
    expect(await termOnRow(await newestSeating(PAST_SEAT))).toBeNull();
  });

  it("refuses a date it cannot read, rather than writing a quiet null", async () => {
    const bad = await call("POST", `/api/admin/org/roles/${PAST_SEAT}/holders`, {
      body: { displayName: "Nobody", termEndsAt: "next Thursday-ish" },
    });
    expect(bad.status).toBe(400);
    expect(String(bad.json?.error)).toContain("could not be read");
    // And nothing was seated by the refusal.
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) AS n FROM org_role_assignments WHERE display_name = 'Nobody'",
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("NOW WRITES THE TERM, which is the one line four dead features were waiting on", async () => {
    // BOTH seats first, then the assertions. A seat created after an
    // assertion that can throw is a seat the later cases cannot find, and the
    // cascade then reports a missing seat where the real answer is a missing
    // term. A falsification that names the wrong thing is worth very little.
    const seated = await call("POST", `/api/admin/org/roles/${PAST_SEAT}/holders`, {
      body: { userId: memberId, focus: "the well", termEndsAt: isoIn(-2) },
    });
    expect(seated.status, JSON.stringify(seated.json)).toBe(200);
    pastSeating = await newestSeating(PAST_SEAT);

    expect((await call("POST", "/api/admin/org/roles", { body: { id: SOON_SEAT, name: "Hearth keeper", seats: 1 } })).status).toBe(200);
    expect((await call("POST", `/api/admin/org/roles/${SOON_SEAT}/holders`, {
      body: { userId: secondMemberId, focus: "the fire", termEndsAt: isoIn(9) },
    })).status).toBe(200);
    soonSeating = await newestSeating(SOON_SEAT);

    const stored = await termOnRow(pastSeating);
    expect(stored, "term_ends_at is on the row").not.toBeNull();
    expect(new Date(stored as Date).getTime()).toBeLessThan(Date.now());
    expect(await termOnRow(soonSeating), "and on the one still running").not.toBeNull();
  });

  it("FEATURE 1, the amber arc: /api/map carries the date TermArc is drawn from", async () => {
    // The power map is a module and every optional module ships off, which is
    // the fork-safe default. The arc lives here rather than on /api/org.
    expect((await call("PUT", "/api/admin/modules/map/lifecycle", {
      body: { lifecycle: "members", examples: false },
    })).status).toBe(200);

    const map = await call("GET", "/api/map", { token: memberToken });
    expect(map.status, JSON.stringify(map.json)).toBe(200);
    const soon = (map.json?.roles ?? []).find((r: any) => r.id === SOON_SEAT);
    expect(soon, "the hearth seat is on the map").toBeTruthy();
    // The seat's earliest live term, which is what TermArc sweeps against.
    // It was null on every seat of every village before this.
    expect(soon.termEnds, "the seat carries its term").toBeTruthy();
    const holder = (soon.holders ?? [])[0];
    expect(holder?.termEndsAt, "the holder carries their own term").toBeTruthy();
  });

  it("FEATURE 2, the seat's own lapse: the term branch reaches the map, and the seat stops reading as filled", async () => {
    /*
     * REWRITTEN TO THE 2026-09-02 RULE, and the rewrite is a SPLIT rather than
     * a reversal. This case used to end on "nothing was revoked", stated as a
     * fact about the product. The founder ruled otherwise on 2026-08-31: "If
     * they're not voted back in then they expire when they expire!"
     *
     * The rule now depends on the plane. An org-chart seat carries
     * accountabilities and no permissions, so there is nothing here to switch
     * off and the holding stays in the record, which is what the last
     * assertion below still pins. What changed is that the SEAT has to stop
     * reading as comfortably filled, because a seat nobody reviews is the harm
     * the lapse exists to surface. Real revocation lives on the permission
     * plane (`role_holders.term_ends_at`, migration 0171) and is driven by
     * server/stewardship.db.test.ts and server/lib/seatLapse.test.ts.
     */
    const org = await call("GET", "/api/org", { token: memberToken });
    const past = (org.json?.roles ?? []).find((r: any) => r.id === PAST_SEAT);
    const wren = (past?.holders ?? []).find((h: any) => h.userId === memberId);
    expect(wren, "the member holds the water seat").toBeTruthy();
    // The term branch of isLapsed, which no seating could ever reach before.
    expect(wren.lapsed, "a term that reached its date reads as lapsed").toBe(true);
    expect(wren.lapsedReason, "and it lapsed on its TERM, not on a season turn").toBe("term");
    // The seat says out loud that it is short a holder. This seat wants two
    // and has one current holder beside the lapsed one, so it reads `partial`:
    // a lapsed holding does not count toward filling a seat, which is the
    // whole point of deriving the state instead of counting rows.
    expect(past.state, "a lapsed holder does not fill a seat").toBe("partial");
    expect(past.state, "and it is certainly not filled").not.toBe("filled");
    // The RECORD keeps the holding. History is not deleted by a date passing.
    expect((past?.holders ?? []).some((h: any) => h.userId === memberId)).toBe(true);
  });

  it("FEATURE 3, the calendar: the seat-term source finally has a row to find", async () => {
    /*
     * The mirror runs on an hourly job, so what is checked here is the exact
     * predicate the `seat-term` source selects on, run against the schema the
     * route just wrote into. What the provider DOES with such a row is
     * already pinned by `server/lib/calendarProviders.test.ts`, which builds
     * one by hand: that suite has been green since it shipped over rows no
     * route could produce. This is the half that was missing.
     */
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT a.id, r.name AS role_name FROM org_role_assignments a " +
        "LEFT JOIN org_roles r ON r.id = a.org_role_id " +
        "WHERE a.ended_at IS NULL AND a.term_ends_at IS NOT NULL",
    );
    const names = rows.map((r) => String(r.role_name));
    expect(names, "a live seating with a term is what the seat-term source looks for").toContain("Hearth keeper");
    expect(names).toContain("Water keeper");
  });

  it("FEATURE 4, term-watch's input: the expiring list reports the term, and says the reason is the term", async () => {
    // The job itself runs on a 24h timer and notifies once per assignment per
    // event, so what is driven here is the row it reads. `expiringSeatings`
    // is term-watch's only input, and its term branch could not fire at all
    // while every seating carried a null.
    const expiring = await call("GET", "/api/admin/org/expiring?days=30");
    expect(expiring.status).toBe(200);
    const rows = expiring.json ?? [];
    const past = rows.find((r: any) => r.assignmentId === pastSeating);
    expect(past, "the passed term is on the list").toBeTruthy();
    expect(past.reason, "and it is there because of its TERM, not a season turn").toBe("term");
    expect(past.termEndsAt).toBeTruthy();
    const soon = rows.find((r: any) => r.assignmentId === soonSeating);
    expect(soon, "and so is the one still running").toBeTruthy();
    expect(soon.daysLeft, "with the number term-watch words its notice with").toBeGreaterThanOrEqual(0);
  });
});

describe.skipIf(!DB_CONFIGURED)("the seat's own succession, read by a member", () => {
  const SEAT = "record-gate-keeper";
  let firstSeating = "";

  it("keeps every holding, ended ones included, and hands them to an ordinary account", async () => {
    expect((await call("POST", "/api/admin/org/roles", { body: { id: SEAT, name: "Gate keeper", seats: 1 } })).status).toBe(200);
    expect((await call("POST", `/api/admin/org/roles/${SEAT}/holders`, {
      body: { displayName: "Ada Brook", focus: "the north gate" },
    })).status).toBe(200);
    firstSeating = await newestSeating(SEAT);

    expect((await call("DELETE", `/api/admin/org/seatings/${firstSeating}`, {
      body: { reason: "stepped down at the season turn" },
    })).status).toBe(200);
    expect((await call("POST", `/api/admin/org/roles/${SEAT}/holders`, {
      body: { userId: memberId, focus: "the north gate" },
    })).status).toBe(200);

    // THE HARM METRIC. A member, with no admin password, reading who has held
    // this seat and when it passed between them.
    const history = await call("GET", `/api/org/roles/${SEAT}/history`, { token: memberToken });
    expect(history.status, JSON.stringify(history.json)).toBe(200);
    const rows = history.json ?? [];
    expect(rows.length, "both holdings are on the record").toBe(2);

    const ended = rows.find((r: any) => r.id === firstSeating);
    expect(ended.name).toBe("Ada Brook");
    expect(ended.focus, "the focus is a fact about the seat and survives").toBe("the north gate");
    expect(ended.endedAt, "an ended holding is ended, never deleted").toBeTruthy();
    expect(ended.endedReason).toContain("stepped down");

    const live = rows.find((r: any) => r.id !== firstSeating);
    expect(live.name).toBe("Wren");
    expect(live.endedAt).toBeNull();
    // An ended_at followed by a started_at is the handover the card renders.
    expect(new Date(live.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(ended.endedAt).getTime());
  });

  it("refuses a stranger, because an empty answer would read as an empty seat", async () => {
    const anon = await call("GET", `/api/org/roles/${SEAT}/history`, { token: null });
    expect(anon.status).toBe(401);
    expect(anon.json?.error).toBe("auth_required");
  });
});

describe.skipIf(!DB_CONFIGURED)("what a decision changed, read cold by somebody who did not close it", () => {
  let proposalId = "";
  let firstBallot = "";
  let secondBallot = "";

  it("turns the governance module on and puts a real dial to a real vote", async () => {
    expect((await call("PUT", "/api/admin/modules/governance/lifecycle", {
      body: { lifecycle: "members", examples: false },
    })).status).toBe(200);
    // A quorum one voter can meet, so the vote carries and the dial applies.
    expect((await call("PUT", "/api/admin/variables/governance.quorum_pct", { body: { value: "1" } })).status).toBe(200);
    expect((await call("PUT", "/api/admin/variables/governance.unity_pct", { body: { value: "50" } })).status).toBe(200);

    const made = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Give a ballot a fortnight instead of a week",
        rationale: "People are on the land most of the week and a seven day window asks them to answer between jobs.",
        changes: [{ key: "governance.vote_days", to: "14" }],
      },
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    proposalId = String(made.json?.id ?? "");

    const opened = await call("POST", `/api/governance/mechanics/${proposalId}/open-ballot`);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    firstBallot = String(opened.json?.ballot?.id ?? "");
    expect(firstBallot).toBeTruthy();

    // A first vote on a subject has no history, and the page shows no strip.
    const fresh = await call("GET", `/api/governance/ballots/${firstBallot}`, { token: memberToken });
    expect(fresh.json?.priorAttempts).toEqual([]);
    expect(fresh.json?.appliedKeys).toEqual([]);
  });

  it("CARRIES, and the ledger keeps what it changed after the session that closed it is gone", async () => {
    expect((await call("POST", `/api/governance/ballots/${firstBallot}/vote`, { body: { choice: "yes" } })).status).toBe(200);
    /*
     * THE CLOCK CLOSES A BALLOT, AND THE WINDOW LANDS IT. Two rules arrived
     * on 2026-09-03 and this case meets both. A ballot passes when its window
     * ends and never before, so the fixture runs the voting window out rather
     * than closing early. A change to the Game is then stamped with a landing
     * instant instead of being written at the close, so the fixture runs that
     * window out too and calls the landing path, which is what the
     * five-minute job does on its own in a running village.
     */
    await pool.query("UPDATE ballots SET closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [firstBallot]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const closed = await call("POST", `/api/governance/ballots/${firstBallot}/close`, {
      body: { outcomeNote: "The village gave itself a fortnight to answer." },
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    expect(closed.json?.outcome).toBe("passed");
    // The close stamps and writes nothing. What it says is when it lands.
    expect(closed.json?.applied).toEqual([]);
    expect(String(closed.json?.held)).toContain("lands at");
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "UPDATE ballots SET lands_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), veto_closes_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) " +
        "WHERE id = ? AND lands_at IS NOT NULL",
      [firstBallot],
    );
    expect((await call("POST", "/api/admin/cycles/close", { body: {} })).status).toBe(200);

    // THE COLD READ. A different token, a fresh request, nothing carried over
    // from the session that closed it. This is where the card used to have
    // nothing to say about the most interesting kind of decision there is.
    const cold = await call("GET", `/api/governance/ballots/${firstBallot}`, { token: memberToken });
    expect(cold.status).toBe(200);
    expect(cold.json?.status).toBe("passed");
    expect(cold.json?.appliedKeys, "the amendment ledger still knows").toContain("governance.vote_days");

    // Read TWICE, because the whole failure was a value that existed once. A
    // second cold request is the anniversary in miniature.
    const later = await call("GET", `/api/governance/ballots/${firstBallot}`, { token: memberToken });
    expect(later.json?.appliedKeys).toContain("governance.vote_days");

    // How far the record reaches is the MODULE's decision and not this
    // change's. Governance runs at `members` in this village, so a stranger
    // is asked to sign in and never handed a decision with its consequence
    // quietly stripped out. Asserted rather than assumed: a route that
    // started answering a stranger here would be a real change in who reads
    // a village's decisions, and it should never happen as a side effect.
    const anon = await call("GET", `/api/governance/ballots/${firstBallot}`, { token: null });
    expect(anon.status).toBe(401);
  });

  it("reports only what the LEDGER holds, never what the proposal asked for", async () => {
    const [rows] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT config_key, proposal_ref FROM mechanics_changes WHERE source = 'governance'",
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0].config_key)).toBe("governance.vote_days");
    expect(String(rows[0].proposal_ref)).toContain(`bal:${firstBallot}`);
    // A ballot that decided nothing carries an empty list rather than a guess
    // at what a proposal of that name might have contained.
    const advisory = await call("POST", "/api/governance/advisory", {
      body: { question: "Would we want a second work morning each moon?" },
    });
    expect(advisory.status, JSON.stringify(advisory.json)).toBe(200);
    const advisoryId = String(advisory.json?.ballot?.id ?? "");
    const read = await call("GET", `/api/governance/ballots/${advisoryId}`, { token: memberToken });
    expect(read.json?.appliedKeys).toEqual([]);
  });

  it("THE VILLAGE HAS DECIDED THIS BEFORE: the second ballot on a subject carries the first", async () => {
    // The proposal applied, so a second run needs its own subject. A fresh
    // proposal on the same dial, taken to a vote twice, is the shape a member
    // actually meets: a question the village comes back to.
    const made = await call("POST", "/api/game/mechanics/proposals", {
      body: {
        title: "Back to ten days for a ballot",
        rationale: "A fortnight turned out to be long enough that people forgot a vote was running at all.",
        changes: [{ key: "governance.vote_days", to: "10" }],
      },
    });
    expect(made.status).toBe(200);
    const second = String(made.json?.id ?? "");

    const first = await call("POST", `/api/governance/mechanics/${second}/open-ballot`);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const firstId = String(first.json?.ballot?.id ?? "");
    expect((await call("POST", `/api/governance/ballots/${firstId}/withdraw`, {
      body: { reason: "Opened against the wrong number. Reopening with ten." },
    })).status).toBe(200);

    const again = await call("POST", `/api/governance/mechanics/${second}/open-ballot`);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    secondBallot = String(again.json?.ballot?.id ?? "");

    const read = await call("GET", `/api/governance/ballots/${secondBallot}`, { token: memberToken });
    expect(read.status).toBe(200);
    const priors = read.json?.priorAttempts ?? [];
    expect(priors.length, "the earlier attempt is on the record").toBe(1);
    expect(priors[0].id).toBe(firstId);
    expect(priors[0].status).toBe("withdrawn");
    expect(String(priors[0].outcomeNote)).toContain("wrong number");
    // And it never lists itself.
    expect(priors.some((p: any) => p.id === secondBallot)).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("a village does not lose its oldest decisions", () => {
  const MADE = 105;

  it("keeps every decision reachable past the hundredth row", async () => {
    // 105 closed ballots straight into the table. The route's page size is a
    // hundred, so this is the exact shape a village four years in has, and it
    // is the shape under which its founding decisions used to be absent from
    // its own record with nothing saying so.
    const values: any[] = [];
    const rows: string[] = [];
    for (let i = 0; i < MADE; i += 1) {
      const id = `bal-old-${String(i).padStart(3, "0")}`;
      // Oldest first: index 0 is the founding decision, and it is the one the
      // old route dropped.
      const created = new Date(Date.UTC(2022, 0, 1) + i * 86400000);
      rows.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      values.push(
        id, "archive", `arch-${i}`, `archive:arch-${i}`, `An old decision, number ${i}`,
        "The document this village voted on.", "majority", "equal", "50.00", "20.00",
        "10.0000", 10, "seed", created, created, "passed",
        `The village settled this on day ${i}.`, created, created,
      );
    }
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "INSERT INTO ballots (id, subject_type, subject_ref, open_key, title, doc_markdown, method, " +
        "weight_mode, unity_pct, quorum_pct, total_weight, electorate_count, opened_by, opens_at, " +
        "closes_at, status, outcome_note, closed_at, created_at) VALUES " + rows.join(","),
      values,
    );

    const first = await call("GET", "/api/governance/ballots?limit=100", { token: memberToken });
    expect(first.status).toBe(200);
    expect(first.json.length).toBe(100);
    const firstIds = new Set(first.json.map((b: any) => b.id));
    // The founding decision is NOT on page one. That is the whole bug: before
    // this it was nowhere at all.
    expect(firstIds.has("bal-old-000")).toBe(false);

    const rest = await call("GET", "/api/governance/ballots?limit=100&offset=100", { token: memberToken });
    expect(rest.status).toBe(200);
    expect(rest.json.length).toBeGreaterThan(0);
    const everything = new Set([...firstIds, ...rest.json.map((b: any) => b.id)]);
    for (let i = 0; i < MADE; i += 1) {
      const id = `bal-old-${String(i).padStart(3, "0")}`;
      expect(everything.has(id), `${id} fell off the end of the record`).toBe(true);
    }
    // And the oldest one still carries the sentence it closed with, which is
    // the thing a member came back for.
    const founding = rest.json.find((b: any) => b.id === "bal-old-000");
    expect(String(founding.outcomeNote)).toContain("day 0");
    expect(founding.closedAt, "and the year the chronicle groups it under").toBeTruthy();
  });

  it("asking for nothing still answers with the same hundred it always did", async () => {
    const plain = await call("GET", "/api/governance/ballots", { token: memberToken });
    expect(plain.status).toBe(200);
    expect(plain.json.length).toBe(100);
  });
});

/**
 * A VOICE THAT WAS EARNED IS NEVER TAKEN AWAY (0109, R65/R66).
 *
 * What this block used to prove: a warning badge naming `ballot.vote` took
 * its holder off `ballot_electorate` on every roll built afterwards, and the
 * refusal she read blamed the clock. The sentence was fixed then. The founder
 * has since ruled on the mechanism itself: "denying a voice is not a power
 * anyone should hold", and "when voice is earned it should never be force
 * taken away". So the deny is gone and this block proves its absence.
 *
 * THREE LOCKS, DRIVEN AGAINST THE BUILT SERVER RATHER THAN DESCRIBED:
 *
 *  1. The write path refuses. `POST /api/admin/badges` will not save a
 *     warning that names a voice key.
 *  2. The GATE ignores one anyway. The badge row here is edited straight in
 *     SQL after it was saved, which is exactly what the validator cannot see
 *     and what code review cannot see either. Cara carries a badge whose
 *     stored `denies` names `ballot.vote`, and she votes.
 *  3. The deny that STAYED still bites. The same badge also denies
 *     `forum.post`, and that refusal is untouched. A village asking somebody
 *     to stop posting for a while is not the act that was ruled on, and the
 *     two sit next to each other here so no later reader confuses them.
 *
 * The freeze case survives unchanged, because the snapshot law is unchanged:
 * a member who arrived after a vote opened is still off that one roll, and is
 * still told so in the freeze's own words.
 */
describe.skipIf(!DB_CONFIGURED)("nobody can take away a voice that was earned", () => {
  let caraToken = "";
  let caraId = "";
  let danaToken = "";
  let ballotId = "";
  let badgeId = "";

  it("REFUSES to save a warning badge that takes the vote away", async () => {
    expect((await call("PUT", "/api/admin/modules/badges/lifecycle", {
      body: { lifecycle: "members", examples: false },
    })).status).toBe(200);

    const refused = await call("POST", "/api/admin/badges", {
      body: {
        name: `Voting paused ${PORT}`,
        description: "A pause on voting while something is being worked out.",
        kind: "warning",
        denies: ["ballot.vote"],
      },
    });
    expect(refused.status, JSON.stringify(refused.json)).toBe(400);
    expect(String(refused.json?.error ?? "")).toContain("never taken away");

    // The other voice key, refused by the same lock and named separately so a
    // later reader can see the map is what decides rather than one key.
    const alsoRefused = await call("POST", "/api/admin/badges", {
      body: { name: `Vouching paused ${PORT}`, kind: "warning", denies: ["member.vouch"] },
    });
    expect(alsoRefused.status).toBe(400);

    // And a control in the same block: the refusal is about WHICH key, never
    // about warning badges. A warning that pauses posting still saves.
    const saved = await call("POST", "/api/admin/badges", {
      body: {
        name: `Posting paused ${PORT}`,
        description: "A pause on posting while something is being worked out.",
        kind: "warning",
        denies: ["forum.post"],
      },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    badgeId = String(saved.json?.badge?.id ?? "");
    expect(badgeId).toBeTruthy();
  });

  it("gives that badge a hand-written deny on the vote, which is the case no validator sees", async () => {
    const cara = await register("Cara Lin", `cara-${PORT}@example.test`);
    caraToken = cara.token;
    caraId = cara.id;
    expect((await call("PUT", `/api/admin/players/${caraId}/stage`, { body: { stageId: "member" } })).status).toBe(200);

    expect((await call("POST", `/api/admin/badges/${badgeId}/award`, {
      body: { userId: caraId, note: "Paused while the circle finishes talking it through." },
    })).status).toBe(200);

    // Straight into the column, past every check the product has. This is the
    // row a village could be carrying from before the ruling, and the row an
    // admin with database access could still write tomorrow.
    await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, and going past the repo IS the case under test
      "UPDATE badges SET denies = ? WHERE id = ?",
      [JSON.stringify(["forum.post", "ballot.vote"]), badgeId],
    );
    const [stored] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT denies FROM badges WHERE id = ?",
      [badgeId],
    );
    expect(JSON.stringify(stored[0]?.denies), "the deny really is in the column").toContain("ballot.vote");
  });

  it("HOLDS THE VOTE ANYWAY, and the same badge still pauses her posting", async () => {
    const standing = await call("GET", "/api/governance/standing", { token: caraToken });
    expect(standing.status).toBe(200);
    expect(standing.json?.eligible, "the badge cannot take her vote").toBe(true);
    expect(standing.json?.deniedByWarning, "and nothing claims a warning did").toBe(false);

    // Both halves off one reading of the real gate, so the pair cannot drift.
    const why = await call("GET", `/api/admin/members/${caraId}/capabilities`);
    expect(why.status).toBe(200);
    const rows: any[] = why.json?.capabilities ?? [];
    const vote = rows.find((r) => r.capability === "ballot.vote");
    const post = rows.find((r) => r.capability === "forum.post");
    expect(vote?.held, "the voice key survives the deny").toBe(true);
    expect(String(vote?.source)).not.toContain("denied");
    expect(post?.held, "the deny that stayed still bites").toBe(false);
    expect(post?.source).toBe("denied by warning badge");
    // The server still reports the stored deny truthfully. It says what the
    // badge SAYS; the gate decides what it TAKES.
    expect(why.json?.badgeDenies).toContain("ballot.vote");
  });

  it("opens a vote after the warning, and Cara is ON its roll", async () => {
    // The founder's earlier advisory is still running and one opener may have
    // one at a time, so it is called off first.
    const open = await call("GET", "/api/governance/ballots?limit=200");
    const running = (open.json ?? []).find((b: any) => b.subjectType === "advisory" && b.status === "open");
    if (running) {
      expect((await call("POST", `/api/governance/ballots/${running.id}/withdraw`, {
        body: { reason: "Asked before the question was settled. Asking the settled one now." },
      })).status).toBe(200);
    }

    const asked = await call("POST", "/api/governance/advisory", {
      body: { question: "Would we want the work morning to start an hour earlier?" },
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    ballotId = String(asked.json?.ballot?.id ?? "");
    expect(ballotId).toBeTruthy();

    const seen = await call("GET", `/api/governance/ballots/${ballotId}`, { token: caraToken });
    expect(seen.status).toBe(200);
    expect(seen.json?.myWeight, "she is inside the roll this vote froze").not.toBeNull();
  });

  it("AND SHE CASTS IT. That is the whole ruling in one call", async () => {
    const cast = await call("POST", `/api/governance/ballots/${ballotId}/vote`, {
      token: caraToken,
      body: { choice: "yes" },
    });
    expect(cast.status, JSON.stringify(cast.json)).toBe(200);
    expect(cast.json?.choice).toBe("yes");
  });

  it("still names the freeze for the member the freeze actually kept out", async () => {
    // Dana registers AFTER the ballot opened and reaches member stage, so she
    // holds `ballot.vote` right now and is off this one roll for the one
    // reason the freeze sentence describes. The snapshot law is untouched.
    const dana = await register("Dana Poe", `dana-${PORT}@example.test`);
    danaToken = dana.token;
    expect((await call("PUT", `/api/admin/players/${dana.id}/stage`, { body: { stageId: "member" } })).status).toBe(200);

    const standing = await call("GET", "/api/governance/standing", { token: danaToken });
    expect(standing.json?.eligible).toBe(true);
    expect(standing.json?.deniedByWarning).toBe(false);

    const refused = await call("POST", `/api/governance/ballots/${ballotId}/vote`, {
      token: danaToken,
      body: { choice: "yes" },
    });
    expect(refused.status).toBe(409);
    const said = String(refused.json?.error ?? "");
    expect(said).toContain("It froze when this vote opened");
    expect(said).not.toContain("warning");
  });

  it("and says the plain thing to an account voting is not open to at all", async () => {
    // The suite's ordinary member never reached member stage, so the gate
    // refuses her for a reason that is neither a warning nor a clock.
    const refused = await call("POST", `/api/governance/ballots/${ballotId}/vote`, {
      token: memberToken,
      body: { choice: "yes" },
    });
    expect(refused.status).toBe(409);
    const said = String(refused.json?.error ?? "");
    expect(said).toContain("Voting is not open to your account at the moment");
    expect(said).not.toContain("warning");
  });

  /**
   * THE OTHER ACT, AND IT IS LEGITIMATE. Leaving is not a sanction.
   *
   * The founder drew the line by TRIGGER rather than by effect. Stripping a
   * member's voice because of how they behaved is the act R65/R66 forbid, and
   * this file's earlier cases prove it is gone. Taking a DEPARTED member's
   * voice out of the pool is a different act and it has to keep working, for
   * a reason that is a real failure mode: a departed member left in the pool
   * counts toward quorum forever, so every proposal gets harder to pass as a
   * village ages. A village that loses four of twelve would slowly become
   * ungovernable while every remaining member is present and willing.
   *
   * Quorum is measured against `ballots.total_weight`, which is the sum of
   * the roll frozen at open, so whatever `buildElectorate` returns at open is
   * the denominator for the life of that ballot. That makes this measurable
   * rather than arguable, and it is measured here instead of read off the
   * code: the counts come off two real ballots opened either side of a real
   * departure.
   */
  it("MEASURES that a departed member leaves the pool, and a present one stays in it", async () => {
    const withdrawRunning = async () => {
      const open = await call("GET", "/api/governance/ballots?limit=200");
      const running = (open.json ?? []).find((b: any) => b.subjectType === "advisory" && b.status === "open");
      if (running) {
        expect((await call("POST", `/api/governance/ballots/${running.id}/withdraw`, {
          body: { reason: "Asked and answered in the circle." },
        })).status).toBe(200);
      }
    };
    const openOne = async (question: string) => {
      await withdrawRunning();
      const asked = await call("POST", "/api/governance/advisory", { body: { question } });
      expect(asked.status, JSON.stringify(asked.json)).toBe(200);
      return String(asked.json?.ballot?.id ?? "");
    };

    // Before. Dana is here, at member stage, and on the roll.
    const beforeId = await openOne("Would we want a second compost bay?");
    const before = await call("GET", `/api/governance/ballots/${beforeId}`, { token: danaToken });
    expect(before.status).toBe(200);
    const countBefore = Number(before.json?.electorateCount);
    const weightBefore = Number(before.json?.totalWeight);
    expect(countBefore, "the roll has people on it, or this measures nothing").toBeGreaterThan(0);
    expect(before.json?.myWeight, "Dana is on the roll while she is here").not.toBeNull();

    // She leaves, through the member's own door.
    const left = await call("POST", "/api/profile/delete-account", {
      token: danaToken,
      body: { password: PASSWORD },
    });
    expect(left.status, JSON.stringify(left.json)).toBe(200);

    // After. A ballot opened now builds its roll without her.
    const afterId = await openOne("Would we want the tool shed painted?");
    const after = await call("GET", `/api/governance/ballots/${afterId}`);
    expect(after.status).toBe(200);
    expect(Number(after.json?.electorateCount), "a departed member is out of the pool").toBe(countBefore - 1);
    expect(Number(after.json?.totalWeight)).toBeLessThan(weightBefore);

    // AND THE CONTROL, in the same measurement: Cara is still here, still
    // carries the warning badge, and is still counted. So the drop above is
    // departure and not some other thing that happened in between.
    const caraSees = await call("GET", `/api/governance/ballots/${afterId}`, { token: caraToken });
    expect(caraSees.json?.myWeight, "a member who is still here keeps her place in the pool").not.toBeNull();

    // The ballot that was already open keeps the roll it froze, which is the
    // snapshot law. Leaving does not rewrite a vote that is already running.
    const frozen = await call("GET", `/api/governance/ballots/${beforeId}`);
    expect(Number(frozen.json?.electorateCount), "an open ballot's roll is frozen, departures included").toBe(countBefore);
  });
});

/**
 * A MEMBER'S OWN FIRSTS, DERIVED ON THE READ.
 *
 * `cast_at` defaults to CURRENT_TIMESTAMP and `updated_at` is the separate ON
 * UPDATE column, so a member who changes their mind does not move the date of
 * their first vote. That is the whole reason this can be derived rather than
 * stored, and it is asserted rather than trusted: the founder votes, changes
 * the vote, and the first-time date must not have moved.
 */
describe.skipIf(!DB_CONFIGURED)("the first time somebody did each of these", () => {
  it("says nothing at all about a member who has done none of them", async () => {
    // A brand new account: never voted, never objected, holds no seat. Three
    // nulls, and the page renders no section rather than three zeroes.
    const fresh = await register("Eli Marsh", `eli-${PORT}@example.test`);
    const theirs = await call("GET", "/api/game/progression", { token: fresh.token });
    expect(theirs.status).toBe(200);
    expect(theirs.json?.firsts).toEqual({ vote: null, objection: null, seat: null });
  });

  it("dates a first vote from cast_at, and a changed vote does not move it", async () => {
    // One advisory per opener at a time, and the previous block left one
    // running.
    const open = await call("GET", "/api/governance/ballots?limit=200");
    const running = (open.json ?? []).find((b: any) => b.subjectType === "advisory" && b.status === "open");
    if (running) {
      expect((await call("POST", `/api/governance/ballots/${running.id}/withdraw`, {
        body: { reason: "Answered in the circle before the vote got going." },
      })).status).toBe(200);
    }
    const asked = await call("POST", "/api/governance/advisory", {
      body: { question: "Should the tool shed keep its own key?" },
    });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const id = String(asked.json?.ballot?.id ?? "");

    expect((await call("POST", `/api/governance/ballots/${id}/vote`, { body: { choice: "yes" } })).status).toBe(200);
    const first = await call("GET", "/api/game/progression");
    expect(first.json?.firsts?.vote, "the founder's first vote is dated").toBeTruthy();
    const dated = String(first.json.firsts.vote);

    expect((await call("POST", `/api/governance/ballots/${id}/vote`, { body: { choice: "abstain" } })).status).toBe(200);
    const again = await call("GET", "/api/game/progression");
    expect(again.json?.firsts?.vote, "changing a vote does not move when you first voted").toBe(dated);
  });

  it("dates a first seat from the seating, and leaves an example seat out of it", async () => {
    const mine = await call("GET", "/api/game/progression", { token: memberToken });
    // She was seated on two real seats earlier in this suite.
    expect(mine.json?.firsts?.seat, "her first seat is dated").toBeTruthy();
    // And never before this run began, which is what an example row would do.
    expect(new Date(String(mine.json.firsts.seat)).getFullYear()).toBeGreaterThanOrEqual(2025);
  });
});
