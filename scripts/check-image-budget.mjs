#!/usr/bin/env node
/**
 * The image gate: format, per-file size, and a total that may only fall.
 *
 * WHAT WAS ALREADY WATCHED, AND WHAT WAS NOT. `.github/workflows/ci.yml` caps
 * any single file in `dist/public` at 400 KB and the whole directory at 6 MB,
 * and `scripts/check-artifact-budget.mjs` watches the living map. Between them
 * they miss the two things that actually decide what a phone downloads:
 *
 *   FORMAT. Nothing stopped a PNG landing in `client/public`. WebP is the
 *   house standard for raster art and it was a convention, which is to say it
 *   held until someone was in a hurry.
 *   DIRECTION. The bundle budget is a CEILING (7000 KB on dist/public since
 *   2026-11-02, 6600 from R33 when the tree sat at 6136 KB), so images can still grow
 *   by several hundred KB and stay green. A ceiling tells you about a
 *   catastrophe; it says nothing about a year of quiet accumulation.
 *
 * So this is a RATCHET on the total, the same discipline as
 * `scripts/brand-refs-baseline.json`: the number in
 * `scripts/image-budget-baseline.json` may only ever go DOWN, and
 * `--update-baseline` refuses to raise it. Art that genuinely needs to grow
 * goes in the uploads volume, which is hashed, cached correctly, swappable,
 * and outside this budget by design.
 *
 * WHY IT RUNS BEFORE THE BUILD. It reads files in the repo, so a wrong format
 * fails in a second instead of after `pnpm build` and `pnpm test`. Same reason
 * the artifact budget sits where it does.
 *
 * THE NON-WEBP ALLOWLIST IS A RULE, NOT A LIST OF NAMES. Two reasons. A list
 * of filenames would be a list of one village's brand assets living in
 * `scripts/`, which the brand ratchet correctly refuses; and a fork with its
 * own icon would have to edit this file to stay green. So the exempt files are
 * DERIVED: whatever `shared/gameConfig.ts` calls the favicon, and whatever
 * `client/index.html` hands to a browser or a link preview as an icon or a
 * social card. Those surfaces have no dependable WebP support, and the PWA
 * manifest additionally labels any non-SVG icon `image/png` from an
 * `endsWith(".svg")` ternary in server/index.ts. Everything else is WebP.
 *
 * ── THE COUPLING CHECK, AND THE FAILURE THAT PAID FOR IT ────────────────────
 *
 * Deriving the exemption from a config field made the exemption move when the
 * field moved, and for a while nothing said so out loud. On 2026-08-30 the
 * neutralisation lane blanked `images.favicon` in `shared/gameConfig.ts`, which
 * silently revoked the exemption keyed off it. This gate went red, and it went
 * red naming `client/public/assets/images/Amora-2-Green1.png`, a file that
 * commit had not touched, for being the wrong format. The cheapest way back to
 * green was to delete the file, so commit 452ab2b did (its own message records
 * the chain). The gate was working. It named the wrong noun, and the wrong noun
 * is what got acted on.
 *
 * A declaration and the file it names are ONE fact written in two places, so
 * this gate now refuses to let the two places disagree, in both directions:
 *
 *   DANGLING (declaration without a file). A declared path that resolves
 *     nowhere fails. Deleting the art while the config still points at it is
 *     now a red, instead of a broken icon nobody sees.
 *   ORPHANED (file without a declaration). An image in `client/public` that
 *     nothing in the repo references fails, and the message reports which
 *     declaration slots are currently sitting empty, because a slot that went
 *     empty is the usual reason a file just became unreferenced.
 *
 * Blanking a field and deleting the file it named are the same change. They
 * belong in one commit, and either half on its own is now a failure that says
 * which half is missing.
 *
 * Usage:
 *   node scripts/check-image-budget.mjs                    # the gate
 *   node scripts/check-image-budget.mjs --json             # machine readable
 *   node scripts/check-image-budget.mjs --update-baseline  # only ever downward
 *
 * Read the exit code. A passing run prints a total; a failing one prints
 * ::error:: lines, and neither is reliably the last line on the terminal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const SCAN_ROOT = path.join(ROOT, "client", "public");
const BASELINE_PATH = path.join(ROOT, "scripts", "image-budget-baseline.json");

/** Matches the per-file cap CI already applies to dist/public. */
const MAX_SINGLE_BYTES = 400 * 1024;

