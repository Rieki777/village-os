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
 *   6. The Base RPC endpoint, key in its path, sat in the plain game variable
 *      `tokens.base_rpc_url`. The server boots here over a legacy row, so the
 *      move into the sealed store runs exactly as it does on an upgrade, and
 *      every surface plus the server's own log is read for the key afterwards.
 *
 * Boots dist/index.js against a throwaway schema like every routes suite, and
 * skips loudly without TEST_DATABASE_URL.
 */
import { createHmac } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIER_FLOORS } from "../shared/governanceEngine";
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
/** Everything the server printed, so a test can prove a key never reached the log. */
const serverLogs: string[] = [];
/** The pre-upgrade endpoint, seeded as a plain variable row before the server boots. Fake. */
const LEGACY_KEY = "AuthzLegacyFakeKey0123456789abcd";
const LEGACY_URL = `https://base-mainnet.g.alchemy.com/v2/${LEGACY_KEY}`;
/** The hub's shared header secret, a throwaway for the spawned scratch server. */
const HUB_SECRET = "authz-round-hub-secret"; // module-review-ok: a throwaway value for the spawned scratch server, never a real credential

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
  // A village upgrading with its endpoint still in the plain variable.
  await pool.query( // module-review-ok: the e2e harness seeding its own scratch schema with the pre-upgrade row
    "INSERT INTO game_variables (config_key, value, value_type) VALUES ('tokens.base_rpc_url', ?, 'text')",
    [LEGACY_URL],
  );

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
      VILLAGE_SECRETS_KEY: "1f".repeat(32), // module-review-ok: fixture sealing key, same as every e2e suite
      BASE_RPC_URL: "",
      GOVERNANCE_HUB_SECRET: HUB_SECRET,
      HYPHA_VOICE_WEBHOOK_SECRET: "", // R171: this suite sets the voice secret through Admin, Integrations
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = serverLogs;
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

  it("moved the legacy endpoint into the sealed store at boot, and no surface or log carries its key", async () => {
    // The plain row is gone from the table the boot found it in.
    const [left] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM game_variables WHERE config_key = 'tokens.base_rpc_url'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(Number(left[0]?.n)).toBe(0);

    // POSITIVE FIRST: the admin card holds it, sealed, masked to four characters.
    const integ = await call("GET", "/api/admin/integrations");
    expect(integ.status, integ.text).toBe(200);
    const st = (integ.json?.secrets as any[]).find((s) => s.key === "base_rpc_url");
    expect(st).toMatchObject({ configured: true, source: "admin", last4: "abcd", atRest: "sealed", unreadable: false });
    expect((integ.json?.cards as any[]).some((c) => c.key === "base_rpc_url"), "the endpoint has a card").toBe(true);

    // Only now does an absence mean anything.
    for (const [route, token] of [
      ["/api/admin/integrations", founderToken],
      ["/api/admin/variables", founderToken],
      ["/api/game/mechanics", ""],
      ["/api/game/mechanics/history", ""],
      ["/api/game/pulse", ""],
    ] as const) {
      const r = await call("GET", route, undefined, token);
      expect(r.status, route).toBe(200);
      expect(r.text, route).not.toContain(LEGACY_KEY);
    }

    // The move is on the public record, with its values kept private.
    const feed = await call("GET", "/api/game/mechanics/history", undefined, "");
    expect(feed.text).not.toContain("alchemy");
    const row = (feed.json as any[]).find((h) => h.key === "tokens.base_rpc_url");
    expect(row, "the move is on the record").toBeTruthy();
    expect(row.withheld).toBe(true);
    expect(row.from).toBe("");

    // And the server printed the move without printing the key.
    expect(serverLogs.join("")).toContain("base_rpc_url");
    expect(serverLogs.join("")).not.toContain(LEGACY_KEY);
  });

  it("the variables door refuses an endpoint, and names where it goes instead", async () => {
    const set = await call("PUT", "/api/admin/variables/tokens.base_rpc_url", { value: KEY_URL });
    expect(set.status, set.text).toBe(400);
    expect(set.text).toContain("Integrations");
    expect(set.text).not.toContain("AuthzRoundKey");
  });

  it("an endpoint saved in Integrations is sealed on disk and reads back masked", async () => {
    const put = await call("PUT", "/api/admin/integrations/base_rpc_url", { value: KEY_URL });
    expect(put.status, put.text).toBe(200);
    expect(put.text).not.toContain("AuthzRoundKey");
    const st = (put.json?.secrets as any[]).find((s) => s.key === "base_rpc_url");
    expect(st).toMatchObject({ configured: true, source: "admin", last4: "cdef", atRest: "sealed" });
    const [doc] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = 'integration-secrets'"); // module-review-ok: the e2e harness reading its own scratch schema
    expect(JSON.stringify(doc)).toContain("ciphertext");
    expect(JSON.stringify(doc)).not.toContain("AuthzRoundKey");
    const vars = await call("GET", "/api/admin/variables");
    expect(vars.text).not.toContain("AuthzRoundKey");
    expect(serverLogs.join("")).not.toContain("AuthzRoundKey");
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

  // The subject used to be tokens.base_rpc_url, the one dial marked `withheld`.
  // It is a sealed integration secret now (#719, then #700), so it is no dial
  // at all and cannot be proposed (the next test). The rule this test holds is
  // the general one: a founder-held dial may be proposed, and a value that
  // looks like a credential is withheld from strangers whichever dial carries
  // it (`withheldFromPublic` in shared/gameVariables.ts). governance.hub_url is
  // founder-held and takes a URL, which is exactly where a key can ride.
  it("a founder-held dial may be proposed (Rye, 2026-09-25), and a credential in its value still reaches no stranger", async () => {
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "Point at a new hub", rationale: "Anyone may propose any dial; a key in the value stays private.",
      changes: [{ key: "governance.hub_url", to: "https://hub.example.test/listen?token=AuthzRoundKeyTwo0123456789" }],
    });
    expect(made.status, made.text).toBe(200);
    const list = await call("GET", "/api/game/mechanics/proposals", undefined, "");
    expect(list.status).toBe(200);
    expect(list.text).toContain("Point at a new hub");
    expect(list.text).not.toContain("AuthzRoundKeyTwo");
    const doc = await call("GET", `/api/game/mechanics/proposals/${String(made.json?.id)}/document`, undefined, "");
    expect(doc.status, doc.text.slice(0, 300)).toBe(200);
    expect(doc.text).not.toContain("AuthzRoundKeyTwo");
  });

  it("the sealed RPC endpoint is no dial: a change-set naming it is refused, and says where it is kept", async () => {
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "Move the RPC", rationale: "A credential does not belong in the public amendment history.",
      changes: [{ key: "tokens.base_rpc_url", to: "https://base-mainnet.g.alchemy.com/v2/AuthzRoundKeyThree0123456789" }],
    });
    expect(made.status, made.text).toBe(400);
    expect(made.text).toMatch(/Integrations/);
    const list = await call("GET", "/api/game/mechanics/proposals", undefined, "");
    expect(list.text).not.toContain("AuthzRoundKeyThree");
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

