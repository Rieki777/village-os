/**
 * The resources routes, against the built server (lane L3).
 *
 * What this suite holds that a unit test cannot:
 *
 *  - The module gate: off and preview answer the BYTE-identical 404, so an
 *    outsider cannot tell "off" from "not yours yet" (harm metric c).
 *  - The tiers on the wire: a member sees village rules plus holders rules
 *    for seats they actually hold; a stranger sees names and kinds with no
 *    amounts; declared rules never leak past their visibility.
 *  - One ask, one proposal (harm metric b): POST /api/resources/requests
 *    hands back a pre-fill, ONE POST /api/forum/threads writes ONE decision
 *    thread carrying the resourcesRequest meta, and the same ask again
 *    answers 409 while that thread stays open.
 *  - Nothing moves (harm metric a, live): the ledger and fiat_charges hold
 *    the same row counts after the whole exercise as before it.
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
  console.warn("[resources.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 25202 + (process.pid % 800);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "resources-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";

// Nia holds the Kitchen's cook seat; Omar holds nothing; Pia speaks for a
// second circle (the Garden) and so is a declarer for it and nothing else.
let niaToken = "";
let niaId = "";
let omarToken = "";
let piaToken = "";

let ledgerRowsBefore = 0;
let fiatRowsBefore = 0;

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON stays visible through text */
  }
  return { status: res.status, json, text };
}

async function register(name: string, slug: string): Promise<{ token: string; id: string }> {
  const r = await call(
    "POST",
    "/api/auth/register",
    { name, email: `${slug}-${PORT}@example.test`, password: "ResourcesTest123!", paths: ["resident"] },
    "",
  );
  expect(r.status, `${name} must register`).toBe(200);
  return { token: String(r.json?.token ?? ""), id: String(r.json?.user?.id ?? "") };
}

async function countRows(table: string): Promise<number> {
  const [rows] = await pool.query<any[]>(`SELECT COUNT(*) AS n FROM \`${table}\``); // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
  return Number(rows[0].n);
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the resources route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-resources-"));
  testDb = await provisionTestDb();
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
      AUTH_TOKEN_SECRET: "resources-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
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
    password: ADMIN, email: `founder-${PORT}@example.test`, name: "Resources Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "ResourcesTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // Resources requires map and recommends forum; turn the lot on.
  const mods = await call("GET", "/api/admin/modules");
  for (const m of mods.json?.modules ?? []) {
    if (m.core) continue;
    await call("PUT", `/api/admin/modules/${m.id}/lifecycle`, { lifecycle: "public" });
  }

  // The village: one circle, one seat, one holder.
  const kitchen = await call("POST", "/api/admin/circles", { name: "Kitchen" });
  expect(kitchen.status, "the Kitchen must exist").toBe(200);
  const garden = await call("POST", "/api/admin/circles", { name: "Garden" });
  expect(garden.status, "the Garden must exist").toBe(200);

  const nia = await register("Nia Sol", "nia");
  niaToken = nia.token;
  niaId = nia.id;
  const omar = await register("Omar Rios", "omar");
  omarToken = omar.token;
  const pia = await register("Pia Vega", "pia");
  piaToken = pia.token;

  // Opening a decision takes proposal.open (co-creator); Omar stays member.
  for (const [id, stage] of [
    [niaId, "co-creator"],
    [omar.id, "member"],
    [pia.id, "member"],
  ] as const) {
    const granted = await call("PUT", `/api/admin/players/${id}/stage`, { stageId: stage });
    expect(granted.status, `stage grant for ${id}`).toBe(200);
  }

  // The seat plane is raw SQL on purpose (0049: not a dbCollection). Pia's
  // Garden seat is flagged represents_circle, the one narrow bridge that
  // makes a non-admin a declarer, for the Garden and nothing else (0083).
  await pool.query( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "INSERT INTO org_roles (id, circle_id, name, seats, active) VALUES ('seat-cook', 'kitchen', 'Cook', 1, 1)",
  );
  await pool.query( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key) VALUES ('asg-cook-nia', 'seat-cook', 'member', ?, ?)",
    [niaId, niaId],
  );
  await pool.query( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "INSERT INTO org_roles (id, circle_id, name, seats, active, represents_circle) VALUES ('seat-garden-voice', 'garden', 'Garden voice', 1, 1, 1)",
  );
  await pool.query( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
    "INSERT INTO org_role_assignments (id, org_role_id, holder_kind, user_id, holder_key) VALUES ('asg-garden-pia', 'seat-garden-voice', 'member', ?, ?)",
    [pia.id, pia.id],
  );

  ledgerRowsBefore = await countRows("token_ledger");
  fiatRowsBefore = await countRows("fiat_charges");
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  await testDb?.drop();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* gone */
  }
});

