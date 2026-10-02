/**
 * The public tree guard's own guard.
 *
 * Every rule gets a file that must trip it and a near miss that must not, so a
 * rule that silently stopped matching fails here rather than waving the next
 * leak through. The fixtures live in a scratch directory and are passed to the
 * real script by name, so nothing here depends on this repository's contents.
 *
 * The secret-looking strings below are assembled from pieces at run time, so
 * this file itself never carries one whole. It is also exempt in the gate.
 *
 * Run: node scripts/check-public-tree.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scan } from "./check-public-tree.mjs";

const SCRIPT = fileURLToPath(new URL("./check-public-tree.mjs", import.meta.url));
const BS = String.fromCharCode(92);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-tree-"));

function write(rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return rel;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const uuid = ["0eaaf3fa", "30a2", "4860", "ab00", "f77e10ba6fc9"].join("-");
const TRIPS = {
  "railway-proxy": `connect to ${["sakura", "proxy", "rlwy", "net"].join(".")}:50483`,
  "railway-domain": `remove ${["mysql-production-7798", "up", "railway", "app"].join(".")}`,
  "railway-id": `measured on deployment ${uuid} of the service`,
  "recovery-key": `the key is in AMORA-BACKUP-${"RECOVERY-KEY"}/`, // brand-ok: a fixture for the gate
  "private-key": `-----BEGIN ${"PGP PRIVATE KEY"} BLOCK-----`,
  "home-path": `C:${BS}Users${BS}someone${BS}Desktop${BS}notes.md`,
};
const NEAR_MISSES = {
  "railway-proxy": "a Railway proxy reaches the database from outside",
  "railway-domain": "your service answers at <your-service>.up.railway.app",
  "railway-id": `a test fixture id ${uuid} with no Railway word nearby`,
  "recovery-key": "keep the recovery key offline",
  "private-key": "-----BEGIN PUBLIC KEY-----",
  "home-path": "/home/runner/work/village-os and /home/claude/livingmap and C: drive",
};

check("every text rule trips on its fixture and nowhere else", () => {
  for (const [rule, text] of Object.entries(TRIPS)) {
    const f = write(`trip-${rule}.md`, `line one\n${text}\n`);
    const { findings } = scan(dir, [f]);
    assert.deepStrictEqual(findings.map((x) => x.rule), [rule], `${rule} should trip exactly once on: ${text}`);
    assert.strictEqual(findings[0].line, 2);
  }
});

check("no rule trips on its near miss", () => {
  for (const [rule, text] of Object.entries(NEAR_MISSES)) {
    const f = write(`miss-${rule}.md`, `${text}\n`);
    const { findings, read } = scan(dir, [f]);
    assert.strictEqual(read, 1, "the file must actually have been read");
    assert.deepStrictEqual(findings, [], `${rule} near miss tripped: ${text}`);
  }
});

check("the internal planning files are refused by name, wherever they sit", () => {
  const names = [
    "SEASON2_FLEET_LEDGER.md",
    "CLAUDE_CODE_PROMPT_2026-10-01_ANYTHING.md",
    "docs/prototypes/FIXES_TO_MAKE_2026-08-08.md",
    "SESSION_HANDOFF.md",
    "PLAN_TO_A.md",
    ".env",
    ".env.remote-backup",
    "sub/.demo-db-url",
  ];
  const files = names.map((n) => write(n, "nothing secret in the body\n"));
  const { findings } = scan(dir, files);
  assert.deepStrictEqual(findings.map((f) => f.file).sort(), [...names].sort());
});

check(".env.example and ordinary files pass by name", () => {
  const files = [write(".env.example", "DATABASE_URL=\n"), write("docs/PLAN.md", "a plan\n"), write("README.md", "hello\n")];
  assert.deepStrictEqual(scan(dir, files).findings, []);
});

check("an inline waiver is honoured and counted", () => {
  const f = write("waived.md", `${TRIPS["railway-proxy"]} public-tree-ok: quoting the incident\n`);
  const r = scan(dir, [f]);
  assert.deepStrictEqual(r.findings, []);
  assert.strictEqual(r.waived, 1);
});

check("the real script exits 1 on a leak and 0 on a clean tree, and says how much it read", () => {
  const bad = write("leak.md", `${TRIPS["home-path"]}\n`);
  const good = write("clean.md", "nothing here\n");
  const red = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--files", `${good},${bad}`], { encoding: "utf8" });
  assert.strictEqual(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stderr, /leak\.md:1\s+\[home-path\]/);
  const green = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--files", good], { encoding: "utf8" });
  assert.strictEqual(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /1 tracked file\(s\), 1 read as text/);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`check-public-tree self-test: ${passed} passed`);
