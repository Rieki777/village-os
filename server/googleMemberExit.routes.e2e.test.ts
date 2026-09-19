/**
 * A member who joined through Google can leave the village, and can delete
 * their account.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `server/routes/authGoogle.ts` creates a Google member with `passwordHash: ""`.
 * `POST /api/profile/request-exit` and `POST /api/profile/delete-account` both
 * demanded a password and accepted nothing else, so that member could neither
 * leave nor erase themselves. Found while PR #258 put the same members on the
 * ballot rolls (server/googleMemberVote.routes.e2e.test.ts).
 *
 * ── THE FIX, AND WHAT THIS PROVES AGAINST THE BUILT SERVER ──────────────────
 *
 * A member with no password confirms with a fresh Google sign-in
 * (`/api/auth/google/start?confirm=<action>`), which leaves a five-minute,
 * single-use, action-bound HttpOnly cookie (server/lib/identityConfirm.ts).
 * The cases below walk the REAL start, callback and route, with a local
 * stand-in playing Google's token endpoint exactly as the vote suite does:
 *
 *  1. Without a confirmation the Google member is refused, in a sentence that
 *     names Google, on both doors, and nothing changes.
 *  2. The callback mints nothing for a Google account linked to nobody, and
 *     sends a password member back to their password.
 *  3. An expired, edited, other-member and other-action confirmation are each
 *     refused with a sentence.
 *  4. The Google member opens a departure after confirming, and the same
 *     confirmation is refused the second time.
 *  5. A second Google member deletes their account after confirming.
 *  6. A password member's path is unchanged, body for body.
 *
 * The cases run IN ORDER. Run the whole file, never a `-t` slice. Run
 * `pnpm build` first. Skips loudly without TEST_DATABASE_URL.
 */
import crypto from "crypto";
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
  console.warn("[googleMemberExit.routes] TEST_DATABASE_URL not set. DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
/** This suite's windows, checked by scripts/check-e2e-ports.mjs. */
const PORT = 1200 + (process.pid % 400);
// 1724 + (pid % 276), and no longer 1600 + (pid % 400): that window held 1719,
// 1720 and 1723, which fetch() refuses to dial ("bad port"), so a run landing
// there polls a healthy server it can never reach. This is the widest clean
// stretch inside the old window. See server/db/e2eBoot.ts.
const GOOGLE_PORT = 1724 + (process.pid % 276);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "google-exit-admin";
const PASSWORD = "GoogleExit123!";
const CLIENT_ID = "exit-client-id.apps.googleusercontent.com";
const SECRET = "google-exit-token-secret"; // module-review-ok: a throwaway signing key for a server this file starts and kills
const FOUNDER_EMAIL = `founder-${PORT}@example.test`;

let child: ChildProcess | undefined;
let googleServer: http.Server | undefined;
let testDb: TestDb | undefined;
let dataDir = "";
let pool: mysql.Pool;
const logs: string[] = [];

let founderToken = "";
let annaToken = "";
let annaId = "";
let ginaToken = "";
let ginaId = "";
let halToken = "";
let halId = "";
/** Gina's real confirmation to leave, held across the refusal cases and then spent. */
let ginaExitCookie = "";

interface Answer { status: number; json: any; setCookies: string[] }

async function call(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null; cookie?: string } = {},
): Promise<Answer> {
  const token = opts.token === undefined ? founderToken : opts.token;
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null), setCookies: res.headers.getSetCookie?.() ?? [] };
}

let nextClaims: Record<string, unknown> | null = null;

/** One trip through start and callback. Returns where the callback sent the browser and what it set. */
async function googleRoundTrip(query: string, who: { sub: string; email: string; name: string }) {
  const start = await fetch(`${BASE}/api/auth/google/start${query}`, { redirect: "manual" }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  expect(start.status, `start${query}`).toBe(302);
  const location = new URL(start.headers.get("location")!);
  nextClaims = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: location.searchParams.get("nonce"),
    sub: who.sub,
    email: who.email,
    email_verified: true,
    name: who.name,
  };
  const state = location.searchParams.get("state")!;
  const cb = await fetch(`${BASE}/api/auth/google/callback?code=a-code&state=${encodeURIComponent(state)}`, { redirect: "manual" }); // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
  expect(cb.status).toBe(302);
  return { location: cb.headers.get("location") ?? "", setCookies: cb.headers.getSetCookie?.() ?? [] };
}

