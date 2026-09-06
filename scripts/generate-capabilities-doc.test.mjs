/**
 * The capability generator's own guard.
 *
 * docs/CAPABILITIES.md is only worth trusting because a build step regenerates
 * it and compares. That step is worth exactly as much as the readers behind
 * it, so this file tests those readers on the cases that would let the
 * document be wrong QUIETLY:
 *
 *   - a key in the `Capability` union with no entry in `ALL_CAPABILITIES`, or
 *     the other way round. A document listing twenty of thirty-one keys tells
 *     a founder that eleven powers do not exist, and it renders perfectly
 *     while doing it.
 *   - a key with no label, no deny ruling or no transfer ruling. Same failure,
 *     one column narrower.
 *   - a statement shape inside the gate that the reader does not understand.
 *     It must throw, never skip. The order of that function IS the permission
 *     policy, so a step read in the wrong place is a document that misassigns
 *     power.
 *   - a step the gate returns that `CapabilitySource` never declares, and a
 *     source declared and never returned.
 *   - a module declaring a key the gate has never heard of.
 *   - a rung naming a stage the ladder does not have.
 *   - determinism, because a byte comparison is the whole mechanism and a
 *     clock reading anywhere in the output would make every run a false
 *     failure.
 *
 * The fixtures use invented capability keys, never a real village's language,
 * because this file lives under scripts/ where the brand guard scans.
 *
 * Run: node scripts/generate-capabilities-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, collectFacts, generate, loadShared } from "./generate-capabilities-doc.mjs";

let run = 0;
const check = async (name, fn) => {
  await fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

// ── A throwaway repository root holding a whole small permission model ───────

const CAPABILITIES = `
export type Capability =
  | "garden.tend"
  | "garden.plan"
  | "council.vote";

export const ALL_CAPABILITIES: Capability[] = ["garden.tend", "garden.plan", "council.vote"];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  "garden.tend": "Tend the beds",
  "garden.plan": "Plan next season's beds",
  "council.vote": "Vote in the council",
};

export const STAGE_UNLOCKS: Partial<Record<Capability, string>> = {
  "garden.tend": "member",
};

export const DENIABLE: Record<Capability, boolean> = {
  "garden.tend": true,
  "garden.plan": true,
  "council.vote": false,
};

export const TRANSFERABLE: Record<Capability, boolean> = {
  "garden.tend": true,
  "garden.plan": true,
  "council.vote": false,
};

export function isDeniable(cap: string): boolean {
  return DENIABLE[cap as Capability] === true;
}

export function isVillageHeld(cap: Capability, held: readonly string[] | undefined): boolean {
  if (!held || held.length === 0) return false;
  return TRANSFERABLE[cap] === true && held.includes(cap);
}

export type CapabilitySource =
  | "admin"
  | "admin-override"
  | "denied by warning badge"
  | "role"
  | "badge"
  | "stage"
  | "not granted";

export function capabilityDecision(cap: any, ctx: any): any {
  const villageHolds = isVillageHeld(cap, ctx.villageHeld);
  if (ctx.isAdmin && !villageHolds) {
    return { allowed: true, source: "admin", villageHolds: false, reachedPastVillage: false };
  }
  if (ctx.isAdmin && villageHolds && ctx.adminOverride === true) {
    return { allowed: true, source: "admin-override", villageHolds: true, reachedPastVillage: true };
  }
  const decided = (allowed: boolean, source: string) =>
    ({ allowed, source, villageHolds, reachedPastVillage: false });
  if (isDeniable(cap) && (ctx.badgeDenies ?? []).includes(cap)) {
    return decided(false, "denied by warning badge");
  }
  if (ctx.roleCapabilities.includes(cap)) return decided(true, "role");
  if ((ctx.badgeCapabilities ?? []).includes(cap)) return decided(true, "badge");
  const unlockStage = ctx.stageUnlockOverrides?.[cap] ?? STAGE_UNLOCKS[cap];
  if (unlockStage && unlockStage !== "none") {
    const needed = ctx.stageIndexOf(unlockStage);
    if (needed >= 0 && ctx.stageIndex >= needed) return decided(true, "stage");
  }
  return decided(false, "not granted");
}
`;

const MODULES = `
import type { Capability } from "./capabilities";

export const MODULES: { id: string; name: string; capabilities: Capability[] }[] = [
  { id: "garden", name: "Garden", capabilities: ["garden.tend", "garden.plan"] },
  { id: "council", name: "Council", capabilities: ["council.vote"] },
];
`;

const GAME_CONFIG = `
export const GAME_CONFIG = {
  stages: [
    { id: "visitor", name: "Visitor" },
    { id: "guest", name: "Guest" },
    { id: "member", name: "Member" },
  ],
};
`;

/** A repository root carrying the three files the generator reads. */
async function withShared(overrides, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capabilities-doc-test-"));
  try {
    fs.mkdirSync(path.join(dir, "shared"));
    const files = { "capabilities.ts": CAPABILITIES, "modules.ts": MODULES, "gameConfig.ts": GAME_CONFIG, ...overrides };
    for (const [name, body] of Object.entries(files)) {
      if (body === null) continue;
      fs.writeFileSync(path.join(dir, "shared", name), body, "utf8");
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The generator refuses this input, and says something a person can act on. */
async function refuses(overrides, ...patterns) {
  await withShared(overrides, async (root) => {
    let text = null;
    let message = null;
    try {
      text = await generate(root);
    } catch (err) {
      message = String(err?.message ?? err);
    }
    assert.strictEqual(
      text,
      null,
      "the generator emitted a document from an input it cannot read; a short document is the failure this guard exists to stop",
    );
    for (const pattern of patterns) assert.ok(pattern.test(message), `expected ${pattern} in: ${message}`);
  });
}

console.log("\ngenerate-capabilities-doc: the small model reads end to end\n");

await check("a whole small model generates, with every key and the key count in it", async () => {
  await withShared({}, async (root) => {
    const text = await generate(root);
    assert.ok(text.startsWith("# Capabilities\n"), "the document must open with its own title");
    assert.ok(text.endsWith("\n"), "a text file ends with a newline");
    for (const key of ["garden.tend", "garden.plan", "council.vote"]) {
      assert.ok(text.includes(`\`${key}\``), `${key} is missing from the document`);
    }
    assert.ok(/\b3 keys\b/.test(text), "the document must state how many keys there are");
    assert.ok(text.includes("Tend the beds"), "the label the code carries has to reach the page");
  });
});

await check("the reverse index reports which module declares which key", async () => {
  await withShared({}, async (root) => {
    const text = await generate(root);
    assert.ok(/\| Garden \| `garden` \| `garden.tend`, `garden.plan` \|/.test(text));
  });
});

console.log("\ngenerate-capabilities-doc: an unreadable model stops the build\n");

await check("A KEY IN THE UNION AND NOT IN THE LIST refuses, instead of emitting a shorter document", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`["garden.tend", "garden.plan", "council.vote"]`, `["garden.tend", "garden.plan"]`) },
    /council\.vote/,
    /lockstep/,
  );
});

