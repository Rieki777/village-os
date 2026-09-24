/**
 * A TEST POOL MUST BE CONFIGURED LIKE THE POOL THE APPLICATION RUNS ON.
 *
 * `server/db/pool.ts` gives every connection two things: the driver's
 * `timezone: "Z"` and a `SET time_zone = '+00:00'` on the connection itself.
 * 175 test files gave their pools the first and not the second, which means the
 * configuration under test was never the configuration that runs.
 *
 * The half that was missing is the half that does not cancel out. A value
 * written through the driver and read back through the driver is right either
 * way, which is most assertions and is why every suite passes today. A value
 * written by `NOW()` and read with `UNIX_TIMESTAMP`, or two instants compared
 * in SQL, is displaced by the database host's offset, and that offset is not
 * even constant: it follows the date being read across daylight-saving
 * boundaries. Measured on this tree, a February instant read at -08:00 on a
 * host whose `NOW()` reported -07:00, in the same second on the same
 * connection.
 *
 * `server/db/testDb.ts` exports `testPool` for this. The guard exists because
 * the convention it replaces was already written down, on `TestDb.url`, and was
 * followed by 175 files and followed half.
 *
 * ── A RATCHET, NOT A WALL, AND WHY ─────────────────────────────────────────
 *
 * Converting all 175 files in one commit would conflict with every lane in
 * flight, for a fidelity win in files that mostly never compare a clock. So the
 * total may only ever fall, the same discipline as `check-brand-refs.mjs` and
 * `check-theme-literals.mjs`: new pools are born pinned, and the rest come
 * across as their files are touched for other reasons.
 *
 * ── THE WAIVER ─────────────────────────────────────────────────────────────
 *
 * Some pools are unpinned ON PURPOSE, because the pin is the thing under test.
 * Those carry `test-pool-ok: <reason>` ON THE LINE ITSELF, the same rule
 * `check-brand-refs.mjs` uses, and they are counted and printed so they stay
 * honest. A waiver on the line above does nothing.
 *
 * Usage:
 *   node scripts/check-test-pool-timezone.mjs
 *   node scripts/check-test-pool-timezone.mjs --json
 *   node scripts/check-test-pool-timezone.mjs --update-baseline   (refuses to raise)
 *   node scripts/check-test-pool-timezone.mjs --dir <path>        (for the self-test)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg !== -1 && process.argv[dirArg + 1]
  ? path.resolve(process.argv[dirArg + 1])
  : path.join(ROOT, "server");

const baselineArg = process.argv.indexOf("--baseline");
const BASELINE_PATH = baselineArg !== -1 && process.argv[baselineArg + 1]
  ? path.resolve(process.argv[baselineArg + 1])
  : path.join(ROOT, "scripts", "test-pool-baseline.json");

const JSON_OUT = process.argv.includes("--json");
const UPDATE = process.argv.includes("--update-baseline");

/** Every `*.test.ts` under a directory, walked rather than listed. */
function testFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...testFiles(full));
    } else if (/\.test\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = fs.existsSync(DIR) ? testFiles(DIR) : [];
const unpinned = [];
let waived = 0;
let pinned = 0;
let filesWithPools = 0;

for (const file of files) {
  // Carriage returns come off before any anchored rule, the lesson
  // `scripts/brand-strip.mjs` paid for: on a CRLF checkout an end-anchored
  // pattern never matches and every line reads as clean.
  const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
  let sawPool = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\btestPool\s*\(/.test(line)) {
      pinned += 1;
      sawPool = true;
    }
    if (!/\bcreatePool\s*\(/.test(line)) continue;
    sawPool = true;
    if (/test-pool-ok:/.test(line)) {
      waived += 1;
      continue;
    }
    unpinned.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), line: i + 1 });
  }
  if (sawPool) filesWithPools += 1;
}

const total = unpinned.length;
const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : { total: Number.POSITIVE_INFINITY };

if (JSON_OUT) {
  console.log(JSON.stringify({ total, baseline: baseline.total, pinned, waived, files: files.length, unpinned }, null, 2));
  process.exit(total > baseline.total ? 1 : 0);
}

// THE DENOMINATORS, always, so a zero is readable as a measurement rather than
// as a scan that found nothing because it looked nowhere.
console.log(`test-pool timezone ratchet`);
console.log(`  test files scanned     ${files.length}`);
console.log(`  files holding a pool   ${filesWithPools}`);
console.log(`  pinned (testPool)      ${pinned}`);
console.log(`  waived on the line     ${waived}`);
console.log(`  UNPINNED               ${total}   (baseline ${baseline.total})`);

if (UPDATE) {
  if (total > baseline.total) {
    console.error(
      `\nREFUSING to raise the baseline from ${baseline.total} to ${total}. ` +
        `This number only goes down. Build pools with testPool() from server/db/testDb.ts.`,
    );
    process.exit(1);
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ total }, null, 2)}\n`);
  console.log(`\nbaseline written: ${total}`);
  process.exit(0);
}

if (total > baseline.total) {
  console.error(
    `\nThe count rose by ${total - baseline.total}, from ${baseline.total} to ${total}.\n` +
      `WHAT FOLLOWS IS EVERY UNPINNED POOL, not the new ones. This guard holds a TOTAL and\n` +
      `cannot tell which line is yours; diff against the base ref to find it. The first draft\n` +
      `of this message said "N new" above a list of forty unrelated files, which sent the\n` +
      `reader looking in the wrong place.` +
      (total > 40 ? `\nShowing the first 40 of ${total}.` : ""),
  );
  for (const u of unpinned.slice(0, 40)) console.error(`  ${u.file}:${u.line}`);
  console.error(
    `\nA pool built with mysql.createPool({ timezone: "Z" }) reads NOW() and UNIX_TIMESTAMP in the\n` +
      `database host's zone, not UTC, and the error changes size across a daylight-saving boundary.\n` +
      `Use testPool(db, { connectionLimit: n }) from server/db/testDb.ts. If the missing pin is the\n` +
      `thing your test is measuring, put "test-pool-ok: <reason>" on the createPool line itself.`,
  );
  process.exit(1);
}

process.exit(0);
