/**
 * Google sign-in, against the BUILT server, over real HTTP, on a real schema.
 *
 * ── WHY A STAND-IN FOR GOOGLE, AND WHAT IT DOES NOT WEAKEN ──────────────────
 *
 * Nothing here can drive accounts.google.com: there is no browser and no
 * consent screen in a test run. So this suite starts a small HTTP server that
 * plays ONE part, the token endpoint, and points the app at it through
 * `GOOGLE_TOKEN_ENDPOINT` (accepted only for a loopback address, see
 * resolveTokenEndpoint).
 *
 * Everything the app itself does still runs for real: the state signature, the
 * nonce it minted being the nonce that comes back, the audience check, the
 * expiry, the verified-email rule, the account decision, the row write, the
 * handoff cookie, the single-use ledger, and the session token that comes out
 * the far end. The stand-in supplies the one thing this process cannot: a
 * response from Google.
 *
 * WHAT IS THEREFORE UNPROVEN HERE, stated plainly:
 *
 *  1. That a real Google authorization screen redirects back with a usable
 *     code. The /start redirect is asserted to be a correct Google URL with
 *     the right client id, redirect URI, scope, state and nonce, and no
 *     further.
 *  2. That a real Google client id and secret are accepted at the real token
 *     endpoint. That is a credentials question and belongs to whoever
 *     registers the OAuth client.
 *  3. Google's id_token SIGNATURE. The shipped code does not verify it either,
 *     deliberately and for a documented reason (see decodeIdTokenPayload): the
 *     token arrives in the body of the server's own authenticated HTTPS POST.
 *     A stand-in on loopback stands in that same position.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, E2E_BOOT_DEADLINE_MS, waitForPortFree } from "./db/testDb";
import { makeSetPasswordToken, SET_PASSWORD_LINK_REFUSAL, signTokenPayload } from "./lib/memberTokens";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[authGoogle.routes] TEST_DATABASE_URL not set. DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** Its own range, above every other suite's (the highest in use ends at 20100). */
const PORT = 7900 + (process.pid % 400);
const GOOGLE_PORT = 8300 + (process.pid % 400);
/** A second app, with no Google credentials at all, for the degrade case. */
const BARE_PORT = 8700 + (process.pid % 400);
const BASE = `http://localhost:${PORT}`;
const BARE_BASE = `http://localhost:${BARE_PORT}`;
const ADMIN = "google-e2e-admin-password";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret";
/** The server's signing key, and the key the set-password cases below mint their links with. */
const TOKEN_SECRET = "google-e2e-token-secret"; // module-review-ok: a throwaway signing key for a server this file starts and kills

let child: ChildProcess | undefined;
let bareChild: ChildProcess | undefined;
let googleServer: http.Server | undefined;
let testDb: TestDb | undefined;
let bareDb: TestDb | undefined;
let dataDir = "";
let bareDataDir = "";
const logs: string[] = [];

/**
 * What the stand-in will answer next. A test sets this, then drives the
 * callback. `claims` becomes the id_token payload verbatim, so a test can send
 * a token with the wrong audience or an unverified address by writing one.
 */
let nextResponse: { status: number; claims: Record<string, unknown> | null; body?: unknown } = {
  status: 200,
  claims: null,
};
/** What the app sent to the token endpoint, for asserting the exchange itself. */
let lastTokenRequest: Record<string, string> = {};

