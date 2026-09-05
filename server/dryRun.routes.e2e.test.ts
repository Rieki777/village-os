/**
 * THE TEST RUN LEAVES NOTHING BEHIND, driven over HTTP against a real database.
 *
 * R86, the founder's words: "we also need a 'test the village' option where all
 * the cycles can run rapidly so we can test how they are all working ... so we
 * can see how everything runs, which we should do anyway before going live."
 *
 * R81 and R67 are what make that hard. All minting goes through governance
 * after launch, and before launch nothing issues at all. A dry run that minted
 * test tokens into real balances would be the platform issuing value with no
 * vote behind it, which is the exact act those rulings exist to prevent.
 *
 * So the harm metric for this file is one sentence, and every clause of it runs
 * against the built server:
 *
 *   A founder runs the longest test their village allows, over a village whose
 *   economy is switched on and seated, and afterwards every append-only table
 *   holds exactly the rows it held before, the issuance gate still refuses, and
 *   the report still told them what their settings would do.
 *
 * WHY THE FIXTURE IS LOUD ABOUT ITS STATE. A compressed run over a village with
 * every module off and no seat held exercises almost nothing and reports a
 * confident green. This suite seats a member on a real role, leaves the seeded
 * mint rules in place, and queues a rule change, so the run has something to
 * find. `stateIsOn` below asserts that before any of it is believed.
 *
 * ── THE DOOR MOVED (R12) ────────────────────────────────────────────────────
 *
 * Rye: "any member as all members may suggest upgrades and will need to run
 * models and tests." The route is `POST /api/dry-run` and it answers any
 * signed-in member. `POST /api/admin/dry-run` is DELETED, and one case here
 * knocks on it and expects a 404, because a door left standing beside a new
 * one is a second gate to keep in step.
 *
 * So the harm sentence above gains a clause: the run that leaves every table
 * as it found it is now a MEMBER's run, and the founder's copy is the one that
 * carries the queued rule change. Both are asserted below.
 *
 * Boots the BUILT `dist/index.js` against a throwaway schema, so run
 * `pnpm build` first or you are testing stale code. Skips loudly without
 * TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { cycleBoundsFor } from "../shared/lunar";
import { villageMoonLabel } from "../shared/villageMoon";
import { RUNS_PER_WINDOW } from "./routes/dryRun";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[dryRun.routes] TEST_DATABASE_URL not set - DB-backed tests SKIPPED.");
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
const PORT = 11100 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "dryrun-admin";
const PASSWORD = "DryRunTest123!";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let founderId = "";
let wrenToken = "";
let wrenId = "";

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

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", {
    token: "",
    body: { name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

/**
 * EVERY APPEND-ONLY TABLE A RUN COULD PLAUSIBLY DIRTY, read raw.
 *
 * Counts alone would miss a row that replaced another, so the ledger and the
 * faucets carry their sums too and the mint rules carry their whole contents.
 * `scheduled_jobs` is here because the obvious wrong build of this feature is
 * one that runs the registered jobs faster, and that ledger is where such a
 * build would leave its fingerprints.
 */
async function fingerprint(): Promise<Record<string, string>> {
  const one = async (label: string, sql: string): Promise<[string, string]> => {
    const [rows] = await pool.query<any[]>(sql); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return [label, JSON.stringify(rows)];
  };
  const parts = await Promise.all([
    one("token_ledger", "SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM token_ledger"),
    one("token_ledger_rows", "SELECT id, from_account, to_account, token_type, amount, source, idempotency_key FROM token_ledger ORDER BY id"),
    one("token_balances", "SELECT account_id, token_type, balance FROM token_balances ORDER BY account_id, token_type"),
    one("faucets", "SELECT b.account_id, b.token_type, b.balance FROM token_balances b JOIN ledger_accounts a ON a.id = b.account_id WHERE a.faucet = 1 ORDER BY b.account_id, b.token_type"),
    one("gratitude_log", "SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM gratitude_log"),
    one("mint_rules", "SELECT id, amount, ceiling, enabled, effective_from_cycle, pending_amount, pending_ceiling, pending_enabled, pending_from_cycle FROM mint_rules ORDER BY id"),
    one("app_config", "SELECT config_key, CAST(value AS CHAR) v FROM app_config ORDER BY config_key"),
    one("scheduled_jobs", "SELECT job, last_run_at, last_result FROM scheduled_jobs ORDER BY job"),
    one("ledger_accounts", "SELECT id, kind, faucet FROM ledger_accounts ORDER BY id"),
    one("gratitude_distributions", "SELECT COUNT(*) n FROM gratitude_distributions"),
    one("gratitude_cycles", "SELECT COUNT(*) n FROM gratitude_cycles"),
    one("events", "SELECT COUNT(*) n FROM events"),
    one("notifications", "SELECT COUNT(*) n FROM notifications"),
  ]);
  return Object.fromEntries(parts);
}

