/**
 * The variables generator's own guard.
 *
 * docs/VARIABLES.md is only worth trusting because a build step regenerates it
 * and compares. That step is worth exactly as much as the reader behind it, so
 * this file tests the reader on the cases that would let it be wrong QUIETLY:
 *
 *   - a dial that is in the registry and NOT in the document. Every static key
 *     in `shared/gameVariables.ts` is read here with a regex that shares no
 *     code with the generator, and every one has to appear. A generator marking
 *     its own homework proves nothing.
 *   - the GENERATED dials. A fifth of the registry is built at module load out
 *     of the village's stage ladder, so a reader of the array literal alone
 *     emits a document that looks complete and is missing 28 dials. That is the
 *     single reason the loader transpiles and imports instead of matching text.
 *   - a shape the reader does not understand: a dial with no description, a
 *     choice with no choices, a type outside the union, a new field on
 *     `VariableDef`, a union member nobody wrote words for, an import the
 *     loader cannot follow. Each must THROW. A skipped dial leaves a document
 *     that renders perfectly and describes a game nobody is playing.
 *   - determinism, because a byte comparison is the whole mechanism and a clock
 *     reading anywhere in the output would make every run a false failure.
 *
 * THE FIXTURE IS PROVED GOOD FIRST. Every negative case below mutates one
 * minimal registry, and the case directly above them generates a document from
 * it unmutated. Without that, a fixture broken for an unrelated reason would
 * make every "it throws" assertion pass for the wrong reason.
 *
 * The fixtures use invented dial names, never a real village's, because this
 * file lives under scripts/ where the brand guard scans.
 *
 * Run: node scripts/generate-variables-doc.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ENTRY, ROOT, generate, rangeOf } from "./generate-variables-doc.mjs";

let run = 0;
const check = async (name, fn) => {
  await fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

const REGISTRY = fs.readFileSync(path.join(ROOT, ...ENTRY.split("/")), "utf8");

/**
 * A key is DATA when it is spliced into a pattern, so every metacharacter is
 * escaped and not just the dot. Escaping one class and trusting the rest is
 * how a reader silently matches the wrong dial instead of failing loudly.
 */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One field of one dial, read straight out of the source with no help from the
 * generator. Anchored on the key and bounded, so a moved field is a loud
 * failure instead of a match on the next dial's value.
 */
function sourceField(key, field) {
  const re = new RegExp(
    `key:\\s*"${reEscape(key)}"[\\s\\S]{0,2500}?\\n\\s*${field}:\\s*"([^"]*)"`,
  );
  const m = re.exec(REGISTRY);
  assert.ok(m, `${ENTRY} no longer declares ${field} for the dial "${key}"; this test's anchor moved`);
  return m[1];
}

// ── A fixture registry, self-contained so a case can break one thing ─────────

const TYPES = ["integer", "decimal", "percentage", "boolean", "choice", "text"];

const DIAL = {
  key: "sample.allowance",
  category: "Sample",
  label: "Allowance each cycle",
  description: "How much each member may hand out before the cycle closes.",
  type: "integer",
  default: "12",
  min: 0,
  max: 99,
  unit: "tokens",
};

function registrySource({ variables = [DIAL], types = TYPES, extraField = "", header = "" } = {}) {
  return `${header}export type VariableType = ${types.map((t) => `"${t}"`).join(" | ")};
export type VariableRing = "open" | "founder";
export type VariableApplyTiming = "instant" | "cycle-close";

export interface VariableDef {
  key: string;
  category: string;
  label: string;
  description: string;
  type: VariableType;
  default: string;
  min?: number;
  max?: number;
  choices?: Array<{ value: string; label: string; hint?: string }>;
  unit?: string;
  ring?: VariableRing;
  applyTiming?: VariableApplyTiming;
${extraField}}

export const VARIABLES: VariableDef[] = ${JSON.stringify(variables, null, 2)};

export const VARIABLES_BY_KEY: Record<string, VariableDef> = Object.fromEntries(
  VARIABLES.map((v) => [v.key, v]),
);

export function ringOf(def: VariableDef): VariableRing {
  return def.ring ?? "open";
}

export function applyTimingOf(def: VariableDef): VariableApplyTiming {
  return def.applyTiming ?? "instant";
}

export function validateVariable(_def: VariableDef, _raw: string): string | null {
  return null;
}
`;
}

