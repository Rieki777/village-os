/**
 * The fork setup step's own proof.
 *
 * `enable-all-modules.mjs` is the FORK_RUNBOOK's "turn every module on" step,
 * and its posture list is written by hand. Three times a module shipped
 * without a line there, and the step either skipped it while printing success
 * or, once it learned to refuse, exited 3 on main and left a founder with
 * nothing opened (`gene-keys`, 2026-10-31). Nothing ran the script before a
 * founder did, so nothing caught it.
 *
 * This holds the list to the REAL registry, `shared/modules.ts`, transpiled and
 * imported the way `module-facts.mjs` reads it, through the REAL `planRun` a
 * run makes its decisions with. Then it attacks the plan: a module that
 * requires one listed after it, a public module that requires a members-only
 * one, a module that needs outside credentials or setup, a module this server
 * does not offer, and a village where everything ships off.
 *
 * Run: node scripts/enable-all-modules.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { PROBES, TARGETS, planRun } from "./enable-all-modules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let run = 0;
const check = (name, fn) => {
  fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

async function loadRegistry() {
  const src = fs.readFileSync(path.join(ROOT, "shared", "modules.ts"), "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enable-all-modules-"));
  try {
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    fs.writeFileSync(path.join(dir, "modules.mjs"), js, "utf8");
    return (await import(pathToFileURL(path.join(dir, "modules.mjs")).href)).MODULES;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The registry as `GET /api/admin/modules` lists it on a fresh village: every optional module off. */
const listed = (registry) =>
  registry.map((m) => ({
    id: m.id,
    core: !!m.core,
    tier: m.tier,
    setup: m.setup,
    requires: m.requires ?? [],
    lifecycle: m.core ? "public" : "off",
    served: m.core ? "public" : "off",
  }));

const mod = (id, extra = {}) => ({ id, core: false, tier: "included", setup: "none", requires: [], lifecycle: "off", served: "off", ...extra });

const registry = await loadRegistry();
assert.ok(registry.length > 20, `read ${registry.length} module(s) from shared/modules.ts, expected the whole registry`);

check("every module the registry ships is opened, skipped for setup, or a listing: none is unaccounted for", () => {
  const plan = planRun(listed(registry));
  assert.deepStrictEqual(plan.missing, [], `add a posture to TARGETS in scripts/enable-all-modules.mjs for: ${plan.missing.join(", ")}`);
});

check("every TARGETS entry names a module the registry has, once", () => {
  const ids = new Set(registry.map((m) => m.id));
  const stale = TARGETS.map(([id]) => id).filter((id) => !ids.has(id));
  assert.deepStrictEqual(stale, [], `TARGETS names no such module: ${stale.join(", ")}`);
  assert.strictEqual(new Set(TARGETS.map(([id]) => id)).size, TARGETS.length, "a module is named twice in TARGETS");
  for (const [id, t] of TARGETS) assert.ok(["public", "members", "held"].includes(t), `${id}: posture ${t}`);
});

check("on the real registry every module opens after what it requires, at a posture what it requires allows", () => {
  const plan = planRun(listed(registry));
  const at = new Map(plan.steps.map((st, i) => [st.id, i]));
  const byId = new Map(registry.map((m) => [m.id, m]));
  for (const st of plan.steps) {
    assert.deepStrictEqual(st.blockedBy, [], `${st.id} is blocked by ${st.blockedBy.join(", ")}`);
    for (const dep of byId.get(st.id).requires ?? []) {
      if (byId.get(dep)?.core) continue;
      assert.ok(at.get(dep) < at.get(st.id), `${st.id} opens before ${dep}, which it requires`);
    }
  }
  for (const [child, parent] of [["feed", "forum"], ["introductions", "messaging"], ["resources", "map"]]) assert.ok(at.get(child) > at.get(parent), `${child} before ${parent}`);
});

check("a held module is named, reported, and never sent: session-card waits on its security review", () => {
  const plan = planRun(listed(registry));
  assert.deepStrictEqual(plan.held.map((h) => h.id), ["session-card"]);
  assert.ok(plan.held[0].reason.length > 0, "a held module says why");
  assert.ok(!plan.steps.some((s) => s.id === "session-card"), "session-card would be switched on");
  assert.ok(!plan.missing.includes("session-card"), "a held module is accounted for, not missing");
  // With --preview too: held means not sent at all.
  assert.ok(!planRun(listed(registry), TARGETS, { preview: true }).steps.some((s) => s.id === "session-card"));
});