describe.skipIf(!DB_CONFIGURED)("the Hypha voice secret, typed into Admin, Integrations (R171)", () => {
  // A founder on a hosted village holds Admin and not the host. The boot check
  // that kept this secret env-only now runs at the write, in both directions.
  const VOICE = "hypha_voice_webhook_secret";
  const OTHER = "riverside_webhook_secret";
  const OWN = "a1".repeat(32);
  const put = (key: string, value: string) => call("PUT", `/api/admin/integrations/${key}`, { value });
  const status = async (key: string) => ((await call("GET", "/api/admin/integrations")).json?.secrets as any[]).find((s) => s.key === key);
  /** A delivery naming no claim: one that verifies stops at "no claim named", before anything settles. */
  const deliver = async (secret: string) => {
    const body = JSON.stringify({ status: "confirmed" });
    const res = await fetch(`${BASE}/api/webhooks/hypha-voice`, { // module-review-ok: the test client dialing the server under test on localhost
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hypha-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
      body,
    });
    return { status: res.status, text: await res.text() };
  };

  afterAll(async () => {
    if (!DB_CONFIGURED) return;
    for (const key of [VOICE, OTHER]) await put(key, "");
  });

  it("has a card, and the receiver has nothing to verify against until it is set", async () => {
    const integ = await call("GET", "/api/admin/integrations");
    expect(integ.status, integ.text).toBe(200);
    expect((integ.json?.cards as any[]).some((c) => c.key === VOICE), "the voice secret has a card").toBe(true);
    expect(await status(VOICE)).toMatchObject({ configured: false, source: "none" });
    expect((await deliver(OWN)).status).toBe(503);
  });

  it("refuses a short value and a copied one at the write, and stores neither", async () => {
    const short = await put(VOICE, "hunter2");
    expect(short.status, short.text).toBe(409);
    expect(short.json?.error).toMatch(/too short/);
    expect((await put(OTHER, OWN)).status).toBe(200);
    const copied = await put(VOICE, OWN);
    expect(copied.status, copied.text).toBe(409);
    expect(copied.json?.error).toMatch(/matches another secret/);
    expect(await status(VOICE)).toMatchObject({ configured: false });
    expect((await put(OTHER, "")).status).toBe(200);
  });

  it("takes a value of its own, sealed, and a delivery signed with it verifies", async () => {
    const saved = await put(VOICE, OWN);
    expect(saved.status, saved.text).toBe(200);
    expect(await status(VOICE)).toMatchObject({ configured: true, source: "admin", atRest: "sealed" });
    expect((await deliver("b2".repeat(32))).status, "the control: any other secret is a bad signature").toBe(401);
    const signed = await deliver(OWN);
    expect(signed.status, signed.text).toBe(400);
    expect(signed.text).toContain("no claim named");
  });

  it("refuses another callback secret that copies it", async () => {
    const copied = await put(OTHER, OWN);
    expect(copied.status, copied.text).toBe(409);
    expect(copied.json?.error).toMatch(/Hypha voice secret/);
    expect((await put(OTHER, "c3".repeat(32))).status, "the control: a value of its own saves").toBe(200);
  });
});