await check("a key with no label refuses, and names the key", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`  "council.vote": "Vote in the council",\n`, "") },
    /CAPABILITY_LABELS/,
    /council\.vote/,
  );
});

await check("a key with no line in DENIABLE refuses", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`export const DENIABLE: Record<Capability, boolean> = {\n  "garden.tend": true,`, "export const DENIABLE: Record<Capability, boolean> = {") },
    /DENIABLE/,
    /garden\.tend/,
  );
});

await check("a key with no line in TRANSFERABLE refuses", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`export const TRANSFERABLE: Record<Capability, boolean> = {\n  "garden.tend": true,`, "export const TRANSFERABLE: Record<Capability, boolean> = {") },
    /TRANSFERABLE/,
    /garden\.tend/,
  );
});

await check("A STATEMENT SHAPE INSIDE THE GATE THAT THE READER CANNOT FOLLOW refuses", async () => {
  await refuses(
    {
      "capabilities.ts": CAPABILITIES.replace(
        "  if (ctx.roleCapabilities.includes(cap)) return decided(true, \"role\");",
        "  for (const r of ctx.roleCapabilities) { if (r === cap) return decided(true, \"role\"); }",
      ),
    },
    /capabilityDecision\(\) in shared\/capabilities\.ts holds a statement this reader does not understand/,
  );
});

await check("an else branch in the gate refuses, because the reader would report it as unreachable", async () => {
  await refuses(
    {
      "capabilities.ts": CAPABILITIES.replace(
        "  if (ctx.roleCapabilities.includes(cap)) return decided(true, \"role\");",
        "  if (ctx.roleCapabilities.includes(cap)) { return decided(true, \"role\"); } else { return decided(false, \"role\"); }",
      ),
    },
    /else branch/,
  );
});

await check("a step reporting a source the CapabilitySource union does not declare refuses", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`decided(true, "badge")`, `decided(true, "honour")`) },
    /CapabilitySource/,
    /honour/,
  );
});

await check("a source the union declares and the gate never returns refuses", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`  | "badge"\n`, `  | "badge"\n  | "the elders"\n`) },
    /the elders/,
    /never returns/,
  );
});

