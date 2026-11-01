/**
 * Four authorization holes, each proved closed over HTTP against the BUILT
 * server, because each one lived in a route handler in server/index.ts and a
 * unit test of a helper cannot see whether the route calls it.
 *
 *   1. POST /api/investor-docs/request emailed whatever `email` said, and the
 *      mailer splits on commas: one stranger request, one essential email per
 *      address. Now one address or a 400.
 *   2. POST /api/forms/submit acknowledged a work-with-us proposal the same
 *      way, to `data.email` raw.
 *   3. GET /api/game/mechanics/history is unauthenticated and published a
 *      withheld dial's stored values raw (the RPC key's second door).
 *   4. GET /api/library handed every viewer each item's donor id.
 *   5. PUT /api/admin/capabilities/:capability/holding re-pointed a power the
 *      village already held, with no vote and no glass.
 *
 * Boots dist/index.js against a throwaway schema like every routes suite, and
 * skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  // eslint-disable-next-line no-console
  console.warn("[authzRound.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs.
const PORT = 3010 + (process.pid % 50);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "authz-round-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
let founderToken = "";

async function call(
  method: string,
  route: string,
  body?: unknown,
  token = founderToken,
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialing the server under test on localhost
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

/** How many emails the post office recorded for one origin. Every post writes a row, sent or not. */
async function mailRows(origin: string): Promise<number> {
  const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM comms_messages WHERE origin = ?", [origin]); // module-review-ok: the e2e harness reading its own scratch schema
  return Number(rows[0]?.n ?? 0);
}

/** Fire-and-forget mail lands a moment after the response; wait for it, bounded. */
async function waitForMailRows(origin: string, atLeast: number, ms = 8000): Promise<number> {
  const deadline = Date.now() + ms;
  let n = await mailRows(origin);
  while (n < atLeast && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    n = await mailRows(origin);
  }
  return n;
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the authz round route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-authz-round-"));
  testDb = await provisionTestDb();
  pool = testPool(testDb, { connectionLimit: 4 }); // module-review-ok: the e2e harness scratch-schema pool, the routes-suite shape

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "authz-round-token-secret", // module-review-ok: a throwaway value for the spawned scratch server, never a real credential
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      STRIPE_WEBHOOK_SECRET: "whsec_authzround", // module-review-ok: a throwaway value for the spawned scratch server, never a real credential
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  await waitForHealth({ base: BASE, logs, child });

  const boot = await call("POST", "/api/admin/bootstrap", {
    password: ADMIN,
    email: `founder-${PORT}@example.test`,
    name: "Authz Founder",
  }, "");
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { token: claim, password: "AuthzRoundTest123!" }, "");
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // Room for every request below under the investor door's per-IP cap.
  const roomy = await call("PUT", "/api/admin/variables/abuse.investor_docs_per_ip_hourly", { value: "50" });
  expect(roomy.status, roomy.text).toBe(200);
});

