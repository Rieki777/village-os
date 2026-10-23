#!/usr/bin/env node
/**
 * The birth-town list the Gene Keys form searches, from GeoNames.
 *
 * A member's birth town only sets the clock: it names the time zone their
 * local birth time is read in. So the list carries a name, a country and a
 * zone, and nothing else, biggest towns first so a search shows the likely
 * one at the top.
 *
 * WHY server/assets AND NOT client/public. client/public is copied into
 * dist/public, which CI holds to MAX_TOTAL_DIST_KB, and this file would spend
 * most of the headroom every lane shares. server/assets ships in the image and
 * is served by `GET /api/gene-keys/places` to signed-in members, compressed on
 * the wire. The browser downloads the whole list and searches it locally, so a
 * typed birth town never leaves the member's device.
 *
 * Input is GeoNames `cities15000.txt` (every place of 15,000 people or more,
 * CC BY 4.0, credited on the form): download
 * https://download.geonames.org/export/dump/cities15000.zip and unzip it.
 * This script makes no network call.
 *
 *   node scripts/gen-gene-keys-places.mjs <path to cities15000.txt>
 *
 * Output format, read by client/src/components/geneKeys/places.ts:
 *   line 1        a comment naming the source and licence
 *   then          one IANA zone per line, then one blank line
 *   then          name TAB ascii-name-if-different TAB country TAB zone-index (base 36)
 */
import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("Usage: node scripts/gen-gene-keys-places.mjs <path to cities15000.txt>");
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const out = path.join(ROOT, "server", "assets", "places", "cities15000.txt");

const rows = fs
  .readFileSync(src, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"))
  .filter((r) => r[1] && r[17])
  .sort((a, b) => Number(b[14] || 0) - Number(a[14] || 0));

const zones = [...new Set(rows.map((r) => r[17]))];
const index = new Map(zones.map((z, i) => [z, i]));
const clean = (s) => String(s).replace(/[\t\n\r]/g, " ");
const body = rows.map((r) => [clean(r[1]), r[2] === r[1] ? "" : clean(r[2]), r[8], index.get(r[17]).toString(36)].join("\t"));

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `# GeoNames cities15000, CC BY 4.0, https://www.geonames.org (generated ${new Date().toISOString().slice(0, 10)})\n` +
    zones.join("\n") + "\n\n" + body.join("\n") + "\n",
);
console.log(`${rows.length} places, ${zones.length} zones, ${fs.statSync(out).size} bytes -> ${path.relative(ROOT, out)}`);