const RASTER = /\.(png|jpe?g|gif|bmp|tiff?|avif|webp)$/i;
const MODERN = /\.(webp|avif)$/i;
/** Wider than RASTER on purpose: an orphaned SVG mark is the same fact as an
 *  orphaned PNG one. Only RASTER is weighed and format-checked, so the budget
 *  numbers this script has always printed do not move. */
const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|avif|webp|svg|ico)$/i;

/** Paths a declaration may legitimately name that this repo does not contain.
 *  `/uploads/` is the runtime volume (hashed, swappable, deliberately outside
 *  this budget) and `/api/` is served rather than stored, so neither can be
 *  checked for existence here without failing a village that uses them. */
const NOT_STATIC = /^\/(?:uploads|api)\//i;

const kb = (n) => `${Math.round(n / 1024)} KB`;

/**
 * Every image path this repo DECLARES, with where it was declared and why.
 *
 * The non-WebP exemption map is derived from this, and so is the coupling
 * check above. Derived, never typed.
 */
function declaredImageRefs() {
  const refs = [];
  const add = (ref, why, source) => {
    const clean = String(ref || "").split(/[?#]/)[0].trim();
    // Anything carrying a scheme, and anything protocol-relative, names a file
    // this repo does not hold. Wider than the `https?:` this used to test:
    // a `data:` URI or a `//cdn.example/x.png` used to survive that test, land
    // in the list, and then fail the new existence check for a file that was
    // never supposed to be on disk.
    if (clean && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) {
      refs.push({ ref: clean, base: path.basename(clean), why, source });
    }
  };

  const config = path.join(ROOT, "shared", "gameConfig.ts");
  if (fs.existsSync(config)) {
    const m = fs.readFileSync(config, "utf8").match(/favicon:\s*"([^"]+)"/);
    if (m) add(m[1], "the brand favicon, which is also the apple-touch-icon and the sole PWA manifest icon", "shared/gameConfig.ts images.favicon");
  }

  // Read each tag whole and pull its attributes out separately. Matching
  // `rel="..."` and `href="..."` in one pattern would quietly depend on the
  // author writing them in that order, and a fork whose icon tag reads
  // `href` first would find its own favicon failing this gate for a reason
  // the error message does not mention.
  const html = path.join(ROOT, "client", "index.html");
  if (fs.existsSync(html)) {
    const src = fs.readFileSync(html, "utf8");
    const attr = (tag, name) => (tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || [])[1] || "";
    for (const [tag] of src.matchAll(/<link\b[^>]*>/gi)) {
      const relAttr = attr(tag, "rel");
      if (/\b(?:apple-touch-icon|mask-icon|icon)\b/i.test(relAttr)) {
        add(attr(tag, "href"), "a favicon declared in the shipped HTML", `client/index.html <link rel="${relAttr}">`);
      }
    }
    for (const [tag] of src.matchAll(/<meta\b[^>]*>/gi)) {
      const key = attr(tag, "property") || attr(tag, "name");
      if (/^(?:og:image|twitter:image)$/i.test(key)) {
        add(attr(tag, "content"), "a social card image, which link previews fetch without WebP support", `client/index.html <meta ${key}>`);
      }
    }
  }
  return refs;
}

/**
 * The nine image slots in `shared/gameConfig.ts` that are currently declared
 * as an empty string.
 *
 * An empty slot and an absent slot are different facts, and this gate reports
 * the difference because the empty ones are the ones that just stopped naming
 * a file. When an image goes unreferenced, the founder reading the error needs
 * to know whether a slot was emptied in the same change, since the honest fix
 * is then to remove the file and the declaration together rather than to
 * delete whichever one the gate happened to point at.
 */
const IMAGE_SLOTS = [
  "hero", "investorHero", "residentHero", "stewardHero", "prosperityHero",
  "masterPlanHero", "logo", "heartLogo", "favicon",
];
function blankImageSlots() {
  const config = path.join(ROOT, "shared", "gameConfig.ts");
  if (!fs.existsSync(config)) return [];
  const src = fs.readFileSync(config, "utf8");
  return IMAGE_SLOTS.filter((k) => new RegExp(`\\b${k}:\\s*""`).test(src));
}

/**
 * Everything in the repo that could name an image, read once as text.
 *
 * A basename is the unit because a path is written a dozen ways (absolute,
 * relative, joined at runtime, listed in a sibling manifest) and the basename
 * survives all of them. Directories whose files are built at runtime already
 * carry a `manifest.json` naming each one, which is where a dynamically
 * constructed path is supposed to be declared.
 *
 * THIS FILE IS EXCLUDED FROM ITS OWN HAYSTACK. The header above names the PNG
 * from the incident, and while it did, replaying the incident showed this gate
 * reading its own comment and concluding the file was still referenced. A
 * guard is not evidence for itself.
 *
 * A mention anywhere else does count, comments included, because telling code
 * from commentary is a separate hard problem (`scripts/brand-strip.mjs` exists
 * for it, and got two machine-dependent answers wrong before it was right).
 * That errs toward calling a file referenced, so this check under-reports
 * orphans rather than inventing them, which is the safe direction for
 * something that fails a build. Markdown is not read at all: a doc naming a
 * file is describing it, never fetching it.
 */
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css", ".json", ".sql", ".webmanifest"]);
const SOURCE_SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".vite", "attached_assets"]);
function sourceText() {
  const parts = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SOURCE_SKIP.has(entry.name)) continue;
        visit(full);
      } else if (SOURCE_EXT.has(path.extname(entry.name)) && full !== SELF) {
        try { parts.push(fs.readFileSync(full, "utf8")); } catch { /* unreadable is not a reference */ }
      }
    }
  };
  visit(ROOT);
  return parts.join("\n");
}