/** A throwaway repository root holding one shared/gameVariables.ts. */
async function withRegistry(options, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "variables-doc-test-"));
  try {
    fs.mkdirSync(path.join(dir, "shared"));
    fs.writeFileSync(path.join(dir, "shared", "gameVariables.ts"), registrySource(options), "utf8");
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The generator refuses this registry, with a message naming the problem. */
async function refuses(options, pattern) {
  await withRegistry(options, async (root) => {
    let text = null;
    await assert.rejects(
      async () => {
        text = await generate(root);
      },
      (err) => {
        assert.ok(pattern.test(err.message), `the message must say what is wrong; it said: ${err.message}`);
        return true;
      },
    );
    assert.strictEqual(text, null, "a refusal must emit no document at all, not a shorter one");
  });
}

console.log("\ngenerate-variables-doc: the real registry reaches the document\n");

const DOC = await generate();

await check("a known dial carries the label and the default the source declares", () => {
  const key = "gratitude.pool_per_cycle";
  const label = sourceField(key, "label");
  const value = sourceField(key, "default");
  assert.ok(DOC.includes(`### ${label}\n`), `"${label}" has no section of its own`);
  assert.ok(DOC.includes(`| Key | \`${key}\` |`), `${key} is not written out in full`);
  assert.ok(
    DOC.includes(`| Default | \`${value}\` |`),
    `${key} defaults to ${value} in the source, and the document does not say so`,
  );
});

await check("EVERY dial declared in the source is written out in the document", () => {
  const keys = [...REGISTRY.matchAll(/\n\s*key:\s*"([a-z0-9_.]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 100, `only ${keys.length} keys were read out of the source; the anchor moved`);
  const absent = [...new Set(keys)].filter((k) => !DOC.includes(`| Key | \`${k}\` |`));
  assert.deepStrictEqual(absent, [], "a dial in the registry with no entry in the document");
});

await check("THE GENERATED DIALS ARE THERE, which a text reader would miss", () => {
  const generated = [...DOC.matchAll(/\| Key \| `(progression\.(?:multiplier|quests_for|unlock)\.[^`]+)` \|/g)];
  assert.ok(
    generated.length > 0,
    "no progression dial reached the document, so the registry was read as text and not imported",
  );
  assert.ok(
    !REGISTRY.includes(`key: "${generated[0][1]}"`),
    `${generated[0][1]} is built at module load, so it must not be a literal in the source`,
  );
});

await check("the ring is surfaced for every dial, and both rings appear", () => {
  const sections = DOC.split("\n### ").length - 1;
  const stated = [...DOC.matchAll(/\| Who may change it \| /g)].length;
  assert.strictEqual(stated, sections, "every dial's section must say who may change it");
  assert.ok(DOC.includes("| Who may change it | the whole village |"));
  assert.ok(DOC.includes("| Who may change it | the founder or an admin |"));
});

await check("the document says it is generated and names its generator", () => {
  assert.ok(DOC.startsWith("# Game variables\n"), "the document must open with its own title");
  assert.ok(DOC.includes("This file is generated."));
  assert.ok(DOC.includes("scripts/generate-variables-doc.mjs"));
  assert.ok(DOC.includes("Editing this file by hand does not hold."));
  assert.ok(DOC.endsWith("\n"), "a text file ends with a newline");
});

await check("the same bytes twice", async () => {
  const twice = await generate();
  assert.strictEqual(DOC, twice, "a timestamp or any other clock reading would break the byte comparison");
});

await check("the prose keeps the house writing rules", () => {
  assert.ok(!DOC.includes("—"), "no em-dashes");
  assert.ok(!DOC.includes("–"), "no en-dashes");
});

await check("THE GENERATOR STILL HAS NO SHEBANG", () => {
  // A shebang and CRLF line endings TOGETHER make Vite's transform throw
  // `SyntaxError: Invalid or unexpected token`, and `core.autocrlf` is true on
  // the Windows checkouts here. scripts/generate-token-doc.mjs carries the same
  // line, having found it the hard way on a rebase.
  const src = fs.readFileSync(new URL("./generate-variables-doc.mjs", import.meta.url), "utf8");
  assert.ok(!src.startsWith("#!"), "generate-variables-doc.mjs must not open with a shebang");
});

console.log("\ngenerate-variables-doc: bounds, in whichever form a dial carries them\n");

await check("a range reads correctly with both bounds, one bound, or none", () => {
  assert.strictEqual(rangeOf({ min: 0, max: 10, type: "integer" }), "0 to 10");
  assert.strictEqual(rangeOf({ min: 3, max: null, type: "integer" }), "3 or more");
  assert.strictEqual(rangeOf({ min: null, max: 7, type: "integer" }), "7 or less");
  assert.strictEqual(rangeOf({ min: null, max: null, type: "boolean" }), "on or off");
  assert.strictEqual(rangeOf({ min: null, max: null, type: "text" }), "no bounds are set");
});

console.log("\ngenerate-variables-doc: the fixture registry, and every way of breaking it\n");

await check("THE FIXTURE ITSELF GENERATES, so the refusals below mean something", async () => {
  await withRegistry({}, async (root) => {
    const text = await generate(root);
    assert.ok(text.includes("| Key | `sample.allowance` |"));
    assert.ok(text.includes("| Default | `12` |"));
    assert.ok(text.includes("| Range | 0 to 99 |"));
    assert.ok(text.includes("How much each member may hand out before the cycle closes."));
    assert.ok(text.includes("1 dial."), "the count is read, never assumed");
  });
});

await check("a dial with no description is refused", async () => {
  const { description, ...rest } = DIAL;
  await refuses({ variables: [rest] }, /has no description/);
});

await check("a dial with an empty label is refused", async () => {
  await refuses({ variables: [{ ...DIAL, label: "   " }] }, /empty label/);
});

await check("a choice with no choices is refused", async () => {
  await refuses({ variables: [{ ...DIAL, type: "choice" }] }, /carries no choices/);
});

await check("a type outside VariableType is refused", async () => {
  await refuses({ variables: [{ ...DIAL, type: "duration" }] }, /not a member of VariableType/);
});

await check("a min above its max is refused", async () => {
  await refuses({ variables: [{ ...DIAL, min: 10, max: 1 }] }, /min above its max/);
});

await check("A NEW FIELD ON VariableDef STOPS THE BUILD instead of going unmentioned", async () => {
  await refuses({ extraField: "  proposable?: boolean;\n" }, /VariableDef declares proposable/);
});

await check("a new VariableType member with no plain words is refused", async () => {
  await refuses({ types: [...TYPES, "duration"] }, /VariableType gained "duration"/);
});

await check("a VariableType member that went away takes its gloss with it", async () => {
  await refuses(
    { types: TYPES.filter((t) => t !== "percentage"), variables: [DIAL] },
    /describes the VariableType value "percentage"/,
  );
});

await check("an import the loader cannot follow is refused, never skipped", async () => {
  await refuses({ header: 'import { clamp } from "helpers";\n\n' }, /not a relative path/);
});

await check("an import from outside shared/ is refused", async () => {
  await refuses({ header: 'import { clamp } from "../server/lib/thing";\n\n' }, /sibling modules inside/);
});

await check("a registry that is not there at all is refused by name", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "variables-doc-test-"));
  try {
    await assert.rejects(() => generate(dir), /shared\/gameVariables\.ts is gone/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${run} check(s) passed\n`);