function cookieValue(setCookies: string[], name: string): string {
  for (const c of setCookies) {
    // Split rather than build a regex out of the name. The cookie itself is
    // the first pair of a Set-Cookie header, and escaping a name into a
    // pattern is one more thing to get wrong.
    const pair = c.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return "";
}

async function signUpWithGoogle(sub: string, email: string, name: string): Promise<{ token: string; id: string }> {
  const trip = await googleRoundTrip("", { sub, email, name });
  const handoff = cookieValue(trip.setCookies, "village_oauth_handoff");
  expect(handoff, "the callback hands over a handoff cookie").toBeTruthy();
  const ex = await fetch(`${BASE}/api/auth/google/exchange`, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method: "POST",
    headers: { cookie: `village_oauth_handoff=${handoff}` },
  });
  expect(ex.status).toBe(200);
  const body = await ex.json();
  return { token: String(body.token), id: String(body.user?.id ?? "") };
}

/** Confirm with Google for one action. Returns the raw cookie value the callback set. */
async function confirmWithGoogle(action: string, who: { sub: string; email: string; name: string }, home: string): Promise<string> {
  const trip = await googleRoundTrip(`?confirm=${action}`, who);
  expect(trip.location, "back to the screen it started from, confirmed").toBe(`${home}?google_confirm=${action}`);
  const name = `village_confirm_${action}`;
  const raw = trip.setCookies.find((c) => c.startsWith(`${name}=`)) ?? "";
  expect(raw, "HttpOnly, so no script on the page can read it").toContain("HttpOnly");
  expect(raw, "sent only to the routes that spend it").toContain("Path=/api/profile");
  const value = cookieValue(trip.setCookies, name);
  expect(value).toBeTruthy();
  return value;
}

/** Edit a confirmation's payload and sign it again with the server's key, as only the server could. */
function resign(token: string, edit: (p: any) => void): string {
  const payload = token.split(".")[0];
  const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  edit(p);
  const next = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${next}.${crypto.createHmac("sha256", SECRET).update(next).digest("base64url")}`;
}

async function openExit(userId: string): Promise<unknown> {
  const r = await call("GET", `/api/admin/players/${userId}/exit-state`);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json?.exit ?? null;
}

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

const GINA = { sub: "google-sub-gina-exit", email: "", name: "Gina Hart" };
const HAL = { sub: "google-sub-hal-delete", email: "", name: "Hal Moss" };
const ANNA_GOOGLE = { sub: "google-sub-anna-password", email: "", name: "Anna Vale" };

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the Google member exit test.`);
  }
  GINA.email = `gina-${PORT}@example.test`;
  HAL.email = `hal-${PORT}@example.test`;
  ANNA_GOOGLE.email = `anna-${PORT}@example.test`;
  await startGoogleStandIn();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-google-exit-"));
  testDb = await provisionTestDb();
  pool = mysql.createPool({ uri: testDb.url, timezone: "Z", connectionLimit: 4 }); // module-review-ok: the e2e harness against the scratch schema, as every e2e suite holds

  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      FRONTEND_URL: BASE,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: SECRET,
      RESEND_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: "exit-client-secret", // module-review-ok: a stand-in client secret the local token stand-in never checks
      GOOGLE_TOKEN_ENDPOINT: `http://127.0.0.1:${GOOGLE_PORT}/token`,
      // Pinned, because this spreads process.env: a developer's own values would
      // move the redirect URI or hand these members the founder role.
      GOOGLE_REDIRECT_URI: "",
      FOUNDER_EMAILS: "",
      BREAK_GLASS_ADMIN_EMAIL: "",
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

  const boot = await call("POST", "/api/admin/bootstrap", {
    body: { password: ADMIN, email: FOUNDER_EMAIL, name: "Exit Founder" },
    token: null,
  });
  const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
  expect(claim, "bootstrap must return a claim link").toBeTruthy();
  const setPw = await call("POST", "/api/auth/set-password", { body: { token: claim, password: PASSWORD }, token: null });
  founderToken = String(setPw.json?.token ?? "");
  expect(founderToken, "founder must hold a session").toBeTruthy();

  // A password member, the control for every case.
  const reg = await call("POST", "/api/auth/register", {
    body: { name: "Anna Vale", email: ANNA_GOOGLE.email, password: PASSWORD, paths: ["resident"] },
    token: null,
  });
  expect(reg.status, "Anna registers").toBe(200);
  annaId = String(reg.json?.user?.id ?? "");
  annaToken = String(reg.json?.token ?? "");
  expect(annaToken, "Anna holds a session").toBeTruthy();

  ({ token: ginaToken, id: ginaId } = await signUpWithGoogle(GINA.sub, GINA.email, GINA.name));
  ({ token: halToken, id: halId } = await signUpWithGoogle(HAL.sub, HAL.email, HAL.name));
  const [rows] = await pool.query<any[]>("SELECT id, password_hash FROM users WHERE id IN (?, ?)", [ginaId, halId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
  expect(rows.map((r) => r.password_hash), "both joined through Google and hold no password").toEqual(["", ""]);
});

