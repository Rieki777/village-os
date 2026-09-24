/**
 * The boot-import guard's own fixture suite.
 *
 * A guard nobody has watched refuse is a guard that reports green either way,
 * and this one refuses on an import shape -- a class of thing where the
 * difference between catching it and missing it is a regex. So every rule is
 * driven against a small fixture tree through `--root`/`--entry` and each
 * verdict is demonstrated: the static import refused, the dynamic import
 * allowed, the type-only import allowed, the transitive hop followed, the
 * budget enforced, and the floor that stops a broken walker reading as clean.
 *
 * The six import shapes in cases 2-7 are the ones that decide whether the fix
 * this guard defends actually holds: `await import("viem")` must pass and
 * `import ... from "viem"` must not, or the guard would refuse the fix and
 * accept the defect.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GUARD = path.resolve(import.meta.dirname, "check-boot-imports.mjs");

let checks = 0;
let failures = 0;

/** Build a fixture tree and run the guard over it. `files` maps path -> source. */
function run(files, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bootimports-"));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const r = spawnSync(
    process.execPath,
    [GUARD, "--root", dir, "--entry", "server/index.ts", "--floor", "1", ...extra],
    { encoding: "utf8" },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function check(label, got, want) {
  checks += 1;
  if (got === want) return;
  failures += 1;
  console.error(`FAIL: ${label}\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`);
}

// 1. The defect itself: a static viem import in the entry file.
{
  const r = run({ "server/index.ts": 'import { createPublicClient } from "viem";\nconsole.log(1);\n' });
  check("static viem import refused", r.status, 1);
  check("and viem is named", /viem is statically imported on the boot path/.test(r.out), true);
}

// 2. The fix: the same symbols reached through a dynamic import.
{
  const r = run({
    "server/index.ts": 'async function f() {\n  const { createPublicClient } = await import("viem");\n  return createPublicClient;\n}\nf();\n',
  });
  check("dynamic viem import passes", r.status, 0);
}

// 3. A dynamic import written on its own line, which is the shape a lazy
//    loader memoising two modules produces. `import(` must not read as a
//    statement just because it starts the line.
{
  const r = run({
    "server/index.ts": 'const p = Promise.all([\n  import("viem"),\n  import("viem/chains"),\n]);\nexport default p;\n',
  });
  check("line-leading import() passes", r.status, 0);
}

// 4. Type-only imports erase at runtime and cost a boot nothing.
{
  const r = run({ "server/index.ts": 'import type { PublicClient } from "viem";\nexport type T = PublicClient;\n' });
  check("import type passes", r.status, 0);
}

// 5. Inline type markers, all of them, erase the whole statement.
{
  const r = run({ "server/index.ts": 'import { type Address, type Hex } from "viem";\nexport type T = [Address, Hex];\n' });
  check("all-inline-type import passes", r.status, 0);
}

// 6. ...but a value binding alongside them does not.
{
  const r = run({ "server/index.ts": 'import getAddress, { type Address } from "viem";\ngetAddress("0x");\n' });
  check("value binding beside inline types refused", r.status, 1);
}

// 7. A re-export is a runtime import of the thing re-exported.
{
  const r = run({ "server/index.ts": 'export { getAddress } from "viem";\n' });
  check("export-from refused", r.status, 1);
}

// 8. Two hops away through relative files -- the real shape of the defect,
//    where index.ts imported hypha/village.ts which imported base-reads.ts.
//    The chain has to be printed or the message sends people to the wrong file.
{
  const r = run({
    "server/index.ts": 'import { v } from "./lib/village";\nconsole.log(v);\n',
    "server/lib/village.ts": 'import { r } from "./base-reads";\nexport const v = r;\n',
    "server/lib/base-reads.ts": 'import { getAddress } from "viem";\nexport const r = getAddress;\n',
  });
  check("transitive static import refused", r.status, 1);
  check(
    "and the chain names the middle file",
    /server.lib.village\.ts -> server.lib.base-reads\.ts/.test(r.out),
    true,
  );
}

// 9. The budget rule, on a package with no entry in DENY at all. Four files
//    against a ceiling of three, so the refusal is the budget and nothing else.
{
  const r = run(
    {
      "server/index.ts": 'import heavy from "heavyish";\nconsole.log(heavy);\n',
      "node_modules/heavyish/package.json": '{"name":"heavyish"}\n',
      "node_modules/heavyish/a.js": "1\n",
      "node_modules/heavyish/b.js": "1\n",
      "node_modules/heavyish/deep/c.js": "1\n",
    },
    ["--max-files", "3"],
  );
  check("over-budget package refused", r.status, 1);
  check("and the budget is named", /over the 3-file budget/.test(r.out), true);
}

// 10. The same package under the ceiling passes, so case 9 is measuring the
//     budget rather than the package merely being present.
{
  const r = run(
    {
      "server/index.ts": 'import heavy from "heavyish";\nconsole.log(heavy);\n',
      "node_modules/heavyish/package.json": '{"name":"heavyish"}\n',
      "node_modules/heavyish/a.js": "1\n",
    },
    ["--max-files", "3"],
  );
  check("under-budget package passes", r.status, 0);
}

// 11. THE FLOOR. Every case above passes `--floor 1` because a fixture tree is
//     tiny. This one does not, so the floor that stops a broken walker from
//     reporting a clean tree is itself exercised.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bootimports-floor-"));
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.writeFileSync(path.join(dir, "server/index.ts"), "export const x = 1;\n");
  const r = spawnSync(process.execPath, [GUARD, "--root", dir, "--entry", "server/index.ts"], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  check("a one-file walk fails the default floor", r.status, 1);
  check("and says the resolver is broken", /The resolver is broken/.test(`${r.stdout}${r.stderr}`), true);
}

// 12. A missing entry is a failure, not an empty pass.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bootimports-none-"));
  const r = spawnSync(process.execPath, [GUARD, "--root", dir, "--entry", "server/index.ts"], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  check("missing entry refused", r.status, 1);
}

// 13. Node builtins are never judged, whatever they are named.
{
  const r = run({ "server/index.ts": 'import fs from "node:fs";\nimport path from "path";\nconsole.log(fs, path);\n' });
  check("builtins pass", r.status, 0);
}

// 14. The passing line carries its denominator. A guard whose success message
//     says nothing cannot be told from a guard that looked at nothing.
{
  const r = run({
    "server/index.ts": 'import { v } from "./lib/village";\nconsole.log(v);\n',
    "server/lib/village.ts": "export const v = 1;\n",
  });
  check("clean tree passes", r.status, 0);
  check("and prints how many files it walked", /2 first-party file\(s\) statically reachable/.test(r.out), true);
}

console.log(`\ncheck-boot-imports.test.mjs: ${checks} check(s), ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
