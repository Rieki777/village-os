// Shared setup for the QA scripts. Nothing in here knows which village it is pointed at.
//
// Playwright is deliberately NOT a dependency of this repo: these scripts drive a browser
// against a DEPLOYED site, they are not part of `pnpm test`, and adding ~300 MB of browsers
// to every install to serve an occasional sweep is the wrong trade. So they fail loudly with
// an install line instead of failing mysteriously on a missing import.
import fs from "node:fs";

export const AA_BODY = 4.5;
export const AA_LARGE = 3.0;

/** The site under test. No default: a QA script that guesses which site it is hitting is a
 *  QA script that will one day sweep the wrong one and report it clean. */
export function baseUrl() {
  const u = (process.env.QA_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!u) {
    console.error(
      "  QA_BASE_URL is not set.\n" +
      "    QA_BASE_URL=https://your-deployment.example node scripts/qa/<script>.mjs\n" +
      "  There is no default on purpose: a sweep pointed at the wrong site still prints a\n" +
      "  clean report, and you would believe it.",
    );
    process.exit(2);
  }
  return u;
}

/** A signed-in token, if the surfaces being swept need one. Optional: the public sweep is
 *  the more important one, because that is what a visitor gets. */
export function authToken() {
  const inline = (process.env.QA_TOKEN ?? "").trim();
  if (inline) return inline;
  const file = (process.env.QA_TOKEN_FILE ?? "").trim();
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return null;
}

/**
 * The localStorage key the client stores its session under, READ FROM THE CLIENT.
 *
 * Hardcoding it here put a village's name into scripts/, which is inside the brand ratchet,
 * and the guard caught it on the first run. Deriving it is better than a waiver twice over:
 * this file carries no village's brand, and the key stays right if it is ever renamed.
 */
export function tokenKey() {
  const src = fs.readFileSync(
    new URL("../../client/src/lib/gameApi.ts", import.meta.url), "utf8");
  const m = /TOKEN_KEY\s*=\s*"([^"]+)"/.exec(src);
  if (!m) throw new Error("Could not find TOKEN_KEY in client/src/lib/gameApi.ts");
  return m[1];
}

export async function playwright() {
  try {
    return await import("playwright");
  } catch {
    console.error(
      "  playwright is not installed, and it is not a dependency of this repo.\n" +
      "    pnpm add -D playwright && npx playwright install chromium webkit\n" +
      "  Or run these from any directory that already has it.",
    );
    process.exit(2);
  }
}

/** The viewports worth sweeping. 320 is the narrowest phone still in use and it finds things
 *  390 does not; desktop finds everything behind an `md:`/`lg:` breakpoint, which a
 *  mobile-only sweep structurally cannot see. 360 and 375 are two of the most common phone
 *  widths and sit between 320 and 390, so a sweep stepping from one to the other lands on
 *  neither: /training overflowed at both (+24px, +9px) while reading clean at 390 (#300). */
export const PROFILES = [
  { name: "phone", width: 393, height: 851, dpr: 2.75, mobile: true, engine: "chromium" },
  { name: "phone-webkit", width: 390, height: 664, dpr: 3, mobile: true, engine: "webkit" },
  { name: "narrow", width: 320, height: 800, dpr: 2.75, mobile: true, engine: "chromium" },
  { name: "android", width: 360, height: 800, dpr: 3, mobile: true, engine: "chromium" },
  { name: "small-iphone", width: 375, height: 667, dpr: 2, mobile: true, engine: "webkit" },
  { name: "desktop", width: 1440, height: 900, dpr: 1, mobile: false, engine: "chromium" },
];

export async function contextFor(pw, profile, token) {
  const browser = await (profile.engine === "webkit" ? pw.webkit : pw.chromium).launch();
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  });
  if (token) {
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} },
      [tokenKey(), token]);
  }
  return { browser, ctx };
}

/** Print a count of what a check could NOT resolve, ALWAYS, even when it is zero.
 *
 *  This is the single most important line any of these scripts emits. Every wrong answer
 *  this toolkit ever gave was an unmeasurable thing reported as a measured one, and silence
 *  about it is indistinguishable from a pass. See README.md. */
export function reportUnmeasured(label, count, samples = []) {
  console.log(`  ${count} ${label} NOT MEASURABLE (counted, never treated as passing)`);
  for (const s of samples.slice(0, 5)) console.log(`      ${s}`);
}
