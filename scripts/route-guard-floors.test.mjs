/**
 * The route-reading guards fail when they read too little to have checked
 * anything (R206). check-route-limits, check-auth-fetch and check-admin-reach
 * each passed on a run that read zero routes, because a pattern that stopped
 * matching finds no violation. Each now has a floor on what it read.
 *
 * A floor that is never reached cannot be seen working on the real tree, so
 * each guard is run twice: as CI runs it (must pass), and with its floor
 * raised past anything the tree holds (must fail and say how many it read).
 *
 * Run: node scripts/route-guard-floors.test.mjs
 */
import assert from "node:assert";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARDS = [
  ["check-route-limits.mjs", "ROUTE_LIMITS_MIN"],
  ["check-auth-fetch.mjs", "AUTH_FETCH_MIN"],
  ["check-admin-reach.mjs", "ADMIN_REACH_MIN"],
];

for (const [script, floorVar] of GUARDS) {
  const env = { ...process.env };
  delete env.ROUTE_LIMITS_ROOT;
  delete env[floorVar];
  const ok = spawnSync(process.execPath, [path.join(HERE, script)], { encoding: "utf8", env });
  assert.strictEqual(ok.status, 0, `${script} fails on the real tree:\n${(ok.stdout + ok.stderr).slice(-600)}`);

  const high = spawnSync(process.execPath, [path.join(HERE, script)], { encoding: "utf8", env: { ...env, [floorVar]: "1000000" } });
  assert.strictEqual(high.status, 1, `${script} passed while reading under its floor:\n${(high.stdout + high.stderr).slice(-600)}`);
  assert.match(high.stderr, /read only \d+/, `${script} failed under its floor without saying how much it read`);
}
console.log(`ok  route guard floors: ${GUARDS.length} guards pass the real tree and refuse a read under their floor`);
