// The shell hands the map a ground, and the map must never invent a coastline.
//
// The Living Map artifact ships the first village's satellite plate baked in. Since the ground became
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
check("the seed alone draws its core and the seed surround",
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


// ── The frame: a picture is drawn where it truly is ──────────────────────────
//
// A picture used to arrive as a bare URL and be stretched across the seed's
// frame, with the seed's scale and coordinates read off it. On the seed
// village that was ground three times too large and 345 m off under every
// building. These checks hold the fix: the seed's own rectangle keeps the
// seed's georeference and geography, and anywhere else takes the picture's
// scale and drops another place's names, coast and caption.
const geoNamesShown = () =>
  page.evaluate(() => [...document.querySelectorAll(".banner.geo")].some((el) => el.style.display !== "none"));
const SEED_MPU = 2592 / 2400;

await fresh();
await push({ core: { url: core }, frame: { spanM: 2592, seed: true, centre: null } });
await settle(() => window.groundSource() === "village");
await page.waitForTimeout(400);
h = await page.evaluate(() => window.groundHas());
check("the seed's own rectangle keeps its coast, its georeference and its scale",
  h.village && h.seedGeography && h.surround && h.caption !== false &&
  Math.abs(h.mPerUnit - SEED_MPU) < 1e-9 && String(h.pinW) === "1520,800", h);

await fresh();
await push({ core: { url: core }, frame: { spanM: 800, seed: false, centre: { lat: -1.2921, lon: 36.8219 } } });
await settle(() => window.groundSource() === "village");
await page.waitForTimeout(400);
h = await page.evaluate(() => window.groundHas());
check("a village elsewhere measures its land at its own scale, not the seed's",
  Math.abs(h.mPerUnit - 800 / 2400) < 1e-9 && Math.abs(h.georefMPerUnit - 800 / 2400) < 1e-9, h);
check("a village elsewhere is placed at its own centre, on the world's centre",
  Math.abs(h.pin[0] - -1.2921) < 1e-9 && Math.abs(h.pin[1] - 36.8219) < 1e-9 && String(h.pinW) === "1200,800", h);
check("a village elsewhere gets none of the seed's coast, caption or place names",
  h.seedGeography === false && h.surround === false && h.caption === false && !(await geoNamesShown()),
  { h, names: await geoNamesShown() });

await fresh();
await push({ core: { url: core }, frame: { spanM: 800, seed: false, centre: null } });
await settle(() => window.groundSource() === "village");
await page.waitForTimeout(400);
h = await page.evaluate(() => window.groundHas());
check("at 'hidden' the map still takes the scale but prints no coordinates at all",
  Math.abs(h.mPerUnit - 800 / 2400) < 1e-9 && h.geoKnown === false && h.seedGeography === false, h);

await fresh();
await push({ core: { url: core }, frame: { spanM: 800, seed: false, centre: { lat: -1.2921, lon: 36.8219 } } });
await settle(() => window.groundSource() === "village");
await push({ core: { url: core }, frame: { spanM: 2592, seed: true, centre: null } });
await page.waitForFunction(() => window.groundHas().seedGeography === true, null, { timeout: 15_000 }).catch(() => {});
h = await page.evaluate(() => window.groundHas());
check("returning to the seed's rectangle puts the seed georeference back exactly",
  h.seedGeography && Math.abs(h.mPerUnit - SEED_MPU) < 1e-9 && String(h.pinW) === "1520,800" &&
  Math.abs(h.pin[0] - 9.2320128) < 1e-9, h);

await fresh();
await push({ core: { url: core } });
await settle(() => window.groundSource() === "village");
h = await page.evaluate(() => window.groundHas());
check("a shell that sends no frame keeps the safe rule: no borrowed coast, no invented scale",
  h.seedGeography === false && h.surround === false && Math.abs(h.mPerUnit - SEED_MPU) < 1e-9, h);

await browser.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