afterAll(async () => {
  child?.kill();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("one public request, one recipient", () => {
  it("the investor door refuses a comma list and writes no mail for it", async () => {
    const list = await call("POST", "/api/investor-docs/request", {
      name: "Stranger", email: "one@example.test,two@example.test,three@example.test", accredited: true,
    }, "");
    expect(list.status, list.text).toBe(400);
    expect(String(list.json?.error)).toContain("does not look right");
    expect(await mailRows("investor.packet")).toBe(0);
  });

  it("the investor door refuses an array, which String() would have joined into a list", async () => {
    const arr = await call("POST", "/api/investor-docs/request", {
      name: "Stranger", email: ["one@example.test", "two@example.test"], accredited: false,
    }, "");
    expect(arr.status, arr.text).toBe(400);
    expect(await mailRows("investor.packet")).toBe(0);
  });

  it("the investor door still answers one real address, with exactly one email", async () => {
    const one = await call("POST", "/api/investor-docs/request", {
      name: "An Investor", email: "investor@example.test", accredited: true,
    }, "");
    expect(one.status, one.text).toBe(200);
    expect(await waitForMailRows("investor.packet", 1)).toBe(1);
  });

  it("the work-with-us acknowledgement goes to one typed address and never to a list", async () => {
    const list = await call("POST", "/api/forms/submit", {
      type: "work-with-us", data: { name: "List Sender", email: "a@example.test,b@example.test,c@example.test", work: "x" },
    }, "");
    // The proposal itself still lands: only the acknowledgement is withheld.
    expect(list.status, list.text).toBe(200);
    const one = await call("POST", "/api/forms/submit", {
      type: "work-with-us", data: { name: "One Sender", email: "proposer@example.test", work: "y" },
    }, "");
    expect(one.status, one.text).toBe(200);
    // The single address's acknowledgement is the sentinel that both have
    // been processed; the list must have added nothing beside it.
    expect(await waitForMailRows("forms.ack", 1)).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailRows("forms.ack")).toBe(1);
    const [rows] = await pool.query<any[]>("SELECT to_email FROM comms_messages WHERE origin = 'forms.ack'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(rows.map((r) => r.to_email)).toEqual(["proposer@example.test"]);
  });
});

describe.skipIf(!DB_CONFIGURED)("the public amendment history", () => {
  const KEY_URL = "https://base-mainnet.g.alchemy.com/v2/AuthzRoundKey0123456789abcdef";

  it("keeps a withheld dial's row and never its value", async () => {
    const set = await call("PUT", "/api/admin/variables/tokens.base_rpc_url", { value: KEY_URL });
    expect(set.status, set.text).toBe(200);

    const feed = await call("GET", "/api/game/mechanics/history", undefined, "");
    expect(feed.status).toBe(200);
    expect(feed.text).not.toContain("AuthzRoundKey");
    expect(feed.text).not.toContain("alchemy");
    const row = (feed.json as any[]).find((h) => h.key === "tokens.base_rpc_url");
    expect(row, "the change is still on the record").toBeTruthy();
    expect(row.withheld).toBe(true);
    expect(row.to).toBe("");
  });

  it("a proposal's credential-shaped value reaches neither the list, the document nor the handoff", async () => {
    const SECRET = "ProposalSecret987";
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "A new place line",
      rationale: "Testing that a value shaped like a credential is not served to strangers.",
      changes: [{ key: "sessions.place_line", to: `Meet by the river https://feed.example.test/x?token=${SECRET}` }],
    });
    expect(made.status, made.text).toBe(200);
    const id = String(made.json?.id ?? "");
    expect(id).toBeTruthy();

    const list = await call("GET", "/api/game/mechanics/proposals", undefined, "");
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(SECRET);
    const mine = (list.json as any[]).find((p) => p.id === id);
    expect(mine?.changes?.[0]?.withheld).toBe(true);

    const doc = await call("GET", `/api/game/mechanics/proposals/${id}/document`, undefined, "");
    expect(doc.status).toBe(200);
    expect(doc.text).not.toContain(SECRET);
    expect(String(doc.json?.markdown)).toContain("kept private");

    const handoff = await call("GET", `/api/game/mechanics/proposals/${id}/handoff`, undefined, "");
    expect(handoff.status).toBe(200);
    expect(handoff.text).not.toContain(SECRET);
  });

  it("a founder-held dial may be proposed (Rye, 2026-09-25), and its withheld value still reaches no stranger", async () => {
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "Move the RPC", rationale: "Anyone may propose any dial; the value stays private.",
      changes: [{ key: "tokens.base_rpc_url", to: "https://base-mainnet.g.alchemy.com/v2/AuthzRoundKeyTwo0123456789" }],
    });
    expect(made.status, made.text).toBe(200);
    const list = await call("GET", "/api/game/mechanics/proposals", undefined, "");
    expect(list.status).toBe(200);
    expect(list.text).not.toContain("AuthzRoundKeyTwo");
    const doc = await call("GET", `/api/game/mechanics/proposals/${String(made.json?.id)}/document`, undefined, "");
    expect(doc.text).not.toContain("AuthzRoundKeyTwo");
  });

  it("an ordinary change still reads in full", async () => {
    const set = await call("PUT", "/api/admin/variables/abuse.investor_docs_per_ip_hourly", { value: "51" });
    expect(set.status, set.text).toBe(200);
    const feed = await call("GET", "/api/game/mechanics/history", undefined, "");
    const row = (feed.json as any[]).find((h) => h.key === "abuse.investor_docs_per_ip_hourly" && h.to === "51");
    expect(row, feed.text.slice(0, 400)).toBeTruthy();
    expect(row.withheld).toBe(false);
  });
});

