/**
 * A FORGED X-Forwarded-Host CANNOT STEER A SET-PASSWORD LINK (readiness R108).
 *
 * With FRONTEND_URL unset, the server learns its own address from the first
 * request it answers, and every absolute link it emails afterwards sits on
 * that address. It used to prefer `X-Forwarded-Host`, which the caller
 * writes. So whoever reached a fresh village first could make every later
 * set-password link, in the village's own email from its own domain, point at
 * a host of their choosing.
 *
 * This boots a server with no FRONTEND_URL and makes the very first request
 * that reaches it (the boot poll itself) carry a forged `X-Forwarded-Host`.
 * Then an admin sends a member a set-password link through a fake mail
 * provider, and the link in the email must sit on the address the request
 * actually reached. Run against the old line, it carries the forged host.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_BOOT_DEADLINE_MS, provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { startFakeResend, type FakeResend } from "./testkit/fakeResend";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[deploymentOrigin] TEST_DATABASE_URL not set: DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs.
const PORT = 3308 + (process.pid % 92);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "deployment-origin-admin";
const PROVIDER_KEY = "re_test_deployment_origin";
const FORGED = "attacker.example";
const MEMBER_EMAIL = `origin-member-${PORT}@example.test`;

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let fake: FakeResend | undefined;
let dataDir = "";
const logs: string[] = [];

/** Every request this suite makes carries the forged header, the boot poll first of all. */
const forged = { "x-forwarded-host": FORGED };

async function call(method: string, route: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + route, { // module-review-ok: the test client dialling the built server on localhost, as every e2e suite does
    method,
    headers: {
      ...forged,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing. Run \`pnpm build\` before the deployment origin test.`);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-deployment-origin-"));
  testDb = await provisionTestDb();
  fake = await startFakeResend({ apiKey: PROVIDER_KEY });
  await waitForPortFree(PORT);
  child = spawn(process.execPath, [DIST], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      // No background scheduler, for the reason selfMembership.routes.e2e.test.ts gives.
      SCHEDULER_ENABLED: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      AUTH_TOKEN_SECRET: "deployment-origin-token-secret", // module-review-ok: a fixture signing secret for a throwaway server on a scratch schema, same as every e2e suite
      // THE SUBJECT: no address of its own, so the first request teaches it one.
      FRONTEND_URL: "",
      RESEND_API_BASE: fake.url,
      RESEND_API_KEY: PROVIDER_KEY,
      EMAIL_FROM: "Test Village <hello@village.example.test>",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start. Output:\n${logs.join("")}`);
    try {
      // The boot poll IS the first request, and it carries the forged host.
      const res = await fetch(`${BASE}/health`, { headers: forged }); // module-review-ok: the boot poll against the local test server
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}, 300_000);

afterAll(async () => {
  child?.kill();
  await fake?.close();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("the address a set-password link sits on", () => {
  it("is the address the request reached, never the X-Forwarded-Host it carried", async () => {
    const boot = await call("POST", "/api/admin/bootstrap", { password: ADMIN, email: `origin-founder-${PORT}@example.test`, name: "Origin Founder" });
    const claim = decodeURIComponent(String(boot.json?.claimUrl ?? "").match(/token=([^&]+)/)?.[1] ?? "");
    expect(claim, `bootstrap must return a claim link: ${JSON.stringify(boot.json).slice(0, 200)}`).toBeTruthy();
    const founderToken = String((await call("POST", "/api/auth/set-password", { token: claim, password: "OriginFounder123!" })).json?.token ?? "");
    expect(founderToken, "the founder must hold a session").toBeTruthy();

    const joined = await call("POST", "/api/auth/register", { name: "Origin Member", email: MEMBER_EMAIL, password: "OriginMember123!", paths: ["resident"] });
    expect(joined.status, JSON.stringify(joined.json).slice(0, 200)).toBe(200);
    const memberId = String(joined.json?.user?.id ?? "");
    expect(memberId).toBeTruthy();

    const sent = await call("POST", `/api/admin/users/${memberId}/send-password-link`, {}, founderToken);
    expect(sent.status, JSON.stringify(sent.json).slice(0, 200)).toBe(200);

    const toMember = fake!.emails().filter((e) => JSON.stringify(e.body.to ?? []).includes(MEMBER_EMAIL));
    const letter = toMember.find((e) => String(e.body.subject) === "Set a new password");
    expect(letter, `the set-password email reached the provider; saw ${toMember.map((e) => e.body.subject).join(", ")}`).toBeTruthy();
    expect(String(letter!.body.html)).toContain(`${BASE}/set-password?token=`);
    // And no letter this village sent anybody carries the forged host.
    for (const e of fake!.emails()) expect(String(e.body.html), String(e.body.subject)).not.toContain(FORGED);
  });
});
