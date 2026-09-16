/**
 * The batch lane, against the BUILT server.
 *
 * Three claims that only a booted process can make good on, and that the
 * DB-backed unit tests in server/lib/synthesisBatch.test.ts cannot:
 *
 *   1. THE SYNCHRONOUS ROUTE IS UNCHANGED. The parse, the evidence rule and
 *      the four writes were extracted into a shared writer so the batch poll
 *      could reuse them. An extraction that quietly changed the admin route's
 *      answer would be the whole lane's worst outcome, because the one thing
 *      it promised was to leave the path a person waits on alone. So this
 *      drives that route over HTTP and reads the response and the rows.
 *
 *   2. THE JOB IS REGISTERED, AND ITS GUARDS ARE EVALUATED WHEN IT RUNS.
 *      `registerJob` captures a function and not a value, and every check in
 *      the closure (the module lifecycle, the game variable) is read at tick
 *      time on purpose: module settings and variables both load AFTER the
 *      registerJob block, so a check hoisted out of the closure reads the
 *      platform default for the life of the process and nothing ever says so.
 *      The only way to catch that is to boot and read what the job wrote.
 *
 *   3. MIGRATION 0082 APPLIED. The runner applies migrations at boot,
 *      fail-loud, so a table that is not there after /health answers is a
 *      migration that did not run.
 *
 * Its own port range, clear of the loop test, the examples routes and the map
 * promise routes. Skips loudly without TEST_DATABASE_URL, like every DB-backed
 * suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[synthesis.batch.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 28002 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "synthesis-batch-admin";

const TRANSCRIPT =
  "We agreed to adopt quiet hours from nine at night, with an exception during harvest week. " +
  "Dana will post the notice on the board before Friday.";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let stub: Server | undefined;
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
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

describe.skipIf(!DB_CONFIGURED)("call synthesis: the batch job and the route it left alone", () => {
  beforeAll(async () => {
    if (!DB_CONFIGURED) return;
    if (!fs.existsSync(DIST)) {
      throw new Error(`${DIST} is missing. Run \`pnpm build\` before the synthesis batch route test.`);
    }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-synthesis-batch-"));
    testDb = await provisionTestDb();
    pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 });

    // Automation ON before the process starts, so the job's FIRST tick (15s
    // after boot) already sees a live module and its answer is about the
    // switch rather than about the module. Enabling it over HTTP afterwards
    // would race that tick and the next one is five minutes away.
    await pool.query(
      "INSERT INTO module_settings (module_id, lifecycle) VALUES ('automation', 'members') " +
        "ON DUPLICATE KEY UPDATE lifecycle = VALUES(lifecycle)",
    );

    // One stub for both shapes of the same API: the synchronous Messages
    // endpoint the admin route posts to, and the batch endpoints the job uses.
    stub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const url = req.url ?? "";
        if (req.method === "POST" && url === "/v1/messages") {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              stop_reason: "end_turn",
              usage: { input_tokens: 2200, output_tokens: 310 },
              content: [{
                type: "text",
                text: JSON.stringify({
                  overview: "Quiet hours were adopted, with a harvest-week exception.",
                  chapters: [{ title: "Quiet hours", startMs: 0 }],
                  decisions: ["Quiet hours from nine at night"],
                  tasks: [
                    // Survives: the quote is verbatim from the tape.
                    { description: "Post the quiet-hours notice", quote: "Dana will post the notice on the board before Friday", timestampMs: 0, roleId: null },
                    // Dropped: nobody ever said this.
                    { description: "Buy a new generator", quote: "we should buy a new generator", timestampMs: 0, roleId: null },
                  ],
                }),
              }],
            }),
          );
        }
        // The job polls with no batches open, so an empty list is the honest
        // answer to anything it asks for here.
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `stub has no route for ${req.method} ${url}` }));
      });
    });
    await new Promise<void>((r) => stub!.listen(0, "127.0.0.1", r));
    const stubUrl = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}`;

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
        DATA_DIR: dataDir,
        DATABASE_URL: testDb.url,
        ADMIN_PASSWORD: ADMIN,
        AUTH_TOKEN_SECRET: "synthesis-batch-token-secret",
        RESEND_API_KEY: "",
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_BASE_URL: stubUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const logs: string[] = [];
    child.stdout?.on("data", (d) => logs.push(String(d)));
    child.stderr?.on("data", (d) => logs.push(String(d)));

    // Reports the last /health answer and when the server logged that it was
    // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
    await waitForHealth({ base: BASE, logs, child });

    // Bootstrap forges the founder and hands back a claim link, never a
    // session. The password gets set through that link, and the set-password
    // response is what carries the token.
    const boot = await call("POST", "/api/admin/bootstrap", {
      password: ADMIN, email: `founder-${PORT}@example.test`, name: "Batch Founder",
    }, "");
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "BatchTest123!" }, "");
    token = String(setPw.json?.token ?? "");
    expect(token, "founder must hold a session").toBeTruthy();
  });

  afterAll(async () => {
    child?.kill();
    await new Promise<void>((r) => (stub ? stub.close(() => r()) : r()));
    await pool?.end();
    await testDb?.drop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("applied 0082, so the batch ledger exists the moment the server answers", async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() " +
        "AND table_name IN ('synthesis_batches', 'synthesis_batch_items')",
    );
    // Sorted here rather than in SQL: the server's collation decides whether
    // an underscore sorts before a letter, and this test is about the tables
    // existing, never about how MySQL orders their names.
    const names = rows.map((r: any) => String(r.t).toLowerCase()).sort();
    expect(names).toEqual(["synthesis_batch_items", "synthesis_batches"]);
  });

  it("still answers the Synthesize button in one request, evidence rule and all", async () => {
    const made = await call("POST", "/api/admin/recordings", {
      title: "Weekly call, quiet hours",
      transcript: TRANSCRIPT,
    });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const recordingId = made.json.recording.id;

    const synth = await call("POST", `/api/admin/recordings/${recordingId}/synthesize`);
    expect(synth.status, JSON.stringify(synth.json)).toBe(200);
    // The shared writer's return, relayed unchanged: one task kept, one
    // dropped for a quote that is not in the tape.
    expect(synth.json.success).toBe(true);
    expect(synth.json.tasks).toBe(1);
    expect(synth.json.dropped).toBe(1);
    expect(String(synth.json.synthesisId)).toMatch(/^syn-/);

    const [synths] = await pool.query<any[]>(
      "SELECT id, ai_body, body, model, dropped_task_count FROM call_syntheses WHERE recording_id = ?",
      [recordingId],
    );
    expect(synths).toHaveLength(1);
    expect(synths[0].id).toBe(synth.json.synthesisId);
    expect(synths[0].model).toBe("claude-haiku-4-5-20251001");
    expect(Number(synths[0].dropped_task_count)).toBe(1);
    // Write-once ai_body, seeded equal to body at INSERT.
    expect(synths[0].ai_body).toContain("Quiet hours were adopted");
    expect(synths[0].body).toBe(synths[0].ai_body);

    const [tasks] = await pool.query<any[]>(
      "SELECT description, quote FROM call_tasks WHERE synthesis_id = ?",
      [synth.json.synthesisId],
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Post the quiet-hours notice");

    const [recs] = await pool.query<any[]>("SELECT status FROM recordings WHERE id = ?", [recordingId]);
    expect(recs[0].status).toBe("synthesized");

    // And the cost of that call was recorded, on the path a person waits on.
    // `loop` and not `batch`: this one paid full price for an answer now, and
    // the rollup must never hand it the batch discount.
    const [usage] = await pool.query<any[]>("SELECT mode, input_tokens, path FROM assistant_usage WHERE mode = 'synthesize'");
    expect(usage.length).toBeGreaterThanOrEqual(1);
    expect(Number(usage[0].input_tokens)).toBe(2200);
    expect(usage[0].path).toBe("loop");
  });

  it("registers synthesis-batch-poll and reads the switch when it runs, not when it is registered", async () => {
    // The scheduler's first tick lands 15s after boot. If the variable were
    // read at registration time it would still be the platform default, and
    // the answer would look the same — which is why this also asserts the
    // module check passed: 'automation module off' here would mean the
    // lifecycle was captured before loadModuleSettings ran.
    const deadline = Date.now() + 120_000;
    let result = "";
    for (;;) {
      const [rows] = await pool.query<any[]>(
        "SELECT last_result FROM scheduled_jobs WHERE job = 'synthesis-batch-poll'",
      );
      result = String(rows[0]?.last_result ?? "");
      if (result) break;
      if (Date.now() > deadline) throw new Error("synthesis-batch-poll never reported a result within 120s");
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Off by default: the village has not opted in, so nothing was submitted
    // and no tokens were spent.
    expect(result).toContain("batching off");
    expect(result).not.toContain("automation module off");
    expect(result).not.toContain("FAILED");

    // Nothing was submitted, so the ledger is empty. The stub would have 404ed
    // a create and the job would have said so.
    const [batches] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM synthesis_batches");
    expect(Number(batches[0].n)).toBe(0);
  });
});
