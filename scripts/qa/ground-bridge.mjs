// The shell hands the map a ground, and the map must never invent a coastline.
//
// The Living Map artifact ships Amora's satellite plate baked in. Since the ground became
// runtime data, the shell pushes `{type:'ground', core:{url}, surround:{url, rect}}` and a
// village draws its own land instead. Nothing in `pnpm test` can see any of this: the
// artifact is a 5.7 MB single file with no module boundary, the bridge is a postMessage,
// and the failure mode is a picture rather than a value.
//
// THE INVARIANT THAT MATTERS MOST is the second check below. The seed's wide plate is the
// Pacific coast west of Dominicalito. If a village pushes its own core and the map keeps
// drawing that seed surround, every landlocked farm on the platform gets a beach it does
// not have -- invented geography, presented at the same fidelity as the real thing. The
// map may never do that, so the rule is: a village core with no surround of its own draws
// NO surround at all, and the honest flat field past its plate instead.
//
// Runs against the artifact on disk. No deployment, no server, no fixtures: the test plates
// are painted in-browser and passed as data: URIs.
//
// Usage:
//   node scripts/qa/ground-bridge.mjs [path/to/grounds-v0.html]
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { playwright } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const artifact = resolve(process.argv[2] ?? resolve(here, "../../docs/prototypes/grounds-v0.html"));

const pw = await playwright();
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

let pass = 0;
const failures = [];
const check = (name, ok, got) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}\n          got ${JSON.stringify(got)}`); }
};

/** Load the artifact and wait for its BAKED plate, so every check starts from the seed. */
async function fresh() {
  await page.goto(pathToFileURL(artifact).href);
  await page.waitForFunction(
    () => typeof window.groundHas === "function" && window.groundSource?.() === "seed",
    null, { timeout: 60_000 },
  );
}
/** A plate with no bytes on disk: painted here, handed over as a data: URI. */
const plate = (w, h, css) =>
  page.evaluate(([w, h, css]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = css; g.fillRect(0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.7);
  }, [w, h, css]);
/** Push exactly what the shell pushes, through the bridge rather than around it. */
const push = (msg) => page.evaluate((m) => window.postMessage(m, "*"), { type: "ground", ...msg });
const settle = (fn) => page.waitForFunction(fn, null, { timeout: 15_000 }).catch(() => {});

console.log(`\nground bridge · ${artifact}\n`);

await fresh();
check("the seed alone draws its core and Amora's surround",
  JSON.stringify(await page.evaluate(() => window.groundHas())).includes('"surround":true'),
  await page.evaluate(() => window.groundHas()));

const core = await plate(2400, 1600, "#d414b4");
await push({ core: { url: core } });
await settle(() => window.groundSource() === "village");
let h = await page.evaluate(() => window.groundHas());
check("a village core with NO surround of its own draws no surround at all",
  h.village === true && h.surround === false, h);

await fresh();
const sur = await plate(1200, 900, "#00bec8");
await push({ core: { url: core }, surround: { url: sur, rect: [-400, -300, 3200, 2200] } });
await settle(() => window.groundHas().surround === true && window.groundSource() === "village");
h = await page.evaluate(() => window.groundHas());
check("a village that brings its own surround draws it at its own rect",
  h.village === true && h.surround === true && String(h.rect) === "-400,-300,3200,2200", h);

await fresh();
const empty = await page.evaluate(() => window.setGround({ type: "ground" }));
h = await page.evaluate(() => window.groundHas());
check("a village that has not placed itself keeps the seed untouched",
  empty === false && h.village === false && h.surround === true, { empty, h });

await fresh();
await push({ surround: { url: sur, rect: "not-an-array" } });
await settle(() => window.groundHas().surround === true);
h = await page.evaluate(() => window.groundHas());
check("a malformed rect falls back to the seed's rect and never throws",
  h.core === true && h.surround === true && String(h.rect) === "-780,-920,3960,3440", h);

await fresh();
await push({ core: { url: core } });
await settle(() => window.groundSource() === "village");
await push({ core: { url: "does-not-exist.jpg" } });
await page.waitForTimeout(1500);
check("a plate that fails to load leaves the ground exactly as it was",
  (await page.evaluate(() => window.groundSource())) === "village",
  await page.evaluate(() => window.groundSource()));

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
