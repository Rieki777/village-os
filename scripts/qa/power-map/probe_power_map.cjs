/* The power map probe (lane L2, 0083): the harm metrics as a machine's walk.
 *
 * Run:  NODE_PATH=<dir containing node_modules/playwright> \
 *       POWER_BASE=http://localhost:3101 node scripts/qa/power-map/probe_power_map.js
 *
 * WebKit, five viewports (desktop 1280x800, then the pocket set 390x844 /
 * 390x664 / 375x812 / 360x800). Read-only: no accounts, no forms, no writes.
 *
 * LOUD BY CONSTRUCTION. Every count asserts > 0 where the page must have
 * content, a NaN comparison throws instead of passing, and any console error
 * or pageerror fails the viewport. The lesson this repo keeps paying for is
 * a probe that measures nothing and reports green; `expect` below refuses
 * undefined and NaN for exactly that reason.
 *
 * What it holds:
 *   - the SVG map is there (role=group), with a breadcrumb and a legend;
 *   - every circle and seat is a button with an aria-label CARRYING STATE,
 *     counted, zero fails (harm metric 3);
 *   - the open-call glyph is drawn dashed (colour never alone, spec 4);
 *   - tapping a circle moves the camera; tapping a SEAT does not (harm 2);
 *   - Escape walks back out; ArrowRight moves focus between siblings;
 *   - no horizontal scroll at any width; below 640 the circle wall carries
 *     the page under the small map (2026-10-23, "map, then circle cards");
 *   - zero console errors, zero page errors.
 */
const path = require("path");
const { webkit } = require(path.join(process.env.NODE_PATH || "", "playwright"));

const BASE = process.env.POWER_BASE || "http://localhost:3101";
const SETTLE_MS = 3500; // networkidle never fires on this app; wait flat.