function idTokenFor(claims: Record<string, unknown>): string {
  // Header and signature are filler: nothing in the shipped path reads them,
  // for the reason documented on decodeIdTokenPayload.
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.stand-in-signature`;
}

function startGoogleStandIn(): Promise<void> {
  googleServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastTokenRequest = Object.fromEntries(new URLSearchParams(body));
      if (nextResponse.status !== 200) {
        res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(nextResponse.body ?? { error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "stand-in-access-token",
          id_token: nextResponse.claims ? idTokenFor(nextResponse.claims) : "not-a-jwt",
        }),
      );
    });
  });
  return new Promise((resolve) => googleServer!.listen(GOOGLE_PORT, "127.0.0.1", () => resolve()));
}

async function waitForHealth(base: string, tag: string): Promise<void> {
  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`${tag} did not start in ${E2E_BOOT_DEADLINE_MS / 1000}s:\n${logs.join("")}`);
    }
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the Google sign-in route test.`);
  }
  await startGoogleStandIn();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-google-"));
  bareDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-nogoogle-"));
  testDb = await provisionTestDb();
  bareDb = await provisionTestDb();

  const shared = {
    ...process.env,
    NODE_ENV: "production",
    ADMIN_PASSWORD: ADMIN,
    AUTH_TOKEN_SECRET: TOKEN_SECRET,
    RESEND_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    // PINNED, because this suite spreads process.env and vitest loads .env into
    // it. Every one of these changes what the assertions below mean, and a
    // developer setting one for their own work would move this suite without
    // touching it. GOOGLE_REDIRECT_URI would replace the address derived from
    // FRONTEND_URL and break the redirect_uri assertion. FOUNDER_EMAILS would
    // hand the founder role to the ordinary members these tests create, which
    // would pass quietly until somebody read the role.
    GOOGLE_REDIRECT_URI: "",
    FOUNDER_EMAILS: "",
  };

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...shared,
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
      FRONTEND_URL: BASE,
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_TOKEN_ENDPOINT: `http://127.0.0.1:${GOOGLE_PORT}/token`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  // The same image with NO Google variables. This is the state every one of
  // the thirteen villages boots in before its founder configures anything.

  // Refuse a port a stranger is already holding, and wait out the previous
  // suite's server if it has not let go yet. The boot poll below breaks on ANY
  // 200 on this port, so without this an orphan answers it and the whole
  // scenario runs against the wrong server. See waitForPortFree in ./db/testDb.
  await waitForPortFree(BARE_PORT);
  bareChild = spawn(process.execPath, [DIST], {
    env: {
      ...shared,
      PORT: String(BARE_PORT),
      // No background scheduler. It arms `setTimeout(tick, 15s)` at boot, and on
      // that first tick every job with no scheduled_jobs row is due, so 28 jobs run
      // in series against the scratch schema this suite is asserting on. Every e2e
      // file in the suite outlives 15 seconds of server uptime under load and none
      // under it alone, which is an unrecorded wall-clock deadline on 40 suites.
      // server/synthesisBatch.routes.e2e.test.ts leaves it armed, because the tick
      // is its subject.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: bareDataDir,
      DATABASE_URL: bareDb.url,
      FRONTEND_URL: BARE_BASE,
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bareChild.stdout?.on("data", (d) => logs.push(String(d)));
  bareChild.stderr?.on("data", (d) => logs.push(String(d)));

  await waitForHealth(BASE, "server");
  await waitForHealth(BARE_BASE, "bare server");
});

afterAll(async () => {
  child?.kill();
  bareChild?.kill();
  googleServer?.close();
  await testDb?.drop();
  await bareDb?.drop();
  for (const d of [dataDir, bareDataDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

/** Ask /start and read back the state and nonce the server actually minted. */
async function beginSignIn(next?: string): Promise<{ state: string; nonce: string; location: URL }> {
  const url = `${BASE}/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const res = await fetch(url, { redirect: "manual" });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!);
  return {
    state: location.searchParams.get("state")!,
    nonce: location.searchParams.get("nonce")!,
    location,
  };
}

const claimsFor = (over: Record<string, unknown>) => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 600,
  ...over,
});

/** Drive the callback and hand back its redirect and its handoff cookie. */
async function callback(state: string, code = "an-authorization-code") {
  const res = await fetch(
    `${BASE}/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { redirect: "manual" },
  );
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const handoff = setCookie
    .map((c) => /(?:^|;\s*)village_oauth_handoff=([^;]*)/.exec(c)?.[1])
    .find((v) => v && v.length > 0);
  return { res, location: res.headers.get("location") ?? "", cookie: handoff ?? null, setCookie };
}

async function exchange(cookie: string | null) {
  return fetch(`${BASE}/api/auth/google/exchange`, {
    method: "POST",
    headers: cookie ? { cookie: `village_oauth_handoff=${cookie}` } : {},
  });
}

/** Poll the captured child output for a line, so a slow flush is not a failure. */
async function waitForLog(needle: string, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (logs.join("").includes(needle)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!DB_CONFIGURED)("a village with no Google credentials degrades honestly", () => {
  it("says so on /api/auth/methods, and names what is missing", async () => {
    // `missing` is here because `google: false` on its own read exactly the
    // same whether a founder had forgotten one variable or all three, and the
    // founder who needs to know is by definition the one who cannot sign in
    // yet. It cost a real round trip on 2026-08-31: three variables were set,
    // Google stayed off, and the only place that said which one was absent was
    // a boot log inside a hosting dashboard.
    //
    // Asserted exactly rather than loosely. A response that grew a field
    // nobody meant to publish is the other half of this endpoint's contract,
    // and the values here are variable NAMES, never values.
    const body = await fetch(`${BARE_BASE}/api/auth/methods`).then((r) => r.json());
    expect(body).toEqual({
      password: true,
      google: false,
      missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      // Published on purpose: the sign-up page reads it. The harness opens the
      // door for this suite (`ProvisionOptions.inviteOnly`), so it reads false.
      inviteOnly: false,
    });
  });

  it("answers 404 on /start instead of redirecting somewhere broken", async () => {
    const res = await fetch(`${BARE_BASE}/api/auth/google/start`, { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("said at boot which methods it has, and named what is missing", async () => {
    expect(await waitForLog("[auth] sign-in methods: email and password. Google is OFF")).toBe(true);
    expect(logs.join("")).toContain("GOOGLE_CLIENT_ID");
  });

  it("keeps the password path working, which is the point of not replacing it", async () => {
    const res = await fetch(`${BARE_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No Google", email: "nogoogle@example.com", password: "a-password-1", paths: [] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBeTruthy();
  });
});

describe.skipIf(!DB_CONFIGURED)("a village WITH credentials offers Google beside the password", () => {
  it("reports both methods", async () => {
    expect(await (await fetch(`${BASE}/api/auth/methods`)).json()).toEqual({ password: true, google: true, inviteOnly: false }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  });

  it("sends the member to Google with the right client, scope, state and nonce", async () => {
    const { location, state, nonce } = await beginSignIn("/admin");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/google/callback`);
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(state).toBeTruthy();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe.skipIf(!DB_CONFIGURED)("the happy path: a new member signs in with Google", () => {
  it("creates the account, hands over a session, and that session is real", async () => {
    const { state, nonce } = await beginSignIn("/quests");
    nextResponse = {
      status: 200,
      claims: claimsFor({
        nonce,
        sub: "google-sub-newcomer",
        email: "Newcomer@Example.com",
        email_verified: true,
        name: "A Newcomer",
      }),
    };
    const { res, location, cookie } = await callback(state);
    expect(res.status).toBe(302);
    expect(location).toBe(`/login?oauth=complete&next=${encodeURIComponent("/quests")}`);
    expect(cookie).toBeTruthy();

    // The exchange really did send this deployment's own client secret and
    // redirect URI to the token endpoint.
    expect(lastTokenRequest.client_id).toBe(CLIENT_ID);
    expect(lastTokenRequest.client_secret).toBe(CLIENT_SECRET);
    expect(lastTokenRequest.redirect_uri).toBe(`${BASE}/api/auth/google/callback`);
    expect(lastTokenRequest.grant_type).toBe("authorization_code");

    const ex = await exchange(cookie);
    expect(ex.status).toBe(200);
    const body = await ex.json();
    expect(body.user.email).toBe("newcomer@example.com");

    // The session token is the proof. A route that refuses strangers must now
    // answer this caller.
    const profile = await fetch(`${BASE}/api/profile`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(profile.status).toBe(200);
    const me = await profile.json();
    expect(me.email).toBe("newcomer@example.com");

    // The link never leaves the server. It is sign-in plumbing carrying the id
    // that names this person at Google, and `prefs` is returned to the account
    // owner and to an admin looking at a member, so it is stripped in
    // publicUser beside the password hash.
    expect(me.prefs?.googleLink).toBeUndefined();
    expect(JSON.stringify(me)).not.toContain("googleLink");
    expect(JSON.stringify(body.user)).not.toContain("googleLink");
    // Positive control: the response really does carry prefs, so the two
    // assertions above are not passing because the whole object is missing.
    expect(me.prefs).toBeDefined();
  });

  it("signs the same person back in without making a second account", async () => {
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({
        nonce,
        sub: "google-sub-newcomer",
        // A changed address at Google. The subject is the identity, so this
        // must still land on the same village account.
        email: "newcomer-changed@example.com",
        email_verified: true,
        name: "A Newcomer",
      }),
    };
    const { cookie } = await callback(state);
    const body = await (await exchange(cookie)).json();
    expect(body.user.email).toBe("newcomer@example.com");
  });
});

describe.skipIf(!DB_CONFIGURED)("the link path", () => {
  it("links a verified Google address to an existing PASSWORD account", async () => {
    const email = "haspassword@example.com";
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Has Password", email, password: "a-password-1", paths: [] }),
    });
    const registered = await reg.json();

    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce, sub: "google-sub-haspassword", email, email_verified: true, name: "Has Password" }),
    };
    const { cookie } = await callback(state);
    const body = await (await exchange(cookie)).json();
    expect(body.user.id).toBe(registered.user.id);

    // Linking must not disturb the credential that was already there.
    const stillWorks = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "a-password-1" }),
    });
    expect(stillWorks.status).toBe(200);
  });

  it("unblocks the account with NO password, which is the founder's state today", async () => {
    // Made the way the founder's account was made: bootstrap creates a founder
    // with an empty password hash and mails a claim link. If the mail never
    // arrives, that account cannot log in and, before this lane, could not ask
    // for a reset either. Google sign-in is now a way back in.
    const email = "locked-out-founder@example.com";
    const boot = await fetch(`${BASE}/api/admin/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: ADMIN, email, name: "Locked Out Founder" }),
    });
    expect(boot.status).toBe(200);
    const bootBody = await boot.json();
    expect(bootBody.emailed).toBe(false); // no provider in this suite, which is the trap

    // The password path is genuinely shut for this account: there is no
    // password that opens it, because there is no hash to match.
    for (const attempt of ["a-guessed-password", " ", "password"]) {
      const cannotLogIn = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: attempt }),
      });
      expect(cannotLogIn.status, `password ${JSON.stringify(attempt)} must not open a hashless account`).toBe(401);
    }

    const { state, nonce } = await beginSignIn("/admin");
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce, sub: "google-sub-founder", email, email_verified: true, name: "Locked Out Founder" }),
    };
    const { cookie } = await callback(state);
    const body = await (await exchange(cookie)).json();
    expect(body.user.id).toBe(bootBody.userId);
    expect(body.user.role).toBe("founder");

    // In, as the founder, with a session that reaches an admin surface.
    const admin = await fetch(`${BASE}/api/admin/content`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(admin.status).toBe(200);
  });

  it("refuses to attach a SECOND Google account to an already linked member", async () => {
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({
        nonce,
        sub: "a-completely-different-google-subject",
        email: "haspassword@example.com",
        email_verified: true,
      }),
    };
    const { location, cookie } = await callback(state);
    expect(location).toBe("/login?oauth=error&reason=already_linked_elsewhere");
    expect(cookie).toBeNull();
  });
});

describe.skipIf(!DB_CONFIGURED)("attacks the callback has to refuse", () => {
  it("refuses a FORGED state, which is the login-CSRF attack", async () => {
    // Without this an attacker drops a victim on this URL holding the
    // attacker's own authorization code, and the victim's browser ends up
    // signed in as, or linked to, the attacker's Google account.
    const { state, nonce } = await beginSignIn();
    nextResponse = { status: 200, claims: claimsFor({ nonce, sub: "s", email: "a@b.com", email_verified: true }) };
    const [payload, sig] = state.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    decoded.next = "/admin";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;

    const good = await callback(state); // positive control: the untampered one works
    expect(good.cookie).toBeTruthy();

    const bad = await callback(forged);
    expect(bad.location).toBe("/login?oauth=error&reason=bad_state");
    expect(bad.cookie).toBeNull();
  });

  it("refuses a state this server never minted", async () => {
    const bad = await callback("completely.invented");
    expect(bad.location).toBe("/login?oauth=error&reason=bad_state");
  });

  it("refuses an UNVERIFIED Google address, which is the founder-impersonation attack", async () => {
    // An attacker who registers a Google account carrying the founder's
    // address without holding the mailbox must get nothing.
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({
        nonce,
        sub: "attacker-subject",
        email: "locked-out-founder@example.com",
        email_verified: false,
        name: "Not The Founder",
      }),
    };
    const { location, cookie } = await callback(state);
    expect(location).toBe("/login?oauth=error&reason=email_unverified");
    expect(cookie).toBeNull();
  });

  it("refuses an id_token minted for a different Google application", async () => {
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({
        nonce,
        aud: "some-other-app.apps.googleusercontent.com",
        sub: "x",
        email: "someone@example.com",
        email_verified: true,
      }),
    };
    expect((await callback(state)).location).toBe("/login?oauth=error&reason=wrong_audience");
  });

  it("refuses an id_token answering a DIFFERENT sign-in", async () => {
    // Two flows started at once. The token from one cannot complete the other.
    const first = await beginSignIn();
    const second = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce: first.nonce, sub: "x", email: "someone@example.com", email_verified: true }),
    };
    expect((await callback(second.state)).location).toBe("/login?oauth=error&reason=nonce_mismatch");
  });

  it("refuses an expired id_token", async () => {
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({
        nonce,
        exp: Math.floor(Date.now() / 1000) - 10,
        sub: "x",
        email: "someone@example.com",
        email_verified: true,
      }),
    };
    expect((await callback(state)).location).toBe("/login?oauth=error&reason=expired_id_token");
  });

  it("survives Google refusing the code, without leaking the reason to the browser", async () => {
    const { state } = await beginSignIn();
    nextResponse = { status: 400, claims: null, body: { error: "invalid_grant" } };
    const { location } = await callback(state);
    expect(location).toBe("/login?oauth=error&reason=exchange_failed");
    // The operator still gets the detail, which is the half that has to survive.
    expect(await waitForLog("Google token exchange failed: status=400")).toBe(true);
  });

  it("REPLAYING the handoff cookie buys a second session for nobody", async () => {
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce, sub: "replay-subject", email: "replay@example.com", email_verified: true }),
    };
    const { cookie } = await callback(state);
    const first = await exchange(cookie);
    expect(first.status).toBe(200); // positive control
    const second = await exchange(cookie);
    expect(second.status).toBe(401);
  });

  it("refuses a forged handoff cookie", async () => {
    const res = await exchange("invented.cookie");
    expect(res.status).toBe(401);
  });

  it("refuses an exchange with no cookie at all", async () => {
    expect((await exchange(null)).status).toBe(401);
  });

  it("sets the handoff cookie HttpOnly, SameSite=Lax and scoped to this site", async () => {
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce, sub: "cookie-shape", email: "cookieshape@example.com", email_verified: true }),
    };
    const { setCookie } = await callback(state);
    const header = setCookie.find((c) => c.startsWith("village_oauth_handoff="))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//);
    // Not Secure here, because this suite is plain http on localhost. A Secure
    // cookie on http is dropped by the browser, which would break local work
    // silently; the flag follows the configured origin's scheme.
    expect(header).not.toMatch(/Secure/i);
  });
});

describe.skipIf(!DB_CONFIGURED)("forgot-password no longer strands an account with no password", () => {
  const sameAnswer = "If an account exists for that address, a link to set a new password is on its way.";

  async function forgot(email: string) {
    const res = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("answers every caller identically, which is the enumeration defence", async () => {
    const unknown = await forgot("nobody-here@example.com");
    const withPassword = await forgot("haspassword@example.com");
    const withoutPassword = await forgot("locked-out-founder@example.com");
    for (const r of [unknown, withPassword, withoutPassword]) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, message: sameAnswer });
    }
  });

  it("actually tries to send a CLAIM letter for the account with no password", async () => {
    // The bug: the old guard was `if (user?.passwordHash)`, so this account
    // got the success message above and no email, on every attempt, forever.
    // There is no mail provider in this suite, so the proof that the send was
    // reached is the line the route logs when a send does not go.
    expect(await waitForLog("(claim): reason=no_api_key")).toBe(true);
  });

  it("still sends a RESET letter for an account that has a password", async () => {
    expect(await waitForLog("(reset): reason=no_api_key")).toBe(true);
  });

  it("says nothing at all about an address with no account", async () => {
    // A log line for an unknown address would be its own enumeration oracle
    // for anyone holding the logs.
    expect(logs.join("")).not.toContain("nobody-here@example.com");
  });
});

/*
 * THE SET-PASSWORD LINK, DRIVEN THROUGH THE ROUTE.
 *
 * server/lib/memberTokens.test.ts proves the claim and the decision. This
 * proves the route asks it, bumps tokenVersion in the same update as the hash,
 * and asks again under the row lock. The links are minted here with this
 * suite's own signing secret, exactly as forgot-password mints them, because
 * no route hands a reset link back to its caller. Nine set-password requests
 * in all: the route allows ten per client address an hour.
 */
describe.skipIf(!DB_CONFIGURED)("a set-password link works once, and never outlives a password change", () => {
  let rowan = { id: "", token: "" };
  let sage = { id: "", token: "" };
  let secondLetter = "";
  let newSession = "";

  async function signUp(who: string) {
    const res = await fetch(`${BASE}/api/auth/register`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `A ${who}`, email: `${who}@example.com`, password: "first-password-1", paths: [] }),
    });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    return { id: String(json.user.id), token: String(json.token) };
  }

  async function setPassword(link: string, password: string) {
    const res = await fetch(`${BASE}/api/auth/set-password`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: link, password }),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function logIn(who: string, password: string): Promise<number> {
    const res = await fetch(`${BASE}/api/auth/login`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${who}@example.com`, password }),
    });
    return res.status;
  }

  async function sessionStatus(token: string): Promise<number> {
    return (await fetch(`${BASE}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })).status; // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  }

  /** The member's row as the database holds it, which is what the route decided on. */
  async function stored(id: string): Promise<{ hash: string; version: number }> {
    const [rows] = await testDb!.conn.query<any[]>("SELECT password_hash, token_version FROM users WHERE id = ?", [id]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    return { hash: String(rows[0].password_hash), version: Number(rows[0].token_version) };
  }

  /** A claim in any shape, signed with this server's own secret. */
  const signed = (claims: unknown) => {
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${p}.${signTokenPayload(TOKEN_SECRET, p)}`;
  };

  beforeAll(async () => {
    if (!DB_CONFIGURED) return;
    rowan = await signUp("rowan-resets");
    sage = await signUp("sage-resets");
    // A second letter, asked for before the first one was used.
    secondLetter = makeSetPasswordToken(TOKEN_SECRET, rowan.id, (await stored(rowan.id)).version);
  });

  it("sets the password once, and the same link cannot set it again", async () => {
    const link = makeSetPasswordToken(TOKEN_SECRET, rowan.id, (await stored(rowan.id)).version);
    const first = await setPassword(link, "second-password-2");
    expect(first.status, JSON.stringify(first.json)).toBe(200); // positive control
    newSession = String(first.json?.token ?? "");
    expect(await logIn("rowan-resets", "second-password-2")).toBe(200);

    const replay = await setPassword(link, "third-password-3");
    expect(replay.status).toBe(401);
    expect(replay.json?.error).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
    expect(await logIn("rowan-resets", "third-password-3"), "the replay must not have set anything").toBe(401);
  });

  it("refuses a second letter that was minted before the password changed, never opened", async () => {
    const late = await setPassword(secondLetter, "fourth-password-4");
    expect(late.status).toBe(401);
    expect(late.json?.error).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
  });

  it("signs the member out of every other session, as setting a password already did", async () => {
    expect(await sessionStatus(rowan.token), "the session from before the reset").toBe(401);
    expect(await sessionStatus(newSession), "the session the reset handed back").toBe(200);
  });

  it("retires an unopened link when the member signs out anywhere", async () => {
    const unopened = makeSetPasswordToken(TOKEN_SECRET, rowan.id, (await stored(rowan.id)).version);
    const out = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${newSession}` } }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    expect(out.status).toBe(200);
    const after = await setPassword(unopened, "fifth-password-5");
    expect(after.status).toBe(401);
    expect(after.json?.error).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
  });

  it("refuses an expired link and a link edited to name another account", async () => {
    const { version } = await stored(rowan.id);
    const expired = signed({ userId: rowan.id, purpose: "set-password", v: version, exp: Date.now() - 1000 });
    const lapsed = await setPassword(expired, "sixth-password-6");
    expect(lapsed.status).toBe(401);
    expect(lapsed.json?.error).toBe("This link is invalid or has expired");

    const genuine = makeSetPasswordToken(TOKEN_SECRET, rowan.id, version);
    const [payload, sig] = genuine.split(".");
    const edited = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")), userId: sage.id }),
    ).toString("base64url");
    const forged = await setPassword(`${edited}.${sig}`, "seventh-password-7");
    expect(forged.status).toBe(401);
    expect(forged.json?.error).toBe("This link is invalid or has expired");
    expect(await logIn("sage-resets", "seventh-password-7")).toBe(401);
  });

  it("RETIRES a link in the old shape, by name, though the old route would have accepted it", async () => {
    // Built exactly as the minter wrote it until 2026-09-21: `pw` is the HMAC
    // of this member's CURRENT stored hash, so the old fingerprint compare
    // would have matched and let it set a password. Sage has never signed
    // out, so tokenVersion is 0, which is what a missing `v` read as `?? 0`
    // would equal. Refused anyway, with a sentence of its own.
    const before = await stored(sage.id);
    expect(before.version).toBe(0);
    const oldFingerprint = crypto.createHmac("sha256", TOKEN_SECRET).update(before.hash).digest("hex").slice(0, 16);
    const oldLink = signed({ userId: sage.id, purpose: "set-password", pw: oldFingerprint, exp: Date.now() + 60 * 60 * 1000 });

    const res = await setPassword(oldLink, "eighth-password-8");
    expect(res.status).toBe(401);
    expect(res.json?.error).toBe(SET_PASSWORD_LINK_REFUSAL.retired);
    expect(await stored(sage.id)).toEqual(before);
    expect(await logIn("sage-resets", "first-password-1"), "nothing changed on the account").toBe(200);
  });

  it("lets exactly one of two clicks racing on one link set the password", async () => {
    // Both requests pass the first check on a plain read, before either has
    // written. Only the second check, inside the locked row update, can stop
    // the loser, and bcrypt holds the window open long enough to reach it.
    const link = makeSetPasswordToken(TOKEN_SECRET, sage.id, (await stored(sage.id)).version);
    const both = await Promise.all([setPassword(link, "race-password-a"), setPassword(link, "race-password-b")]);
    expect(both.map((r) => r.status).sort(), JSON.stringify(both.map((r) => r.json))).toEqual([200, 401]);
    expect(both.find((r) => r.status === 401)?.json?.error).toBe(SET_PASSWORD_LINK_REFUSAL.spent);
    expect((await stored(sage.id)).version, "one landing, one bump").toBe(1);
  });
});

/*
 * THE GOOGLE DOOR, IN A VILLAGE THAT JOINS BY INVITATION.
 *
 * The harness opens the door for this suite (`ProvisionOptions.inviteOnly` in
 * server/db/testDb.ts), so the founder shuts it here, the way a village would,
 * and every case below runs with it shut. The email door's half of the same
 * rule is proved in server/invites.routes.e2e.test.ts. This is the half only
 * this suite can drive, because only this suite plays Google.
 */
describe.skipIf(!DB_CONFIGURED)("a village that joins by invitation, at the Google door", () => {
  let founderToken = "";

  /** A sign-in that starts from an invitation link, the way the sign-up page starts one. */
  async function beginInvitedSignIn(invite: string): Promise<{ state: string; nonce: string }> {
    const res = await fetch(`${BASE}/api/auth/google/start?invite=${encodeURIComponent(invite)}`, { redirect: "manual" }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    return { state: location.searchParams.get("state")!, nonce: location.searchParams.get("nonce")! };
  }

  /** What the server signed into a state, read back without trusting it. */
  const statePayload = (state: string) => JSON.parse(Buffer.from(state.split(".")[0], "base64url").toString("utf-8"));

  async function asFounder(method: string, route: string, body?: unknown) {
    const res = await fetch(`${BASE}${route}`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${founderToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  /** Somebody Google has never sent here before, arriving on the given state. */
  async function newcomer(state: string, nonce: string, who: string) {
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce, sub: `google-sub-${who}`, email: `${who}@example.com`, email_verified: true, name: `A ${who}` }),
    };
    return callback(state);
  }

  beforeAll(async () => {
    if (!DB_CONFIGURED) return;
    // The founder from "the link path", signed back in through Google. Signing
    // in to an account that already exists is never gated on an invitation.
    const { state, nonce } = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce, sub: "google-sub-founder", email: "locked-out-founder@example.com", email_verified: true, name: "Locked Out Founder" }),
    };
    const { cookie } = await callback(state);
    founderToken = String((await (await exchange(cookie)).json())?.token ?? "");
    expect(founderToken, "the founder holds a session").toBeTruthy();
    const shut = await asFounder("PUT", "/api/admin/variables/membership.invite_only", { value: "true" });
    expect(shut.status, JSON.stringify(shut.json)).toBe(200);
  });

  afterAll(async () => {
    if (!DB_CONFIGURED || !founderToken) return;
    await asFounder("PUT", "/api/admin/variables/membership.invite_only", { value: "false" });
  });

  it("says so on /api/auth/methods", async () => {
    expect((await (await fetch(`${BASE}/api/auth/methods`)).json()).inviteOnly).toBe(true); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  });

  it("makes no account for somebody with no link, and still signs a member back in", async () => {
    const stranger = await beginSignIn();
    const refused = await newcomer(stranger.state, stranger.nonce, "uninvited");
    expect(refused.location).toBe("/login?oauth=error&reason=invitation_required");
    expect(refused.cookie).toBeNull();

    // THE CONTROL, in the same case: the member who joined by Google earlier
    // signs straight back in with the door shut.
    const again = await beginSignIn();
    nextResponse = {
      status: 200,
      claims: claimsFor({ nonce: again.nonce, sub: "google-sub-newcomer", email: "Newcomer@Example.com", email_verified: true, name: "A Newcomer" }),
    };
    const back = await callback(again.state);
    expect(back.location).toContain("oauth=complete");
    expect(back.cookie).toBeTruthy();
  });

  it("makes the account for the person holding a link, records the inviter's vouch, and uses the link up", async () => {
    const made = await asFounder("POST", "/api/invites");
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const invite = new URL(String(made.json.path), BASE).searchParams.get("invite")!;

    // The token never travels to Google: only the invitation's id rides in the signed state.
    const { state, nonce } = await beginInvitedSignIn(invite);
    expect(state).not.toContain(invite);
    expect(statePayload(state).invite).toBe(made.json.id);

    const arrived = await newcomer(state, nonce, "invited");
    expect(arrived.location).toContain("oauth=complete");
    const session = await (await exchange(arrived.cookie)).json();
    expect(session.user.email).toBe("invited@example.com");

    const vouches = await asFounder("GET", `/api/members/${session.user.id}/vouches`);
    expect((vouches.json?.vouches ?? []).map((v: any) => v.kind)).toEqual(["arrival"]);

    // Used up: the same link now starts a sign-in carrying no invitation, and
    // a second newcomer on it is refused.
    const reuse = await beginInvitedSignIn(invite);
    expect(statePayload(reuse.state).invite).toBe("");
    const second = await newcomer(reuse.state, reuse.nonce, "second-on-one-link");
    expect(second.location).toBe("/login?oauth=error&reason=invitation_required");
    expect(second.cookie).toBeNull();
  });
});