check("ATTACK: a module that requires a held one is blocked, not opened over it", () => {
  const plan = planRun([mod("base"), mod("lens", { requires: ["base"] })], [["base", "held", "review pending"], ["lens", "members"]]);
  assert.deepStrictEqual(plan.held.map((h) => h.id), ["base"]);
  assert.deepStrictEqual(plan.steps.find((s) => s.id === "lens").blockedBy, ["base"]);
});

check("a probe is only written for a module that opens to the public", () => {
  const plan = planRun(listed(registry));
  for (const id of Object.keys(PROBES)) assert.strictEqual(plan.steps.find((s) => s.id === id)?.want, "public", `${id} has a probe`);
});

check("CONTROL: a module added to the registry with no posture is caught by name", () => {
  const plan = planRun([...listed(registry), mod("a-new-module")]);
  assert.deepStrictEqual(plan.missing, ["a-new-module"]);
});

check("ATTACK: a module listed before the module it requires still opens after it", () => {
  const plan = planRun([mod("child", { requires: ["parent"] }), mod("parent")], [["child", "members"], ["parent", "members"]]);
  assert.deepStrictEqual(plan.steps.map((s) => s.id), ["parent", "child"]);
  assert.deepStrictEqual(plan.steps.map((s) => s.blockedBy), [[], []]);
});

check("ATTACK: a public module that requires a members-only one is narrowed to members, and says so", () => {
  const plan = planRun([mod("lens", { requires: ["base"] }), mod("base")], [["lens", "public"], ["base", "members"]]);
  const lens = plan.steps.find((s) => s.id === "lens");
  assert.strictEqual(lens.want, "members");
  assert.strictEqual(lens.narrowedFrom, "public");
});

check("ATTACK: a module that requires one that is off and not in the run is blocked, not sent", () => {
  const plan = planRun([mod("lens", { requires: ["elsewhere"] }), mod("elsewhere", { setup: "required" })], [["lens", "members"]]);
  assert.deepStrictEqual(plan.steps.find((s) => s.id === "lens").blockedBy, ["elsewhere"]);
  // ...unless the village already has it on.
  const on = planRun([mod("lens", { requires: ["elsewhere"] }), mod("elsewhere", { setup: "required", lifecycle: "members", served: "members" })], [["lens", "members"]]);
  assert.deepStrictEqual(on.steps.find((s) => s.id === "lens").blockedBy, []);
});

check("ATTACK: a module needing outside credentials or setup is skipped and never counted as missing", () => {
  const plan = planRun(
    [mod("vendor-thing", { tier: "connected", setup: "required" }), mod("bridge", { setup: "required" }), mod("managed-thing", { tier: "managed" })],
    [],
  );
  assert.deepStrictEqual(plan.missing, []);
  assert.deepStrictEqual(plan.listings.map((m) => m.id), ["vendor-thing", "managed-thing"]);
  assert.deepStrictEqual(plan.needSetup.map((m) => m.id), ["bridge"]);
  assert.deepStrictEqual(plan.steps, []);
  // On the real registry, the credentialed and setup-first modules are exactly the ones skipped.
  const real = planRun(listed(registry));
  for (const m of [...real.listings, ...real.needSetup]) assert.ok(!real.steps.some((s) => s.id === m.id), `${m.id} would be opened`);
});

check("ATTACK: a TARGETS entry this server does not offer is skipped, not sent", () => {
  const plan = planRun([mod("forum")], [["forum", "public"], ["from-a-newer-release", "members"]]);
  assert.deepStrictEqual(plan.absent, ["from-a-newer-release"]);
  assert.deepStrictEqual(plan.steps.map((s) => s.id), ["forum"]);
});

check("ATTACK: on a village where every module ships off, every step is a change, and --preview opens each to preview", () => {
  const plan = planRun(listed(registry));
  assert.ok(plan.steps.every((s) => s.from === "off"));
  const preview = planRun(listed(registry), TARGETS, { preview: true });
  assert.ok(preview.steps.every((s) => s.want === "preview" && s.blockedBy.length === 0));
  assert.strictEqual(plan.steps.length + plan.held.length, TARGETS.length);
});

console.log(`\n${run} check(s) passed`);
