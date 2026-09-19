/**
 * Introductions over HTTP (round 4, lane L7). Boots the BUILT server against
 * a scratch schema and proves what only a real request can:
 *
 *   1. The module gate: off is a 404 for every /api/intents route; the
 *      dependency graph refuses introductions while messaging is off;
 *      members lifecycle turns the board into a 401 for strangers and public
 *      opens it, first names only.
 *   2. Who may act: a member posts; a fresh guest is refused; the same guest
 *      with an active stay posts.
 *   3. The whole arc: post, match, both accept over the wire, one Messages
 *      thread opens, the platform wrote no message into it, the relay rows
 *      carry source 'introduction'.
 *   4. Harm metric a on the wire: an incognito intent's words and owner name
 *      never appear in ANY response to the counterpart, the admin demand
 *      route included.
 *   5. Harm metric b on the wire: a third member's accept is refused with
 *      nothing written.
 *   6. Harm metric d in the usage table: with no model key configured, every
 *      matcher run wrote a path='deterministic' row for mode='introductions'
 *      and nothing else.
 *
 * Order-dependent (fixtures build on each other): run the whole file, never
 * a -t slice. Skips loudly without TEST_DATABASE_URL.
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
  console.warn("[intents.routes] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** Above every other suite's window (agent holds 9800-10799). */