await check("a module declaring a key the gate never heard of refuses", async () => {
  await refuses(
    { "modules.ts": MODULES.replace(`"council.vote"]`, `"council.vote", "council.dissolve"]`) },
    /council\.dissolve/,
    /ALL_CAPABILITIES does not list/,
  );
});

await check("a rung naming a stage the ladder does not have refuses", async () => {
  await refuses(
    { "capabilities.ts": CAPABILITIES.replace(`"garden.tend": "member",`, `"garden.tend": "elder",`) },
    /STAGE_UNLOCKS/,
    /elder/,
  );
});

await check("a source file that is gone refuses, and names the path it wanted", async () => {
  await refuses({ "gameConfig.ts": null }, /shared\/gameConfig\.ts is gone/);
});

console.log("\ngenerate-capabilities-doc: the real repository\n");

await check("the real model generates, and generates the same bytes twice", async () => {
  const once = await generate();
  const twice = await generate();
  assert.strictEqual(once, twice, "a timestamp or any other clock reading would break the byte comparison");
});

await check("EVERY capability key the code holds appears in the document, and so does the count", async () => {
  // The count is read through a second, independent path: the generator's own
  // transpile-and-import of the real file. A document listing twenty of
  // thirty-one keys is the failure this whole file exists to stop, and it is
  // invisible to any assertion that trusts the document's own arithmetic.
  const caps = await loadShared(ROOT, "capabilities");
  const text = await generate();
  for (const key of caps.ALL_CAPABILITIES) {
    assert.ok(text.includes(`| \`${key}\` |`), `${key} has no row of its own in docs/CAPABILITIES.md`);
    assert.ok(text.includes(caps.CAPABILITY_LABELS[key]), `${key}'s label is missing from the document`);
  }
  assert.ok(
    text.includes(`${caps.ALL_CAPABILITIES.length} keys`),
    `the document must state the real key count, which is ${caps.ALL_CAPABILITIES.length}`,
  );
});

await check("THE RESOLUTION ORDER IS EMITTED IN THE ORDER THE GATE IMPLEMENTS IT", async () => {
  const facts = await collectFacts();
  const text = await generate();
  const sources = facts.steps.map((s) => s.source);

  // The numbered table, row by row, in the gate's order.
  sources.forEach((source, i) => {
    assert.ok(
      text.includes(`| ${i + 1} | \`${source}\` |`),
      `step ${i + 1} of the gate is \`${source}\` and the document does not say so`,
    );
  });

  // And the one-line statement of the order, which is what a reader in a hurry
  // takes away.
  assert.ok(
    text.includes(`In one line: ${sources.map((s) => `\`${s}\``).join(" then ")}.`),
    "the document must state the order in one line, in the gate's own order",
  );

  const at = (source) => text.indexOf(`**${sources.indexOf(source) + 1}. \`${source}\`.**`);
  const deny = sources.find((s) => /denied/i.test(s));
  assert.ok(deny, "the gate no longer has a deny step; this assertion needs rewriting with it");
  for (const later of ["role", "badge", "stage"]) {
    if (!sources.includes(later)) continue;
    assert.ok(
      sources.indexOf(deny) < sources.indexOf(later),
      `a warning badge's deny must beat ${later}, and the gate now puts it after`,
    );
    assert.ok(at(deny) < at(later), `the document prints ${later} before the deny that beats it`);
  }
  assert.strictEqual(sources[0], "admin", "the admin short-circuit is the first thing the gate reads");
  assert.strictEqual(sources[sources.length - 1], "not granted", "the gate's fall-through is a refusal");
});

await check("the worked decisions are answers the gate gave, not claims about it", async () => {
  const facts = await collectFacts();
  const text = await generate();
  assert.ok(facts.decisions.length >= 5, "too few worked decisions to demonstrate the order");
  for (const d of facts.decisions) {
    assert.ok(facts.sources.includes(d.source), `${d.source} is not a step the gate can report`);
    assert.ok(text.includes(d.who), `the worked decision "${d.who}" is missing from the document`);
  }
  const denied = facts.decisions.find((d) => /denied/i.test(d.source));
  assert.ok(denied && denied.allowed === false, "no worked decision demonstrates a warning badge's deny");
});

await check("the prose keeps the house writing rules", async () => {
  const text = await generate();
  assert.ok(!text.includes("—"), "no em-dashes");
  assert.ok(!text.includes("–"), "no en-dashes");
  assert.ok(!/\bnot (?:just|only) [a-z]+,? but\b/i.test(text), "no not-X-but-Y framing");
});

console.log(`\n${run} check(s) passed\n`);
