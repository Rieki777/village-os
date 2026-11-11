/**
 * The browser side of the rehearsal: contexts at 390 and 1280, the per-page
 * checks, and the record each persona walk writes into.
 *
 * Playwright and axe-core are NOT dependencies of this repository. The runner
 * finds them in the folder REHEARSAL_DEPS names (a folder with a node_modules
 * holding `playwright` and `axe-core`), and the nightly workflow installs both
 * there. Without it the runner tries a plain `import("playwright")`.
 *
 * Every context aborts any request that leaves loopback and records it, so a
 * walk can never write to a real site, and a page that reaches out to one
 * says so in the summary.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { isLoopbackUrl } from "./guard.mjs";

export async function loadBrowserDeps() {
  const dir = process.env.REHEARSAL_DEPS;
  if (dir) {
    const req = createRequire(path.join(path.resolve(dir), "package.json"));
    return { chromium: req("playwright").chromium, axeSource: fs.readFileSync(req.resolve("axe-core/axe.min.js"), "utf8") };
  }
  const pw = await import("playwright");
  const req = createRequire(import.meta.url);
  return { chromium: pw.chromium, axeSource: fs.readFileSync(req.resolve("axe-core/axe.min.js"), "utf8") };
}

export const VIEWPORTS = {
  phone: { width: 390, options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  desktop: { width: 1280, options: { viewport: { width: 1280, height: 860 } } },
};

/** The axe rules the audit used: contrast, names, labels, landmarks and headings. */
const AXE_RULES = ["color-contrast", "button-name", "link-name", "label", "image-alt", "html-has-lang", "document-title", "aria-valid-attr-value", "nested-interactive", "select-name", "heading-order", "region"];

/**
 * One persona at one viewport. `walk.step(name, fn)` runs one act and records
 * pass or fail; `walk.look(name, opts)` checks the page and takes the shot.
 */
export class Walk {
  constructor({ browser, axeSource, persona, vp, shotsDir, base, locale = "en-GB", token = null, ip }) {
    Object.assign(this, { browser, axeSource, persona, vp, shotsDir, base, locale, token, ip });
    this.steps = [];
    this.pages = [];
    this.console = [];
    this.failedRequests = [];
    this.blockedExternal = [];
    this.stopped = false;
  }

  async open() {
    const ctx = await this.browser.newContext({
      ...VIEWPORTS[this.vp].options,
      locale: this.locale,
      extraHTTPHeaders: { "Accept-Language": this.locale, "x-forwarded-for": this.ip },
    });
    await ctx.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:") || isLoopbackUrl(url)) return route.continue();
      this.blockedExternal.push(`${route.request().method()} ${url.slice(0, 160)}`);
      return route.abort();
    });
    if (this.token) {
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("village-auth-token", t);
        } catch {}
      }, this.token);
    }
    ctx.on("page", (p) => this.wire(p));
    this.ctx = ctx;
    this.page = await ctx.newPage();
    this.page.setDefaultTimeout(10_000);
    this.wire(this.page);
    return this.page;
  }

  wire(page) {
    if (page.__rehearsalWired) return;
    page.__rehearsalWired = true;
    const where = () => {
      try {
        return new URL(page.url()).pathname;
      } catch {
        return page.url();
      }
    };
    page.on("console", (m) => {
      if (m.type() === "error") this.console.push(`${where()} :: ${m.text().slice(0, 240)}`);
    });
    page.on("pageerror", (e) => this.console.push(`${where()} :: page error ${String(e).slice(0, 240)}`));
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().includes("favicon")) this.failedRequests.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    page.on("requestfailed", (r) => {
      const why = r.failure()?.errorText ?? "";
      if (!isLoopbackUrl(r.url())) return; // already recorded as blocked
      if (/ERR_ABORTED/.test(why) && r.method() === "GET") return; // navigation away
      this.failedRequests.push(`FAILED ${r.method()} ${new URL(r.url()).pathname} ${why}`);
    });
  }

  async goto(route) {
    await this.page.goto(this.base + route, { waitUntil: "domcontentloaded" });
    await settle(this.page);
  }

  /**
   * Runs one act. A failed act stops the rest of this walk (they depend on it);
   * the rest are recorded as not reached by `finish`.
   */
  async step(name, fn) {
    if (this.stopped) {
      this.steps.push({ name, ok: false, skipped: true });
      return undefined;
    }
    const started = Date.now();
    try {
      const value = await fn(this.page);
      this.steps.push({ name, ok: true, ms: Date.now() - started });
      return value;
    } catch (e) {
      this.steps.push({ name, ok: false, ms: Date.now() - started, error: String(e?.message ?? e).split("\n")[0].slice(0, 300) });
      this.stopped = true;
      await this.shot(`FAILED-${slug(name)}`).catch(() => {});
      return undefined;
    }
  }

  /** The screenshot name: persona, viewport, then the look's own name. */
  shotName(name) {
    return `${this.persona}-${this.vp}-${slug(name)}`;
  }

  async shot(name, { full = true } = {}) {
    const file = path.join(this.shotsDir, `${this.shotName(name)}.png`);
    await this.page.screenshot({ path: file, fullPage: full, animations: "disabled", caret: "hide" });
    return file;
  }

  /**
   * Checks the page as it stands and takes the screenshot. `next` is a locator
   * for the act this person is about to press, so the phone check can ask
   * whether it sits within thumb reach. `journey` marks a page of the joining
   * journey, where the desktop check asks whether the layout is only the phone
   * column stretched.
   */
  async look(name, { next = null, journey = true, full = true } = {}) {
    if (this.stopped) return;
    const page = this.page;
    await settle(page);
    const rec = { name, shot: this.shotName(name), path: safePath(page.url()) };
    rec.overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    rec.axe = await this.axe();
    rec.findings = [];
    if (rec.overflow > 1) rec.findings.push({ kind: "sideways-scroll", detail: `the page scrolls sideways by ${rec.overflow}px` });
    if (this.vp === "phone") {
      // A target reported once in this walk (the footer, the menu) is not reported again.
      this.seenSmall ??= new Set();
      const small = (await smallTargets(page)).filter((t) => !this.seenSmall.has(t));
      for (const t of small) this.seenSmall.add(t);
      if (small.length) rec.findings.push({ kind: "small-targets", detail: `${small.length} tap target(s) under 44px`, samples: small.slice(0, 6) });
      if (next) {
        const reach = await thumbReach(page, next);
        if (reach) rec.findings.push({ kind: "thumb-reach", detail: reach });
      }
    } else if (journey) {
      const col = await columnSpan(page);
      if (col && col.span < 600) rec.findings.push({ kind: "stretched-phone", detail: `the content spans ${col.span}px of ${col.viewport}px with nothing beside it` });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await this.shot(name, { full });
    this.pages.push(rec);
  }

  async axe() {
    const page = this.page;
    await page.addScriptTag({ content: this.axeSource }).catch(() => {});
    return page
      .evaluate(async (rules) => {
        const r = await window.axe.run(document, { runOnly: { type: "rule", values: rules } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
      }, AXE_RULES)
      .catch((e) => [{ id: "axe-error", impact: "unknown", nodes: 0, error: String(e).slice(0, 160) }]);
  }

  async finish() {
    await this.ctx?.close().catch(() => {});
    return {
      persona: this.persona,
      vp: this.vp,
      width: VIEWPORTS[this.vp].width,
      steps: this.steps,
      pages: this.pages,
      console: this.console,
      failedRequests: this.failedRequests,
      blockedExternal: [...new Set(this.blockedExternal)],
    };
  }
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** The path and query of a URL, with any token in the query cut out. */
function safePath(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/token|invite|key/i.test(k)) u.searchParams.set(k, "…");
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return url;
  }
}

export async function settle(page, ms = 600) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 8000 });
  } catch {}
  await page.waitForTimeout(ms);
}

