/**
 * The port guard's own fixture suite.
 *
 * A ratchet nobody has watched refuse is a ratchet that reports green either
 * way. This drives `check-e2e-ports.mjs` against small fixture trees through
 * its `--dir` argument, so each refusal is demonstrated rather than assumed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GUARD = path.resolve(import.meta.dirname, "check-e2e-ports.mjs");

let checks = 0;
let failures = 0;

function run(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portguard-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  const r = spawnSync(process.execPath, [GUARD, "--dir", dir], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function check(label, got, want) {
  checks += 1;
  if (got === want) return;
  failures += 1;
  console.error(`FAIL: ${label}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`);
}

// 1. Two disjoint windows are fine.
{
  const r = run({
    "a.e2e.test.ts": "const PORT = 7000 + (process.pid % 400);\n",
    "b.e2e.test.ts": "const PORT = 7400 + (process.pid % 400);\n",
  });
  check("disjoint windows pass", r.status, 0);
}

// 2. Identical bases: the eleven-file case that collided in every run.
{
  const r = run({
    "a.e2e.test.ts": "const PORT = 7000 + (process.pid % 400);\n",
    "b.e2e.test.ts": "const PORT = 7000 + (process.pid % 400);\n",
  });
  check("identical bases refused", r.status, 1);
  check("and named as overlapping", /overlapping windows/.test(r.out), true);
}

// 3. Windows that merely touch at one port are still an overlap.
{
  const r = run({
    "a.e2e.test.ts": "const PORT = 7000 + (process.pid % 400);\n",
    "b.e2e.test.ts": "const PORT = 7399 + (process.pid % 400);\n",
  });
  check("one shared port is an overlap", r.status, 1);
}

// 4. A fixed port: the modulePool defect, by name.
{
  const r = run({ "a.e2e.test.ts": "const PORT = 8127;\n" });
  check("fixed port refused", r.status, 1);
  check("and called a FIXED port", /is a FIXED port/.test(r.out), true);
}

// 5. A derived stub port carries its base's window with it. This is the class
//    every hand-written survey missed: they grepped for `process.pid %`.
{
  const r = run({
    "a.e2e.test.ts": "const PORT = 7000 + (process.pid % 400);\nconst STUB_PORT = PORT + 400;\n",
    "b.e2e.test.ts": "const PORT = 7400 + (process.pid % 400);\n",
  });
  check("a derived port collides like any other", r.status, 1);
}

// 6. Two windows in the SAME file may overlap: within a run the pid is fixed,
//    so PORT and PORT + 1 are two different ports.
{
  const r = run({ "a.e2e.test.ts": "const PORT = 7000 + (process.pid % 400);\nconst STUB_PORT = PORT + 1;\n" });
  check("same-file overlap allowed", r.status, 0);
}

// 7. The ephemeral floor, which only ever bites on Linux.
{
  const r = run({ "a.e2e.test.ts": "const PORT = 32700 + (process.pid % 400);\n" });
  check("a window reaching 32768+ refused", r.status, 1);
  check("and says why", /ephemeral/.test(r.out), true);
}

// 8. Finding nothing is a failure, not a clean run.
{
  const r = run({ "a.e2e.test.ts": "// no ports here\n" });
  check("an empty survey refused", r.status, 1);
}

// 9. A non-port numeric constant must not be mistaken for a port.
{
  const r = run({
    "a.e2e.test.ts": "const MAX_ROWS = 6000;\nconst PORT = 7000 + (process.pid % 400);\n",
    "b.e2e.test.ts": "const PORT = 7400 + (process.pid % 400);\n",
  });
  check("a non-port constant is ignored", r.status, 0);
}

// 10. A window holding a port fetch() refuses. The fixtures above moved from
//     6000/6400 to 7000/7400 for exactly this reason: both old windows held one.
//     This is adminTokens.e2e's old window, which failed CI on 6668, 6669, 6679.
{
  const r = run({ "a.e2e.test.ts": "const PORT = 6500 + (process.pid % 400);\n" });
  check("a window holding a fetch-blocked port refused", r.status, 1);
  check("and names the ports", /holds 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697/.test(r.out), true);
  check("and the widest clean stretch left", /\[6698-6899\], 202 port\(s\)/.test(r.out), true);
}

// 11. A derived stub port that lands on one is refused like a base port.
{
  const r = run({ "a.e2e.test.ts": "const PORT = 7000 + (process.pid % 100);\nconst STUB_PORT = PORT + 3060;\n" });
  check("a derived port on a fetch-blocked port refused", r.status, 1);
  check("and named by its own name", /STUB_PORT \[10060-10159\] holds 10080/.test(r.out), true);
}

// 12. The window adminTokens.e2e moved to passes.
{
  const r = run({ "a.e2e.test.ts": "const PORT = 6698 + (process.pid % 202);\n" });
  check("the widest clean stretch passes", r.status, 0);
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} check(s) FAILED.`);
  process.exit(1);
}
console.log(`check-e2e-ports: ${checks} check(s) passed`);