/** Ask the founder to hand-mint. The simplest issuance a route can be told to do. */
const tryToIssue = (reason: string) =>
  call("POST", "/api/admin/tokens/gratitude/mint", {
    body: { toUserId: wrenId, amount: 5, reason },
  });

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the dry run route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-dryrun-"));
  // A village that has NOT started its Game, which is the whole premise: the
  // test run is the last thing a founder reaches for before the launch ballot.
  testDb = await provisionTestDb({ gameStarted: false });
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the suite's own pool onto the scratch schema it provisioned

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
      AUTH_TOKEN_SECRET: "dryrun-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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

  const boot = await call("POST", "/api/admin/bootstrap", {
    token: "",
    body: { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Dry Run Founder" },
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: "", body: { token: claim, password: PASSWORD } });
  founderToken = String(setPw.json?.token ?? "");
  founderId = String(setPw.json?.user?.id ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  const wren = await register("Wren Ashby", "wren");
  wrenToken = wren.token; wrenId = wren.id;

  /*
   * THE STATE, ON.
   *
   * A compressed run over a village with every module off and no seat held
   * exercises almost nothing and reports a confident green. Three things are
   * switched on here and each one makes a different part of the run have
   * something to say:
   *
   *   the FEED, because a village with it off is sending no hearts, and the
   *   allowance arithmetic says so instead of describing a channel nobody can
   *   reach;
   *
   *   a SEAT somebody actually holds, because the moon settlement thanks seat
   *   holders and has nothing to report without one;
   *
   *   a QUEUED RULE CHANGE, because the promotion path is otherwise dead code
   *   in every turn.
   */
  // The feed is a LENS over forum threads and names the forum as a hard
  // dependency, so the forum goes on first or the enable is refused with a 409.
  for (const id of ["forum", "feed"]) {
    const on = await call("PUT", `/api/admin/modules/${id}/lifecycle`, {
      body: { lifecycle: "members", examples: false },
    });
    expect(on.status, `${id} must be on for this suite: ${JSON.stringify(on.json)}`).toBe(200);
  }
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO org_roles (id, name, seats, active) VALUES ('dryrun-seat', 'Water Steward', 1, 1)",
  );
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key, is_example) " +
      "VALUES ('dryrun-seating', 'dryrun-seat', 'member', ?, ?, 0)",
    [wrenId, wrenId],
  );

  /*
   * The seat rule this suite defers a change on is the GRATITUDE one, and a
   * village is no longer seeded paying it: since 0125 the defaults are Village
   * Voice and Village Credits and the gratitude seat rule ships disabled, which
   * a village switches on if it wants it (`server/lib/economySeed.ts`).
   *
   * So the fixture switches it on, explicitly, and that is the honest shape:
   * this suite is about DEFERRAL, a queued change landing at the next moon and
   * not this one, and it needs a live rule to defer a change on. Deferring a
   * change on a disabled rule would have measured nothing while still going
   * green, which is the failure this whole suite exists to catch.
   */
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE mint_rules SET enabled = 1 WHERE id = 'rule-role.cycle-gratitude'",
  );

  /*
   * A queued change on the seat rule, stamped for a moon inside every run this
   * suite makes. Written the way `queueRuleChange` writes it, because the
   * route that queues one is the Mint panel and this suite is about the run.
   */
  await pool.query( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    "UPDATE mint_rules SET pending_amount = 45, pending_ceiling = ceiling, pending_enabled = 1, " +
      "pending_from_cycle = ? WHERE id = 'rule-role.cycle-gratitude'",
    [cycleBoundsFor(new Date()).cycleNumber + 1],
  );
}, 180_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the test run before launch", () => {
  it("the fixture has the state ON, so a green here means something", async () => {
    const [seats] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) n FROM org_role_assignments WHERE active_holder_key IS NOT NULL AND holder_kind = 'member' AND user_id IS NOT NULL AND is_example = 0",
    );
    expect(Number(seats[0].n), "a member holds a seat").toBeGreaterThan(0);
    const [rules] = await pool.query<any[]>( // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
      "SELECT COUNT(*) n FROM mint_rules WHERE enabled = 1",
    );
    expect(Number(rules[0].n), "the village has enabled mint rules").toBeGreaterThan(0);

    // The feed is on, so the run measures a village where hearts are sendable.
    const r = await call("POST", "/api/dry-run", { body: { moons: 3 } });
    expect(r.status).toBe(200);
    expect(
      r.json.runFindings.some((f: any) => f.area === "gratitude"),
      "the feed is on, so nothing says it is off",
    ).toBe(false);
    expect(
      r.json.allowances.some((a: any) => a.heartsSendable),
      "at least one stage can send a heart",
    ).toBe(true);
    expect(
      r.json.turns.flatMap((t: any) => t.findings).some((f: any) => f.area === "settlement" && f.outcome === "issued"),
      "the seat holder is thanked, so the settlement is live in this fixture",
    ).toBe(true);

    // The queued change lands in exactly one moon of the run, and the seat
    // settles at the new amount from that moon on. Without this the promotion
    // path is dead code in every turn and the run looks fine anyway.
    const landings = r.json.turns.filter((t: any) => t.findings.some((f: any) => f.area === "rules"));
    expect(landings, "the queued rule change lands in one moon").toHaveLength(1);
    expect(JSON.stringify(landings[0].findings)).toContain("20 becomes 45");
    // Named by TOKEN, not by position. A village now pays a seat holder in
    // more than one token, so a turn carries several settlement findings and
    // `.find()` on the area alone returns whichever the rules query happened
    // to order first. That is undefined, and a test that reads it is a test
    // that passes or fails on row order.
    const amountIn = (i: number, token: string) =>
      r.json.turns[i].findings.find(
        (f: any) => f.area === "settlement" && f.outcome === "issued" && String(f.sentence).includes(token),
      )?.sentence ?? "";
    expect(amountIn(0, "Gratitude")).toContain("20 Gratitude");
    expect(amountIn(1, "Gratitude")).toContain("45 Gratitude");
    // The defaults a village is actually born with settle alongside it, and
    // the deferred change does not disturb them.
    expect(amountIn(0, "Village Voice")).toContain("50 Village Voice");
    expect(amountIn(0, "Village Credits")).toContain("25 Village Credits");
  });

  it("refuses a stranger", async () => {
    const r = await call("POST", "/api/dry-run", { token: null, body: { moons: 3 } });
    expect(r.status).toBe(401);
  });

  /*
   * R12, AND THE WHOLE REASON THIS ROUTE MOVED. "Any member as all members may
   * suggest upgrades and will need to run models and tests." This case used to
   * assert the opposite: that a signed-in member got 401. It is inverted here
   * on purpose, and the inversion is the change.
   */
  it("answers any signed-in member, and leaves the queued change out of their copy", async () => {
    const r = await call("POST", "/api/dry-run", { token: wrenToken, body: { moons: 3 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.turns).toHaveLength(3);
    expect(r.json.isolation).toMatch(/wrote nothing/i);
    // The fixture queues a change on the seat rule for the moon after this
    // run starts, and the founder's copy names it. A member's does not.
    expect(
      r.json.turns.some((t: any) => t.findings.some((f: any) => f.area === "rules")),
      "a member reads no queued change",
    ).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain("20 becomes 45");
    // Every moon settles at the amount the rule carries today.
    for (const t of r.json.turns) {
      const paid = t.findings.find(
        (f: any) => f.area === "settlement" && f.outcome === "issued" && String(f.sentence).includes("Gratitude"),
      );
      expect(paid?.sentence, `moon ${t.cycleNumber}`).toContain("20 Gratitude");
    }
  });

  it("has no admin door left to knock on", async () => {
    const gone = await call("POST", "/api/admin/dry-run", { body: { moons: 3 } });
    expect(gone.status, "the admin path is deleted, not kept beside the new one").toBe(404);
    const strangerAtTheOldDoor = await call("POST", "/api/admin/dry-run", { token: null, body: { moons: 3 } });
    expect(strangerAtTheOldDoor.status).toBe(404);
  });

  it("runs, and says what it was measuring", async () => {
    const r = await call("POST", "/api/dry-run", { body: { moons: 12 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.moons).toBe(12);
    expect(r.json.turns).toHaveLength(12);
    expect(r.json.gameStarted).toBe(false);
    // Every turn names its own lunation, and they run forward one at a time.
    const numbers = r.json.turns.map((t: any) => t.cycleNumber);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBe(numbers[i - 1] + 1);
    // The settlement had a seat to thank, so the run is not walking an empty village.
    const settled = r.json.turns[0].findings.filter((f: any) => f.area === "settlement");
    expect(settled.length, "the settlement said something").toBeGreaterThan(0);
    // And it is honest about what it did not test.
    expect(Array.isArray(r.json.notCovered)).toBe(true);
    expect(r.json.notCovered.length, "the run names what it does not cover").toBeGreaterThan(0);
  });

  /*
   * THE CARD READS THESE FIELDS BY NAME.
   *
   * `TestRun` in `client/src/pages/JourneyToLaunch.tsx` types the payload
   * itself, so the compiler checks the card against the card's own idea of the
   * server. A field the server stopped sending would render as `undefined` and
   * crash on `.map`, with `pnpm check` green the whole way. This is the half of
   * that contract a type cannot hold.
   */
  it("sends every field the launch page renders", async () => {
    const r = await call("POST", "/api/dry-run", { body: { moons: 6 } });
    expect(r.status).toBe(200);
    for (const field of ["moons", "spanDays", "isolation", "gameStarted"]) {
      expect(r.json[field], `${field} is missing from the payload`).toBeDefined();
    }
    for (const field of ["turns", "runFindings", "allowances", "jobs", "refusals", "covered", "notCovered"]) {
      expect(Array.isArray(r.json[field]), `${field} must be an array the card can map over`).toBe(true);
    }
    expect(r.json.runFindings.length, "the run always has something to say about itself").toBeGreaterThan(0);
    expect(r.json.allowances.length, "one row per stage of the path").toBeGreaterThan(0);
    expect(r.json.jobs.length, "the scheduler registry reached the report").toBeGreaterThan(0);
    for (const f of [...r.json.runFindings, ...r.json.turns.flatMap((t: any) => t.findings)]) {
      expect(typeof f.sentence).toBe("string");
      expect(f.sentence.length).toBeGreaterThan(0);
      expect(["issued", "refused", "idle"]).toContain(f.outcome);
    }
    for (const a of r.json.allowances) {
      expect(typeof a.note).toBe("string");
      expect(a.stageId).toBeTruthy();
    }
    for (const j of r.json.jobs) {
      expect(j.name).toBeTruthy();
      // Both are strings on purpose: a cadence a person would say, and a count
      // at the precision it deserves.
      expect(j.cadence, `${j.name} has no cadence`).toMatch(/^every |^once a day$/);
      expect(typeof j.runsInSpan).toBe("string");
    }
  });

  /*
   * THE UNLAUNCHED CASE, ON THE ROUTE THAT MOST OFTEN MEETS IT.
   *
   * A village runs this report BEFORE it launches, which is the whole point
   * of a dry run, so it has no first moon and therefore no moon numbers. The
   * ordinal arithmetic is proved in `shared/villageMoon.test.ts`; what this
   * holds is that the resolved anchor reaches the payload the card reads, and
   * that an absent one arrives as an honest absence and never as Moon 0.
   */
  it("gives every turn a village moon, and gives an unlaunched village no number in it", async () => {
    const r = await call("POST", "/api/dry-run", { body: { moons: 6 } });
    expect(r.status).toBe(200);
    for (const t of r.json.turns) {
      expect(t.moon, "the card reads t.moon by name").toBeTruthy();
      expect(t.moon.cycleNumber).toBe(t.cycleNumber);
      expect(t.moon.startsAt).toBe(t.startsAt);
      expect(t.moon.endsAt).toBe(t.endsAt);
      // This fixture has never launched and sets no override, so there is no
      // Moon 1 to count from.
      expect(t.moon.standing).toBe("unanchored");
      expect(t.moon.ordinal).toBeNull();
      expect(villageMoonLabel(t.moon), "dates, and no invented moon number").not.toContain("Moon");
      expect(villageMoonLabel(t.moon).length).toBeGreaterThan(0);
    }
  });

  /*
   * DRIVEN BY THE MEMBER, because the member is the caller that is new. It is
   * one handler and one function either way, so the founder's run has the same
   * property; the risk this file has to answer is that opening the door let a
   * write in behind it.
   */

  it("THE LEDGER IS UNCHANGED, and so is every other append-only table", async () => {
    const before = await fingerprint();
    const r = await call("POST", "/api/dry-run", { token: wrenToken, body: { moons: 36 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // A run that computed nothing would also leave the ledger alone, so prove
    // it computed something first.
    const issued = r.json.turns.flatMap((t: any) => t.findings).filter((f: any) => f.outcome === "issued");
    expect(issued.length, "the run projected at least one issuance").toBeGreaterThan(0);

    const after = await fingerprint();
    for (const key of Object.keys(before)) {
      expect(after[key], `${key} changed during a test run`).toBe(before[key]);
    }
  });

  it("leaves the issuance gate exactly where it found it", async () => {
    const beforeRun = await tryToIssue("before the test run");
    expect(beforeRun.status, "a village that has not started refuses issuance").toBeGreaterThanOrEqual(400);

    await call("POST", "/api/dry-run", { body: { moons: 24 } });

    const afterRun = await tryToIssue("after the test run");
    expect(afterRun.status, "and it still refuses afterwards").toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(afterRun.json)).toMatch(/has not started its Game/i);
  });

  it("refuses a length nobody asked for rather than inventing one", async () => {
    const tooMany = await call("POST", "/api/dry-run", { body: { moons: 5000 } });
    expect(tooMany.status).toBe(400);
    const zero = await call("POST", "/api/dry-run", { body: { moons: 0 } });
    expect(zero.status).toBe(400);
  });

  it("carries the refusals a founder needs, never only the successes", async () => {
    // A rule that pays nothing is the silent misconfiguration this exists for.
    await pool.query("UPDATE mint_rules SET amount = NULL WHERE `trigger` = 'role.cycle' AND token_slug = 'gratitude'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const r = await call("POST", "/api/dry-run", { body: { moons: 6 } });
    expect(r.status).toBe(200);
    const refusals = r.json.refusals ?? [];
    expect(refusals.length, "the run reported at least one refusal").toBeGreaterThan(0);
    expect(JSON.stringify(refusals)).toMatch(/pays nothing|reads its amount/i);
    // Put it back so a later read of this schema is not confused by it.
    await pool.query("UPDATE mint_rules SET amount = 20 WHERE `trigger` = 'role.cycle' AND token_slug = 'gratitude'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  });

  /*
   * R11 HELD, READ FROM THE LAUNCH STATUS ITSELF.
   *
   * `launchVoteBlocked` counts open blocking requirements and has never read
   * the dry run (server/lib/launch.ts). Opening the run to the roll is exactly
   * the change that could quietly wire the two together, so the assertion is
   * an outcome: the founder reads the launch status, a MEMBER runs the longest
   * test the village allows, and the status is identical afterwards, down to
   * every item's state.
   */
  it("a member's run moves nothing on the launch checklist", async () => {
    const shape = (j: any) => JSON.stringify({
      blockingOpen: j?.blockingOpen,
      recommendedOpen: j?.recommendedOpen,
      launchedAt: j?.launchedAt ?? null,
      items: (j?.items ?? []).map((i: any) => [i.id, i.state, i.severity]),
      voteBlocked: j?.vote?.blocked ?? null,
    });
    const before = await call("GET", "/api/admin/launch");
    expect(before.status).toBe(200);
    const run = await call("POST", "/api/dry-run", { token: wrenToken, body: { moons: 40 } });
    expect(run.status, JSON.stringify(run.json)).toBe(200);
    // The run had something to say, so this is not a comparison of two nothings.
    expect(run.json.turns).toHaveLength(40);
    const after = await call("GET", "/api/admin/launch");
    expect(shape(after.json)).toBe(shape(before.json));
  });

  /*
   * THE PER-PERSON BUDGET, against the real MySQL-backed limiter.
   *
   * Two members registered here and nowhere else, because the ceiling has to
   * be reached and every other case in this file would have to fit under
   * whatever was left. `RUNS_PER_WINDOW` is imported from the route module
   * instead of retyped: a test carrying its own copy of the number keeps
   * passing on the day the number moves.
   */
  it("stops one member at their hourly ceiling and leaves the next member alone", async () => {
    const heavy = await register("Bramble Vane", "bramble");
    const light = await register("Rowan Pike", "rowan");

    for (let i = 0; i < RUNS_PER_WINDOW; i++) {
      const ok = await call("POST", "/api/dry-run", { token: heavy.token, body: { moons: 1 } });
      expect(ok.status, `run ${i + 1} of ${RUNS_PER_WINDOW} is inside the budget`).toBe(200);
    }

    const over = await call("POST", "/api/dry-run", { token: heavy.token, body: { moons: 1 } });
    expect(over.status).toBe(429);
    expect(over.json.error).toBe("too_many");
    expect(String(over.json.message), "the refusal is a sentence").toContain(String(RUNS_PER_WINDOW));
    expect(String(over.json.message)).toMatch(/hour/i);

    // A second member has spent nothing, so the bucket is keyed on the person.
    const fresh = await call("POST", "/api/dry-run", { token: light.token, body: { moons: 1 } });
    expect(fresh.status, "one member's ceiling is not the village's").toBe(200);
  });
});