describe.skipIf(!DB_CONFIGURED)("the public library catalogue", () => {
  it("names no donor and no intake signer to a stranger", async () => {
    const on = await call("PUT", "/api/admin/modules/library/lifecycle", { lifecycle: "public", examples: false });
    expect(on.status, on.text).toBe(200);
    await pool.query( // module-review-ok: the e2e harness seeding its own scratch schema
      "INSERT INTO library_items (id, name, status, credit_value, donor_user_id, intake_signed_by) VALUES (?,?,?,?,?,?)",
      ["lib-authz-1", "A good drill", "available", 40, "user-donor-authz", "user-signer-authz"],
    );
    const pub = await call("GET", "/api/library", undefined, "");
    expect(pub.status, pub.text).toBe(200);
    const item = (pub.json.items as any[]).find((i) => i.id === "lib-authz-1");
    expect(item, "the item is on the public shelf").toBeTruthy();
    expect(pub.text).not.toContain("user-donor-authz");
    expect(pub.text).not.toContain("user-signer-authz");
    expect("donorUserId" in item).toBe(false);

    // The admin shelf still has both, because the keeper needs them.
    const adm = await call("GET", "/api/admin/library");
    expect(adm.status).toBe(200);
    const full = (adm.json.items as any[]).find((i) => i.id === "lib-authz-1");
    expect(full.donorUserId).toBe("user-donor-authz");
  });
});

describe.skipIf(!DB_CONFIGURED)("a power the village holds does not move on an admin's say", () => {
  it("hands intake.moderate to the Steward Circle the first time", async () => {
    const roles = await call("GET", "/api/roles", undefined, "");
    const steward = (roles.json ?? []).find((r: any) => r.id === "steward-circle");
    expect(steward, "the seeded Steward Circle must exist").toBeTruthy();
    const give = await call("PUT", "/api/admin/roles/steward-circle/capabilities", {
      capabilities: [...(steward.capabilities ?? []), "intake.moderate"], grantedEscalations: ["intake.moderate"],
    });
    expect(give.status, give.text).toBe(200);
    const moved = await call("PUT", "/api/admin/capabilities/intake.moderate/holding", { roleId: "steward-circle" });
    expect(moved.status, moved.text).toBe(200);
  });

  it("refuses to write the holding again without the village, and names the ballot", async () => {
    const again = await call("PUT", "/api/admin/capabilities/intake.moderate/holding", { roleId: "steward-circle", note: "re-point" });
    expect(again.status, again.text).toBe(409);
    expect(again.json.requiresOverride).toBe(true);
    expect(again.json.ballotRoute).toBe("/api/governance/power-transfers");
    expect(String(again.json.error)).toContain("village's decision");
    const holding = await call("GET", "/api/admin/capabilities/holding");
    const row = (holding.json.powers as any[]).find((p) => p.capability === "intake.moderate");
    expect(row.heldBy.roleId).toBe("steward-circle");
  });

  it("the hand-back door says the same thing in the same shape", async () => {
    const back = await call("DELETE", "/api/admin/capabilities/intake.moderate/holding");
    expect(back.status, back.text).toBe(409);
    expect(back.json).toMatchObject({ requiresOverride: true, ballotRoute: "/api/governance/power-returns" });
    expect(String(back.json.error)).toContain("Handing a power back");
  });
});
