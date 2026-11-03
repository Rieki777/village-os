/**
 * Connection chips land on their own card.
 *
 * Playwright is not a dependency of this repo. Install it beside the script
 * the way scripts/qa/README.md says, then:
 *
 *   QA_BASE_URL=http://127.0.0.1:3000 QA_TOKEN=... node scripts/qa/admin-focus.mjs
 *
 * The token is a local session. This never signs in as a person named in the
 * environment and never writes.
 */
import { authToken, baseUrl, contextFor, playwright } from "./lib.mjs";

const pw = await playwright();
const token = authToken();
if (!token) {
  console.error("  QA_TOKEN is required. This check signs in as whoever that token is.");
  process.exit(2);
}
const { browser, ctx } = await contextFor(pw, { width: 1280, height: 800, dpr: 1, mobile: false, engine: "chromium" }, token);
const page = await ctx.newPage();
const origin = baseUrl();
await page.goto(`${origin}/admin?tab=home`);
await page.getByRole("button", { name: /Night look/ }).waitFor({ timeout: 20000 });

async function land(name, id, tab) {
  await page.goto(`${origin}/admin?tab=home`);
  await page.getByRole("button", { name }).click();
  await page.waitForFunction((cardId) => {
    const el = document.getElementById(cardId);
    if (!el) return false;
    const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const top = el.getBoundingClientRect().top;
    return new URL(location.href).searchParams.get("tab") && top < head + 40 && top > head - 8;
  }, id, { timeout: 8000 });
  const got = new URL(page.url()).searchParams.get("tab");
  if (got !== tab) throw new Error(`${name} opened ${got}, expected ${tab}`);
  console.log(`  ${tab} #${id}`);
}

await land(/Sera /, "integration-sera", "integrations");
await land(/Email /, "integration-email", "integrations");
await land(/Payments /, "integration-payments", "integrations");
await land(/Calendar /, "integration-calendar", "events-admin");
console.log("  four chips land on their own cards");
await browser.close();
