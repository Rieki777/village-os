/**
 * START_HERE.md says of its backup and restore commands: "These exact
 * commands are run, and the restored village signed into, on every change to
 * the self-host path". Readiness finding R073 found that sentence untrue twice
 * over. The restore loaded the dump straight after `docker compose up -d db`
 * while the smoke waited for a healthy database first, so the founder's copy
 * could race MySQL's first start and the smoke never saw it; and the smoke's
 * path filter did not name START_HERE.md, so an edit to the commands never ran
 * it.
 *
 * This holds the sentence to the file. Every command line in the two Backups
 * blocks must appear in `.github/workflows/selfhost-smoke.yml`, read with the
 * smoke's `$compose` as `docker compose` and its `$DATE` as the doc's `DATE`,
 * and the smoke must run on a change to START_HERE.md. The line counts are
 * pinned as well, so a parse that finds nothing cannot pass by checking
 * nothing.
 *
 * Run: node scripts/start-here-backup-contract.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = fs.readFileSync(path.join(ROOT, "START_HERE.md"), "utf8").replace(/\r/g, "");
const smoke = fs.readFileSync(path.join(ROOT, ".github/workflows/selfhost-smoke.yml"), "utf8").replace(/\r/g, "");

const section = doc.split(/^## Backups$/m)[1]?.split(/^## /m)[0] ?? "";
assert.ok(section, "START_HERE.md has a Backups section");
const blocks = [...section.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gm)].map((m) =>
  m[1].split("\n").map((l) => l.trim()).filter(Boolean),
);
assert.ok(blocks.length >= 2, `the Backups section has a backup block and a restore block, found ${blocks.length}`);
const [backup, restore] = blocks;
assert.ok(backup.length >= 3, `the backup block has its three commands, found ${backup.length}`);
assert.ok(restore.length >= 5, `the restore block has its five commands, found ${restore.length}`);

const smokeLines = new Set(
  smoke.split("\n").map((l) => l.trim().replace(/\$compose /g, "docker compose ").replace(/\$DATE/g, "DATE")),
);
for (const line of [...backup, ...restore]) {
  assert.ok(smokeLines.has(line), `selfhost-smoke.yml does not run this START_HERE.md command:\n  ${line}`);
}

const paths = smoke.split(/^\s*paths:\s*$/m)[1]?.split(/^\s*workflow_dispatch:/m)[0] ?? "";
assert.match(paths, /^\s*-\s*START_HERE\.md\s*$/m, "selfhost-smoke.yml runs on a change to START_HERE.md");

console.log(`ok  start-here backup contract: ${backup.length} backup and ${restore.length} restore commands, each run by the smoke`);
