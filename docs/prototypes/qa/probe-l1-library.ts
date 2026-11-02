/**
 * L1 probe: the Module Library flow against the BUILT server on a fixture
 * village, driven by real browsers.
 *
 * What it proves, loudly (any failure exits 1 with the check named):
 *   A  a fresh village's Admin shows platform tabs + Module Library only
 *      (counted against TAB_MODULE's labels), and turning tools on makes the
 *      Tools tab appear wearing its badge
 *   C  /modules renders anonymous: eighteen cards, five shelves, the builder
 *      card, and no state pills
 *   D  with every image request blocked, the drawn hue-and-emblem fallback
 *      renders instead of a broken card
 *   E  R36 sweep: with every swept module forced to members, every swept
 *      route shows the sign-in card with a working ?next=, never a 404
 *   F  readiness flips on the first real save (tools), read from the admin
 *      payload
 *   G  the detail page's Turn on -> Go-live -> Members only writes the
 *      module_events lifecycle row (messaging, setup none)
 *   H  WebKit iPhone 14 (390x844, DPR3): /messages shows the sign-in card
 *      (screenshot), /modules and /modules/stays scroll only vertically
 *   I  preview stays a 404 page for the signed-out, byte-identical manifest
 *
 * Run:  npx tsx docs/prototypes/qa/probe-l1-library.ts
 * Env:  PW_DIR=<node_modules dir holding playwright>  (required)
 *       TEST_DATABASE_URL must point at a scratch MySQL (never production).
 * Playwright hazard notes honoured: no networkidle (domcontentloaded + waits),
 * scroll-behavior forced auto, failures are loud, no NaN bands.
 */