function walk(dir, match) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (entry.isFile() && match.test(entry.name)) out.push(full);
  }
  return out;
}

const declared = declaredImageRefs();
const allowed = new Map(declared.map((d) => [d.base, d.why]));
const files = walk(SCAN_ROOT, RASTER).sort();
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

let total = 0;
const wrongFormat = [];
const tooBig = [];
for (const file of files) {
  const size = fs.statSync(file).size;
  total += size;
  const name = path.basename(file);
  if (!MODERN.test(name) && !allowed.has(name)) wrongFormat.push({ file: rel(file), size });
  if (size > MAX_SINGLE_BYTES) tooBig.push({ file: rel(file), size });
}

// ── The coupling check, both directions. See the header for what it cost to
// learn that a derived exemption needs one.

/** Declaration without a file. One entry per path, however many places name it. */
const dangling = [];
const seenRef = new Map();
for (const d of declared) {
  if (NOT_STATIC.test(d.ref)) continue;
  if (fs.existsSync(path.join(SCAN_ROOT, d.ref.replace(/^\/+/, "")))) continue;
  const already = seenRef.get(d.ref);
  if (already) already.sources.push(d.source);
  else {
    const entry = { ref: d.ref, sources: [d.source] };
    seenRef.set(d.ref, entry);
    dangling.push(entry);
  }
}

/** File without a declaration. Any image, not only the rasters that are weighed. */
const blankSlots = blankImageSlots();
const everyImage = walk(SCAN_ROOT, IMAGE).sort();
const haystack = everyImage.length ? sourceText() : "";
const orphans = everyImage
  .filter((f) => !haystack.includes(path.basename(f)))
  .map((f) => rel(f));

const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : { totalBytes: total, files: files.length };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    total, files: files.length, baseline: baseline.totalBytes,
    wrongFormat, tooBig, dangling, orphans, blankSlots,
  }));
}