describe.skipIf(!DB_CONFIGURED)("a hub outcome that names no Hypha space (R039)", () => {
  // One hub listener serves many villages, so a delivery about somebody
  // else's space can arrive correctly signed. With a space id recorded, a
  // delivery naming none cannot be checked: it is recorded, and it waits for
  // a person instead of changing a dial on its own.
  const deliver = async (proposalId: string, extra: Record<string, unknown>) => {
    const res = await fetch(BASE + "/api/webhooks/mechanics-governance", { // module-review-ok: the test client dialing the server under test on localhost
      method: "POST",
      headers: { "Content-Type": "application/json", "x-governance-hub-secret": HUB_SECRET },
      body: JSON.stringify({ outcome: "passed", marker: `[gm:${proposalId}]`, ...extra }),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const placeLine = async (): Promise<string | null> => {
    const [rows] = await pool.query<any[]>("SELECT value FROM game_variables WHERE config_key = 'sessions.place_line'"); // module-review-ok: the e2e harness reading its own scratch schema
    return rows[0] ? String(rows[0].value) : null;
  };

  it("holds an unstated outcome for a person, and applies one that names this village's space", async () => {
    expect((await call("PUT", "/api/admin/variables/hypha.space_id", { value: "42" })).status).toBe(200);
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "Meet at the long table", rationale: "The hall is warmer in the dry season.",
      changes: [{ key: "sessions.place_line", to: "Meet at the long table" }],
    });
    expect(made.status, made.text).toBe(200);
    const id = String(made.json?.id);
    const sent = await call("POST", `/api/game/mechanics/proposals/${id}/to-hypha`, {});
    expect(sent.status, sent.text).toBe(200);
    const before = await placeLine();

    const unstated = await deliver(id, { deliveryId: "r039-unstated" });
    expect(unstated.status, JSON.stringify(unstated.json)).toBe(200);
    expect(unstated.json?.status).toBe("passed_verified");
    expect(String(unstated.json?.held)).toMatch(/named no Hypha space/);
    expect(await placeLine(), "nothing changed on an outcome nobody could check").toBe(before);

    const named = await deliver(id, { deliveryId: "r039-named", spaceId: "42" });
    expect(named.status, JSON.stringify(named.json)).toBe(200);
    expect(named.json?.status).toBe("applied");
    expect(await placeLine()).toBe("Meet at the long table");
  });

  it("after launch, any member can ask the village to decide a held outcome, at its highest tier (Rye, 2026-11-06)", async () => {
    // This scratch village has started its Game, so the admin door is shut and
    // the held outcome would otherwise wait forever. The village's own vote
    // lives in the governance module, so it is on here.
    const on = await call("PUT", "/api/admin/modules/governance/lifecycle", { lifecycle: "members", examples: false });
    expect(on.status, on.text).toBe(200);
    const made = await call("POST", "/api/game/mechanics/proposals", {
      title: "Meet by the river", rationale: "Shade in the afternoon.",
      changes: [{ key: "sessions.place_line", to: "Meet by the river" }],
    });
    expect(made.status, made.text).toBe(200);
    const id = String(made.json?.id);
    expect((await call("POST", `/api/game/mechanics/proposals/${id}/to-hypha`, {})).status).toBe(200);
    const held = await deliver(id, { deliveryId: "r039-held-ask" });
    expect(held.json?.status, JSON.stringify(held.json)).toBe("passed_verified");
    expect((await call("POST", `/api/admin/mechanics/proposals/${id}/apply`, {})).status, "the admin door is closed after launch").toBe(409);

    // The village's own door is open to a member on the roll, and the page is told.
    expect((await call("GET", "/api/game/mechanics/standing")).json?.mayAskVillage).toBe(true);
    const asked = await call("POST", `/api/governance/mechanics/${id}/open-ballot`, {});
    expect(asked.status, asked.text).toBe(200);
    const [rows] = await pool.query<any[]>( // module-review-ok: the e2e harness reading its own scratch schema
      "SELECT m.status, b.unity_pct, b.quorum_pct FROM mechanics_proposals m JOIN ballots b ON b.id = m.ballot_id WHERE m.id = ?",
      [id],
    );
    expect(rows[0]?.status).toBe("onsite_vote");
    // The highest tier, never the ordinary mechanics dials (80 and 20 by default).
    expect(Number(rows[0].unity_pct)).toBeGreaterThanOrEqual(TIER_FLOORS.constitutional.unityPct);
    expect(Number(rows[0].quorum_pct)).toBeGreaterThanOrEqual(TIER_FLOORS.constitutional.quorumPct);

    // The vote now under way decides; a late delivery cannot jump it.
    const late = await deliver(id, { deliveryId: "r039-held-late", spaceId: "42" });
    expect(String(late.json?.discarded)).toMatch(/not awaiting an outcome/);
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

describe.skipIf(!DB_CONFIGURED)("a stranger cannot make the village mail one address over and over (R106)", () => {
  // Both public doors send to the address the stranger typed. Bounded per IP
  // only, so anyone could aim the village's own mail at one inbox, with a
  // greeting they chose. Each address now hears from a door three times a day.
  const toRows = async (origin: string, to: string) => {
    const [rows] = await pool.query<any[]>("SELECT body_html FROM comms_messages WHERE origin = ? AND to_email = ?", [origin, to]); // module-review-ok: the e2e harness reading its own scratch schema
    return rows.map((r) => String(r.body_html ?? ""));
  };
  const settle = async (origin: string, to: string, atLeast: number) => {
    for (let i = 0; i < 40 && (await toRows(origin, to)).length < atLeast; i++) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 400));
    return toRows(origin, to);
  };

  it("acknowledges a work-with-us proposal to one address three times a day", async () => {
    const longName = "R".repeat(500);
    for (let i = 0; i < 4; i++) {
      const sent = await call("POST", "/api/forms/submit", {
        type: "work-with-us", data: { name: longName, email: "repeat@example.test", work: `proposal ${i}` },
      }, "");
      expect(sent.status, sent.text).toBe(200);
    }
    const acks = await settle("forms.ack", "repeat@example.test", 3);
    // An acknowledgement is essential mail, so its body is never stored; the
    // greeting's length is held by greetingName's own test (lib/workWithUsAck).
    expect(acks.length, "the fourth acknowledgement is not sent").toBe(3);
  });

  it("sends the investor packet to one address three times a day", async () => {
    expect((await call("PUT", "/api/admin/variables/abuse.investor_docs_per_ip_hourly", { value: "50" })).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      const asked = await call("POST", "/api/investor-docs/request", { name: "Repeat Asker", email: "packet@example.test", accredited: true }, "");
      expect(asked.status, asked.text).toBe(200);
    }
    expect((await settle("investor.packet", "packet@example.test", 3)).length).toBe(3);
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

/*
 * SHEET 19 (Rye, 2026-10-31: "admin access only, for Founders Circle and
 * steward roles"; coordinator, 2026-11-01: Power groups only, founders-circle
 * and steward-circle ON, every other group OFF, no switch on the org seat).
 *
 * Holding a power group whose switch is on opens the admin panel, read live
 * from the holding, and nothing more: the capability gate's admin short-circuit
 * still reads the account's own role. These run last in the file because the
 * final case starts the village's Game.
 */
describe.skipIf(!DB_CONFIGURED)("sheet 19: admin access through a power group", () => {
  const PW = "GroupAdmin123!";
  let sam = { id: "", token: "" };
  let ola = { id: "", token: "" };
  const join = async (name: string, email: string) => {
    const r = await call("POST", "/api/auth/register", { name, email, password: PW, paths: ["resident"] }, "");
    expect(r.status, r.text).toBe(200);
    return { id: String(r.json?.user?.id ?? ""), token: String(r.json?.token ?? "") };
  };
  const hold = (group: string, userId: string, action: "add" | "remove") =>
    call("POST", `/api/admin/roles/${group}/holders`, { userId, action });
  const opensPanel = async (token: string) => (await call("GET", "/api/admin/players", undefined, token)).status === 200;

  it("control: a plain member cannot open the panel, and the profile says so", async () => {
    sam = await join("Sam Steward", "sam-group-admin@example.test");
    ola = await join("Ola Founder", "ola-group-admin@example.test");
    // Steward Circle asks for Member or above, so both are admitted first.
    for (const id of [sam.id, ola.id]) expect((await call("PUT", `/api/admin/players/${id}/stage`, { stageId: "member" })).status).toBe(200);
    expect(await opensPanel(sam.token)).toBe(false);
    expect((await call("GET", "/api/profile", undefined, sam.token)).json?.adminAccess).toBe(false);
  });

  it("the two named groups ship with the switch on, and every other group off", async () => {
    const groups = (await call("GET", "/api/roles")).json;
    const on = (Array.isArray(groups) ? groups : groups?.roles ?? []).filter((g: any) => g.grantsAdmin).map((g: any) => g.id).sort();
    expect(on).toEqual(["founders-circle", "steward-circle"]);
  });

  it("holding Steward Circle opens the panel, and the Players card names the group", async () => {
    expect((await hold("steward-circle", sam.id, "add")).status).toBe(200);
    expect(await opensPanel(sam.token)).toBe(true);
    expect((await call("GET", "/api/profile", undefined, sam.token)).json?.adminAccess).toBe(true);
    const row = (await call("GET", "/api/admin/players")).json.find((p: any) => p.id === sam.id);
    expect(row.adminVia).toEqual(["Steward Circle"]);
    // Admin ACCESS, never the account's role: nothing was written to it.
    expect(row.role).toBe("member");
  });

  it("gives the panel and no power: the capability gate still reads the account's own role", async () => {
    // Steward Circle carries no quest.approve, and an admin account would pass it by short-circuit.
    // (It carried no proposal.decide either until Rye's answer of 2026-11-01 put that on the group.)
    const me = (await call("GET", "/api/game/progression", undefined, sam.token)).json;
    const manage = (me?.capabilityCatalogue ?? []).find((c: any) => c.key === "quest.approve");
    expect(manage, "the catalogue lists the key").toBeTruthy();
    expect(manage?.held).toBe(false);
  });

  it("a holder of the steward ORG seat who is not in Steward Circle gets no admin access", async () => {
    const made = await call("POST", "/api/admin/org/roles", { id: "steward", name: "Village Steward", aim: "Hold the village in trust." });
    expect([200, 409]).toContain(made.status);
    const seated = await call("POST", "/api/admin/org/roles/steward/holders", { userId: ola.id });
    expect(seated.status, seated.text).toBeLessThan(300);
    expect(await opensPanel(ola.token)).toBe(false);
    expect((await call("GET", "/api/profile", undefined, ola.token)).json?.adminAccess).toBe(false);
  });

  it("two groups that both carry the switch are one way in, and losing one keeps the other", async () => {
    expect((await hold("founders-circle", sam.id, "add")).status).toBe(200);
    const row = (await call("GET", "/api/admin/players")).json.find((p: any) => p.id === sam.id);
    expect(row.adminVia).toEqual(["Founders Circle", "Steward Circle"]);
    expect((await hold("founders-circle", sam.id, "remove")).status).toBe(200);
    expect(await opensPanel(sam.token)).toBe(true);
  });

  it("the role ending mid-session closes the panel on the very next request, same token", async () => {
    expect((await hold("steward-circle", sam.id, "remove")).status).toBe(200);
    expect(await opensPanel(sam.token)).toBe(false);
  });

  it("only a founder may switch a group on before launch, and a group admin is not one", async () => {
    expect((await hold("steward-circle", sam.id, "add")).status).toBe(200);
    // An earlier case in this file can leave the village launched, so put it back before launch for this one.
    await pool.query("DELETE FROM app_config WHERE config_key = 'game-start'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const byGroupAdmin = await call("PUT", "/api/admin/roles/treasury/admin-access", { on: true }, sam.token);
    expect(byGroupAdmin.status, byGroupAdmin.text).toBe(403);
  });

  it("the last way in cannot switch its own group off or remove itself", async () => {
    // Start the Game, so the founder role no longer stands and the founder may stand down.
    await pool.query("INSERT IGNORE INTO app_config (config_key, value) VALUES ('game-start', ?)", [JSON.stringify({ startedAt: new Date().toISOString(), ballotId: "e2e", startedBy: "e2e", note: "" })]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const me = (await call("GET", "/api/profile")).json;
    const down = await call("PUT", `/api/admin/users/${me.id}/role`, { role: "member" });
    expect(down.status, down.text).toBe(200);
    // Sam, through Steward Circle, is now the only account that can open the panel.
    const off = await call("PUT", "/api/admin/roles/steward-circle/admin-access", { on: false }, sam.token);
    expect(off.status, off.text).toBe(409);
    expect(off.json.error).toContain("nobody able to open the admin panel");
    // Removing a holder needs proposal.decide, which Steward Circle carries since Rye's answer of
    // 2026-11-01, so Sam reaches the route, and the last-admin guard refuses him taking himself out.
    // The founder, stood down, no longer reaches the route at all.
    const self = await call("POST", "/api/admin/roles/steward-circle/holders", { userId: sam.id, action: "remove" }, sam.token);
    expect(self.status, self.text).toBe(409);
    expect(self.json.error).toContain("nobody able to open the admin panel");
    expect((await hold("steward-circle", sam.id, "remove")).status).toBe(401);
    expect(await opensPanel(sam.token)).toBe(true);
  });
});

describe.skipIf(!DB_CONFIGURED)("an admin route of a module that is off (R102)", () => {
  // Every module's routes mount behind requireModule, and off means 404 for
  // everybody, admins included. These admin routes sat outside their module's
  // mount, so a switched-off shop could still confirm a purchase and a
  // switched-off network could still sync with a peer.
  const OFF: Array<[string, string, string]> = [
    ["GET", "/api/admin/products", "commerce"],
    ["POST", "/api/admin/products/purchases/p-none/confirm", "commerce"],
    ["GET", "/api/admin/crowdpool/status", "crowdpool"],
    ["GET", "/api/admin/network/peers", "network"],
    ["POST", "/api/admin/network/sync", "network"],
    ["POST", "/api/admin/exchange/reconcile", "exchange"],
  ];
  it.each(OFF)("%s %s answers as the off %s module does", async (method, route, module) => {
    const r = await call(method, route, method === "GET" ? undefined : {});
    expect(r.status, `${method} ${route}: ${r.text.slice(0, 200)}`).toBe(404);
    expect(r.json?.error).toBe("module_disabled");
    expect(r.json?.module).toBe(module);
  });
});