const PORT = 16300 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "intents-routes-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let ana = { token: "", id: "" };
let ben = { token: "", id: "" };
let cara = { token: "", id: "" };
let nadia = { token: "", id: "" };

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
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
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: "IntentsTest123!", paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the intents route test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-intents-"));
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
      AUTH_TOKEN_SECRET: "intents-routes-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      // No model anywhere: a matcher that reached for one would refuse and
      // write nothing, which is exactly what harm metric d asserts against.
      ANTHROPIC_API_KEY: "",
      PLATFORM_ASSISTANT_KEY: "",
      RESEND_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // Reports the last /health answer and when the server logged that it was
  // listening, and stops at once if the child died. See ./db/e2eBoot.ts.
  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `founder-${PORT}@example.test`, name: "Intents Founder" }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "IntentsTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken).toBeTruthy();

  ana = await register("Ana Ruiz", "ana");
  ben = await register("Ben Cole", "ben");
  cara = await register("Cara Diaz", "cara");
  nadia = await register("Nadia Reyes", "nadia");
  for (const m of [ana, ben, nadia]) {
    expect((await call("PUT", `/api/admin/players/${m.id}/stage`, { stageId: "member" })).status).toBe(200);
  }
}, 240_000);

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("introductions over HTTP", () => {
  it("hides the whole surface while the module is off, and holds the dependency on messaging", async () => {
    expect((await call("GET", "/api/intents/board", undefined, "")).status).toBe(404);
    expect((await call("GET", "/api/intents/mine", undefined, ana.token)).status).toBe(404);
    // The graph refuses introductions while messaging is off.
    const early = await call("PUT", "/api/admin/modules/introductions/lifecycle", { lifecycle: "members" });
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect((await call("PUT", "/api/admin/modules/messaging/lifecycle", { lifecycle: "public" })).status).toBe(200);
    expect((await call("PUT", "/api/admin/modules/introductions/lifecycle", { lifecycle: "members" })).status).toBe(200);
  });

  it("keeps the members lifecycle for members: strangers get a 401, members get the board", async () => {
    expect((await call("GET", "/api/intents/board", undefined, "")).status).toBe(401);
    expect((await call("GET", "/api/intents/board", undefined, ana.token)).status).toBe(200);
  });

  it("lets a member post, refuses a fresh guest, and admits the same guest with an active stay", async () => {
    const posted = await call(
      "POST",
      "/api/intents",
      { kind: "seek", text: "seeking help planning a permaculture food forest", topics: ["food", "land"], tier: "public" },
      ana.token,
    );
    expect(posted.status).toBe(200);
    expect(posted.json?.intent?.id).toBeTruthy();

    const guest = await call("POST", "/api/intents", { kind: "seek", text: "seeking a chess partner" }, cara.token);
    expect(guest.status).toBe(403);

    await pool.query( // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds
      "INSERT INTO stays (id, user_id, accommodation_id, status, arrive_on) VALUES ('sty-cara', ?, 'acc-x', 'active', CURDATE())",
      [cara.id],
    );
    const staying = await call(
      "POST",
      "/api/intents",
      { kind: "seek", text: "seeking a chess partner for slow evenings", topics: ["games"] },
      cara.token,
    );
    expect(staying.status).toBe(200);
  });

  it("walks the whole arc: match on post, both accept, one thread opens, no message written for anyone", async () => {
    const offer = await call(
      "POST",
      "/api/intents",
      { kind: "offer", text: "offering permaculture design help and food forest experience", topics: ["food", "land"] },
      ben.token,
    );
    expect(offer.status).toBe(200);
    expect(offer.json?.proposed, "the matcher proposes on post").toBe(true);

    const anaInbox = await call("GET", "/api/intents/opportunities", undefined, ana.token);
    expect(anaInbox.status).toBe(200);
    const opp = anaInbox.json?.opportunities?.[0];
    expect(opp?.id).toBeTruthy();
    expect(opp?.theirs?.counterpart?.firstName).toBe("Ben");
    expect(opp?.reasons?.length).toBeGreaterThan(0);

    // A third member cannot answer for either of them (harm metric b).
    const intruder = await call("POST", `/api/intents/opportunities/${opp.id}/accept`, {}, nadia.token);
    expect(intruder.status).toBe(403);

    const yes1 = await call("POST", `/api/intents/opportunities/${opp.id}/accept`, {}, ana.token);
    expect(yes1.status).toBe(200);
    expect(yes1.json?.opened).toBe(false);

    const benInbox = await call("GET", "/api/intents/opportunities", undefined, ben.token);
    const benOpp = benInbox.json?.opportunities?.find((o: any) => o.id === opp.id);
    expect(benOpp?.theirAccepted).toBe(true);
    expect(benOpp?.myAccepted).toBe(false);

    const yes2 = await call("POST", `/api/intents/opportunities/${opp.id}/accept`, {}, ben.token);
    expect(yes2.status).toBe(200);
    expect(yes2.json?.opened).toBe(true);
    const conversationId = String(yes2.json?.opportunity?.conversationId ?? "");
    expect(conversationId).toBeTruthy();

    // The thread exists for both, and the platform wrote nothing into it.
    const anaMessages = await call("GET", "/api/messages", undefined, ana.token);
    const thread = anaMessages.json?.conversations?.find((c: any) => c.id === conversationId);
    expect(thread).toBeTruthy();
    const [msgs] = await pool.query<any[]>("SELECT * FROM messages WHERE conversation_id = ?", [conversationId]);
    expect(msgs).toHaveLength(0);

    // The relay rows carry the audit source, one per direction.
    const [relay] = await pool.query<any[]>("SELECT source FROM contact_requests");
    expect(relay).toHaveLength(2);
    expect(relay.every((r: any) => r.source === "introduction")).toBe(true);
  });

  it("never shows an incognito member's words or name to the counterpart, on any route (harm metric a)", async () => {
    const secret = await call(
      "POST",
      "/api/intents",
      {
        kind: "seek",
        text: "quietly seeking a grief companion after a loss",
        topics: ["care", "listening"],
        tier: "incognito",
      },
      nadia.token,
    );
    expect(secret.status).toBe(200);
    const listening = await call(
      "POST",
      "/api/intents",
      { kind: "offer", text: "offering to be a grief companion for anyone seeking one", topics: ["care", "listening"] },
      ana.token,
    );
    expect(listening.status).toBe(200);

    // Somebody got the match: Nadia's run on post, or Ana's. Whichever side
    // the matcher ran for, Ana is the counterpart.
    const anaView = await call("GET", "/api/intents/opportunities", undefined, ana.token);
    const masked = anaView.json?.opportunities?.find((o: any) => o.theirs?.incognito);
    expect(masked, "the incognito match reached Ana's inbox").toBeTruthy();
    for (const [route, token] of [
      ["/api/intents/opportunities", ana.token],
      ["/api/intents/board", ana.token],
      ["/api/intents/mine", ana.token],
      ["/api/intents/admin/demand", founderToken],
      ["/api/intents/board", founderToken],
      // The self-service export rides the same boundary (the security
      // review's finding: a raw row here once leaked the counterpart).
      ["/api/profile/export", ana.token],
    ] as const) {
      const r = await call("GET", route, undefined, token);
      expect(r.status).toBe(200);
      expect(r.text, `${route} must not carry the incognito words`).not.toContain("quietly seeking");
      expect(r.text, `${route} must not carry the incognito why`).not.toContain("after a loss");
    }
    // Ana's masked view names nobody.
    expect(JSON.stringify(masked)).not.toContain("Nadia");
    // Nadia reads her own words in full.
    const nadiaView = await call("GET", "/api/intents/mine", undefined, nadia.token);
    expect(nadiaView.text).toContain("quietly seeking a grief companion");
  });

  it("goes public: the board opens to strangers with first names only, and /api/modules lists the module", async () => {
    expect((await call("PUT", "/api/admin/modules/introductions/lifecycle", { lifecycle: "public" })).status).toBe(200);
    const board = await call("GET", "/api/intents/board", undefined, "");
    expect(board.status).toBe(200);
    const entries: any[] = board.json?.board ?? [];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((b) => b.text.includes("permaculture food forest"))).toBe(true);
    expect(board.text).not.toContain("Ruiz");
    expect(board.text).not.toContain("quietly seeking");

    const modules = await call("GET", "/api/modules", undefined, "");
    expect(modules.status).toBe(200);
    expect((modules.json?.modules ?? []).some((m: any) => m.id === "introductions")).toBe(true);
  });

  it("left only deterministic usage rows: no key, no model, and the metric can prove it (harm metric d)", async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT path, COUNT(*) AS n FROM assistant_usage WHERE mode = 'introductions' GROUP BY path",
    );
    const byPath = Object.fromEntries(rows.map((r: any) => [String(r.path), Number(r.n)]));
    expect(byPath["deterministic"] ?? 0).toBeGreaterThan(0);
    const [[nonDet]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM assistant_usage WHERE mode = 'introductions' AND path <> 'deterministic'",
    );
    expect(Number(nonDet.n)).toBe(0);
  });

  it("keeps acceptance columns empty for rows nobody answered, even after the module's own traffic", async () => {
    const [rows] = await pool.query<any[]>(
      "SELECT a_accepted_at, b_accepted_at, status FROM intent_opportunities WHERE status = 'proposed'",
    );
    for (const r of rows) {
      expect(r.a_accepted_at).toBeNull();
      expect(r.b_accepted_at).toBeNull();
    }
  });
});
