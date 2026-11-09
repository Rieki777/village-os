/**
 * The two colour ratchets, run for real against a fixture (readiness R209 and
 * R205).
 *
 * check-tailwind-gray.mjs and check-theme-literals.mjs had no test that
 * executed them: nothing proved the gate goes red on a new hit, and nothing
 * proved `--update-baseline` refuses what it should. R205 found the second
 * hole by hand. A fall in one file paid for a NEW hit in another, because the
 * write path compared totals only, and the line it printed said "lowered".
 *
 * Each script takes `--root` and `--baseline`, so this never reads or writes
 * the repository's own files.
 *
 * Run: node scripts/check-colour-ratchets.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// `gate: false` for theme-literals: its gate path also runs contrast-pairing
// checks that read this repository's real pages, so on a fixture only its
// write path is meaningful. The write path is where R205 lives, and it exits
// before the pairing checks run.
const RATCHETS = [
  { script: "check-tailwind-gray.mjs", gate: true, hit: (i) => `  <p className="text-gray-500">line ${i}</p>` },
  { script: "check-tailwind-palette.mjs", gate: true, hit: (i) => `  <p className="${i % 2 ? "hover:text-blue-900" : "bg-emerald-50"}">line ${i}</p>` },
  { script: "check-theme-literals.mjs", gate: false, hit: (i) => `  <p style={{ color: "#a1b2c3" }}>line ${i}</p>` },
];

const page = (name, hits, ratchet) =>
  `export function ${name}() {\n  return (\n    <div>\n${Array.from({ length: hits }, (_, i) => `  ${ratchet.hit(i)}`).join("\n")}\n    </div>\n  );\n}\n`;

let checks = 0;
for (const ratchet of RATCHETS) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "colour-ratchet-"));
  const baselinePath = path.join(root, "baseline.json");
  const src = path.join(root, "client", "src");
  fs.mkdirSync(src, { recursive: true });
  const put = (name, hits) => {
    const file = path.join(src, `${name}.tsx`);
    if (hits === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, page(name, hits, ratchet));
  };
  const run = (...args) => {
    const r = spawnSync(process.execPath, [path.join(HERE, ratchet.script), "--root", root, "--baseline", baselinePath, ...args], { encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const recorded = () => JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const is = (label, r, code, said) => {
    assert.strictEqual(r.code, code, `${ratchet.script}: ${label}: expected exit ${code}, got ${r.code}\n${r.out.slice(-900)}`);
    if (said) assert.match(r.out, said, `${ratchet.script}: ${label}: the output does not say ${said}`);
    checks += 1;
  };

  try {
    put("Old", 4);
    fs.writeFileSync(baselinePath, `${JSON.stringify({ totalLiterals: 4, files: { "client/src/Old.tsx": 4 } }, null, 2)}\n`);
    if (ratchet.gate) is("the tree at its baseline passes", run(), 0);

    put("Fresh", 2);
    if (ratchet.gate) is("a NEW file with hits fails the gate", run(), 1, /Fresh\.tsx/);

    // The R205 hole: Old falls by three and pays for Fresh's two.
    put("Old", 1);
    const before = recorded();
    is("a fall elsewhere does not let --update-baseline record a new file", run("--update-baseline"), 1, /refusing to write.*Fresh\.tsx: 2, the baseline allows 0/s);
    assert.deepStrictEqual(recorded(), before, `${ratchet.script}: the refused write left the baseline as it was`);

    put("Fresh", null);
    is("a pure fall is recorded", run("--update-baseline"), 0, /lowered to 1/);
    assert.deepStrictEqual(recorded().files, { "client/src/Old.tsx": 1 }, `${ratchet.script}: the recorded fall`);

    put("Old", 2);
    is("a raise is refused", run("--update-baseline"), 1, /refusing to raise/);
    assert.deepStrictEqual(recorded().files, { "client/src/Old.tsx": 1 }, `${ratchet.script}: the refused raise wrote nothing`);
    if (ratchet.gate) is("and the gate fails on it", run(), 1, /Old\.tsx/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log(`ok  colour ratchets: ${checks} checks across ${RATCHETS.length} ratchets, a fall elsewhere buys no new hit`);
