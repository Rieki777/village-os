// Every admin tab, at phone widths: does the PAGE scroll sideways? Exits 1 if any does.
//
// E10 (2026-10-31): ten admin tabs scrolled the whole page sideways at 390px, each for its
// own small reason (a select as wide as its longest option, a flex-1 input that would not
// shrink, a long webhook URL, a tab strip with no wrap). Each fix is local and the next
// tab can regress the same way, so this walks EVERY tab the rail offers rather than a
// list someone has to keep.
//
// The tab list is READ FROM THE PAGE: whatever the signed-in admin's rail shows is what is
// swept, so a newly enabled module's tab is covered the day it appears. A tab that fails
// to render is counted as NOT MEASURABLE and fails the run, because a tab that never
// painted has not passed.
//
// A wide thing inside an `overflow-x: auto` wrapper (a table, a code block) is fine and is
// not counted: the measure is the document's own scrollWidth against the viewport.
//
//   QA_BASE_URL=http://127.0.0.1:3049 QA_TOKEN=<admin session token> node scripts/qa/admin-overflow.mjs
//   ... node scripts/qa/admin-overflow.mjs --long-words     (the adversarial pass, see LENGTHEN)
//
// Needs an admin token: the rail only renders for one. Not part of CI, which has no browser
// (README.md); `client/src/lib/adminFit.test.ts` is the half that runs there.
import { baseUrl, authToken, playwright, contextFor, PROFILES, reportUnmeasured } from "./lib.mjs";

const WIDTHS = PROFILES.filter((p) => ["phone", "narrow"].includes(p.name));

/*
 * --long-words: the adversarial pass. Every UI here is customizable (Rye, 2026-10-22), so a
 * village can rename any label, and German runs long. Before measuring, every word of
 * five letters or more inside <main> becomes a 34-letter compound, and every placeholder
 * too. A layout that only fits the English it was written against fails here.
 */
const LONG_WORDS = process.argv.includes("--long-words");
const LENGTHEN = () => {
  const word = "Gemeinschaftsverantwortungsbereich";
  const walk = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
  // <code> holds identifiers (a capability id), which no village renames, so it is left as it is.
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest("code")) n.nodeValue = n.nodeValue.replace(/[A-Za-z]{5,}/g, word);
  for (const el of document.querySelectorAll("main [placeholder]")) el.setAttribute("placeholder", word);
};

const PROBE = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const contained = (el) => {
    for (let e = el.parentElement; e && e !== de; e = e.parentElement) {
      if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(e).overflowX)) return true;
    }
    return false;
  };
  const culprits = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1 || contained(el)) continue;
    culprits.push({ tag: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 4).join(".") : ""}`, right: Math.round(r.right), text: (el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40) });
  }
  // CONTENT can spill out of a box that itself fits (a button shrunk below its label, one
  // long word), and then no element's box crosses the edge at all. Without this the sweep
  // printed a failure with no culprit, which is a measurement that names nothing.
  if (culprits.length === 0) {
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      if (el.children.length > 0 || el.scrollWidth <= el.clientWidth + 1 || r.left + el.scrollWidth <= vw + 1) continue;
      culprits.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.left + el.scrollWidth), text: `spills: ${(el.textContent || "").trim().slice(0, 32)}` });
    }
  }
  culprits.sort((a, b) => b.right - a.right);
  return { vw, scrollWidth: de.scrollWidth, culprits: culprits.slice(0, 3) };
};

const base = baseUrl();
const token = authToken();
if (!token) {
  console.error("  QA_TOKEN is not set. The admin rail renders only for an admin, so there is nothing to sweep.");
  process.exit(2);
}

const pw = await playwright();
let failed = 0;
const unmeasured = [];
for (const profile of WIDTHS) {
  const { browser, ctx } = await contextFor(pw, profile, token);
  const page = await ctx.newPage();
  // "load", then a settle: several tabs poll on an interval, so the network is never idle
  // and a networkidle wait times out on a page that rendered fine.
  await page.goto(`${base}/admin`, { waitUntil: "load" });
  await page.waitForSelector("[data-admin-tab]", { timeout: 60000 }).catch(() => {});
  // The rail's own links carry the tab in their href; on a phone the rail is the icon column.
  const tabs = await page.evaluate(() =>
    Array.from(new Set(Array.from(document.querySelectorAll("a[href*='/admin?tab='], [data-admin-tab]"))
      .map((a) => a.getAttribute("data-admin-tab") || new URL(a.getAttribute("href"), location.href).searchParams.get("tab"))
      .filter(Boolean))));
  if (tabs.length === 0) unmeasured.push(`${profile.name}: the rail offered no tabs (signed in as an admin?)`);
  console.log(`\n${profile.name} (${profile.width}px): ${tabs.length} tabs`);
  for (const tab of tabs) {
    try {
      await page.goto(`${base}/admin?tab=${encodeURIComponent(tab)}`, { waitUntil: "load", timeout: 60000 });
      // Painted when the panel holds real text. Not every tab has a heading (drafts, brain).
      await page.waitForFunction(() => (document.querySelector("main")?.innerText ?? "").trim().length > 40, null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      if (LONG_WORDS) { await page.evaluate(LENGTHEN); await page.waitForTimeout(200); }
      const m = await page.evaluate(PROBE);
      if (m.scrollWidth > m.vw) {
        failed++;
        console.log(`  FAIL ${tab}: page ${m.scrollWidth}px wide in a ${m.vw}px viewport`);
        for (const c of m.culprits) console.log(`         <${c.tag}> ends at ${c.right}px  "${c.text}"`);
      }
    } catch (e) {
      unmeasured.push(`${profile.name} ${tab}: ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
  await browser.close();
}

console.log("");
reportUnmeasured("admin tab(s)", unmeasured.length, unmeasured);
console.log(failed === 0 && unmeasured.length === 0 ? "  every admin tab fits" : `  ${failed} tab(s) scroll sideways`);
process.exit(failed > 0 || unmeasured.length > 0 ? 1 : 0);