afterAll(async () => {
  child?.kill();
  googleServer?.close();
  await pool?.end();
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await testDb?.drop();
});

describe.skipIf(!DB_CONFIGURED)("a member who joined through Google can leave and can delete", () => {
  it("THE DEFECT, NOW A SENTENCE: without a confirmation a Google member is asked to confirm with Google, on both doors", async () => {
    const leave = await call("POST", "/api/profile/request-exit", { token: ginaToken, body: {} });
    expect(leave.status).toBe(403);
    expect(String(leave.json?.error)).toContain("Confirm with Google");
    expect(leave.json?.confirmWith).toBe("google");

    // A password field is not a way round it: there is no password to match.
    const guessed = await call("POST", "/api/profile/request-exit", { token: ginaToken, body: { password: "" } });
    expect(guessed.status).toBe(403);
    expect(String(guessed.json?.error)).toContain("Confirm with Google");

    const erase = await call("POST", "/api/profile/delete-account", { token: ginaToken, body: {} });
    expect(erase.status).toBe(403);
    expect(String(erase.json?.error)).toContain("Confirm with Google before you delete your account");

    expect(await openExit(ginaId), "nothing opened").toBeNull();
  });

  it("the screen is told what each member confirms with", async () => {
    expect((await call("GET", "/api/auth/confirm-methods", { token: ginaToken })).json).toEqual({ confirmWith: "google" });
    expect((await call("GET", "/api/auth/confirm-methods", { token: annaToken })).json).toEqual({ confirmWith: "password" });
    expect((await call("GET", "/api/auth/confirm-methods", { token: null })).status).toBe(401);
  });

  it("a Google account linked to nobody gets no confirmation, and no account is made", async () => {
    const stranger = { sub: "google-sub-stranger", email: `stranger-${PORT}@example.test`, name: "Stranger" };
    const trip = await googleRoundTrip("?confirm=request-exit", stranger);
    expect(trip.location).toBe("/exit-policy?google_confirm=error&for=request-exit&reason=not_linked");
    expect(trip.setCookies.some((c) => c.startsWith("village_confirm_"))).toBe(false);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM users WHERE email = ?", [stranger.email]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(Number(rows[0].n)).toBe(0);
  });

  it("a password member who tries to confirm through Google is sent back to their password", async () => {
    // Anna links Google by signing in with it, and keeps her password.
    await signUpWithGoogle(ANNA_GOOGLE.sub, ANNA_GOOGLE.email, ANNA_GOOGLE.name);
    const trip = await googleRoundTrip("?confirm=delete-account", ANNA_GOOGLE);
    expect(trip.location).toBe("/profile?google_confirm=error&for=delete-account&reason=has_password");
    expect(trip.setCookies.some((c) => c.startsWith("village_confirm_"))).toBe(false);
  });

  it("an expired confirmation is refused, and so is one edited without the server's key", async () => {
    ginaExitCookie = await confirmWithGoogle("request-exit", GINA, "/exit-policy");

    const expired = resign(ginaExitCookie, (p) => { p.exp = Date.now() - 1000; });
    const late = await call("POST", "/api/profile/request-exit", { token: ginaToken, body: {}, cookie: `village_confirm_request-exit=${expired}` });
    expect(late.status).toBe(403);
    expect(String(late.json?.error)).toContain("has expired");

    const [payload, sig] = ginaExitCookie.split(".");
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    p.exp = Date.now() + 60 * 60 * 1000;
    const edited = `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`;
    const forged = await call("POST", "/api/profile/request-exit", { token: ginaToken, body: {}, cookie: `village_confirm_request-exit=${edited}` });
    expect(forged.status).toBe(403);
    expect(String(forged.json?.error)).toContain("could not be read");

    expect(await openExit(ginaId), "still nothing opened").toBeNull();
  });

  it("another member's confirmation is refused", async () => {
    const r = await call("POST", "/api/profile/request-exit", { token: halToken, body: {}, cookie: `village_confirm_request-exit=${ginaExitCookie}` });
    expect(r.status).toBe(403);
    expect(String(r.json?.error)).toContain("belongs to a different account");
    expect(await openExit(halId)).toBeNull();
  });

  it("a confirmation to leave cannot delete the account", async () => {
    const r = await call("POST", "/api/profile/delete-account", { token: ginaToken, body: {}, cookie: `village_confirm_delete-account=${ginaExitCookie}` });
    expect(r.status).toBe(403);
    expect(String(r.json?.error)).toContain("given for something else");
    const [rows] = await pool.query<any[]>("SELECT email FROM users WHERE id = ?", [ginaId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(String(rows[0].email)).toBe(GINA.email);
  });

  it("A GOOGLE MEMBER OPENS THEIR DEPARTURE AFTER CONFIRMING WITH GOOGLE", async () => {
    const r = await call("POST", "/api/profile/request-exit", {
      token: ginaToken,
      body: { note: "Moving to the coast." },
      cookie: `village_confirm_request-exit=${ginaExitCookie}`,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await openExit(ginaId)).not.toBeNull();
    expect(r.setCookies.some((c) => c.startsWith("village_confirm_request-exit=;")), "the spent cookie is cleared").toBe(true);
  });

  it("the same confirmation is refused the second time, before anything else is asked", async () => {
    const again = await call("POST", "/api/profile/request-exit", { token: ginaToken, body: {}, cookie: `village_confirm_request-exit=${ginaExitCookie}` });
    expect(again.status, "a 409 here would mean the confirmation was accepted twice").toBe(403);
    expect(String(again.json?.error)).toContain("already been used");
  });

  it("A GOOGLE MEMBER DELETES THEIR ACCOUNT AFTER CONFIRMING WITH GOOGLE", async () => {
    const cookie = await confirmWithGoogle("delete-account", HAL, "/profile");
    const r = await call("POST", "/api/profile/delete-account", { token: halToken, body: {}, cookie: `village_confirm_delete-account=${cookie}` });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json?.anonymized).toBe(true);
    const [rows] = await pool.query<any[]>("SELECT email FROM users WHERE id = ?", [halId]); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    expect(String(rows[0].email)).toContain("anonymized.invalid");
  });

  it("THE PASSWORD PATH IS UNCHANGED: same bodies on a wrong password, and the right one deletes", async () => {
    const wrongExit = await call("POST", "/api/profile/request-exit", { token: annaToken, body: { password: "not-it" } });
    expect(wrongExit.status).toBe(403);
    expect(wrongExit.json).toEqual({ error: "Confirm with your password" });

    // A validly signed confirmation does not stand in for a password member's password.
    const signed = resign(ginaExitCookie, (p) => { p.userId = annaId; p.action = "delete-account"; p.exp = Date.now() + 60_000; });
    const wrongDelete = await call("POST", "/api/profile/delete-account", {
      token: annaToken,
      body: {},
      cookie: `village_confirm_delete-account=${signed}`,
    });
    expect(wrongDelete.status).toBe(403);
    expect(wrongDelete.json).toEqual({ error: "Confirm with your password to delete your account" });

    const right = await call("POST", "/api/profile/delete-account", { token: annaToken, body: { password: PASSWORD } });
    expect(right.status, JSON.stringify(right.json)).toBe(200);
    expect(right.json?.anonymized).toBe(true);
  });
});
