#!/usr/bin/env node
/**
 * THE SEASON TWO TEST VILLAGE, step 3 of 3: walk every surface as three people at two widths.
 *
 *   node scripts/qa/season-village/walk.mjs
 *   node scripts/qa/season-village/walk.mjs --only journey,governance --roles member --viewports phone
 *   node scripts/qa/season-village/walk.mjs --surfaces path/to/other-surfaces.json
 *
 * For every surface in surfaces.json, at desktop (1360x900) and phone (390x844,
 * touch, no device emulation), as a visitor, a member and the founder who holds
 * the canvas pen, it records: the HTTP status, console and page errors, failed
 * requests, horizontal overflow (scrollWidth over clientWidth, with the widest
 * in-flow culprit), the required and forbidden text, whether the surface exists
 * at all, and a full-page screenshot. Each view of a surface (a button that
 * swaps what the page shows, like the Journey's Canvas) is pressed and measured
 * the same way, AFTER the resting page has been measured on its own.
 *
 * ── SETTLED MEANS TWO IDENTICAL READS ──────────────────────────────────────
 *
 * A page is read every 350ms: its text, its height, its element count. It is
 * measured only once two reads in a row agree, no request is in flight and no
 * spinner is visible. A page that never agrees within 15 seconds is measured
 * anyway and reported UNSETTLED, because an unsettled number is a claim about
 * a frame, not about the page.
 *
 * ── WHAT IT WRITES ─────────────────────────────────────────────────────────
 *
 * <QA_OUT_DIR>/runs/<stamp>/report.json, summary.md and shots/*.png. Never
 * inside the repository. Exit 0 when nothing failed, 1 when something did,
 * 2 when the walk could not run at all.
 *
 * Environment:
 *   QA_BASE_URL          a village to walk (default: the one boot.mjs is running)
 *   QA_OUT_DIR           where the run goes (default: the OS temp dir)
 *   PLAYWRIGHT_PATH      the playwright package directory (it is not a dependency of this repo)
 *   NODE_PATH            searched for playwright when PLAYWRIGHT_PATH is unset
 *   PLAYWRIGHT_CHROMIUM  a chrome executable, when the one playwright expects is not installed
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { tokenKey } from "../lib.mjs";
import { routes } from "../routes.mjs";
import { HERE, ROOT, baseUrl, fail, health, readJson, runsDir, serverState, tokensFile } from "./shared.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : String(argv[i + 1] ?? "");
};
const list = (name) => (flag(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const SURFACES_FILE = path.resolve(flag("--surfaces") || path.join(HERE, "surfaces.json"));
const ONLY = list("--only");
const ROLES_WANTED = list("--roles");
const VIEWPORTS_WANTED = list("--viewports");
/**
 * --self-check walks one page with a defect of every kind INJECTED into it, and
 * one path that does not exist, and passes only if each defect is reported.
 * A check that has never been seen to fail is a check nobody knows works: run
 * this after changing the probes, the settle rule or the classification.
 */
const SELF_CHECK = argv.includes("--self-check");

const SETTLE_EVERY_MS = 350;
const SETTLE_MAX_MS = 15_000;

// ── inputs ─────────────────────────────────────────────────────────────────

const spec = readJson(SURFACES_FILE);
if (!spec || !Array.isArray(spec.surfaces)) fail(`${SURFACES_FILE} is not a surfaces file (no "surfaces" list).`, 2);
const seen = new Set();
for (const s of spec.surfaces) {
  if (!s.id || !s.path || !String(s.path).startsWith("/")) fail(`every surface needs an id and a path starting with "/": ${JSON.stringify(s)}`, 2);
  if (seen.has(s.id)) fail(`surface id "${s.id}" appears twice in ${SURFACES_FILE}.`, 2);
  seen.add(s.id);
}

const BASE = baseUrl();
const h = await health(BASE);
if (!h.ok) fail(`${BASE}/health did not answer ok (${h.status} ${h.error ?? ""}). Is boot.mjs running?`, 2);

