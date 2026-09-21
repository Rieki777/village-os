/**
 * The headers and the shell files, against the BUILT server.
 *
 * Every case here was a live finding measured with `curl -sI` against the
 * deployed site (round-2 QA, 2026-08-15), and every one of them is invisible
 * to a typecheck and to a unit test of any handler: they are properties of
 * what leaves the process, not of what a function returns.
 *
 * The one worth naming is `frame-ancestors`. /map is a full-viewport iframe of
 * a SAME-ORIGIN artifact, so the fix and the regression look identical from
 * the outside: a header strict enough to stop a stranger framing the village
 * is one character away from a header that blanks the map for everyone. So the
 * assertion is not "the header is set" — it is set AND /grounds/index.html
 * still serves the artifact under it.
 *
 * Skips loudly without TEST_DATABASE_URL, like every DB-backed suite here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb, waitForPortFree } from "./db/testDb";
import { waitForHealth } from "./db/e2eBoot";

const DB_CONFIGURED = testDbConfigured();
if (!DB_CONFIGURED) {
  console.warn("[hygiene.routes] TEST_DATABASE_URL not set — DB-backed tests SKIPPED.");
}

const DIST = path.resolve(process.cwd(), "dist/index.js");
// Its window is checked by scripts/check-e2e-ports.mjs, not claimed here: the
// hand-written claims this replaces had gone stale and were describing a tree
// that had moved on.
const PORT = 15400 + (process.pid % 900);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "hygiene-admin";

let child: ChildProcess | undefined;
let testDb: TestDb | undefined;
let dataDir = "";

/** The set every response carries, whatever it is. */
const EXPECTED: Array<[string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-frame-options", "SAMEORIGIN"],
  ["content-security-policy", "frame-ancestors 'self'"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
];

beforeAll(async () => {
  if (!DB_CONFIGURED) return;
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} is missing. Run \`pnpm build\` before the hygiene route test.`);
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "village-hygiene-"));
  testDb = await provisionTestDb();

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
      AUTH_TOKEN_SECRET: "hygiene-token-secret",
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
});