describe.skipIf(!DB_CONFIGURED)("the resources module", () => {
  it("declares rules, sources and budgets through the admin surface", async () => {
    const village = await call("POST", "/api/admin/resources/rules", {
      scope: "circle", scopeId: "kitchen", amountMinor: 5000, unit: "CHF",
      approval: "none", paidFrom: "circle-budget", visibility: "village",
    });
    expect(village.status, village.text).toBe(200);

    const holders = await call("POST", "/api/admin/resources/rules", {
      scope: "circle", scopeId: "kitchen", amountMinor: 50000, unit: "CHF",
      approval: "circle-consent", paidFrom: "treasury", visibility: "holders",
    });
    expect(holders.status, holders.text).toBe(200);

    const roleRule = await call("POST", "/api/admin/resources/rules", {
      scope: "role", scopeId: "seat-cook", amountMinor: 2000, unit: "CHF",
      approval: "lead", paidFrom: "circle-budget", visibility: "holders",
    });
    expect(roleRule.status, roleRule.text).toBe(200);

    // Village-visible but Kitchen-scoped: everyone reads it, only a Kitchen
    // seat can ask under it. The pair below proves 403 and 404 differ.
    const bigAsk = await call("POST", "/api/admin/resources/rules", {
      scope: "circle", scopeId: "kitchen", amountMinor: 300000, unit: "CHF",
      approval: "founders", paidFrom: "treasury", visibility: "village",
    });
    expect(bigAsk.status, bigAsk.text).toBe(200);

    // R28's spirit on the wire: other without its note is a sentence, not a row.
    const bare = await call("POST", "/api/admin/resources/sources", { name: "The bakery", kind: "other" });
    expect(bare.status).toBe(400);
    expect(String(bare.json?.error)).toContain("note");

    const stays = await call("POST", "/api/admin/resources/sources", { name: "Guest stays", kind: "stays", sharePct: 40 });
    expect(stays.status, stays.text).toBe(200);

    const budget = await call("POST", "/api/admin/resources/budgets", {
      circleId: "kitchen", amountMinor: 120000, unit: "CHF",
    });
    expect(budget.status, budget.text).toBe(200);

    // The standing budget upserts in place: same circle, same unit, one row.
    const again = await call("POST", "/api/admin/resources/budgets", {
      circleId: "kitchen", amountMinor: 150000, unit: "CHF",
    });
    expect(again.status).toBe(200);
    const [budgetRows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT amount_minor FROM circle_budgets WHERE circle_id = 'kitchen' AND unit = 'CHF'",
    );
    expect(budgetRows.length, "one standing envelope per circle and unit").toBe(1);
    expect(Number(budgetRows[0].amount_minor)).toBe(150000);
  });

  it("shows each tier its own picture and nothing more (harm metric c)", async () => {
    // Nia holds the cook seat: village rule, the Kitchen holders rule, her role rule.
    const nia = await call("GET", "/api/resources", undefined, niaToken);
    expect(nia.status).toBe(200);
    expect(nia.json.tier).toBe("member");
    const niaRules = (nia.json.rules as any[]).map((r) => `${r.visibility}:${r.scope}`).sort();
    expect(niaRules).toEqual(["holders:circle", "holders:role", "village:circle", "village:circle"]);

    // Omar holds nothing: the two village rules alone.
    const omar = await call("GET", "/api/resources", undefined, omarToken);
    expect(omar.status).toBe(200);
    expect((omar.json.rules as any[]).length).toBe(2);
    expect((omar.json.rules as any[]).every((r) => r.visibility === "village")).toBe(true);

    // A stranger with the public structure on: names and kinds, no numbers.
    await call("PUT", "/api/admin/variables/map.public_structure", { value: "true" });
    const stranger = await call("GET", "/api/resources", undefined, "");
    expect(stranger.status).toBe(200);
    expect(stranger.json.tier).toBe("public");
    expect(stranger.json.rules).toEqual([]);
    expect(stranger.json.budgets).toEqual([]);
    expect(stranger.json.measured).toBeNull();
    expect(stranger.json.sources).toEqual([{ name: "Guest stays", kind: "stays" }]);
    expect(stranger.text.includes("amountMinor"), "no amounts reach a stranger").toBe(false);
    expect(stranger.text.includes("sharePct"), "no shares reach a stranger").toBe(false);

    // Public structure off again: a stranger is asked to sign in.
    await call("PUT", "/api/admin/variables/map.public_structure", { value: "false" });
    expect((await call("GET", "/api/resources", undefined, "")).status).toBe(401);
    await call("PUT", "/api/admin/variables/map.public_structure", { value: "true" });
  });

  it("answers the four questions for the person asking", async () => {
    const me = await call("GET", "/api/resources/me", undefined, niaToken);
    expect(me.status).toBe(200);
    expect(me.json.answers.alone[0]).toContain("without asking");
    expect(me.json.answers.withApproval.length).toBeGreaterThan(0);
    expect(me.json.answers.paidFrom[0]).toContain("Kitchen");
    expect(me.json.answers.comesFrom[0]).toContain("Guest stays");
    expect((await call("GET", "/api/resources/me", undefined, "")).status).toBe(401);
  });

  it("turns one ask into exactly one open decision, and refuses the twin (harm metric b)", async () => {
    const holdersRule = ((await call("GET", "/api/resources", undefined, niaToken)).json.rules as any[]).find(
      (r) => r.approval === "circle-consent",
    );
    expect(holdersRule, "the consent rule is visible to its holder").toBeTruthy();

    // A holders rule Omar cannot SEE does not exist for him: 404, the same
    // existence-hiding the messaging suite holds its refusals to.
    const invisible = await call(
      "POST", "/api/resources/requests",
      { ruleId: holdersRule.id, amountMinor: 10000, purpose: "a new oven" },
      omarToken,
    );
    expect(invisible.status).toBe(404);

    // A village-visible rule he can read but holds no seat under: 403, in words.
    const villageRule = ((await call("GET", "/api/resources", undefined, omarToken)).json.rules as any[]).find(
      (r) => r.approval === "founders",
    );
    expect(villageRule, "the big ask is village-visible").toBeTruthy();
    const notYours = await call(
      "POST", "/api/resources/requests",
      { ruleId: villageRule.id, amountMinor: 10000, purpose: "a new oven" },
      omarToken,
    );
    expect(notYours.status).toBe(403);
    expect(String(notYours.json?.error)).toContain("seat");

    // Above the ceiling is a sentence, not a thread.
    const tooMuch = await call(
      "POST", "/api/resources/requests",
      { ruleId: holdersRule.id, amountMinor: 999999, purpose: "a walk-in freezer" },
      niaToken,
    );
    expect(tooMuch.status).toBe(400);

    const ask = await call(
      "POST", "/api/resources/requests",
      { ruleId: holdersRule.id, amountMinor: 20000, purpose: "a new oven" },
      niaToken,
    );
    expect(ask.status, ask.text).toBe(200);
    const prefill = ask.json.prefill;
    expect(prefill.kind).toBe("decision");
    expect(prefill.meta.resourcesRequest.ruleId).toBe(holdersRule.id);

    // The client posts the pre-fill ONCE through the existing primitive.
    const thread = await call("POST", "/api/forum/threads", prefill, niaToken);
    expect(thread.status, thread.text).toBe(200);

    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT id, kind, meta FROM forum_threads WHERE JSON_UNQUOTE(JSON_EXTRACT(meta, '$.resourcesRequest.requestKey')) = ?",
      [ask.json.requestKey],
    );
    expect(rows.length, "exactly one thread carries this ask").toBe(1);
    expect(rows[0].kind).toBe("decision");
    const meta = typeof rows[0].meta === "string" ? JSON.parse(rows[0].meta) : rows[0].meta;
    expect(meta.status).toBe("open");
    expect(meta.resourcesRequest.ruleId).toBe(holdersRule.id);

    // The same ask again, while that thread stays open: 409, pointing home.
    const twin = await call(
      "POST", "/api/resources/requests",
      { ruleId: holdersRule.id, amountMinor: 20000, purpose: "a new oven, again" },
      niaToken,
    );
    expect(twin.status).toBe(409);
    expect(twin.json.threadId).toBe(rows[0].id);

    // A rule that needs no approval sends the asker away with a sentence.
    const aloneRule = ((await call("GET", "/api/resources", undefined, niaToken)).json.rules as any[]).find(
      (r) => r.approval === "none",
    );
    const noNeed = await call(
      "POST", "/api/resources/requests",
      { ruleId: aloneRule.id, amountMinor: 100, purpose: "flour" },
      niaToken,
    );
    expect(noNeed.status).toBe(400);
  });

  it("hides the module bytes-identically at off and preview (harm metric c)", async () => {
    await call("PUT", "/api/admin/modules/resources/lifecycle", { lifecycle: "off" });
    const offAnon = await call("GET", "/api/resources", undefined, "");
    const offMember = await call("GET", "/api/resources", undefined, niaToken);
    expect(offAnon.status).toBe(404);
    expect(offMember.status).toBe(404);
    expect(offAnon.text).toBe(offMember.text);

    await call("PUT", "/api/admin/modules/resources/lifecycle", { lifecycle: "preview" });
    const previewMember = await call("GET", "/api/resources", undefined, niaToken);
    expect(previewMember.status).toBe(404);
    expect(previewMember.text, "off and preview are the same closed door").toBe(offAnon.text);
    expect((await call("GET", "/api/resources")).status, "preview stays open to admins").toBe(200);

    await call("PUT", "/api/admin/modules/resources/lifecycle", { lifecycle: "public" });
  });

  it("gates writes to declarers and validates the vocabulary", async () => {
    const omarWrite = await call(
      "POST", "/api/admin/resources/rules",
      { scope: "circle", scopeId: "kitchen", amountMinor: 1, unit: "CHF", approval: "none", paidFrom: "treasury" },
      omarToken,
    );
    expect(omarWrite.status).toBe(401);

    const badWord = await call("POST", "/api/admin/resources/rules", {
      scope: "circle", scopeId: "kitchen", amountMinor: 1, unit: "CHF", approval: "manager", paidFrom: "treasury",
    });
    expect(badWord.status).toBe(400);

    const otherNoNote = await call("POST", "/api/admin/resources/rules", {
      scope: "circle", scopeId: "kitchen", amountMinor: 1, unit: "CHF", approval: "other", paidFrom: "treasury",
    });
    expect(otherNoNote.status).toBe(400);
    expect(String(otherNoNote.json?.error)).toContain("approvalNote");

    // An admin passes the declare gate, so a ghost circle is a 400 sentence.
    const ghostCircle = await call("POST", "/api/admin/resources/budgets", {
      circleId: "nowhere", amountMinor: 1, unit: "CHF",
    });
    expect(ghostCircle.status).toBe(400);
    expect(String(ghostCircle.json?.error)).toContain("No such circle");
  });

  it("a circle's representative cannot overwrite another circle's rule by its id (BOLA)", async () => {
    // Pia speaks for the Garden, so she may declare Garden rules and only
    // those. She declares one, to prove she is a real declarer.
    const own = await call(
      "POST", "/api/admin/resources/rules",
      { scope: "circle", scopeId: "garden", amountMinor: 1000, unit: "CHF", approval: "none", paidFrom: "circle-budget" },
      piaToken,
    );
    expect(own.status, own.text).toBe(200);

    // A Kitchen rule she has no authority over. Read its id and its amount.
    const kitchenRule = ((await call("GET", "/api/resources", undefined, niaToken)).json.rules as any[]).find(
      (r) => r.scope === "circle" && r.scopeId === "kitchen" && r.approval === "none",
    );
    expect(kitchenRule, "a Kitchen rule exists to target").toBeTruthy();
    const amountBefore = kitchenRule.amountMinor;

    // The attack: pass the Kitchen rule's id, but name the Garden (which she
    // may declare for) as the scope. The destination gate would pass; the
    // stored-row gate must not.
    const tamper = await call(
      "POST", "/api/admin/resources/rules",
      { id: kitchenRule.id, scope: "circle", scopeId: "garden", amountMinor: 999999, unit: "CHF", approval: "none", paidFrom: "treasury" },
      piaToken,
    );
    expect(tamper.status, "the stored row's circle gates the edit").toBe(401);

    // The Kitchen rule is untouched: same amount, still the Kitchen's.
    const [rows] = await pool.query<any[]>( // module-review-ok: a fixture or readback on the scratch schema this suite provisioned
      "SELECT scope_id, amount_minor FROM spending_rules WHERE id = ?",
      [kitchenRule.id],
    );
    expect(rows.length).toBe(1);
    expect(String(rows[0].scope_id)).toBe("kitchen");
    expect(Number(rows[0].amount_minor)).toBe(amountBefore);
  });

  it("moved nothing: the ledger and the charges hold their row counts (harm metric a)", async () => {
    expect(await countRows("token_ledger")).toBe(ledgerRowsBefore);
    expect(await countRows("fiat_charges")).toBe(fiatRowsBefore);
  });
});