const seed = readJson(tokensFile());
const booted = serverState();
const seedIsForThisVillage = !!seed && (!booted || seed.villageId === booted.villageId);
if (seed && !seedIsForThisVillage) {
  console.log(`  tokens.json belongs to village ${seed.villageId} and this one is ${booted?.villageId}; the member and founder walks are skipped. Run seed.mjs.`);
}
const facts = seedIsForThisVillage ? seed.facts ?? {} : {};
const personFor = (role) => {
  if (!seedIsForThisVillage) return null;
  const key = seed.walkAs?.[role];
  return seed.people.find((p) => p.key === key) ?? null;
};

const VIEWPORTS = Object.entries(spec.viewports ?? {
  desktop: { width: 1360, height: 900, deviceScaleFactor: 1, touch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, touch: true },
}).filter(([name]) => (SELF_CHECK ? name === "desktop" : !VIEWPORTS_WANTED.length || VIEWPORTS_WANTED.includes(name)));
const ROLES = SELF_CHECK
  ? ["visitor"]
  : Object.keys(spec.roles ?? { visitor: "", member: "", founder: "" }).filter((r) => !ROLES_WANTED.length || ROLES_WANTED.includes(r));

/** The page the self-check poisons, and the text it is sure to carry. */
const SELF_CHECK_PATH = "/"; // the one route every fork keeps
const SELF_CHECK_SURFACES = [
  {
    id: "self-check-defects",
    path: SELF_CHECK_PATH,
    required: true,
    text: ["season-village self-check: text that is on no page"],
    forbidden: ["season-village self-check: words the page must not carry"],
    expect: { visitor: { path: "/season-village-self-check-nowhere" } },
  },
  { id: "self-check-missing", path: "/season-village-self-check-missing", required: true },
];
/** What the self-check must see, each as a pattern over the findings it produces. */
const SELF_CHECK_EXPECTS = [
  ["a page error", "fail", /^page error: .*self-check/],
  ["a console error", "fail", /^console error: .*self-check/],
  ["horizontal overflow", "fail", /^horizontal overflow \+\d+px/],
  ["missing required text", "fail", /^required text missing: "season-village self-check/],
  ["forbidden text", "fail", /^forbidden text present: "season-village self-check: words/],
  // Built when it is read: the term comes from the brand guard, never from this file.
  ["the injected brand term", "fail", () => new RegExp(`^forbidden text present: brand term "${BRAND?.[0] ?? "(none)"}"`, "i")],
  ["the wrong end path", "fail", /^expected to end on \/season-village-self-check-nowhere/],
  ["a refused request", "warn", /^request GET \/api\/admin\/launch answered 401/],
  ["a page that never settles", "warn", /^did not settle/],
  ["a missing required surface", "fail", /^a REQUIRED surface is missing/],
];

const SURFACES = SELF_CHECK ? SELF_CHECK_SURFACES : spec.surfaces.filter((s) => !ONLY.length || ONLY.includes(s.id));
if (!VIEWPORTS.length || !ROLES.length || !SURFACES.length) fail("the filters left nothing to walk.", 2);

/** The platform's banned brand terms, read from the guard that bans them. */
function brandTerms() {
  try {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "check-brand-refs.mjs"), "utf8");
    const block = /const BANNED = \[([\s\S]*?)\];/.exec(src);
    const terms = block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
    return terms.length ? terms : null;
  } catch {
    return null;
  }
}
const BRAND = brandTerms();