if (process.argv.includes("--update-baseline")) {
  // Downward only. A gate whose baseline can be raised to clear a failure is a
  // logbook, and this one is meant to hold.
  if (total > baseline.totalBytes) {
    console.error(
      `::error::refusing to raise the image baseline: ${kb(total)} is above the recorded ${kb(baseline.totalBytes)}. ` +
      `This number only ever falls. Compress the art, or put it in the uploads volume where it is hashed and swappable.`);
    process.exit(1);
  }
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ totalBytes: total, files: files.length, maxSingleBytes: MAX_SINGLE_BYTES }, null, 2)}\n`,
  );
  console.log(`image baseline lowered to ${kb(total)} across ${files.length} files`);
  process.exit(0);
}

console.log(`shipped images: ${files.length} files, ${kb(total)} (baseline ${kb(baseline.totalBytes)})`);
console.log(`  ${files.filter((f) => MODERN.test(f)).length} WebP or AVIF, ${allowed.size} allowed exceptions, per-file cap ${kb(MAX_SINGLE_BYTES)}`);
console.log(
  `  ${declared.length} declared reference(s) across ${new Set(declared.map((d) => d.source)).size} declaration site(s), ` +
  `${everyImage.length} image(s) in client/public, ${blankSlots.length} of ${IMAGE_SLOTS.length} config image slot(s) empty`);

let failed = false;

// Named first, because both of the checks below can fire as a CONSEQUENCE of a
// declaration moving, and a reader who fixes the consequence first deletes the
// evidence of the cause. That ordering is the whole reason this section exists.
for (const { ref, sources } of dangling) {
  console.error(
    `::error::${ref} is declared by ${sources.join(" and ")}, and no such file exists under client/public. ` +
    `A declaration and the file it names are one fact in two places. Either restore the file, or clear the ` +
    `declaration in the same commit that removed it. Clearing it also revokes any non-WebP exemption keyed ` +
    `off that field, so expect this gate to have more to say once you do.`);
  failed = true;
}
for (const file of orphans) {
  console.error(
    `::error::${file} is referenced by nothing in this repo. ` +
    (blankSlots.length
      ? `shared/gameConfig.ts currently declares ${blankSlots.join(", ")} as empty string(s): if one of those ` +
        `named this file, emptying the slot and removing the file are the same change and belong in one commit. `
      : `No config image slot is empty, so this file was probably added without a use, or its last use was removed. `) +
    `Do not delete it to clear this line before checking which reference went away (git log -S with the filename ` +
    `finds it). If the path is built at runtime, name the file in the manifest.json beside it, which is how the ` +
    `avatar and module directories already declare theirs.`);
  failed = true;
}
for (const { file, size } of wrongFormat) {
  console.error(
    `::error::${file} is ${kb(size)} and is not WebP. Convert it: ` +
    `node scripts/compress-static-images.mjs --write. An icon or social card that genuinely cannot be WebP ` +
    `is exempted by being declared in shared/gameConfig.ts or client/index.html, never by editing this script. ` +
    `If this file was passing yesterday, a declaration that exempted it has just been emptied: restore the ` +
    `declaration, or remove the declaration and the file together. Deleting the file alone makes this line go ` +
    `away and leaves the config change unreviewed, which is exactly how 452ab2b happened.`);
  failed = true;
}
for (const { file, size } of tooBig) {
  console.error(
    `::error::${file} is ${kb(size)}, over the ${kb(MAX_SINGLE_BYTES)} per-image cap. ` +
    `Serve it from the uploads volume rather than static assets: that path is content-addressed and swappable, ` +
    `while client/public is cached one-year-immutable and cannot be replaced.`);
  failed = true;
}
if (total > baseline.totalBytes) {
  console.error(
    `::error::shipped images total ${kb(total)}, over the ${kb(baseline.totalBytes)} baseline by ${kb(total - baseline.totalBytes)}. ` +
    `This is a ratchet: the number goes down, never up. New art belongs in the uploads volume. ` +
    `If you have genuinely made the total smaller, run --update-baseline.`);
  failed = true;
}

process.exit(failed ? 1 : 0);
