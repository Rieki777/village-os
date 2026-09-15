/**
 * A member who joins through Google is on the roll, and votes.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `server/routes/authGoogle.ts` creates a new Google member with
 * `passwordHash: ""`, on purpose: sign-in is by Google until they choose to set
 * a password. `buildElectorate` in server/index.ts built every ballot roll from
 * members with a truthy `passwordHash`, so every member who joined that way was
 * silently left off every frozen electorate. Nobody was told; the vote simply
 * ran without them. The fix is one predicate, `isPresentMember` in
 * server/lib/memberPresence.ts, used by every roll and roster.
 *
 * ── WHAT THIS PROVES, AGAINST THE BUILT SERVER ──────────────────────────────
 *
 *  1. The member is created through the REAL Google path (start, callback,
 *     exchange), with a local stand-in playing Google's token endpoint exactly
 *     as authGoogle.routes.e2e.test.ts does, and the row really has an empty
 *     hash and a link.
 *  2. A ballot opened BEFORE they joined keeps the roll it froze. They are not
 *     on it and cannot vote on it. That is the snapshot law, and it is also
 *     what a deploy of this fix does to a ballot already open on a live village.
 *  3. The next ballot's frozen roll carries them, and they cast a vote.
 *  4. CONTROL: an UNCLAIMED account, a founder created by bootstrap who never
 *     used the claim link, is on neither roll. It holds the founder role, so the
 *     capability gate says yes to it and only the credential test keeps it off.
 *  5. The admin weight allocation table lists the Google member and not the
 *     unclaimed account.
 *
 * The cases run IN ORDER. Run the whole file, never a `-t` slice. Run
 * `pnpm build` first. Skips loudly without TEST_DATABASE_URL.
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import mysql from "mysql2/promise";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[googleMemberVote.routes] TEST_DATABASE_URL not set. DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** This suite's windows, checked by scripts/check-e2e-ports.mjs. */
const PORT = 31202 + (process.pid % 400);
const GOOGLE_PORT = 31602 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "google-vote-admin";
const PASSWORD = "GoogleVote123!";
const CLIENT_ID = "vote-client-id.apps.googleusercontent.com";
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;
/** The break-glass address: bootstrap will create this account and nobody will ever claim it. */
const UNCLAIMED_EMAIL = `unclaimed-${PORT}@example.test`;

let child: ChildProcess | undefined;
let googleServer: http.Server | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let annaId = "";
let unclaimedId = "";
let googleToken = "";
let googleId = "";
let beforeBallotId = "";
let beforeCount = 0;

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