afterAll(async () => {
  child?.kill();
  await testDb?.drop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe.skipIf(!DB_CONFIGURED)("security response headers", () => {
  // The SPA shell, a JSON API route, and a path that matches nothing: a header
  // set on two of the three is the shape of the bug this replaces.
  for (const route of ["/", "/api/modules", "/nothing-is-here"]) {
    it(`are on ${route}`, async () => {
      const res = await fetch(BASE + route);
      for (const [name, value] of EXPECTED) {
        expect(res.headers.get(name), `${route} is missing ${name}`).toBe(value);
      }
    });
  }

  it("no longer advertise the server stack", async () => {
    for (const route of ["/", "/api/modules"]) {
      expect((await fetch(BASE + route)).headers.get("x-powered-by")).toBeNull();
    }
  });

  it("say nothing about HSTS, because no hostname list was verified", async () => {
    // Written as an assertion rather than a comment: max-age is not reversible,
    // so this header arriving by accident is worth a red test.
    expect((await fetch(`${BASE}/`)).headers.get("strict-transport-security")).toBeNull();
  });

  it("still let /map embed the map artifact it lives on", async () => {
    // frame-ancestors 'self' and X-Frame-Options SAMEORIGIN both permit the
    // same-origin iframe the shell renders. If the artifact stops serving, or
    // the policy tightens past 'self', this is where it shows.
    const res = await fetch(`${BASE}/grounds/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe.skipIf(!DB_CONFIGURED)("the crawler's two files", () => {
  it("serve robots.txt as text with a sitemap line", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    // The failure being guarded is the SPA shell answering with a 200.
    expect(body).not.toContain("<div id=\"root\">");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /api/");
    expect(body).toMatch(/Sitemap: https?:\/\/[^/]+\/sitemap\.xml/);
  });

  it("serve sitemap.xml as XML with absolute public URLs", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/xml/);
    const body = await res.text();
    expect(body).not.toContain("<div id=\"root\">");
    expect(body).toContain("<urlset");
    expect(body).toMatch(new RegExp(`<loc>http://localhost:${PORT}/quests</loc>`));
    // Module-gated pages stay out until their module serves everyone, and every
    // optional module is off on a fresh village.
    expect(body).not.toContain("/network</loc>");
  });
});

describe.skipIf(!DB_CONFIGURED)("a refusal", () => {
  it("has one shape for every route that means sign in", async () => {
    for (const route of ["/api/profile", "/api/notifications", "/api/admin/economy"]) {
      const res = await fetch(BASE + route);
      expect(res.status, route).toBe(401);
      const body = await res.json();
      expect(body.error, `${route} answered ${JSON.stringify(body)}`).toBe("auth_required");
    }
  });

  it("keeps the human sentence where a route had one", async () => {
    // A core-module route on purpose: every optional module is off on a fresh
    // village, and a module 404 would never reach the refusal being measured.
    const res = await fetch(`${BASE}/api/game/quests/q-welcome-ambassador/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("auth_required");
    expect(body.message).toBe("Sign in to claim quests");
  });

  it("still tells someone with a wrong password what actually happened", async () => {
    // Credential verification is not "you are anonymous", and the sign-in page
    // renders this string. Unifying it would have put `auth_required` in front
    // of every person who mistyped a password.
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.test", password: "wrong" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Invalid credentials");
  });
});

describe.skipIf(!DB_CONFIGURED)("the seeded quest board", () => {
  it("asks for no poster this build does not ship", async () => {
    // The 14 seeded quests carried /api/uploads/quest-NN-*.webp, which 404 on
    // every deployment: the files live in one dev box's uploads volume. Each
    // one was a console error on the busiest public page.
    const res = await fetch(`${BASE}/api/quests`);
    const quests = await res.json();
    expect(Array.isArray(quests)).toBe(true);
    expect(quests.length).toBeGreaterThan(0);
    // Read as bytes rather than by field name: the board has been served as
    // `image` and as `imageUrl` in different rounds, and the thing that must
    // not be there is the upload path under either name.
    const [firstMiss] = JSON.stringify(quests).match(/\/api\/uploads\/quest-[^"]*/) ?? [];
    expect(firstMiss, `a seeded quest still names an upload: ${firstMiss}`).toBeUndefined();
  });
});

/*
 * A PATH THAT LOOKS LIKE A FILE FAILS LIKE ONE.
 *
 * A missing image under /images, and a missing root-level file such as
 * /favicon.png, answered the app's own HTML with a 200. A broken image read as
 * served, and an uptime check pointed at a missing file stayed green forever.
 * Both now answer 404 text/plain, the way /assets already did.
 *
 * The rule sits AFTER express.static and after every generated file, so the
 * half of this block that matters as much as the 404s is the first test: every
 * real file still answers, and every real page still gets the shell. A 404 rule
 * registered one line too early would pass the second test and break the site.
 */
describe.skipIf(!DB_CONFIGURED)("a path that looks like a file fails like one", () => {
  const SHELL = "<div id=\"root\">";
  const IMAGES = path.resolve(process.cwd(), "dist/public/images/modules");

  it("still serves every real file, static and generated", async () => {
    const art = fs.readdirSync(IMAGES).find((f) => f.endsWith(".webp"));
    expect(art, "dist/public/images/modules must hold module art; run pnpm build").toBeTruthy();
    const real: Array<[string, RegExp]> = [
      [`/images/modules/${art}`, /image\/webp/],
      ["/images/modules/manifest.json", /json/],
      ["/assets/images/platform-favicon.svg", /svg/],
      ["/sw.js", /javascript/],
      ["/robots.txt", /text\/plain/],
      ["/sitemap.xml", /xml/],
      ["/manifest.webmanifest", /manifest\+json/],
      ["/grounds/manifest.json", /json/],
    ];
    for (const [route, type] of real) {
      const res = await fetch(BASE + route); // module-review-ok: the test client dialling its own in-process server on localhost, as every e2e suite does
      expect(res.status, `${route} is a real file`).toBe(200);
      expect(res.headers.get("content-type") ?? "", `${route} content type`).toMatch(type);
    }
  });

  it("answers 404 for a missing file, never the shell with a 200", async () => {
    for (const route of [
      "/images/modules/zzz-does-not-exist.webp",
      "/images/nope",
      "/favicon-definitely-missing.png",
      "/apple-touch-icon.png",
      "/wp-login.php",
    ]) {
      const res = await fetch(BASE + route); // module-review-ok: the test client dialling its own in-process server on localhost, as every e2e suite does
      expect(res.status, `${route} is a missing file`).toBe(404);
      expect(res.headers.get("content-type") ?? "").toMatch(/text\/plain/);
      expect(await res.text(), `${route} must not be answered with the app`).not.toContain(SHELL);
    }
  });

  it("still gives every real page the shell, a dotted profile handle included", async () => {
    for (const route of ["/", "/investor", "/quests", "/profile/ada.lovelace", "/no-such-page"]) {
      const res = await fetch(BASE + route); // module-review-ok: the test client dialling its own in-process server on localhost, as every e2e suite does
      expect(res.status, `${route} is a page`).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
      expect(await res.text()).toContain(SHELL);
    }
  });
});