import "dotenv/config"; // TEST_DATABASE_URL, exactly as vitest's setupFiles load it
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { provisionTestDb, E2E_BOOT_DEADLINE_MS } from "../../../server/db/testDb";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const PW_DIR = process.env.PW_DIR;
if (!PW_DIR) {
  console.error("PW_DIR must point at a node_modules directory holding playwright");
  process.exit(2);
}
const requirePw = createRequire(path.join(PW_DIR, "/"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium, webkit, devices } = requirePw("playwright");

const PORT = 4600 + (process.pid % 1000);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "l1-probe-admin";
const SHOTS = process.env.SHOTS_DIR ?? path.join(os.tmpdir(), "l1-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
}

async function api(method: string, route: string, body?: unknown, auth?: string) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

/** The swept module-gated routes (R36/R37): route -> module id. */
const SWEPT: Array<[string, string]> = [
  ["/badges", "badges"],
  ["/contribute", "commerce"],
  ["/events", "events"],
  ["/feed", "feed"],
  ["/forum", "forum"],
  ["/library", "library"],
  ["/map", "map"],
  ["/map/circles", "map"],
  ["/messages", "messaging"],
  ["/network", "network"],
  ["/stay", "stays"],
  ["/tools", "tools"],
  ["/village-health", "health"],
  ["/tokens", "exchange"],
  ["/wallet", "exchange"],
];

/** Admin labels of module-mapped tabs (TAB_MODULE keys that exist today). */
const MAPPED_TAB_LABELS = [
  "Moderation", "Payments", "Circles & Map", "Calendar", "Tools",
  "Stays & Payments", "Exchange", "Badges", "Library", "Village Health", "Calls",
];

async function main() {
  // ── Boot the built server against a scratch schema ─────────────────────────
  const dist = path.join(ROOT, "dist", "index.js");
  if (!fs.existsSync(dist)) throw new Error("dist/index.js missing; run pnpm build first");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "l1-probe-"));
  const testDb = await provisionTestDb();
  const child: ChildProcess = spawn(process.execPath, [dist], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      DATA_DIR: dataDir,
      DATABASE_URL: testDb.url,
      ADMIN_PASSWORD: ADMIN,
      JOURNEY_PASSWORD: "l1-probe-journey",
      AUTH_TOKEN_SECRET: "l1-probe-secret",
      RESEND_API_KEY: "",
      STRIPE_WEBHOOK_SECRET: "whsec_l1probe",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  const deadline = Date.now() + E2E_BOOT_DEADLINE_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start. Output:\n${logs.join("")}`);
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Founder: register like anyone, then bootstrap elevates.
  const founder = { email: `founder-${PORT}@probe.test`, password: "ProbePass123!", name: "Probe Founder" };
  const reg = await api("POST", "/api/auth/register", { ...founder, paths: ["steward"] });
  const founderToken: string = reg.json.token;
  await api("POST", "/api/admin/bootstrap", { password: ADMIN, email: founder.email });

  const cleanup: Array<() => Promise<void> | void> = [];
  try {
    const browser = await chromium.launch();
    cleanup.push(() => browser.close());

    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await adminCtx.addInitScript(
      ([k, t]: string[]) => localStorage.setItem(k, t),
      ["village-auth-token", founderToken],
    );
    const anonCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    for (const ctx of [adminCtx, anonCtx]) {
      await ctx.addInitScript(() => {
        const s = document.createElement("style");
        s.textContent = "* { scroll-behavior: auto !important; }";
        document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
      });
    }

    // ── A: fresh village Admin = platform tabs + Module Library ─────────────
    const admin = await adminCtx.newPage();
    await admin.goto(`${BASE}/admin?tab=submissions`, { waitUntil: "domcontentloaded" });
    await admin.waitForTimeout(3500);
    const navLabels: string[] = await admin.evaluate(() =>
      Array.from(document.querySelectorAll("nav button[aria-label]")).map(
        (b) => b.getAttribute("aria-label") ?? "",
      ),
    );
    const mappedShown = MAPPED_TAB_LABELS.filter((l) => navLabels.includes(l));
    check(
      "A1 fresh Admin hides every module tab",
      mappedShown.length === 0 && navLabels.length > 0,
      mappedShown.length ? `still shows: ${mappedShown.join(", ")}` : `${navLabels.length} platform items`,
    );
    check("A2 Module Library entry present", navLabels.includes("Module Library"), navLabels.join("|").slice(0, 120));

    // Turning tools on (preview) makes the Tools tab appear, wearing preview.
    await api("PUT", "/api/admin/modules/tools/lifecycle", { lifecycle: "preview", examples: false }, founderToken);
    await admin.reload({ waitUntil: "domcontentloaded" });
    await admin.waitForTimeout(3500);
    const toolsTab = await admin.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("nav button[aria-label='Tools']"))[0];
      return btn ? (btn.textContent ?? "") : null;
    });
    check("A3 Turn on shows the Tools tab with its badge", !!toolsTab && /preview/i.test(toolsTab), String(toolsTab));

    // ── C: /modules anonymous ────────────────────────────────────────────────
    const shelfPage = await anonCtx.newPage();
    await shelfPage.goto(`${BASE}/modules`, { waitUntil: "domcontentloaded" });
    await shelfPage.waitForTimeout(3500);
    const shelf = await shelfPage.evaluate(() => ({
      cards: document.querySelectorAll("a[href^='/modules/']:not([href='/modules'])").length,
      shelves: Array.from(document.querySelectorAll("section h2")).map((h) => h.textContent?.trim()),
      builder: !!Array.from(document.querySelectorAll("h3")).find((h) => h.textContent?.includes("get paid in $ReGen")),
      pills: document.body.innerText.includes("On in this village") || document.body.innerText.includes("Preview"),
    }));
    check("C1 eighteen cards anonymous", shelf.cards === 18, `${shelf.cards} cards`);
    check("C2 five shelves", shelf.shelves.length === 5, shelf.shelves.join("|"));
    check("C3 builder card present", shelf.builder);
    check("C4 no state pills for the signed-out", !shelf.pills);

    // ── D: block every image; the drawn fallback carries the card ────────────
    const artCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    cleanup.push(() => artCtx.close());
    await artCtx.route("**/images/modules/**", (r: any) => r.abort());
    await artCtx.route("**/api/uploads/**", (r: any) => r.abort());
    const artPage = await artCtx.newPage();
    await artPage.goto(`${BASE}/modules`, { waitUntil: "domcontentloaded" });
    await artPage.waitForTimeout(3500);
    const fallbacks = await artPage.evaluate(
      () => Array.from(document.querySelectorAll("div[style*='linear-gradient']")).length,
    );
    check("D1 drawn fallback art renders when images are gone", fallbacks >= 18, `${fallbacks} fallbacks`);

    // ── E: R36 sweep — every swept route offers sign-in at members ──────────
    // forum before feed (hard dependency); the rest in any order.
    const sweptIds = ["forum", "feed", "map", "messaging", "stays", "tools", "badges", "library", "health", "automation", "network", "exchange", "commerce", "events"];
    for (const id of sweptIds) {
      const r = await api("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "members" }, founderToken);
      if (r.status !== 200) check(`E0 enable ${id} to members`, false, JSON.stringify(r.json).slice(0, 120));
    }
    const anonManifest = await api("GET", "/api/modules");
    check(
      "E1 signInToSee names every members module",
      sweptIds.every((id) => (anonManifest.json.signInToSee ?? []).includes(id)),
      (anonManifest.json.signInToSee ?? []).join(","),
    );
    for (const [route] of SWEPT) {
      const p = await anonCtx.newPage();
      await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(3000);
      const verdict = await p.evaluate(() => {
        const text = document.body.innerText;
        const link = document.querySelector("a[href^='/login?next=']");
        return {
          card: text.includes("opens when you sign in"),
          notFound: !!Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "404"),
          next: link ? link.getAttribute("href") : null,
        };
      });
      const wantNext = `/login?next=${encodeURIComponent(route)}`;
      check(
        `E2 ${route} offers sign-in, never 404`,
        verdict.card && !verdict.notFound && verdict.next === wantNext,
        `next=${verdict.next ?? "none"}${verdict.notFound ? " (404 PAGE)" : ""}`,
      );
      await p.close();
    }

    // ── F: readiness flips on the first real save (tools) ────────────────────
    const before = await api("GET", "/api/admin/modules", undefined, founderToken);
    const t0 = before.json.modules.find((m: any) => m.id === "tools");
    const mk = await api(
      "POST",
      "/api/admin/tools",
      { name: "Probe Tool", purpose: "The probe's own card", url: "https://example.org/probe", category: "communication", visibility: "members" },
      founderToken,
    );
    const after = await api("GET", "/api/admin/modules", undefined, founderToken);
    const t1 = after.json.modules.find((m: any) => m.id === "tools");
    check(
      "F1 first real save flips readiness",
      t0.ready?.ready === false && mk.status === 200 && t1.ready?.ready === true,
      `before=${JSON.stringify(t0.ready)} after=${JSON.stringify(t1.ready)}`,
    );

    // ── H: WebKit iPhone 14: the card on /messages, no sideways scroll ──────
    const wk = await webkit.launch();
    cleanup.push(() => wk.close());
    const iphone = devices["iPhone 14"] ?? {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    };
    const wkCtx = await wk.newContext({ ...iphone, viewport: { width: 390, height: 844 } });
    const wkPage = await wkCtx.newPage();
    await wkPage.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
    await wkPage.waitForTimeout(3500);
    const wkCard = await wkPage.evaluate(() => ({
      card: document.body.innerText.includes("opens when you sign in"),
      next: document.querySelector("a[href^='/login?next=']")?.getAttribute("href") ?? null,
    }));
    await wkPage.screenshot({ path: path.join(SHOTS, "messages-signin-390x844.png") });
    check(
      "H1 /messages sign-in card at 390x844 with ?next=",
      wkCard.card && wkCard.next === "/login?next=%2Fmessages",
      `next=${wkCard.next}`,
    );
    // The ?next= is WORKING, end to end: tap Sign in, sign in, land back on
    // /messages (messaging is at members here, so the inbox renders).
    await wkPage.click("a[href^='/login?next=']");
    await wkPage.waitForTimeout(2000);
    await wkPage.fill("input[type='email']", founder.email);
    await wkPage.fill("input[type='password']", founder.password);
    await wkPage.click("button[type='submit']");
    await wkPage.waitForTimeout(3500);
    const landedAt = await wkPage.evaluate(() => location.pathname);
    check("H1b signing in returns to ?next=", landedAt === "/messages", `landed ${landedAt}`);
    await wkPage.evaluate(() => localStorage.removeItem("village-auth-token"));
    for (const route of ["/modules", "/modules/stays"]) {
      await wkPage.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await wkPage.waitForTimeout(3500);
      const width = await wkPage.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
      if (!(width > 0)) check(`H2 ${route} measured a real width`, false, String(width));
      else check(`H2 ${route} no sideways scroll at 390`, width <= 390, `scrollWidth=${width}`);
      await wkPage.screenshot({ path: path.join(SHOTS, `l1-${route.replace(/\W+/g, "_")}-390.png`) });
    }

    // ── G: detail-page Turn on -> Go-live -> Members only (messaging) ───────
    await api("PUT", "/api/admin/modules/messaging/lifecycle", { lifecycle: "off" }, founderToken);
    const detail = await adminCtx.newPage();
    await detail.goto(`${BASE}/modules/messaging`, { waitUntil: "domcontentloaded" });
    await detail.waitForTimeout(3500);
    await detail.getByRole("button", { name: "Turn on" }).click();
    await detail.waitForTimeout(2500);
    const goLiveVisible = await detail.evaluate(() => document.body.innerText.includes("Go live?"));
    check("G1 setup-none module offers Go-live right after Turn on", goLiveVisible);
    await detail.getByRole("button", { name: "Members only" }).click();
    await detail.waitForTimeout(2500);
    const [rows] = await testDb.conn.query<any[]>(
      "SELECT COUNT(*) AS n FROM module_events WHERE module_id = 'messaging' AND kind = 'lifecycle' AND from_value = 'preview' AND to_value = 'members'",
    );
    check("G2 Go-live wrote the module_events lifecycle row", Number(rows[0].n) >= 1, `rows=${rows[0].n}`);

    // ── I: preview is a 404 page to the signed-out, manifest unmoved ────────
    // Everything off (feed before forum), then tools alone at preview.
    for (const id of ["feed", "forum", "map", "messaging", "stays", "badges", "library", "health", "automation", "network", "exchange", "commerce", "events", "tools"]) {
      await api("PUT", `/api/admin/modules/${id}/lifecycle`, { lifecycle: "off" }, founderToken);
    }
    const manifest0 = await api("GET", "/api/modules");
    await api("PUT", "/api/admin/modules/tools/lifecycle", { lifecycle: "preview", examples: false }, founderToken);
    const manifest1 = await api("GET", "/api/modules");
    check(
      "I1 anonymous manifest byte-identical with a preview module",
      JSON.stringify(manifest0.json.modules) === JSON.stringify(manifest1.json.modules) &&
        (manifest1.json.signInToSee ?? []).length === 0,
      `signInToSee=[${(manifest1.json.signInToSee ?? []).join(",")}]`,
    );
    const previewPage = await anonCtx.newPage();
    await previewPage.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded" });
    await previewPage.waitForTimeout(3000);
    const previewVerdict = await previewPage.evaluate(() => ({
      notFound: !!Array.from(document.querySelectorAll("h1")).find((h) => h.textContent?.trim() === "404"),
      card: document.body.innerText.includes("opens when you sign in"),
    }));
    check("I2 preview renders the 404 page to the signed-out, never the card", previewVerdict.notFound && !previewVerdict.card);

    // Main JS budget evidence. The baseline is L1's dispatch measurement at
    // def4b18 (515134); after another lane's merge moves the shared shell,
    // pass L1_MAIN_JS_BASELINE with that lane's growth folded in, so this
    // keeps measuring THIS lane's delta and never re-litigates someone
    // else's bytes.
    const baseline = Number(process.env.L1_MAIN_JS_BASELINE ?? 515134);
    const assets = fs.readdirSync(path.join(ROOT, "dist", "public", "assets")).filter((f) => /^index-.*\.js$/.test(f));
    const mainBytes = Math.max(...assets.map((f) => fs.statSync(path.join(ROOT, "dist", "public", "assets", f)).size));
    check(`J1 main JS within 1 KB of the ${baseline}-byte baseline`, Math.abs(mainBytes - baseline) <= 1024, `${mainBytes} bytes`);
  } finally {
    for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* closing */ } }
    child.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* tmp */ }
    await testDb.drop();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${SHOTS}`);
  if (failed.length) {
    console.error(`FAILED: ${failed.map((f) => f.name).join("; ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