/** Who a ballot's frozen roll actually holds, read from the table `openBallot` writes. */
async function rollOf(ballotId: string): Promise<string[]> {
  const [rows] = await pool.query<any[]>("SELECT user_id FROM ballot_electorate WHERE ballot_id = ?", [ballotId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  return rows.map((r) => String(r.user_id));
}

let nextClaims: Record<string, unknown> | null = null;

function startGoogleStandIn(): Promise<void> {
  googleServer = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(nextClaims ?? {})).toString("base64url");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "stand-in", id_token: `${header}.${payload}.stand-in-signature` }));
    });
  });
  return new Promise((resolve) => googleServer!.listen(GOOGLE_PORT, "127.0.0.1", () => resolve()));
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the Google member vote test.`);
  }
  await startGoogleStandIn();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-google-vote-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler: see authGoogle.routes.e2e.test.ts for why.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      FRONTEND_URL: BASE,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "google-vote-token-secret", // a throwaway signing key for a server this file starts and kills
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: "vote-client-secret",
      GOOGLE_TOKEN_ENDPOINT: `http://127.0.0.1:${GOOGLE_PORT}/token`,
      // Pinned, because this spreads process.env: a developer's own values would
      // move the redirect URI or hand these members the founder role.
      GOOGLE_REDIRECT_URI: "",
      FOUNDER_EMAILS: "",
      BREAK_GLASS_ADMIN_EMAIL: UNCLAIMED_EMAIL,
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
      if ((await fetch(`${BASE}/health`)).ok) break; // module-review-ok: the boot poll against the local test server
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  // The founder, claimed: a password member with the admin role.
  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Vote Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // An ordinary password member at the member stage.
  const reg = await call("POST", "/api/auth/register", {
    body: { name: "Anna Vale", email: `anna-${PORT}@example.test`, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(reg.status, "Anna registers").toBe(200);
  annaId = String(reg.json?.user?.id ?? "");
  expect((await call("PUT", `/api/admin/players/${annaId}/stage`, { body: { stageId: "member" } })).status).toBe(200);

  const on = await call("PUT", "/api/admin/modules/governance/lifecycle", { body: { lifecycle: "members", examples: false } });
  expect(on.status, JSON.stringify(on.json)).toBe(200);
});

afterAll(async () => {
  child?.kill();
  googleServer?.close();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a member who joins through Google is on the roll", () => {
  it("CONTROL SETUP: bootstrap creates an unclaimed founder, with no hash and no link", async () => {
    const r = await call("POST", "/api/admin/bootstrap", {
      body: { password: ADMIN, email: UNCLAIMED_EMAIL, name: "Unclaimed Founder" },
      token: null,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const [rows] = await pool.query<any[]>("SELECT id, password_hash, prefs, role FROM users WHERE email = ?", [UNCLAIMED_EMAIL]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows).toHaveLength(1);
    unclaimedId = String(rows[0].id);
    expect(rows[0].password_hash).toBe("");
    expect(JSON.stringify(rows[0].prefs ?? null)).not.toContain("googleLink");
    // The founder role means the capability gate answers yes for ballot.vote.
    // Only the credential test can keep this account off a roll.
    expect(rows[0].role).toBe("founder");
  });

  it("a ballot opened before the Google member joins freezes a roll without them", async () => {
    const asked = await call("POST", "/api/governance/advisory", { body: { question: "Would we want a second compost bay?" } });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    beforeBallotId = String(asked.json?.ballot?.id ?? "");
    beforeCount = Number(asked.json?.ballot?.electorateCount);
    const roll = await rollOf(beforeBallotId);
    expect(roll).toContain(annaId);
    expect(roll, "the unclaimed founder is not on the roll").not.toContain(unclaimedId);
    expect(roll.length).toBe(beforeCount);
  });

  it("the Google path creates a member with an empty password hash and a link", async () => {
    const start = await fetch(`${BASE}/api/auth/google/start`, { redirect: "manual" });
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location")!);
    const state = location.searchParams.get("state")!;
    nextClaims = {
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: location.searchParams.get("nonce"),
      sub: "google-sub-voter",
      email: `gina-${PORT}@example.test`,
      email_verified: true,
      name: "Gina Hart",
    };
    const cb = await fetch(`${BASE}/api/auth/google/callback?code=a-code&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    expect(cb.status).toBe(302);
    const cookie = (cb.headers.getSetCookie?.() ?? [])
      .map((c) => /(?:^|;\s*)village_oauth_handoff=([^;]*)/.exec(c)?.[1])
      .find((v) => v && v.length > 0);
    expect(cookie, "the callback hands over a handoff cookie").toBeTruthy();
    const ex = await fetch(`${BASE}/api/auth/google/exchange`, {
      method: "POST",
      headers: { cookie: `village_oauth_handoff=${cookie}` },
    });
    expect(ex.status).toBe(200);
    const body = await ex.json();
    googleToken = String(body.token ?? "");
    googleId = String(body.user?.id ?? "");
    expect(googleToken).toBeTruthy();

    // The exact shape that the old filter read as nobody.
    const [rows] = await pool.query<any[]>("SELECT password_hash, prefs FROM users WHERE id = ?", [googleId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(rows[0].password_hash).toBe("");
    const prefs = typeof rows[0].prefs === "string" ? JSON.parse(rows[0].prefs) : rows[0].prefs;
    expect(prefs?.googleLink?.sig, "the member carries a signed Google link").toBeTruthy();

    expect((await call("PUT", `/api/admin/players/${googleId}/stage`, { body: { stageId: "member" } })).status).toBe(200);
  });

  it("the ballot already open keeps the roll it froze: they are not on it and cannot vote on it", async () => {
    expect(await rollOf(beforeBallotId)).not.toContain(googleId);
    const seen = await call("GET", `/api/governance/ballots/${beforeBallotId}`, { token: googleToken });
    expect(seen.status).toBe(200);
    expect(Number(seen.json?.electorateCount)).toBe(beforeCount);
    expect(seen.json?.myWeight ?? null).toBeNull();
    const refused = await call("POST", `/api/governance/ballots/${beforeBallotId}/vote`, { token: googleToken, body: { choice: "yes" } });
    expect(refused.status).not.toBe(200);
    expect(String(refused.json?.error ?? "")).toContain("roll");

    const gone = await call("POST", `/api/governance/ballots/${beforeBallotId}/withdraw`, { body: { reason: "Asked again below." } });
    expect(gone.status, JSON.stringify(gone.json)).toBe(200);
  });

  it("A MEMBER WHO JOINED THROUGH GOOGLE IS ON THE NEXT FROZEN ROLL, AND VOTES", async () => {
    const asked = await call("POST", "/api/governance/advisory", { body: { question: "Would we want the tool shed painted?" } });
    expect(asked.status, JSON.stringify(asked.json)).toBe(200);
    const ballotId = String(asked.json?.ballot?.id ?? "");
    const roll = await rollOf(ballotId);

    expect(roll, "the Google member is on the frozen roll").toContain(googleId);
    expect(Number(asked.json?.ballot?.electorateCount)).toBe(beforeCount + 1);
    expect(roll, "the unclaimed founder is still off it").not.toContain(unclaimedId);

    const seen = await call("GET", `/api/governance/ballots/${ballotId}`, { token: googleToken });
    expect(seen.json?.myWeight, "the Google member sees their own weight").not.toBeNull();

    const voted = await call("POST", `/api/governance/ballots/${ballotId}/vote`, { token: googleToken, body: { choice: "yes" } });
    expect(voted.status, JSON.stringify(voted.json)).toBe(200);
    const [votes] = await pool.query<any[]>("SELECT choice FROM ballot_votes WHERE ballot_id = ? AND user_id = ?", [ballotId, googleId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(votes.map((v) => v.choice)).toEqual(["yes"]);
  });

  it("the weight allocation table lists the Google member and not the unclaimed account", async () => {
    const r = await call("GET", "/api/admin/governance/weights");
    expect(r.status).toBe(200);
    const ids = (r.json?.members ?? []).map((m: any) => String(m.id));
    expect(ids).toContain(googleId);
    expect(ids).toContain(annaId);
    expect(ids).not.toContain(unclaimedId);
  });
});
