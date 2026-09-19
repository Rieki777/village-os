/**
 * THE DRIVE: several members use several modules, and the pool reports itself.
 *
 * This boots the BUILT `dist/index.js` against a scratch schema and drives it
 * over HTTP, so what it proves is what a village runs. It is the acceptance
 * criterion for lane METER, and it exists because every part of this feature is
 * cheap to fake in a unit test: a meter that counts nothing still passes an
 * arithmetic test, and arithmetic that closes on invented weights proves
 * nothing about whether anybody was measured.
 *
 * What it drives, in order:
 *   1. four members register and three modules are turned on,
 *   2. the members use them, unevenly and on purpose,
 *   3. one of them hammers a module, and the count does not move,
 *   4. the pool statement closes, and every share returns to the pool.
 *
 * Step 4 is the R59 demonstration. Every module in the registry today is the
 * platform's own, so every share is recycled and the payable total is zero.
 * That is not a defect in the drive: it is the state the platform ships in, and
 * a statement that could not report it honestly would be the defect.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import mysql from "mysql2/promise";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";
import { sealCycle } from "./repos/moduleUsage";
import { cycleIdFor } from "./lib/gratitude-cycles";
import { verifyDocument } from "./lib/villageExport";
import { moduleUsageReportProblems, MODULE_USAGE_PROTOCOL } from "../shared/moduleProvenance";

const DB_CONFIGURED = testDbConfigured();
const DIST = path.resolve(__dirname, "../dist/index.js");
const PORT = 21902 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "MeterDrive123!";
const PASSWORD = "MeterMember123!";

let child: ChildProcess | null = null;
let testDb: TestDb;
let pool: mysql.Pool;
let dataDir = "";

interface Called { status: number; json: any; text: string }

async function call(method: string, route: string, body?: any, token?: string): Promise<Called> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON stays visible through text */ }
  return { status: res.status, json, text };
}

/**
 * Let the meter catch up.
 *
 * The mark is written on the response's `finish` event and is deliberately not
 * awaited, because nothing about a member's page may wait on a measurement. So
 * the write can still be in flight when the client already holds the response,
 * and a test that read the count immediately would be racing the design. This
 * is the one place that has to care.
 */
const settle = () => new Promise((r) => setTimeout(r, 500));

async function register(name: string, slug: string): Promise<{ name: string; token: string }> {
  const r = await call("POST", "/api/auth/register", {
    name, email: `${slug}-${PORT}@example.test`, password: PASSWORD, paths: ["resident"],
  });
  expect(r.status, `${name} must register`).toBe(200);
  return { name, token: String(r.json?.token ?? "") };
}

let founder = "";
const members: Record<string, string> = {};
/** The spawned server's own stdout and stderr, so a failure can quote it. */
const logs: string[] = [];

/** The tail of what the server said, for an assertion message that would otherwise name nothing. */
function serverSaid(lines: string[]): string {
  const text = lines.join("").trimEnd();
  if (!text) return "(the spawned server said nothing at all)";
  return `--- the spawned server said ---\n${text.slice(-2000)}`;
}