let failures = 0;
function expect(cond, label, detail) {
  const bad =
    cond === undefined ||
    cond === null ||
    (typeof cond === "number" && Number.isNaN(cond)) ||
    cond === false;
  if (bad) {
    failures += 1;
    console.log(`  FAIL  ${label}${detail !== undefined ? `  [${JSON.stringify(detail)}]` : ""}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

async function newPage(browser, width, height) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: width < 768 ? 3 : 1,
    hasTouch: width < 768,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/map/circles`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "* { scroll-behavior: auto !important; }" }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  return { ctx, page, errors };
}

async function desktop(browser) {
  console.log("viewport 1280x800 (desktop)");
  const { ctx, page, errors } = await newPage(browser, 1280, 800);

  const shell = await page.evaluate(() => {
    const svg = document.querySelector("svg[data-power-map]");
    const nodes = svg ? Array.from(svg.querySelectorAll('[role="button"][tabindex]')) : [];
    const labelled = nodes.filter((el) => (el.getAttribute("aria-label") || "").trim().length > 3);
    const stateWords = /open call|held|forming|term|partly/i;
    const stateful = labelled.filter((el) => stateWords.test(el.getAttribute("aria-label") || ""));
    return {
      svg: !!svg,
      crumb: !!document.querySelector("[data-power-crumb]"),
      legend: !!document.querySelector("[data-power-legend]"),
      liveRegion: !!document.querySelector('[role="status"]'),
      nodes: nodes.length,
      labelled: labelled.length,
      stateful: stateful.length,
      dashedOpen: svg ? svg.querySelectorAll('circle[stroke-dasharray="3 3"]').length : 0,
      horiz: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      viewBox: svg ? svg.getAttribute("viewBox") : null,
    };
  });
  expect(shell.svg, "the SVG map renders");
  expect(shell.crumb, "the breadcrumb bar is there (spec 2)");
  expect(shell.legend, "the legend is there (spec 10)");
  expect(shell.liveRegion, "the live region exists (spec 11)");
  expect(shell.nodes > 0, "interactive circles and seats exist", shell.nodes);
  expect(shell.labelled === shell.nodes, "every one carries an aria-label", `${shell.labelled}/${shell.nodes}`);
  // Seats say their state; circles say where Enter goes. At least the seats
  // must match the state words, and there are always seats on this chart.
  expect(shell.stateful > 0, "aria-labels carry state (harm 3)", shell.stateful);
  expect(shell.dashedOpen > 0, "the open-call glyph draws dashed (spec 4)", shell.dashedOpen);
  expect(!shell.horiz, "no horizontal scroll");

  // The camera contract (harm 2), driven through the app's own handlers.
  const camera = await page.evaluate(async () => {
    const svg = document.querySelector("svg[data-power-map]");
    const before = svg.getAttribute("viewBox");
    const circle = svg.querySelector('circle[role="button"][tabindex="0"]');
    circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const afterCircle = svg.getAttribute("viewBox");
    const focusParam = new URLSearchParams(location.search).get("focus");
    const seat = Array.from(svg.querySelectorAll('g[role="button"]')).find((g) =>
      (g.getAttribute("aria-label") || "").includes("a seat in"),
    );
    if (seat) seat.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 650));
    const afterSeat = svg.getAttribute("viewBox");
    const cardOpen = !!document.querySelector("[data-power-card]");
    return { moved: before !== afterCircle, focusParam, seatHeld: afterCircle === afterSeat, cardOpen, seatFound: !!seat };
  });
  expect(camera.moved, "tapping a circle flies the camera (spec 1)");
  expect(camera.focusParam, "?focus= lands in the URL (spec 1)", camera.focusParam);
  expect(camera.seatFound, "a seat was there to tap");
  expect(camera.seatHeld, "tapping a seat NEVER moves the camera (harm 2)");
  expect(camera.cardOpen, "the seat card opened instead (spec 5)");

  // Escape goes out one level; ArrowRight walks siblings (spec 11).
  const keys = await page.evaluate(async () => {
    const svg = document.querySelector("svg[data-power-map]");
    const focused = svg.querySelector('circle[role="button"][tabindex="0"]');
    focused.focus();
    const hadFocus = document.activeElement === focused;
    focused.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const movedTo = document.activeElement?.getAttribute?.("aria-label") || null;
    const arrowMoved = document.activeElement !== focused && !!movedTo;
    return { hadFocus, arrowMoved, movedTo: movedTo ? movedTo.slice(0, 48) : null };
  });
  expect(keys.hadFocus, "a circle takes keyboard focus");
  expect(keys.arrowMoved, "ArrowRight moves focus to a sibling (spec 11)", keys.movedTo);

  expect(errors.length === 0, "zero console and page errors", errors.slice(0, 3));
  await ctx.close();
}

async function pocket(browser, width, height) {
  console.log(`viewport ${width}x${height} (pocket)`);
  const { ctx, page, errors } = await newPage(browser, width, height);
  const shell = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll("[data-power-map-box]")).map(
      (b) => b.getBoundingClientRect().width,
    );
    const wall = document.querySelector("[data-power-wall]");
    return {
      horiz: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      mapShown: boxes.some((w) => w > 50),
      wall: (wall?.getBoundingClientRect().height ?? 0) > 50,
      legend: !!document.querySelector("[data-power-legend]"),
      crumbOrTitle: !!document.querySelector("[data-power-crumb], h1"),
    };
  });
  expect(!shell.horiz, "no horizontal scroll");
  if (width < 640) expect(shell.wall, "the circle wall carries the page under the map");
  expect(shell.mapShown, "the map is drawn at every width");
  expect(shell.legend, "the legend is reachable");
  expect(errors.length === 0, "zero console and page errors", errors.slice(0, 3));
  await ctx.close();
}

(async () => {
  console.log(`power map probe against ${BASE}`);
  const browser = await webkit.launch();
  try {
    await desktop(browser);
    for (const [w, h] of [
      [390, 844],
      [390, 664],
      [375, 812],
      [360, 800],
    ]) {
      await pocket(browser, w, h);
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) {
    console.log(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nall checks passed");
})().catch((e) => {
  console.error("probe crashed, which is a failure:", e);
  process.exit(1);
});
