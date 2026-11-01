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

/*
 * THE OTHER TWO FILES THE PROMPT SENDS THE ASSISTANT TO, AND THE HOSTED PATH
 * (readiness R191 and R202). The prompt says AGENTS.md and START_HERE.md win
 * when they disagree with it, so a stall in either is a stall in the prompt:
 * a clone without `--branch` takes unreleased `main`, and `docker compose
 * logs -f` never returns to an assistant waiting on it. And the three
 * hosted-path documents gave two different answers for DATABASE_URL and no
 * step at all for the address `/claim` is opened at.
 */
const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const SENT_TO = { "AGENTS.md": read("AGENTS.md"), "START_HERE.md": read("START_HERE.md"), "the prompt": prompt };

check("no file the assistant follows clones without a release or waits on logs -f", () => {
  for (const [name, text] of Object.entries(SENT_TO)) {
    for (const line of text.split(/\r?\n/)) {
      if (/git clone\b/.test(line)) assert.match(line, /--branch\s+\S+/, `${name}: an unpinned clone takes unreleased main: ${line.trim()}`);
    }
    assert.doesNotMatch(text, /logs\s+-f\b/, `${name}: \`logs -f\` never returns to an assistant waiting on it`);
  }
});

check("the hosted path names one DATABASE_URL, a reference, and an address before /claim", () => {
  const hosted = { "START_HERE.md": SENT_TO["START_HERE.md"], "docs/PROVISIONING.md": read("docs/PROVISIONING.md"), "the prompt": prompt };
  for (const [name, text] of Object.entries(hosted)) {
    assert.match(text, /\$\{\{MySQL\.MYSQL_URL\}\}/, `${name}: DATABASE_URL is the reference to the MySQL service's MYSQL_URL`);
    assert.match(text, /Generate Domain/, `${name}: no step gives the service an address to open /claim at`);
  }
  assert.doesNotMatch(read("docs/PROVISIONING.md"), /filled in for you\s+automatically/, "the old wording said DATABASE_URL fills itself in");
});

console.log(`setup-prompt contract: ${passed} passed`);
