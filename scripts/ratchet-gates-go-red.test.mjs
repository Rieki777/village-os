/**
 * Four guards that had no test showing they can go RED (readiness R209).
 *
 * Each was tested only for refusing a missing baseline (ratchet-missing-
 * baseline.test.mjs) or for its read floor (route-guard-floors.test.mjs). A
 * guard that has never been seen failing is a guard nobody knows works, so
 * each is driven red here for the reason it exists, and then green again, so
 * the red is about that reason and nothing else:
 *
 *   image budget   a baseline below what client/public weighs fails, an equal
 *                  one passes, and --update-baseline refuses to record a rise;
 *   module docs    the same, on the count of modules with no contract doc;
 *   brand refs     an allowance of zero for every file fails and names the
 *                  file, --update-baseline refuses the raise per file and
 *                  writes nothing, and --force writes the measured counts,
 *                  which then pass;
 *   auth fetch     a client fetch with no token, to a route that answers a
 *                  stranger 401, fails, and the same call with a token passes.
 *
 * The three ratchets are pointed at a scratch baseline (`--baseline`), so the
 * committed ones are never touched. The auth guard reads the tree it is run in,
 * so it is run inside a two-file fixture.
 *
 * Run: node scripts/ratchet-gates-go-red.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-red-"));
const run = (script, args = [], opts = {}) => {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: "utf8", ...opts });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
let checked = 0;

try {
  // ── The image budget ───────────────────────────────────────────────────
  {
    const script = "check-image-budget.mjs";
    // One JSON line, then the human report, which this does not read.
    const measured = JSON.parse(run(script, ["--json"]).out.split("\n").find((l) => l.trim().startsWith("{"))).total;
    assert.ok(measured > 0, "the image budget measured nothing, so nothing below means anything");
    const b = path.join(scratch, "image.json");
    writeJson(b, { totalBytes: measured - 1, files: 0, maxSingleBytes: 409600 });
    const over = run(script, ["--baseline", b]);
    assert.strictEqual(over.status, 1, `${script} passed a tree one byte over its baseline:\n${over.out.slice(-600)}`);
    assert.match(over.out, /over the .* baseline/, `${script} failed without saying the total is over`);
    const refused = run(script, ["--baseline", b, "--update-baseline"]);
    assert.strictEqual(refused.status, 1, `${script} --update-baseline recorded a rise:\n${refused.out.slice(-600)}`);
    assert.strictEqual(readJson(b).totalBytes, measured - 1, `${script} --update-baseline wrote the rise it refused`);
    writeJson(b, { totalBytes: measured, files: 0, maxSingleBytes: 409600 });
    const equal = run(script, ["--baseline", b]);
    assert.strictEqual(equal.status, 0, `${script} failed a tree that sits at its baseline:\n${equal.out.slice(-600)}`);
    checked++;
  }

  // ── Module docs ────────────────────────────────────────────────────────
  {
    const script = "check-module-docs.mjs";
    const j = run(script, ["--json"]).out;
    const measured = JSON.parse(j.slice(j.indexOf("{"), j.lastIndexOf("}") + 1)).undocumented.length;
    assert.ok(measured > 0, "every module has a doc, so a baseline below the measured count cannot be built; lower this test's reach");
    const b = path.join(scratch, "module-docs.json");
    writeJson(b, { undocumented: measured - 1, modules: 0, ids: [] });
    const over = run(script, ["--baseline", b]);
    assert.strictEqual(over.status, 1, `${script} passed one undocumented module over its baseline:\n${over.out.slice(-600)}`);
    assert.match(over.out, /have no contract doc, and the baseline allows/, `${script} failed without naming the count`);
    const refused = run(script, ["--baseline", b, "--update-baseline"]);
    assert.strictEqual(refused.status, 1, `${script} --update-baseline recorded a rise:\n${refused.out.slice(-600)}`);
    assert.strictEqual(readJson(b).undocumented, measured - 1, `${script} --update-baseline wrote the rise it refused`);
    writeJson(b, { undocumented: measured, modules: 0, ids: [] });
    assert.strictEqual(run(script, ["--baseline", b]).status, 0, `${script} failed a tree that sits at its baseline`);
    checked++;
  }

  // ── Brand references ───────────────────────────────────────────────────
  {
    const script = "check-brand-refs.mjs";
    const b = path.join(scratch, "brand-refs.json");
    writeJson(b, {});
    const over = run(script, ["--baseline", b]);
    assert.strictEqual(over.status, 1, `${script} passed with an allowance of zero everywhere:\n${over.out.slice(-600)}`);
    assert.match(over.out, /baseline allows 0/, `${script} failed without naming a file over its allowance`);
    const refused = run(script, ["--baseline", b, "--update-baseline"]);
    assert.strictEqual(refused.status, 1, `${script} --update-baseline raised a file without --force:\n${refused.out.slice(-600)}`);
    assert.match(refused.out, /refusing to raise the brand-refs baseline for \d+ file/);
    assert.deepStrictEqual(readJson(b), {}, `${script} --update-baseline wrote the raise it refused`);
    const forced = run(script, ["--baseline", b, "--update-baseline", "--force"]);
    assert.strictEqual(forced.status, 0, `${script} --force did not write the measured counts:\n${forced.out.slice(-600)}`);
    assert.ok(Object.keys(readJson(b)).length > 0, `${script} --force wrote an empty baseline`);
    assert.strictEqual(run(script, ["--baseline", b]).status, 0, `${script} failed against the counts it just measured`);
    checked++;
  }

  // ── The auth guard, in a fixture tree ──────────────────────────────────
  {
    const script = "check-auth-fetch.mjs";
    const root = path.join(scratch, "auth-tree");
    fs.mkdirSync(path.join(root, "server"), { recursive: true });
    fs.mkdirSync(path.join(root, "client", "src", "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "server", "index.ts"),
      [
        `app.get("/api/fixture/private", async (req, res) => {`,
        `  const user = await authedUser(req);`,
        `  if (!user) return res.status(401).json({ error: "auth_required" });`,
        `  res.json({ ok: true });`,
        `});`,
        "",
      ].join("\n"),
    );
    const page = path.join(root, "client", "src", "pages", "Fixture.tsx");
    const env = { ...process.env, AUTH_FETCH_MIN: "1" };
    fs.writeFileSync(page, `export async function load() {\n  return fetch("/api/fixture/private");\n}\n`);
    const bare = run(script, [], { cwd: root, env });
    assert.strictEqual(bare.status, 1, `${script} passed a tokenless call to a route that refuses strangers:\n${bare.out.slice(-600)}`);
    assert.match(bare.out, /pages[\\/]Fixture\.tsx:2/, `${script} failed without naming the call`);
    fs.writeFileSync(
      page,
      `export async function load(token: string) {\n  return fetch("/api/fixture/private", { headers: { Authorization: \`Bearer \${token}\` } });\n}\n`,
    );
    const carried = run(script, [], { cwd: root, env });
    assert.strictEqual(carried.status, 0, `${script} failed a call that carries its token:\n${carried.out.slice(-600)}`);
    checked++;
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

assert.strictEqual(checked, 4);
console.log(`ok  ratchet gates go red: ${checked} guards fail for the reason they exist, and pass again once it is gone`);