describe.skipIf(!DB_CONFIGURED)("the builders' pool, driven", () => {
  beforeAll(async () => {
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before the module pool drive.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-meter-"));
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
        AUTH_TOKEN_SECRET: "meter-drive-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
        RESEND_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => logs.push(String(d)));
    child.stderr?.on("data", (d) => logs.push(String(d)));
    // If the child dies (a bind conflict, a bad env), say so at once instead of
    // letting the boot poll succeed against whatever else answers this port.
    child.on("exit", (code) => logs.push(`\n[the spawned server exited with code ${code}]\n`));

    // Reports the last /health answer and when the server logged that it was
    // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
    await waitForHealth({ base: BASE, logs, child });

    /*
     * ASSERT EACH STEP WHERE ITS VALUE IS PRODUCED.
     *
     * This chain used to assert nothing until the end, so when bootstrap
     * answered with no claim link the regex yielded "", set-password was called
     * with an empty token, and the first thing that spoke was
     * `expected '' to be truthy` three calls downstream, naming neither the
     * call that failed nor its status. That is the whole printed evidence of
     * the intermittent this file was known for. The server's own account of it
     * sat in `logs` and was thrown away, because 41 of the 42 e2e suites read
     * that array in exactly one place: the boot-deadline message.
     */
    const boot = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Meter Founder",
    });
    expect(boot.status, `bootstrap answered ${boot.status}: ${boot.text.slice(0, 300)}\n${serverSaid(logs)}`).toBe(200);
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    expect(claim, `bootstrap must return a claim link, got ${boot.text.slice(0, 300)}\n${serverSaid(logs)}`).toBeTruthy();
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: ADMIN });
    expect(setPw.status, `set-password answered ${setPw.status}: ${setPw.text.slice(0, 300)}\n${serverSaid(logs)}`).toBe(200);
    founder = String(setPw.json?.token ?? "");
    expect(founder, `founder must hold a session\n${serverSaid(logs)}`).toBeTruthy();

    for (const [name, slug] of [["Ana", "ana"], ["Ben", "ben"], ["Cass", "cass"], ["Dev", "dev"]]) {
      members[name!] = (await register(name!, slug!)).token;
    }

    // Three modules on, public so an unauthenticated read is possible too.
    for (const id of ["tools", "events", "forum"]) {
      const r = await call("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "public" }, founder);
      expect(r.status, `${id} must turn on: ${r.text.slice(0, 200)}`).toBe(200);
    }
  }, 180_000);

  afterAll(async () => {
    // Wait for the child to actually go. `fileParallelism: false` starts the
    // next suite the moment this resolves, and on Linux the server's SIGTERM
    // handler drains in-flight requests and closes its pool before the socket
    // is released, so firing kill() and moving on hands the next file a port
    // that is still bound.
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        child?.once("exit", done);
        setTimeout(done, 5_000);
        child?.kill();
      });
    }
    await pool?.end();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("counts the members who opened each module, and no more", async () => {
    // Ana, Ben and Cass open the tools hub. Dev never does.
    for (const who of ["Ana", "Ben", "Cass"]) await call("GET", "/api/tools", undefined, members[who]);
    // Ana alone opens events. All four open the forum.
    await call("GET", "/api/events", undefined, members.Ana);
    for (const who of ["Ana", "Ben", "Cass", "Dev"]) {
      await call("GET", "/api/forum/categories", undefined, members[who]);
    }

    // ONE MEMBER HAMMERS THE TOOLS HUB. This is the anti-gaming property: if
    // the number moves here, the pool pays for noise.
    for (let i = 0; i < 40; i += 1) await call("GET", "/api/tools", undefined, members.Ana);

    // A stranger with no token opens all three. A member is the unit, so an
    // anonymous reader earns a module nothing.
    for (const r of ["/api/tools", "/api/events", "/api/forum/categories"]) await call("GET", r);

    await settle();
    const report = (await call("GET", "/api/platform/module-usage")).json;
    const reach = new Map<string, any>(report.modules.map((m: any) => [m.moduleId, m]));
    expect(report.activeMembers).toBe(4);
    expect(reach.get("tools").membersReached).toBe(3);
    expect(reach.get("events").membersReached).toBe(1);
    expect(reach.get("forum").membersReached).toBe(4);
    expect(reach.get("forum").reach).toBe(1);
    expect(reach.get("tools").reach).toBe(0.75);
    expect(reach.get("events").reach).toBe(0.25);

    // Nothing that left this deployment names a person. `proof` is stripped
    // first: its signature is random base64url that changes every run, so
    // matching against it would make this assertion flaky about the one thing
    // it must never be flaky about.
    const { proof: _proof, ...body } = report;
    expect(JSON.stringify(body)).not.toMatch(/user_id|userId|@example\.test/);
  });

  it("refuses to be claimed by knocking on a module's door", async () => {
    /*
     * `requireModule` is mounted with `app.use("/api/library", ...)`, so it runs
     * for every path under the prefix before express knows whether the route
     * exists. If the mark were written there, Dev could claim the tools hub
     * with one curl at a path that does not exist, and any stray prefetch would
     * credit a module nobody opened. The mark waits for a response under 400.
     */
    const before = (await call("GET", "/api/platform/module-usage")).json;
    const toolsBefore = before.modules.find((m: any) => m.moduleId === "tools").membersReached;
    expect(toolsBefore).toBe(3);

    for (const bogus of ["/api/tools/nothing-here", "/api/tools/x/y/z", "/api/events/no-such-thing"]) {
      const r = await call("GET", bogus, undefined, members.Dev);
      expect(r.status, `${bogus} must not be a real route`).toBeGreaterThanOrEqual(400);
    }

    await settle();
    const after = (await call("GET", "/api/platform/module-usage")).json;
    expect(after.modules.find((m: any) => m.moduleId === "tools").membersReached).toBe(toolsBefore);
    // Dev opened only the forum, so events must still have found nobody but Ana.
    expect(after.modules.find((m: any) => m.moduleId === "events").membersReached).toBe(1);
  });

  it("answers a nonsense cycle with the open one instead of a fiction", async () => {
    const made_up = (await call("GET", "/api/modules/pool?cycle=whatever-i-like")).json;
    expect(made_up.cycle).toBe(cycleIdFor());
    expect(made_up.cycle).not.toBe("whatever-i-like");
  });

  it("closes the arithmetic, and returns the platform's share to the pool", async () => {
    const stmt = (await call("GET", "/api/modules/pool")).json;
    const t = stmt.totals;

    // THE CLOSURE. What goes out plus what comes back is what the pool held.
    expect(t.payable + t.accrued + t.recycled).toBe(t.pool);
    expect(t.distributed + t.recycled).toBe(t.pool);
    expect(stmt.modules.reduce((n: number, m: any) => n + m.share, 0)).toBe(t.pool);

    // R59, driven: every module in the registry is the platform's own, so the
    // whole pool is awarded on real usage and the whole pool comes back.
    expect(t.payable).toBe(0);
    expect(t.accrued).toBe(0);
    expect(t.recycled).toBe(t.pool);
    // The RULE, and not the coincidence: next cycle holds the hub's fresh
    // budget plus everything that came back. It happens to be double today
    // because everything came back, and asserting the double would pin the
    // arithmetic to a state that stops being true the first time a third party
    // lists a module.
    expect(t.nextCyclePool).toBe(t.pool + t.recycled);
    for (const m of stmt.modules.filter((x: any) => x.share > 0)) {
      expect(m.settlement).toBe("recycled");
      expect(m.pool.eligible).toBe(true);
      expect(m.pool.disposition).toBe("recycled");
    }

    // The shares track the reach: the forum was opened by everybody, so it
    // takes the largest share of the three.
    const share = new Map<string, number>(stmt.modules.map((m: any) => [m.id, m.share]));
    expect(share.get("forum")!).toBeGreaterThan(share.get("tools")!);
    expect(share.get("tools")!).toBeGreaterThan(share.get("events")!);

    // The statement says what it is, so an integrator cannot read it as a
    // settlement across every village.
    expect(stmt.basis).toBe("village-reading");

    console.log(
      `\n  THE STATEMENT, cycle ${stmt.cycle} (${stmt.sealed ? "sealed" : "open"}), ` +
        `${stmt.activeMembers} members active\n` +
        `  pool ${t.pool}  to builders ${t.distributed}  back into the pool ${t.recycled}  ` +
        `next cycle holds ${t.nextCyclePool}\n` +
        stmt.modules
          .filter((m: any) => m.share > 0)
          .map((m: any) => `    ${m.name.padEnd(22)} ${String(m.membersReached).padStart(2)} members  ` +
            `reach ${(m.reach * 100).toFixed(0).padStart(3)}%  share ${String(m.share).padStart(5)}  ${m.settlement}`)
          .join("\n"),
    );
  });

  it("seals the cycle, keeps the numbers, and forgets the members", async () => {
    const cycle = cycleIdFor();
    const dropped = await sealCycle(pool, cycle);
    expect(dropped).toBeGreaterThan(0);

    const after = (await call("GET", `/api/modules/pool?cycle=${cycle}`)).json;
    expect(after.sealed).toBe(true);
    expect(after.activeMembers).toBe(4);
    expect(after.totals.recycled).toBe(after.totals.pool);
    expect(after.modules.reduce((n: number, m: any) => n + m.share, 0)).toBe(after.totals.pool);

    const [marks]: any = await pool.query( // module-review-ok: the privacy assertion reads the table directly, because asking the repo would be asking the code under test whether it forgot
      "SELECT COUNT(*) AS n FROM module_usage_marks WHERE cycle_id = ?",
      [cycle],
    );
    expect(Number(marks[0].n)).toBe(0);

    /*
     * The sealed report is what a counter settles against, so it has to say
     * WHEN these numbers stopped moving. A settlement made from a cycle with no
     * date on it is a payment nobody can place afterwards.
     */
    const sealed = (await call("GET", `/api/platform/module-usage?cycle=${cycle}`)).json;
    expect(sealed.sealed).toBe(true);
    expect(typeof sealed.sealedAt).toBe("string");
    expect(Number.isNaN(Date.parse(sealed.sealedAt))).toBe(false);
    expect(moduleUsageReportProblems(sealed)).toEqual([]);
    const { proof: _sealedProof, ...sealedBody } = sealed;
    expect(JSON.stringify(sealedBody)).not.toMatch(/user_id|userId|@example\.test/);

    /*
     * A sealed cycle cannot change again, so it signs at its own seal time and
     * two fetches are byte identical. That is what lets a counter cache one,
     * compare two copies, and settle from a document whose integrity survived
     * leaving this server. An open cycle signs at now, because it is a reading.
     */
    const again = (await call("GET", `/api/platform/module-usage?cycle=${cycle}`)).json;
    expect(again.proof.signedAt).toBe(sealed.proof.signedAt);
    expect(again.proof.signature).toBe(sealed.proof.signature);
    expect(sealed.proof.signedAt).toBe(sealed.sealedAt);
  });

  it("carries who built each module, so a counter needs no list of its own", async () => {
    /*
     * R72's third clause. A counter that has never heard of this deployment
     * must be able to learn the credits from the report itself, because a fork
     * cannot inherit a hand-maintained list it is not on.
     *
     * The registry ships with no third-party module, so every line here reads
     * platform built and recycled. That is the state the platform ships in and
     * not a gap in the drive: what is being proved is that the credit TRAVELS,
     * and a line that carries "nobody built this outside the platform" is
     * carrying it.
     */
    const report = (await call("GET", "/api/platform/module-usage")).json;
    expect(report.protocol).toBe(MODULE_USAGE_PROTOCOL);
    expect(report.instanceId).toBeTruthy();

    // The check a counter runs before settling anything against a report it
    // did not build, run here against a report a real server actually served.
    expect(moduleUsageReportProblems(report)).toEqual([]);

    const forum = report.modules.find((m: any) => m.moduleId === "forum");
    expect(forum).toMatchObject({
      moduleId: "forum",
      membersReached: 4,
      activeMembers: 4,
      reach: 1,
      builtBy: null,
      builtByAccount: null,
      builtByNamespace: null,
      platformBuilt: true,
      // R59 made visible on the wire: the platform's share goes back in.
      poolEligible: true,
      disposition: "recycled",
    });
  });

  it("announces the meter in discovery and signs what it serves", async () => {
    /*
     * The two halves of "reportable to whoever is counting". Discovery is how a
     * counter that has never heard of this fork FINDS the report, and the
     * signature is what makes a copy of that report worth anything once it has
     * been cached, relayed or handed to an agent, where TLS to the origin has
     * evaporated.
     */
    const wk = (await call("GET", "/.well-known/village.json")).json;
    expect(wk.supports).toContain(MODULE_USAGE_PROTOCOL);
    expect(wk.links.moduleUsage).toBe("/api/platform/module-usage");

    const report = (await call("GET", wk.links.moduleUsage)).json;
    const pem = wk.publicKey.publicKeyPem;
    expect(verifyDocument(report, pem)).toBe(true);

    // A signature nobody can break is ceremony. Move one number and it fails.
    const cooked = JSON.parse(JSON.stringify(report));
    cooked.modules[0].membersReached += 1;
    expect(verifyDocument(cooked, pem)).toBe(false);
  });

  it("still holds the ledger invariants after all of it", async () => {
    expect((await call("GET", "/health")).status).toBe(200);
    /*
     * Per token, SUM(balance) over all accounts is zero. This is the reading
     * `assertLedgerBalanced` performs at boot (`server/lib/ledger.ts`), copied
     * character for character including `HAVING SUM(balance) <> 0`, so a row
     * coming back IS a violation and an empty result is the invariant holding.
     *
     * Asserted here because the meter is the first thing in a long time to sit
     * on the request path of every module route, and the one thing it must
     * never do is move value. This says it did not start to.
     */
    const [rows]: any = await pool.query( // module-review-ok: the reconciliation read the boot invariant performs, asserted here from the outside
      "SELECT token_type, SUM(balance) s FROM token_balances GROUP BY token_type HAVING SUM(balance) <> 0",
    );
    expect(rows).toEqual([]);
  });
});