/** Visible tap targets under 44px in either direction. Inline links inside running text are exempt (WCAG 2.5.8). */
async function smallTargets(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a[href], [role=button], input[type=checkbox], input[type=radio], select")) {
      const r = el.getBoundingClientRect();
      // Zero or one pixel is a visually hidden skip link, which grows when focused.
      if (r.width <= 2 || r.height <= 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.tagName === "A" && cs.display === "inline" && el.closest("p,li")) continue;
      // A box inside a 44px label row is reached through the row.
      if ((el.type === "checkbox" || el.type === "radio") && el.closest("label")?.getBoundingClientRect().height >= 44) continue;
      if (r.width < 44 || r.height < 44) {
        const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

/**
 * The phone's next act should sit where a thumb reaches: kept on screen
 * (sticky or fixed), or in the lower part of the first screen. Measured from
 * the top of the page, the way a person arrives. Returns a sentence when it is
 * out of reach, or null.
 */
async function thumbReach(page, locator) {
  const el = locator.first();
  if (!(await el.count())) return "the next act was not found on the page";
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const info = await el.evaluate((node) => {
    let n = node;
    let pinned = false;
    while (n && n !== document.body) {
      const p = getComputedStyle(n).position;
      if (p === "fixed" || p === "sticky") pinned = true;
      n = n.parentElement;
    }
    const r = node.getBoundingClientRect();
    return { pinned, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
  });
  if (info.pinned && info.bottom <= info.vh && info.top >= 0) return null;
  if (info.top >= info.vh * 0.4 && info.bottom <= info.vh) return null;
  if (info.top > info.vh) return `the next act starts ${info.top}px down the page, ${Math.round(info.top / info.vh)} screens below where a person arrives, and is not kept on screen`;
  return `the next act sits at the top of the screen (y=${info.top}px of ${info.vh}px), out of a thumb's reach`;
}

/**
 * How wide the page's content really is at desktop width: the span from the
 * leftmost to the rightmost visible piece of text or control inside <main>.
 * A span under 600px means one narrow column with nothing beside it.
 */
async function columnSpan(page) {
  return page.evaluate(() => {
    const root = document.querySelector("main") || document.body;
    let left = Infinity;
    let right = -Infinity;
    for (const el of root.querySelectorAll("h1,h2,h3,p,li,label,button,a,input,textarea,select,img,svg,figure")) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.position === "fixed") continue;
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    if (!Number.isFinite(left)) return null;
    return { span: Math.round(right - left), viewport: document.documentElement.clientWidth };
  });
}