/** The router's own route table, so a surface can be called missing without guessing. */
const ROUTER = (() => {
  try {
    const r = routes();
    return {
      has: (pathname) =>
        r.concrete.includes(pathname) ||
        r.parameterised.some((p) => new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`).test(pathname)),
    };
  } catch {
    return null;
  }
})();

/** What the soft 404 says, from the page itself, plus whatever surfaces.json adds. */
const MISSING_MARKERS = (() => {
  const markers = new Set(spec.missingMarkers ?? []);
  try {
    const src = fs.readFileSync(path.join(ROOT, "client", "src", "pages", "NotFound.tsx"), "utf8");
    const m = /<h1[^>]*>\s*([^<{]+?)\s*<\/h1>/.exec(src);
    if (m) markers.add(m[1].trim());
  } catch {
    /* the markers from the file stand alone */
  }
  return [...markers];
})();

// ── playwright, which is not a dependency of this repo ─────────────────────

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const tries = [];
  const explicit = (process.env.PLAYWRIGHT_PATH ?? "").trim();
  if (explicit) tries.push(explicit, path.join(explicit, "playwright"), path.join(explicit, "node_modules", "playwright"));
  for (const dir of (process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean)) tries.push(path.join(dir, "playwright"));
  tries.push("playwright", "playwright-core");
  for (const t of tries) {
    try {
      const mod = req(t);
      if (mod?.chromium) return { pw: mod, from: t };
    } catch {
      /* next */
    }
  }
  fail(
    "playwright could not be loaded, and it is not a dependency of this repo. Point PLAYWRIGHT_PATH at an " +
      "installed playwright package directory (or NODE_PATH at the node_modules that holds it).",
    2,
  );
}

function chromiumExecutable(pw) {
  const explicit = (process.env.PLAYWRIGHT_CHROMIUM ?? "").trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) fail(`PLAYWRIGHT_CHROMIUM is ${explicit}, which does not exist.`, 2);
    return explicit;
  }
  try {
    if (fs.existsSync(pw.chromium.executablePath())) return undefined; // the one playwright expects is installed
  } catch {
    /* look for another */
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    } catch {
      continue;
    }
    for (const d of dirs) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  fail("no chromium was found. Install one with `npx playwright install chromium`, or set PLAYWRIGHT_CHROMIUM.", 2);
}

// ── in-page probes (serialised into the browser) ───────────────────────────

const SIGNATURE = () => {
  const t = document.body ? document.body.innerText : "";
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
  const spinners = [...document.querySelectorAll(".animate-spin")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).length;
  const de = document.documentElement;
  return {
    key: [location.pathname, location.search, t.length, hash, de.scrollHeight, document.getElementsByTagName("*").length].join("|"),
    spinners,
  };
};

/**
 * The page as read at this moment. Overflow carries the sweep's containment
 * rule (scripts/qa/sweep.mjs): an element past the right edge only widens the
 * document when nothing between it and <html> clips or scrolls.
 */
const MEASURE = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const contained = (el) => {
    for (let e = el.parentElement; e && e !== de; e = e.parentElement) {
      if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(e).overflowX)) return true;
    }
    return false;
  };
  const offenders = [];
  if (de.scrollWidth - vw > 1) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= vw + 1 || contained(el)) continue;
      const pos = getComputedStyle(el).position;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") || "").slice(0, 60),
        right: Math.round(r.right),
        fixed: pos === "fixed" || pos === "absolute",
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
      });
    }
    offenders.sort((a, b) => Number(a.fixed) - Number(b.fixed) || b.right - a.right);
  }
  return {
    pathname: location.pathname,
    search: location.search,
    title: document.title,
    text: document.body ? document.body.innerText : "",
    scrollWidth: de.scrollWidth,
    clientWidth: vw,
    overflow: Math.max(0, de.scrollWidth - vw),
    culprit: offenders[0] ?? null,
  };
};

const SCROLL_THROUGH = async () => {
  document.documentElement.style.scrollBehavior = "auto";
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 80));
  }
  window.scrollTo(0, 0);
};

// ── the checks ─────────────────────────────────────────────────────────────

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const notMeasurable = [];

/** Expand $placeholders. Returns null when one cannot be resolved, which is counted, never passed. */
function expand(text, role, where) {
  const viewer = personFor(role);
  const values = { ...facts, viewerName: viewer?.name };
  let unresolved = null;
  const out = String(text).replace(/\$([A-Za-z]+)/g, (whole, key) => {
    if (key === "brandTerms") return whole;
    const v = values[key];
    if (v === undefined || v === null || v === "") unresolved = key;
    return v ?? whole;
  });
  if (unresolved) {
    notMeasurable.push(`${where}: "${text}" needs $${unresolved}, which the seed did not provide`);
    return null;
  }
  return out;
}

function checkText(m, rules, role, where) {
  const haystack = norm(`${m.title}\n${m.text}`);
  const requiredMissing = [];
  const forbiddenFound = [];
  for (const want of rules.required) {
    const text = expand(want, role, where);
    if (text !== null && !haystack.includes(norm(text))) requiredMissing.push(text);
  }
  for (const bad of rules.forbidden) {
    if (bad === "$brandTerms") {
      if (!BRAND) {
        notMeasurable.push(`${where}: the brand terms could not be read from scripts/check-brand-refs.mjs`);
        continue;
      }
      for (const term of BRAND) {
        const hit = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").exec(`${m.title}\n${m.text}`);
        if (hit) forbiddenFound.push(`brand term "${hit[0]}"`);
      }
      continue;
    }
    const text = expand(bad, role, where);
    if (text !== null && haystack.includes(norm(text))) forbiddenFound.push(`"${text}"`);
  }
  return { requiredMissing, forbiddenFound };
}

function rulesFor(surface, view, role) {
  const exp = surface.expect?.[role] ?? {};
  const base = view ? { text: view.text ?? [], forbidden: view.forbidden ?? [] } : { text: [...(surface.text ?? []), ...(exp.text ?? [])], forbidden: exp.forbidden ?? [] };
  return {
    required: base.text,
    forbidden: [...(spec.forbiddenEverywhere ?? []), ...(surface.forbidden ?? []), ...base.forbidden],
    path: view ? null : exp.path ?? null,
  };
}

// ── walking one page ───────────────────────────────────────────────────────

function track(page) {
  const ev = { console: [], pageErrors: [], failed: [], inflight: new Set() };
  const settleIgnore = (spec.settleIgnore ?? []).map((p) => new RegExp(p));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // A failed resource is also a response below, where it carries its URL. Counted there.
    if (/^Failed to load resource/i.test(text)) return;
    ev.console.push(text.slice(0, 300));
  });
  page.on("pageerror", (e) => ev.pageErrors.push(String(e?.message ?? e).slice(0, 300)));
  page.on("request", (r) => {
    if (["eventsource", "websocket"].includes(r.resourceType())) return;
    if (settleIgnore.some((re) => re.test(r.url()))) return;
    ev.inflight.add(r);
  });
  page.on("requestfinished", (r) => ev.inflight.delete(r));
  page.on("requestfailed", (r) => {
    ev.inflight.delete(r);
    const why = r.failure()?.errorText ?? "failed";
    // An aborted fetch is a component unmounting or a navigation, not a broken endpoint.
    if (/ERR_ABORTED/i.test(why)) return;
    ev.failed.push({ status: 0, method: r.method(), url: r.url(), error: why });
  });
  page.on("response", (r) => {
    if (r.status() >= 400) ev.failed.push({ status: r.status(), method: r.request().method(), url: r.url() });
  });
  return ev;
}

async function settle(page, ev) {
  const started = Date.now();
  let prev = null;
  let reads = 0;
  let last = { spinners: 0 };
  while (Date.now() - started < SETTLE_MAX_MS) {
    await page.waitForTimeout(SETTLE_EVERY_MS);
    try {
      last = await page.evaluate(SIGNATURE);
    } catch {
      prev = null; // a navigation replaced the document mid-read
      continue;
    }
    reads++;
    const quiet = ev.inflight.size === 0 && last.spinners === 0;
    if (quiet && prev === last.key) return { settled: true, ms: Date.now() - started, reads };
    prev = quiet ? last.key : null;
  }
  return { settled: false, ms: Date.now() - started, reads, inflight: ev.inflight.size, spinners: last.spinners };
}

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

/** Read, check and photograph whatever the page shows now. */
async function capture(page, ev, ctxInfo, surface, view, marks, status, shotsDir, runDir) {
  const where = `${ctxInfo.viewport}/${ctxInfo.role}/${surface.id}/${view?.id ?? "rest"}`;
  const s1 = await settle(page, ev);
  const atRest = await page.evaluate(MEASURE);
  // Lazy content arrives on scroll: walk the page, let it settle, and read the width again.
  await page.evaluate(SCROLL_THROUGH).catch(() => undefined);
  const s2 = await settle(page, ev);
  const afterScroll = await page.evaluate(MEASURE).catch(() => atRest);
  const shot = path.join(shotsDir, `${slug(ctxInfo.viewport)}-${slug(ctxInfo.role)}-${slug(surface.id)}-${slug(view?.id ?? "rest")}.png`);
  let screenshot = null;
  try {
    await page.screenshot({ path: shot, fullPage: true });
    screenshot = path.relative(runDir, shot).split(path.sep).join("/");
  } catch (e) {
    notMeasurable.push(`${where}: the screenshot failed (${String(e?.message ?? e).split("\n")[0]})`);
  }

  const inRouter = ROUTER ? ROUTER.has(surface.path.split("?")[0]) : null;
  if (!ROUTER) notMeasurable.push(`${where}: the router table in client/src/App.tsx could not be read`);
  const rendered404 = MISSING_MARKERS.some((mk) => norm(atRest.text).includes(norm(mk)));
  const missing = inRouter === false || rendered404;

  const rules = rulesFor(surface, view, ctxInfo.role);
  const text = missing ? { requiredMissing: [], forbiddenFound: [] } : checkText(atRest, rules, ctxInfo.role, where);
  const overflow = Math.max(atRest.overflow, afterScroll.overflow);
  const culprit = atRest.overflow >= afterScroll.overflow ? atRest.culprit : afterScroll.culprit;

  const consoleErrors = ev.console.slice(marks.console);
  const pageErrors = ev.pageErrors.slice(marks.pageErrors);
  const failedRequests = ev.failed.slice(marks.failed).map((f) => ({ ...f, url: f.url.replace(BASE, "") }));

  const findings = [];
  const add = (severity, what) => findings.push({ severity, where, what });
  if (status >= 400) add("fail", `HTTP ${status} for the document`);
  if (missing) {
    add(surface.required ? "fail" : "info", `${surface.required ? "a REQUIRED surface is missing" : "missing (not built yet)"}: ${inRouter === false ? "no route in client/src/App.tsx" : "the page renders the soft 404"}`);
  }
  for (const e of pageErrors) add("fail", `page error: ${e}`);
  for (const e of consoleErrors) add("fail", `console error: ${e}`);
  if (overflow > 1) {
    add("fail", `horizontal overflow +${overflow}px` + (culprit ? ` (widest: <${culprit.tag} class="${culprit.cls}"> "${culprit.text}"${culprit.fixed ? ", positioned, likely a symptom" : ""})` : ""));
  }
  for (const t of text.requiredMissing) add("fail", `required text missing: "${t}"`);
  for (const t of text.forbiddenFound) add("fail", `forbidden text present: ${t}`);
  if (rules.path && !missing && atRest.pathname !== rules.path) add("fail", `expected to end on ${rules.path}, ended on ${atRest.pathname}`);
  for (const f of failedRequests) add(f.status >= 500 ? "fail" : "warn", `request ${f.method} ${f.url} ${f.status ? `answered ${f.status}` : `failed (${f.error})`}`);
  if (!s1.settled || !s2.settled) {
    const s = !s1.settled ? s1 : s2;
    add("warn", `did not settle in ${SETTLE_MAX_MS / 1000}s (${s.inflight} request(s) in flight, ${s.spinners} spinner(s) visible); measured anyway`);
  }

  const verdict = findings.some((f) => f.severity === "fail") ? "fail" : missing ? "missing" : "pass";
  return {
    viewport: ctxInfo.viewport,
    role: ctxInfo.role,
    surface: surface.id,
    path: surface.path,
    view: view?.id ?? "rest",
    required: !!surface.required,
    verdict,
    status,
    finalPath: `${atRest.pathname}${atRest.search}`,
    missing,
    settled: s1.settled && s2.settled,
    settleMs: s1.ms + s2.ms,
    overflowPx: overflow,
    consoleErrors,
    pageErrors,
    failedRequests,
    requiredMissing: text.requiredMissing,
    forbiddenFound: text.forbiddenFound,
    textLength: atRest.text.length,
    screenshot,
    findings,
  };
}

async function walkSurface(ctx, ctxInfo, surface, shotsDir, runDir) {
  const page = await ctx.newPage();
  const ev = track(page);
  const results = [];
  try {
    let status = 0;
    try {
      const resp = await page.goto(BASE + surface.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      status = resp?.status() ?? 0;
    } catch (e) {
      const where = `${ctxInfo.viewport}/${ctxInfo.role}/${surface.id}/rest`;
      results.push({
        viewport: ctxInfo.viewport, role: ctxInfo.role, surface: surface.id, path: surface.path, view: "rest",
        required: !!surface.required, verdict: "fail", status: 0,
        findings: [{ severity: "fail", where, what: `navigation failed: ${String(e?.message ?? e).split("\n")[0]}` }],
      });
      return results;
    }
    const marks = () => ({ console: ev.console.length, pageErrors: ev.pageErrors.length, failed: ev.failed.length });
    const rest = await capture(page, ev, ctxInfo, surface, null, { console: 0, pageErrors: 0, failed: 0 }, status, shotsDir, runDir);
    results.push(rest);
    if (rest.missing) return results;

    for (const view of surface.views ?? []) {
      if (view.roles && !view.roles.includes(ctxInfo.role)) continue;
      const where = `${ctxInfo.viewport}/${ctxInfo.role}/${surface.id}/${view.id}`;
      const mark = marks();
      await page.evaluate(() => window.scrollTo(0, 0));
      const button = page.getByRole("button", { name: view.click, exact: true });
      const count = await button.count();
      if (count === 0) {
        const findings = [{ severity: surface.required && view.required !== false ? "fail" : "info", where, what: `no "${view.click}" button to press, so this view was not reached` }];
        results.push({
          viewport: ctxInfo.viewport, role: ctxInfo.role, surface: surface.id, path: surface.path, view: view.id,
          required: !!surface.required, verdict: findings[0].severity === "fail" ? "fail" : "missing", status, missing: true, findings,
        });
        continue;
      }
      try {
        await button.first().click({ timeout: 10_000 });
      } catch (e) {
        results.push({
          viewport: ctxInfo.viewport, role: ctxInfo.role, surface: surface.id, path: surface.path, view: view.id,
          required: !!surface.required, verdict: "fail", status,
          findings: [{ severity: "fail", where, what: `the "${view.click}" button could not be pressed: ${String(e?.message ?? e).split("\n")[0]}` }],
        });
        continue;
      }
      results.push(await capture(page, ev, ctxInfo, surface, view, mark, status, shotsDir, runDir));
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return results;
}

// ── the run ────────────────────────────────────────────────────────────────

const { pw, from } = loadPlaywright();
const executablePath = chromiumExecutable(pw);
const stamp = new Date().toISOString().replace(/[:.]/g, "-") + (SELF_CHECK ? "-self-check" : "");
const runDir = path.join(runsDir(), stamp);
const shotsDir = path.join(runDir, "shots");
fs.mkdirSync(shotsDir, { recursive: true });

console.log(`\nwalking ${BASE} (build ${h.build})`);
console.log(`  surfaces: ${SURFACES.map((s) => s.id).join(", ")}  (${path.relative(ROOT, SURFACES_FILE).split(path.sep).join("/")})`);
console.log(`  viewports: ${VIEWPORTS.map(([n, v]) => `${n} ${v.width}x${v.height}`).join(", ")}; roles: ${ROLES.join(", ")}`);
console.log(`  playwright from ${from}${executablePath ? `, chromium ${executablePath}` : ""}`);
console.log(`  output: ${runDir}`);

const started = Date.now();
const browser = await pw.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [];
const skippedRoles = [];
const KEY = tokenKey();
try {
  for (const [viewport, vp] of VIEWPORTS) {
    for (const role of ROLES) {
      const person = role === "visitor" ? null : personFor(role);
      if (role !== "visitor" && !person) {
        skippedRoles.push(`${viewport}/${role}`);
        notMeasurable.push(`${viewport}/${role}: no seeded person to sign in as, so every surface for this role is unwalked`);
        continue;
      }
      // hasTouch without isMobile: device emulation reports innerWidth at a
      // multiple of the CSS viewport on this chromium, and the page lays out wide.
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor ?? 1,
        hasTouch: !!vp.touch,
      });
      if (person) {
        await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* storage refused */ } }, [KEY, person.token]);
      }
      if (SELF_CHECK) {
        // One defect of every kind, outside React's root so a render cannot remove it.
        await ctx.addInitScript(([where, brand]) => {
          if (location.pathname !== where) return;
          document.addEventListener("DOMContentLoaded", () => {
            console.error("season-village self-check: an injected console error");
            const wide = document.createElement("div");
            wide.style.cssText = "width:3000px;height:4px";
            document.body.appendChild(wide);
            const spinner = document.createElement("div");
            spinner.className = "animate-spin";
            spinner.style.cssText = "width:12px;height:12px";
            document.body.appendChild(spinner);
            const named = document.createElement("p");
            named.textContent = `self-check ${brand}. season-village self-check: words the page must not carry`;
            document.body.appendChild(named);
            fetch("/api/admin/launch").catch(() => undefined);
            setTimeout(() => { throw new Error("season-village self-check: an injected page error"); }, 0);
          });
        }, [SELF_CHECK_PATH, BRAND?.[0] ?? ""]);
      }
      console.log(`\n  ${viewport} as ${role}${person ? ` (${person.name})` : ""}`);
      for (const surface of SURFACES) {
        // One page that breaks the walk is a finding about that page, and the rest still get walked.
        const got = await walkSurface(ctx, { viewport, role }, surface, shotsDir, runDir).catch((e) => [{
          viewport, role, surface: surface.id, path: surface.path, view: "rest", required: !!surface.required, verdict: "fail", status: 0,
          findings: [{ severity: "fail", where: `${viewport}/${role}/${surface.id}/rest`, what: `the walk broke on this page: ${String(e?.message ?? e).split("\n")[0]}` }],
        }]);
        for (const r of got) {
          results.push(r);
          const worst = r.findings.find((f) => f.severity === "fail") ?? r.findings.find((f) => f.severity === "warn");
          const label = `${surface.id}${r.view === "rest" ? "" : `:${r.view}`}`;
          console.log(`    ${r.verdict.toUpperCase().padEnd(7)} ${label.padEnd(26)} ${String(r.status ?? "").padEnd(4)} ${worst ? worst.what.slice(0, 110) : ""}`);
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

// ── the report ─────────────────────────────────────────────────────────────

const findings = results.flatMap((r) => r.findings);
const totals = {
  pageViews: results.length,
  pass: results.filter((r) => r.verdict === "pass").length,
  fail: results.filter((r) => r.verdict === "fail").length,
  missing: results.filter((r) => r.verdict === "missing").length,
  withWarnings: results.filter((r) => r.findings.some((f) => f.severity === "warn")).length,
  failFindings: findings.filter((f) => f.severity === "fail").length,
  warnFindings: findings.filter((f) => f.severity === "warn").length,
  notMeasurable: notMeasurable.length,
};
const seconds = Math.round((Date.now() - started) / 1000);
const report = {
  base: BASE,
  build: h.build,
  bootId: booted?.bootId ?? null,
  villageId: booted?.villageId ?? null,
  seededVillage: seed?.villageId ?? null,
  startedAt: new Date(started).toISOString(),
  seconds,
  surfacesFile: SURFACES_FILE,
  viewports: Object.fromEntries(VIEWPORTS),
  roles: ROLES,
  skippedRoles,
  brandTerms: BRAND,
  missingMarkers: MISSING_MARKERS,
  totals,
  notMeasurable,
  results,
};
fs.writeFileSync(path.join(runDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "summary.md"), summary(report));

console.log(`\n  ${totals.pageViews} page views in ${seconds}s: ${totals.pass} pass, ${totals.fail} fail, ${totals.missing} missing, ${totals.withWarnings} with warnings`);
console.log(`  ${totals.failFindings} failing finding(s), ${totals.warnFindings} warning(s)`);
console.log(`  ${notMeasurable.length} check(s) NOT MEASURABLE (counted, never treated as passing)`);
for (const n of notMeasurable.slice(0, 8)) console.log(`      ${n}`);
console.log(`  report: ${path.join(runDir, "report.json")}`);
console.log(`  summary: ${path.join(runDir, "summary.md")}`);
if (SELF_CHECK) {
  console.log("\n  self-check: every injected defect must be reported");
  let unseen = 0;
  for (const [label, severity, pattern] of SELF_CHECK_EXPECTS) {
    const re = typeof pattern === "function" ? pattern() : pattern;
    const seenIt = findings.some((f) => f.severity === severity && re.test(f.what));
    if (!seenIt) unseen++;
    console.log(`    ${seenIt ? "DETECTED    " : "NOT DETECTED"} ${label} (${severity})`);
  }
  console.log(unseen ? `\n  SELF-CHECK FAILED: ${unseen} injected defect(s) went unreported.` : "\n  self-check passed: every instrument reported what was put in front of it.");
  process.exitCode = unseen ? 1 : 0;
} else {
  process.exitCode = totals.fail > 0 ? 1 : 0;
}

function summary(r) {
  const cell = (s) => String(s).replace(/\|/g, "\\|");
  const lines = [];
  lines.push("# Season village walk", "");
  lines.push(`- Village: ${r.base}, build \`${r.build}\`, boot \`${r.bootId ?? "external"}\``);
  lines.push(`- Walked: ${r.startedAt} in ${r.seconds}s, surfaces from \`${path.relative(ROOT, r.surfacesFile).split(path.sep).join("/")}\``);
  lines.push(`- Viewports: ${Object.entries(r.viewports).map(([n, v]) => `${n} ${v.width}x${v.height}${v.touch ? " touch" : ""}`).join(", ")}. Roles: ${r.roles.join(", ")}`);
  lines.push(`- **${r.totals.pageViews} page views: ${r.totals.pass} pass, ${r.totals.fail} fail, ${r.totals.missing} missing, ${r.totals.withWarnings} with warnings.** ${r.totals.notMeasurable} check(s) NOT MEASURABLE.`);
  if (r.skippedRoles.length) lines.push(`- Roles not walked (no seeded person): ${r.skippedRoles.join(", ")}`);
  lines.push("");

  const cols = [];
  for (const vp of Object.keys(r.viewports)) for (const role of r.roles) cols.push([vp, role]);
  const rows = [...new Set(r.results.map((x) => `${x.surface}${x.view === "rest" ? "" : `:${x.view}`}`))];
  lines.push("## Matrix", "");
  lines.push(`| surface | ${cols.map(([v, ro]) => `${v} ${ro}`).join(" | ")} |`);
  lines.push(`|---|${cols.map(() => "---").join("|")}|`);
  for (const row of rows) {
    const [sid, view = "rest"] = row.split(":");
    const cells = cols.map(([v, ro]) => {
      const hit = r.results.find((x) => x.surface === sid && x.view === view && x.viewport === v && x.role === ro);
      if (!hit) return "";
      const warn = hit.findings.some((f) => f.severity === "warn") ? " (w)" : "";
      return `${hit.verdict.toUpperCase()}${warn}`;
    });
    lines.push(`| ${row} | ${cells.join(" | ")} |`);
  }
  lines.push("", "PASS, FAIL, MISSING (not built yet, and not required), (w) has warnings. Blank: that view is not offered to that role.", "");

  // Grouped by what was found, so one defect on every page reads as one line with its reach.
  const section = (title, sev) => {
    const hits = r.results.flatMap((x) => x.findings.filter((f) => f.severity === sev));
    lines.push(`## ${title} (${hits.length})`, "");
    if (!hits.length) lines.push("None.");
    else {
      const groups = new Map();
      for (const f of hits) groups.set(f.what, [...(groups.get(f.what) ?? []), f.where]);
      lines.push("| what | pages | where |", "|---|---|---|");
      for (const [what, where] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`| ${cell(what)} | ${where.length} | ${cell(where.join(", "))} |`);
      }
    }
    lines.push("");
  };
  section("Failures", "fail");
  section("Warnings", "warn");
  section("Missing surfaces and views", "info");

  lines.push(`## Not measurable (${r.notMeasurable.length})`, "");
  lines.push(r.notMeasurable.length ? r.notMeasurable.map((n) => `- ${n}`).join("\n") : "None. (Printed even at zero: silence reads as a pass.)");
  lines.push("", "## Screenshots", "");
  for (const x of r.results.filter((y) => y.screenshot)) lines.push(`- ${x.viewport}/${x.role}/${x.surface}/${x.view}: \`${x.screenshot}\``);
  lines.push("");
  return lines.join("\n");
}
