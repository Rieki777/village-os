/**
 * Proof that scripts/check-test-pool-timezone.mjs is a real ratchet.
 *
 * A guard nobody has watched refuse is a guard nobody knows works, and this
 * repository has paid for that lesson twice in a week: an intake classifier
 * printing `blocked: false` with nothing listed, and a governance check that
 * matched `/steward/i` against a comment and reported a ruling as built. So
 * every property here is asserted against the REAL shipped script, driven at
 * fixture trees through its own `--dir` and `--baseline` flags. Nothing is
 * copied and nothing is reimplemented.
 *
 * This file is also what ENFORCES the gate today. `.github/workflows/ci.yml`
 * is owned by the safety lane (ledger section 27), so the CI step is filed in
 * section 6 rather than added here, and meanwhile this test runs under the
 * existing `pnpm test` step. That is the same arrangement
 * `server/serverIndexRatchet.test.ts` uses for the server-index ratchet.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-test-pool-timezone.mjs");

const made: string[] = [];

afterAll(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway tree of test files, plus a baseline file to judge them against. */
function fixture(files: Record<string, string>, baseline: number | null): { dir: string; baselinePath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-pool-ratchet-"));
  made.push(root);
  const dir = path.join(root, "server");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const baselinePath = path.join(root, "baseline.json");
  if (baseline !== null) fs.writeFileSync(baselinePath, `${JSON.stringify({ total: baseline }, null, 2)}\n`);
  return { dir, baselinePath };
}

function run(dir: string, baselinePath: string, extra: string[] = []) {
  const r = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--baseline", baselinePath, ...extra], {
    encoding: "utf8",
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const UNPINNED = `const p = mysql.createPool({ uri: db.url, timezone: "Z" });\n`; // test-pool-ok: a fixture string, never a pool
const PINNED = `const p = testPool(db, { connectionLimit: 2 });\n`;

describe("the test-pool timezone ratchet", () => {
  it("REFUSES a tree that holds more unpinned pools than its baseline", () => {
    const { dir, baselinePath } = fixture({ "a.test.ts": UNPINNED + UNPINNED }, 1);
    const r = run(dir, baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.test.ts");
    expect(r.stderr).toContain("testPool");
  });

  it("passes a tree that sits at its baseline", () => {
    const { dir, baselinePath } = fixture({ "a.test.ts": UNPINNED }, 1);
    expect(run(dir, baselinePath).status).toBe(0);
  });

  it("counts a testPool() call as pinned and never as debt", () => {
    const { dir, baselinePath } = fixture({ "a.test.ts": PINNED + PINNED }, 0);
    const r = run(dir, baselinePath);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pinned (testPool)      2");
  });

  it("honours a waiver ON THE LINE, and ignores one on the line above", () => {
    const onTheLine = `const p = mysql.createPool({ uri: db.url }); // test-pool-ok: the pin is what this measures\n`;
    const lineAbove = `// test-pool-ok: this does nothing here\nconst p = mysql.createPool({ uri: db.url });\n`;
    const good = fixture({ "a.test.ts": onTheLine }, 0);
    expect(run(good.dir, good.baselinePath).status).toBe(0);

    const bad = fixture({ "a.test.ts": lineAbove }, 0);
    expect(run(bad.dir, bad.baselinePath).status).toBe(1);
  });

  it("walks subdirectories, so a pool under server/repos is not invisible", () => {
    const { dir, baselinePath } = fixture({ "repos/deep.test.ts": UNPINNED }, 0);
    const r = run(dir, baselinePath);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("deep.test.ts");
  });

  it("reads only *.test.ts, so production code holding a pool is not counted", () => {
    const { dir, baselinePath } = fixture({ "pool.ts": UNPINNED }, 0);
    expect(run(dir, baselinePath).status).toBe(0);
  });

  it("REFUSES to raise its own baseline, and leaves the file byte-identical", () => {
    const { dir, baselinePath } = fixture({ "a.test.ts": UNPINNED + UNPINNED }, 1);
    const before = fs.readFileSync(baselinePath, "utf8");
    const r = run(dir, baselinePath, ["--update-baseline"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REFUSING to raise");
    expect(fs.readFileSync(baselinePath, "utf8")).toBe(before);
  });

  it("writes a baseline that has fallen", () => {
    const { dir, baselinePath } = fixture({ "a.test.ts": UNPINNED }, 5);
    expect(run(dir, baselinePath, ["--update-baseline"]).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(baselinePath, "utf8")).total).toBe(1);
  });

  it("and the real tree still sits at its committed baseline", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(0);
    // The denominators print, so a zero is readable as a measurement.
    expect(r.stdout).toContain("test files scanned");
  });
});
