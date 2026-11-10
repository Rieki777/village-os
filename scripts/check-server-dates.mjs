#!/usr/bin/env node
/**
 * No bare `toLocale*String()` in server code (readiness R134).
 *
 * WHY. On a server, `new Date(x).toLocaleDateString()` with no arguments
 * formats in the CONTAINER's locale and time zone, which is UTC and M/D/Y on
 * every host this platform runs on. A notice written that way tells a village a
 * day ahead of UTC the wrong day, in a date format it may not read. The fix has
 * existed since R134: `deadlineInVillage` (server/lib/villageReaders.ts) gives
 * a ballot's deadline in the village's own calendar, and the other notices
 * pass an explicit locale and time zone. Two vote notices written after that
 * fix still used the bare form (the canvas, #1055), because nothing refused it.
 * This is the refusal.
 *
 * WHAT IT REFUSES. A call to `toLocaleString`, `toLocaleDateString` or
 * `toLocaleTimeString` with no arguments, or with only `undefined`, in any
 * `server/` TypeScript file that is not a test. A call that names its locale is
 * left alone: `(m / 100).toLocaleString("en-US", ...)` formats a number and
 * reads no clock, and a date call that passes `timeZone` has chosen one.
 *
 * WHAT IT CANNOT SEE. A date formatted with a locale and NO `timeZone` still
 * reads the container's zone; this guard does not parse the options object.
 * Comments are skipped line by line (`scripts/brand-strip.mjs`), so a bare call
 * written inside a multi-line block comment whose lines do not start with `*`
 * would be counted; none does today.
 *
 * A genuine exception takes `server-date-ok: <reason>` on the same line.
 *
 * Usage: node scripts/check-server-dates.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./brand-strip.mjs";

const BARE = /\.toLocale(?:Date|Time)?String\(\s*(?:undefined\s*)?\)/g;
const WAIVER = /server-date-ok:\s*\S/;

/** Every bare call on one source line, as the guard reads it (code only). Pure. */
export function bareDateCalls(line) {
  if (WAIVER.test(line)) return [];
  const code = stripComments(line, ".ts");
  return [...code.matchAll(BARE)].map((m) => m[0].slice(1));
}

/** Every hit in one file's text: `{ line, call }`. Pure. */
export function scanText(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const call of bareDateCalls(line)) hits.push({ line: i + 1, call });
  });
  return hits;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const serverDir = path.join(root, "server");
  const files = walk(serverDir);
  if (files.length === 0) {
    console.error("::error::check-server-dates found no server TypeScript files to read, so it checked nothing.");
    process.exit(1);
  }
  const found = [];
  for (const f of files) {
    for (const h of scanText(fs.readFileSync(f, "utf8"))) found.push({ file: path.relative(root, f).split(path.sep).join("/"), ...h });
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ files: files.length, found }, null, 2));
  if (found.length > 0) {
    console.error(`::error::${found.length} bare toLocale*String() call(s) in server code. On a server that formats in the container's UTC and its M/D/Y, so a village is told the wrong day.`);
    for (const h of found) console.error(`  ${h.file}:${h.line}  ${h.call}`);
    console.error("  A ballot deadline: deadlineInVillage(at) from server/lib/villageReaders.ts.");
    console.error("  Any other date: pass a locale and a timeZone. A genuine exception: `server-date-ok: <reason>` on the line.");
    process.exit(1);
  }
  console.log(`check-server-dates: ${files.length} server files, no bare toLocale*String().`);
}
