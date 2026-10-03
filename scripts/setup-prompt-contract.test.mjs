/**
 * The setup prompt's contract with the regencivics.earth card.
 *
 * The "Run it yourself" card on regencivics.earth/village-os has a "Copy the
 * setup guide" button. It reads docs/FOUNDER_SETUP_PROMPT.md at a pinned commit
 * and copies only the text BELOW the single line that is just `---`: above it
 * are notes for the person, below it is the prompt their AI assistant runs.
 * A file with no such line copies nothing, and a file with two copies the wrong
 * half. Nothing in this repository would notice either, because the reader is
 * in another repository (the hub's shared/villageOsOffer.ts).
 *
 * The prompt also has to send the assistant to ONE release for everything it
 * fetches, because the card pins the prompt's words to a release while the
 * prompt itself is read later, after newer releases exist (docs/RELEASING.md,
 * step 8).
 *
 * Run: node scripts/setup-prompt-contract.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const FILE = fileURLToPath(new URL("../docs/FOUNDER_SETUP_PROMPT.md", import.meta.url));
const lines = fs.readFileSync(FILE, "utf8").split(/\r?\n/);
const separators = lines.map((l, i) => (l.trim() === "---" ? i : -1)).filter((i) => i >= 0);
let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

check("exactly one line is only ---", () => {
  assert.strictEqual(separators.length, 1, `found ${separators.length} separator line(s) at ${separators.map((i) => i + 1).join(", ")}`);
});

const prompt = lines.slice(separators[0] + 1).join("\n");

check("the copied half is the prompt, and it is not empty", () => {
  assert.ok(prompt.trim().length > 1000, `only ${prompt.trim().length} characters below the separator`);
  assert.match(prompt, /The one rule/);
});

check("the copied half fetches everything at one release", () => {
  assert.match(prompt, /releases\/latest/);
  assert.match(prompt, /raw\.githubusercontent\.com\/Rieki777\/village-os\/VERSION\/AGENTS\.md/);
  assert.match(prompt, /raw\.githubusercontent\.com\/Rieki777\/village-os\/VERSION\/START_HERE\.md/);
  assert.match(prompt, /git clone --branch VERSION/);
  assert.doesNotMatch(prompt, /village-os\/main\//, "a link to main mixes releases");
  assert.doesNotMatch(prompt, /village-os:\d+\.\d+\.\d+/, "a pinned image tag mixes releases");
});

console.log(`setup-prompt contract: ${passed} passed`);
