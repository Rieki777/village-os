/**
 * A ratchet whose baseline file is missing must fail, never pass (R203).
 *
 * Three of them read a missing baseline as permission: the image budget took
 * today's total as the baseline, the test-pool timezone ratchet took
 * infinity, and the module-docs ratchet took infinity. Deleting the file was
 * therefore a way to clear any of them, and a fork that lost the file in a
 * copy would never be told. Each now refuses, names the file, and says how to
 * write one on purpose (`--update-baseline`, which still only ever records
 * the number it measured).
 *
 * Each script is pointed at a baseline path that does not exist, in a scratch
 * directory, so the real baselines are never touched.
 *
 * Run: node scripts/ratchet-missing-baseline.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ["check-image-budget.mjs", "check-test-pool-timezone.mjs", "check-module-docs.mjs"];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-baseline-"));

try {
  for (const script of SCRIPTS) {
    const missing = path.join(scratch, `${script}.missing.json`);
    const r = spawnSync(process.execPath, [path.join(HERE, script), "--baseline", missing], { encoding: "utf8" });
    const said = `${r.stdout}\n${r.stderr}`;
    assert.strictEqual(r.status, 1, `${script} passed with no baseline file at all:\n${said.slice(-600)}`);
    assert.match(said, /baseline/i, `${script} failed without saying the baseline is missing`);
    assert.ok(!fs.existsSync(missing), `${script} wrote a baseline it was only asked to check`);

    const written = path.join(scratch, `${script}.written.json`);
    const u = spawnSync(process.execPath, [path.join(HERE, script), "--baseline", written, "--update-baseline"], { encoding: "utf8" });
    assert.strictEqual(u.status, 0, `${script} --update-baseline could not create a first baseline:\n${(u.stdout + u.stderr).slice(-600)}`);
    assert.ok(fs.existsSync(written), `${script} --update-baseline wrote no file`);
  }
  console.log(`ok  ratchet missing baseline: ${SCRIPTS.length} ratchets refuse a missing baseline and create one only on --update-baseline`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
