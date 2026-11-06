/**
 * The village-fact guard's own guard.
 *
 * Two things are being proved, and the second matters more than the first.
 *
 * IT REFUSES. A new price, a new token name in display text, a grown count, a
 * file nobody listed, and a listed count that has been cleaned and not
 * delisted all fail, and the failure names the file and the line. Every one of
 * those runs the REAL script as a child process against a fixture tree and
 * reads the exit code.
 *
 * IT DOES NOT CRY WOLF. Every refusal is paired with a positive control that
 * has to come back clean, because a guard that flagged everything would pass
 * the refusal half of this file perfectly. The allow cases are the ones the
 * brief named as most likely to make a guard wrong: a route path, a component
 * name, a comment, a database column, a source tag, a test fixture, and a
 * ProjectHistory entry recording the token-naming decision itself.
 *
 * WHY THE FIXTURES RUN THE REAL SCRIPT. check-identity-keys.test.mjs copies
 * the guard into each fixture tree, which works because that guard imports
 * nothing. This one imports typescript, and a copy in os.tmpdir() cannot
 * resolve it. So the script takes `--root` and `--pending` and is driven in
 * place. That is better anyway: a copy is a second implementation, and the
 * thing worth proving is that the file CI runs refuses.
 *
 * The fixture villages and people are invented. A test that had to name a real
 * village or a real person to work would be the same mistake it is testing
 * for.
 *
 * Run: node scripts/check-village-facts.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EXCLUDED,
  MACHINERY_KEYS,
  DISPLAY_KEYS,
  NOT_A_PERSON,
  PENDING_CEILING,
  RULES,
  auditPending,
  countsOf,
  isExcluded,
  isProse,
  isWaived,
  moneyHit,
  scanSource,
  totalOf,
} from "./check-village-facts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, "check-village-facts.mjs");
const REPO = path.resolve(HERE, "..");
const REAL_PENDING = path.join(HERE, "village-facts-pending.json");

let run = 0;
const check = (name, fn) => {
  fn();
  run += 1;
  console.log(`  PASS  ${name}`);
};

console.log("\ncheck-village-facts: no new village facts in copy, and a list that only shrinks\n");

// ── The reader ──────────────────────────────────────────────────────────────
//
// These come first for the reason check-identity-keys.test.mjs gives about its
// own parser: a reader that quietly stopped finding copy would pass every
// refusal case below by finding nothing to object to.

const scan = (src, file = "client/src/pages/Fixture.tsx") => scanSource(file, src).hits;
const rulesIn = (src, file) => [...new Set(scan(src, file).map((h) => h.rule))].sort();

check("finds a price in JSX text", () => {
  const hits = scan(`export const A = () => <p>Homes from $80,000</p>;`);
  assert.deepStrictEqual(hits.map((h) => [h.rule, h.hit]), [["money", "$80,000"]]);
  assert.strictEqual(hits[0].line, 1);
});

check("finds a price in a display prop and in an array element", () => {
  assert.deepStrictEqual(rulesIn(`const a = { description: "a deposit from $5k to $20k+" };`), ["money"]);
  assert.deepStrictEqual(rulesIn(`const a = { details: ["Refundable", "$5k-$20k+ per home"] };`), ["money"]);
});

check("finds a currency code as well as a symbol", () => {
  assert.deepStrictEqual(rulesIn(`const a = { label: "Dues are 45,000 CRC a month" };`), ["money"]);
});

check("finds a template literal that OPENS on a bare currency symbol", () => {
  // The five money formatters in this client are exactly this shape, and the
  // head's text is one character, so the prose test cannot see it. The rule
  // runs on every span for that reason.
  const hits = scan("const usd = (m: number) => `$${(m / 100).toFixed(2)}`;", "client/src/lib/f.ts");
  assert.deepStrictEqual(hits.map((h) => h.rule), ["money"]);
  assert.match(hits[0].hit, /^\$\$\{/);
});

check("finds an area unit asserted in a label", () => {
  assert.deepStrictEqual(rulesIn(`const s = [{ key: "acres", label: "Total Acres" }];`), ["unit"]);
  assert.deepStrictEqual(rulesIn(`const a = () => <span>1,200 sq ft of living space</span>;`), ["unit"]);
  assert.deepStrictEqual(rulesIn(`const a = { title: "Six hectares under restoration" };`), ["unit"]);
});

check("finds the token name in JSX text, in a label and inside a sentence", () => {
  assert.deepStrictEqual(rulesIn(`const a = () => <h2>Gratitude</h2>;`), ["token-name"]);
  assert.deepStrictEqual(rulesIn(`const a = { label: "Gratitude" };`), ["token-name"]);
  assert.deepStrictEqual(rulesIn(`const a = { body: "You can still give gratitude this moon." };`), ["token-name"]);
});

check("finds the value token name and the member noun", () => {
  assert.deepStrictEqual(rulesIn(`const a = { body: "paid out in Village Credits each cycle" };`), ["value-token-name"]);
  assert.deepStrictEqual(rulesIn(`const a = () => <p>Every village member gets a vote.</p>;`), ["member-name"]);
});

check("finds a person promised in copy", () => {
  const hits = scan(`const f = () => setOk("Thank you! Marlow will be in touch within 48 hours.");`);
  assert.deepStrictEqual(hits.map((h) => h.rule), ["person-name"]);
  assert.match(hits[0].hit, /Marlow will be in touch/);
  assert.deepStrictEqual(rulesIn(`const a = { body: "Any questions, email Marlow." };`), ["person-name"]);
  assert.deepStrictEqual(rulesIn(`const a = { body: "Marlow is our steward for this season." };`), ["person-name"]);
});

check("reports the line the copy is on, not the line the file starts on", () => {
  const hits = scan(["const a = 1;", "const b = 2;", `const c = () => <p>from $80,000</p>;`].join("\n"));
  assert.deepStrictEqual(hits.map((h) => h.line), [3]);
});

check("survives CRLF, which has silently blinded a guard in this repo before", () => {
  // check-brand-refs gave a different answer per machine over exactly this,
  // and its own test records the incident. The AST is CRLF-safe on its own;
  // the WAIVER lookup reads raw lines, and a trailing \r there would make a
  // marker at end of line match on Linux and not on Windows.
  const src = [`const a = { label: "Total Acres" }; // village-ok: fixture`, `const b = () => <p>from $80,000</p>;`].join("\n");
  const lf = scanSource("client/src/pages/F.tsx", src);
  const crlf = scanSource("client/src/pages/F.tsx", src.replace(/\n/g, "\r\n"));
  assert.deepStrictEqual(crlf.hits, lf.hits, "a Windows checkout must read the same as a Linux one");
  assert.strictEqual(crlf.waived, 1, "and the waiver must still be found with a carriage return on the line");
  assert.strictEqual(crlf.hits.length, 1);
});

// ── The allow rules, which are the ones that decide whether this survives ───

check("ALLOWS a route path and an href, because renaming a route breaks links", () => {
  assert.deepStrictEqual(rulesIn(`const nav = [{ href: "/gratitude", to: "/gratitude/new" }];`), []);
  assert.deepStrictEqual(rulesIn("const u = (id: string) => `/gratitude/${id}`;", "client/src/lib/r.ts"), []);
  assert.deepStrictEqual(rulesIn(`const a = () => <a href="/gratitude">Open</a>;`), []);
  // Control: the same file's LABEL is not exempt, which is the whole point.
  assert.deepStrictEqual(rulesIn(`const nav = [{ href: "/gratitude", label: "Gratitude" }];`), ["token-name"]);
});

check("ALLOWS component, hook and function names", () => {
  const src = [
    `import { GratitudeWall } from "@/pages/GratitudeWall";`,
    `export function useGratitudeBloom() { return GratitudeWall; }`,
    `const AcresTile = () => null;`,
    `export const usdFormatter = null;`,
  ].join("\n");
  assert.deepStrictEqual(rulesIn(src, "client/src/lib/x.ts"), []);
});

check("ALLOWS database columns, API fields, source tags and token slugs", () => {
  const src = [
    `const q = { source: "gratitude", tokenSlug: "gratitude", column: "gratitude_balance" };`,
    `const r = await post({ field: "acres", metric: "hectares_restored" });`,
    `const t = credit("gratitude", 5);`,
    `const k = row["acres"];`,
  ].join("\n");
  assert.deepStrictEqual(rulesIn(src, "client/src/lib/api.ts"), []);
});

check("ALLOWS comments and docblocks", () => {
  const src = [
    `/**`,
    ` * Gratitude is held, never spent. Homes cost $80,000 and sit on 6 acres.`,
    ` * Marlow will be in touch about the Village Credits pool.`,
    ` */`,
    `// Total Acres was the old label; village members read it as hectares.`,
    `export const N = 1;`,
  ].join("\n");
  assert.deepStrictEqual(rulesIn(src, "client/src/lib/c.ts"), []);
});

check("ALLOWS a historical record: ProjectHistory keeps the naming decision", () => {
  // The subtlest exclusion in the guard and the one most likely to make it
  // wrong. This file holds the record of the token-naming decision, the
  // options that were considered included. Substituting the current name
  // there would corrupt a document.
  assert.ok(EXCLUDED.includes("client/src/pages/ProjectHistory.tsx"));
  assert.ok(isExcluded("client/src/pages/ProjectHistory.tsx"));
  // Control: the same content in any other page IS flagged, so the pass above
  // is the exclusion working rather than the rule failing to fire.
  const src = `const d = { note: "The village chose Gratitude over Seeds and Roots." };`;
  assert.deepStrictEqual(rulesIn(src, "client/src/pages/Anywhere.tsx"), ["token-name"]);
});

check("ALLOWS test files and fixtures", () => {
  for (const r of [
    "client/src/pages/MasterPlan.test.tsx",
    "client/src/lib/housingForm.test.ts",
    "client/src/__tests__/thing.tsx",
    "client/src/fixtures/prices.ts",
  ]) {
    assert.ok(isExcluded(r), `${r} must be excluded`);
  }
  assert.ok(!isExcluded("client/src/pages/MasterPlan.tsx"), "and the page itself must not be");
});

check("ALLOWS a currency symbol read from config with a literal fallback", () => {
  // The platform's own established pattern, and the same shape
  // check-theme-literals accepts for `var(--tone-brand, #157f7d)`: the literal
  // is what a village that has set nothing yet sees, not a value config can
  // never reach.
  assert.deepStrictEqual(rulesIn(`const a = () => <span>{dues.currency || "$"}{dues.amount}</span>;`), []);
  assert.deepStrictEqual(rulesIn(`const b = { value: cfg.symbol ?? "$" };`), []);
});

check("ALLOWS a regular-expression backreference, which is not a price", () => {
  // client/src/pages/Admin.tsx line 985 is exactly this. A guard that flagged
  // it would be wrong in the most annoying possible place.
  assert.deepStrictEqual(rulesIn(`const t = (k: string) => k.replace(/([A-Z])/g, " $1").trim();`, "client/src/lib/t.ts"), []);
  assert.strictEqual(moneyHit(" $1"), null);
  // Control: two digits is a price, and one digit before a slash is a rate.
  assert.strictEqual(moneyHit("costs $33 a month"), "$33");
  assert.strictEqual(moneyHit("$5/month"), "$5");
});

check("ALLOWS a shell variable in generated code, which opens on no symbol", () => {
  // client/src/components/YourAgentPanel.tsx builds a curl example three
  // times. Those spans are template MIDDLES, so the money-formatter rule
  // never reaches them.
  const src = "const c = (v: string) => `  -H \"Authorization: Bearer $${v}\"`;";
  assert.deepStrictEqual(rulesIn(src, "client/src/components/A.tsx"), []);
});

check("ALLOWS an import specifier", () => {
  assert.deepStrictEqual(rulesIn(`import { x } from "@/pages/gratitude/wall";`, "client/src/lib/i.ts"), []);
});

check("a waiver takes the hit, on the line or in the comment above it", () => {
  const sameLine = `const a = { label: "Total Acres" }; // village-ok: fixture reason`;
  assert.deepStrictEqual(scan(sameLine), []);
  assert.strictEqual(scanSource("client/src/pages/F.tsx", sameLine).waived, 1);

  const above = [
    `const a = {`,
    `  // village-ok: fixture reason, written down rather than just marked`,
    `  label: "Total Acres",`,
    `};`,
  ].join("\n");
  assert.deepStrictEqual(scan(above), []);

  // A blank line breaks the arming, so a marker cannot drift onto an unrelated
  // hit further down the file.
  const drifted = [`// village-ok: about something else entirely`, ``, `const a = { label: "Total Acres" };`].join("\n");
  assert.deepStrictEqual(scan(drifted).map((h) => h.rule), ["unit"]);
});

check("isProse keeps sentences and drops bare identifiers", () => {
  assert.strictEqual(isProse({ kind: "jsx", text: "Gratitude", key: null }), true);
  assert.strictEqual(isProse({ kind: "string", text: "gratitude", key: "source" }), false);
  assert.strictEqual(isProse({ kind: "string", text: "Gratitude", key: "label" }), true);
  assert.strictEqual(isProse({ kind: "string", text: "Send gratitude", key: null }), true);
  assert.strictEqual(isProse({ kind: "string", text: "gratitude_balance", key: null }), false);
});

check("the machinery and display key lists do not contradict each other", () => {
  // `value` and `name` are on both kinds of list in this codebase's history,
  // and copySpans resolves the overlap by letting DISPLAY_KEYS win. That has
  // to be a deliberate short list rather than an accident, so it is asserted.
  const both = [...MACHINERY_KEYS].filter((k) => DISPLAY_KEYS.has(k)).sort();
  assert.deepStrictEqual(both, [], "a key on both lists is ambiguous; pick one");
});

check("the person rule is carried by its patterns, not by the stoplist", () => {
  // Measured over the whole client at b6af325: the patterns matched once, on
  // the Jess line, and the stoplist stopped nothing. If it ever starts
  // carrying real load the patterns are wrong. This pins the shape rather than
  // the list, so it does not have to be edited when a word is added.
  assert.ok(NOT_A_PERSON.has("The"));
  assert.deepStrictEqual(rulesIn(`const a = { body: "The steward will be in touch shortly." };`), []);
  assert.deepStrictEqual(rulesIn(`const a = { body: "Please contact Support if it stalls." };`), []);
  // Control: a real given name in the same sentence shape is caught.
  assert.deepStrictEqual(rulesIn(`const a = { body: "Marlow will be in touch shortly." };`), ["person-name"]);
});

// ── The ratchet arithmetic, as a pure function ──────────────────────────────

const KEY = "client/src/pages/Fixture.tsx::money";
const listOf = (counts, total) => ({ total: total ?? totalOf(counts), counts });

check("POSITIVE CONTROL: counts matching the list exactly are accepted", () => {
  const r = auditPending({ [KEY]: 3 }, listOf({ [KEY]: 3 }), 3);
  assert.deepStrictEqual(r.grown, []);
  assert.deepStrictEqual(r.unexpected, []);
  assert.deepStrictEqual(r.stale, []);
  assert.strictEqual(r.ceiling, null);
  assert.strictEqual(r.declared, null);
});

check("REFUSES a count that grew", () => {
  const r = auditPending({ [KEY]: 4 }, listOf({ [KEY]: 3 }), 3);
  assert.deepStrictEqual(r.grown, [{ key: KEY, found: 4, allowed: 3 }]);
});

check("REFUSES a file and rule nobody listed", () => {
  const r = auditPending({ [KEY]: 1 }, listOf({}), 0);
  assert.deepStrictEqual(r.unexpected, [{ key: KEY, found: 1 }]);
});

check("REFUSES a listed entry that has been cleaned and left on the list", () => {
  const r = auditPending({}, listOf({ [KEY]: 3 }), 3);
  assert.deepStrictEqual(r.stale, [{ key: KEY, found: 0, listed: 3 }]);
});

check("REFUSES a partial fix that the list does not record", () => {
  const r = auditPending({ [KEY]: 1 }, listOf({ [KEY]: 3 }), 3);
  assert.deepStrictEqual(r.stale, [{ key: KEY, found: 1, listed: 3 }]);
});

check("ACCEPTS the shrink when the list and the ceiling come down with it", () => {
  const r = auditPending({ [KEY]: 1 }, listOf({ [KEY]: 1 }), 1);
  assert.deepStrictEqual(r.stale, []);
  assert.strictEqual(r.ceiling, null);
});

check("REFUSES a list whose ceiling did not follow it down", () => {
  const r = auditPending({ [KEY]: 1 }, listOf({ [KEY]: 1 }), 3);
  assert.deepStrictEqual(r.ceiling, { listed: 1, ceiling: 3 });
});

check("REFUSES a list whose own declared total disagrees with its counts", () => {
  const r = auditPending({ [KEY]: 1 }, listOf({ [KEY]: 1 }, 9), 1);
  assert.deepStrictEqual(r.declared, { listed: 1, declared: 9 });
});

check("the ceiling rule stands down for a list it is not tracking", () => {
  assert.strictEqual(auditPending({}, listOf({}), null).ceiling, null);
});

check("the shipped list and the shipped ceiling agree", () => {
  const real = JSON.parse(fs.readFileSync(REAL_PENDING, "utf8"));
  assert.strictEqual(totalOf(real.counts), PENDING_CEILING, "PENDING_CEILING must equal the list's total");
  assert.strictEqual(real.total, PENDING_CEILING, "and the list's own header must say the same number");
  for (const [key, entry] of Object.entries(real.entries ?? {})) {
    assert.ok(key in real.counts, `${key} has an entry and no count`);
    assert.match(entry.since ?? "", /^\d{4}-\d{2}-\d{2}$/, `${key} must carry the date it was recorded`);
  }
  for (const key of Object.keys(real.counts)) {
    const [, ruleId] = key.split("::");
    assert.ok(RULES.some((r) => r.id === ruleId), `${key} names a rule that no longer exists`);
  }
});

check("the guard carries no shebang, which would break a Vitest import", () => {
  // check-identity-keys.mjs records the incident: a shebang and CRLF line
  // endings together make Vite's transform throw `SyntaxError: Invalid or
  // unexpected token`, either alone is fine, and that is how it passed on an
  // LF working copy and failed the moment a checkout rewrote the file with
  // CRLF. Named here so the next person to add `#!` gets this sentence.
  const source = fs.readFileSync(GUARD, "utf8");
  assert.ok(!source.startsWith("#!"), "check-village-facts.mjs must not open with a shebang");
  // Control: the assertion is looking at the right file, and would see one.
  assert.ok(source.includes("PENDING_CEILING"), "the file being read is the guard");
});

check("every rule carries the sentence a failing author needs", () => {
  for (const r of RULES) {
    assert.ok(r.what && r.what.length > 10, `${r.id} needs a description`);
    assert.ok(r.fix && r.fix.length > 20, `${r.id} needs a fix instruction`);
    assert.ok(r.match || r.matchAny, `${r.id} matches nothing`);
  }
  assert.ok(RULES.length >= 6, "six rules shipped; a rule quietly deleted checks fewer things than yesterday");
});

// ── The gate, against a real tree, reading the exit code ────────────────────

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), "village-facts-"));

/**
 * Build a fixture village and run the REAL guard over it.
 *
 * spawnSync, not execFileSync: execFileSync throws away stderr on a successful
 * run, which is how check-identity-keys.test.mjs's --fork case once passed for
 * the wrong reason. Both streams, both outcomes, every time.
 */
function runGate(label, files, pending = { total: 0, counts: {}, entries: {} }, args = [], env = {}) {
  const root = path.join(FIXTURES, label);
  for (const [name, body] of Object.entries(files)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const pendingPath = path.join(root, "pending.json");
  if (pending !== null) fs.writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`);
  const r = spawnSync(
    process.execPath,
    [GUARD, "--root", path.join(root, "client", "src"), "--pending", pendingPath, ...args],
    { encoding: "utf8", cwd: REPO, env: { ...process.env, ...env } },
  );
  return {
    code: r.status,
    out: `${r.stdout || ""}${r.stderr || ""}`,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

/**
 * Swap the page's copy slot for something else, and say which line it lands
 * on.
 *
 * The line number is computed rather than written down. It was written down
 * first and it was wrong by one, which is the kind of assertion that gets
 * "corrected" to whatever the guard printed. Computing it means the test
 * asserts the guard found the right line rather than asserting whatever the
 * guard said.
 */
const SLOT = "<p>Ask the village what a home costs.</p>";
const inject = (copy) => ({
  page: CLEAN_PAGE.replace(SLOT, copy),
  line: CLEAN_PAGE.split("\n").findIndex((l) => l.includes(SLOT)) + 1,
});

const CLEAN_PAGE = `import { useTokenName } from "@/hooks/useTokenNames";

export function Reserve() {
  const token = useTokenName();
  // A comment may say Gratitude and $80,000 and 6 acres freely.
  return (
    <div>
      <a href="/gratitude">{token}</a>
      <p>Ask the village what a home costs.</p>
    </div>
  );
}
`;

check("FIXTURE TREE, positive control: a clean page exits 0", () => {
  const { code, out } = runGate("clean", { "client/src/pages/Reserve.tsx": CLEAN_PAGE });
  assert.strictEqual(code, 0, out);
  assert.match(out, /village-fact guard passed/);
});

check("FIXTURE TREE: a NEW price exits 1 and names the file and the line", () => {
  const { page, line } = inject("<p>Homes from $80,000, reserve now</p>");
  const { code, out } = runGate("new-price", { "client/src/pages/Reserve.tsx": page });
  assert.strictEqual(code, 1);
  assert.match(out, new RegExp(`client/src/pages/Reserve\\.tsx:${line}\\b`), "the file and the line must be named");
  assert.match(out, /\$80,000/, "and the amount that was found");
  assert.match(out, /"money"/);
  assert.match(out, /village's own settings/, "and what to do instead");
});

check("FIXTURE TREE: a NEW token name in display text exits 1", () => {
  const { page, line } = inject("<p>Gratitude is held, never spent.</p>");
  const { code, out } = runGate("new-token", { "client/src/pages/Reserve.tsx": page });
  assert.strictEqual(code, 1);
  assert.match(out, new RegExp(`client/src/pages/Reserve\\.tsx:${line}\\b`));
  assert.match(out, /"token-name"/);
  assert.match(out, /useTokenName/, "the fix names the accessor");
});

check("FIXTURE TREE: a NEW area unit and a NEW person both exit 1", () => {
  const { page } = inject(`<p>Six acres of it</p><p>{ok ? "Marlow will be in touch" : ""}</p>`);
  const { code, out } = runGate("new-unit-person", { "client/src/pages/Reserve.tsx": page });
  assert.strictEqual(code, 1);
  assert.match(out, /"unit"/);
  assert.match(out, /"person-name"/);
});

check("FIXTURE TREE: the allow cases together exit 0", () => {
  // One tree carrying every shape the brief said a guard must not flag, so a
  // rule that starts over-matching fails here rather than in somebody's PR.
  const files = {
    "client/src/pages/Reserve.tsx": CLEAN_PAGE,
    "client/src/config/nav.ts": `export const NAV = [{ href: "/gratitude", path: "/gratitude/new", icon: "gratitude" }];\n`,
    "client/src/lib/ledger.ts": `export const credit = () => post({ source: "gratitude", tokenSlug: "gratitude", column: "acres" });\n`,
    "client/src/components/GratitudeWall.tsx": `export function GratitudeWall() { return useGratitudeBloom(); }\n`,
    "client/src/lib/doc.ts": `/**\n * Gratitude, $80,000, 6 acres, Village Credits, village members, Marlow will call.\n */\nexport const N = 1;\n`,
    "client/src/pages/ProjectHistory.tsx": `export const H = { suggestedOptions: ["Gratitude", "Seeds", "Roots"], note: "The village picked Gratitude in 2025." };\n`,
    "client/src/pages/Reserve.test.tsx": `it("shows $80,000 and 6 acres of Gratitude", () => {});\n`,
    "client/src/lib/money.ts": `export const sym = (c?: string) => c || "$";\n`,
    "client/src/lib/keys.ts": `export const t = (k: string) => k.replace(/([A-Z])/g, " $1").trim();\n`,
    "client/src/components/Agent.tsx": 'export const c = (v: string) => `  -H "Authorization: Bearer $${v}"`;\n',
  };
  const { code, out } = runGate("allow-all", files);
  assert.strictEqual(code, 0, out);
  assert.match(out, /village-fact guard passed/);
  // Control: the walk actually visited them, so the pass is the rules
  // allowing this content rather than the scanner finding no files.
  assert.match(
    out,
    /8 client file\(s\) scanned/,
    "ten files, minus the test and minus ProjectHistory, both excluded by path",
  );
});

check("FIXTURE TREE: a listed count that grew exits 1", () => {
  const { page } = inject("<p>Homes from $80,000</p><p>Studios from $40,000</p>");
  const key = "client/src/pages/Reserve.tsx::money";
  const { code, out } = runGate("grown", { "client/src/pages/Reserve.tsx": page }, { total: 1, counts: { [key]: 1 }, entries: { [key]: { since: "2026-09-03" } } });
  assert.strictEqual(code, 1);
  assert.match(out, /now carries 2 hit\(s\)|allows 1/);
  assert.match(out, /only turns down/);
});

check("FIXTURE TREE: cleaning a listed entry and leaving it listed exits 1", () => {
  // The rule theme-literals leaves out. A fall nobody records is a standing
  // permission for the fact to come back later under a number nobody checked.
  const key = "client/src/pages/Reserve.tsx::money";
  const { code, out } = runGate("stale", { "client/src/pages/Reserve.tsx": CLEAN_PAGE }, { total: 2, counts: { [key]: 2 }, entries: { [key]: { since: "2026-09-03" } } });
  assert.strictEqual(code, 1);
  assert.match(out, /is now CLEAN/);
  assert.match(out, /delete that entry/, "it says to delete the entry");
  assert.match(out, /lower PENDING_CEILING to 0/, "and it says the number to lower the ceiling to");
});

check("FIXTURE TREE: a listed count that only partly fell exits 1 and says the new number", () => {
  const { page } = inject("<p>Homes from $80,000</p>");
  const key = "client/src/pages/Reserve.tsx::money";
  const { code, out } = runGate("partial", { "client/src/pages/Reserve.tsx": page }, { total: 3, counts: { [key]: 3 }, entries: { [key]: { since: "2026-09-03" } } });
  assert.strictEqual(code, 1);
  assert.match(out, /at 3 and now carries 1/);
  assert.match(out, /--update-pending/);
});

check("FIXTURE TREE: a fall in one file does not buy a NEW fact in another (R205)", () => {
  // The finding's own control. Reserve.tsx is listed at 3 money hits and now
  // carries 1; Fresh.tsx is unlisted and carries a new price. The total fell
  // from 3 to 2, which is all the write path used to look at.
  const { page } = inject("<p>Homes from $80,000</p>");
  const key = "client/src/pages/Reserve.tsx::money";
  const pending = { total: 3, counts: { [key]: 3 }, entries: { [key]: { since: "2026-09-03" } } };
  const files = {
    "client/src/pages/Reserve.tsx": page,
    "client/src/pages/Fresh.tsx": "export function Fresh() {\n  return <p>Plots from $25,000</p>;\n}\n",
  };

  const gate = runGate("fall-buys-new", files, pending);
  assert.strictEqual(gate.code, 1, gate.out);
  assert.match(gate.out, /Fresh\.tsx/);
  assert.match(gate.out, /cannot be recorded yet/, "the fall is named, and the advice waits for the growth");
  assert.doesNotMatch(gate.out, /Good news, and the ratchet has to record it: run/, "it must not send the reader to a write that refuses");

  const write = runGate("fall-buys-new", files, pending, ["--update-pending"]);
  assert.strictEqual(write.code, 1, write.out);
  assert.match(write.out, /refusing to write the village-fact pending list/);
  assert.match(write.out, /Fresh\.tsx::money: 1, not on the pending list at all/);
  const after = JSON.parse(fs.readFileSync(path.join(FIXTURES, "fall-buys-new", "pending.json"), "utf8"));
  assert.deepStrictEqual(after.counts, pending.counts, "nothing was written");
});

check("FIXTURE TREE: a list whose own total disagrees with its counts exits 1", () => {
  const key = "client/src/pages/Reserve.tsx::money";
  const { page } = inject("<p>Homes from $80,000</p>");
  const { code, out } = runGate("mismatched-total", { "client/src/pages/Reserve.tsx": page }, { total: 7, counts: { [key]: 1 }, entries: {} });
  assert.strictEqual(code, 1);
  assert.match(out, /declares a total of 7/);
});

check("FIXTURE TREE: the pending list prints even on a passing run", () => {
  const key = "client/src/pages/Reserve.tsx::money";
  const { page } = inject("<p>Homes from $80,000</p>");
  const { code, out } = runGate("print", { "client/src/pages/Reserve.tsx": page }, { total: 1, counts: { [key]: 1 }, entries: { [key]: { since: "2026-09-03" } } });
  assert.strictEqual(code, 0, out);
  assert.match(out, /PENDING/);
  assert.match(out, /client\/src\/pages\/Reserve\.tsx/);
  assert.match(out, /recorded 2026-09-03/);
  assert.match(out, /only ever shrinks/);
});

check("FIXTURE TREE: an inline waiver is honoured and counted out loud", () => {
  const { page } = inject(
    "{/* village-ok: fixture reason, written down rather than just marked */}\n      <p>Homes from $80,000</p>",
  );
  const { code, out } = runGate("waived", { "client/src/pages/Reserve.tsx": page });
  assert.strictEqual(code, 0, out);
  assert.match(out, /1 waiver\(s\) in force/, "a waiver is never silent");
});

check("FIXTURE TREE: an empty tree exits 1 rather than reporting a clean client", () => {
  // "0 findings" and "the walk found nothing to scan" must never print the
  // same line. A moved or renamed scan root would otherwise report a clean
  // tree forever, which is the vacuous pass this repo keeps paying for.
  const { code, out } = runGate("empty", { "client/src/.keep": "" });
  assert.strictEqual(code, 1);
  assert.match(out, /found ZERO scannable files/);
  assert.match(out, /Refusing to report a pass/);
});

check("FIXTURE TREE: a missing client tree exits 1", () => {
  const root = path.join(FIXTURES, "gone");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "pending.json"), "{}\n");
  const r = spawnSync(
    process.execPath,
    [GUARD, "--root", path.join(root, "client", "src"), "--pending", path.join(root, "pending.json")],
    { encoding: "utf8", cwd: REPO },
  );
  assert.strictEqual(r.status, 1);
  assert.match(`${r.stdout}${r.stderr}`, /the client tree is not at/);
});

check("FIXTURE TREE: --fork reports the same finding and exits 0", () => {
  const { page } = inject("<p>Homes from $80,000</p>");
  const r = runGate("fork", { "client/src/pages/Reserve.tsx": page }, undefined, ["--fork"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.stdout, /\$80,000/, "a fork still gets told what was found");
  assert.match(r.stdout, /reported and not failed/);
});

check("FIXTURE TREE: --fork annotates nothing, because nothing failed", () => {
  const { page } = inject("<p>Homes from $80,000</p>");
  const r = runGate("fork-clean", { "client/src/pages/Reserve.tsx": page }, undefined, ["--fork"]);
  assert.ok(!r.out.includes("::error::"), "a green run must not emit error annotations");
  // Control: the same tree without --fork does annotate, so the assertion
  // above measures the flag rather than a guard that never annotates.
  const control = runGate("fork-control", { "client/src/pages/Reserve.tsx": page });
  assert.strictEqual(control.code, 1);
  assert.ok(control.stderr.includes("::error::"));
});

check("FIXTURE TREE: VILLAGE_FORK=1 does the same as the flag", () => {
  const { page } = inject("<p>Homes from $80,000</p>");
  const r = runGate("forkenv", { "client/src/pages/Reserve.tsx": page }, undefined, [], { VILLAGE_FORK: "1" });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.stdout, /reported and not failed/);
});

check("FIXTURE TREE: --json carries the same verdict as the exit code", () => {
  const { page } = inject("<p>Homes from $80,000</p>");
  const { code, out } = runGate("json", { "client/src/pages/Reserve.tsx": page }, undefined, ["--json"]);
  assert.strictEqual(code, 1);
  const line = out.split("\n").find((l) => l.trim().startsWith("{"));
  assert.ok(line, "a --json run must print an object");
  const parsed = JSON.parse(line);
  assert.strictEqual(parsed.total, 1);
  assert.deepStrictEqual(parsed.unexpected, [{ key: "client/src/pages/Reserve.tsx::money", found: 1 }]);
});

check("FIXTURE TREE: --update-pending refuses to raise the total", () => {
  const { page } = inject("<p>Homes from $80,000</p><p>Studios from $40,000</p>");
  const key = "client/src/pages/Reserve.tsx::money";
  const before = { total: 1, counts: { [key]: 1 }, entries: { [key]: { since: "2026-09-03" } } };
  const r = runGate("no-raise", { "client/src/pages/Reserve.tsx": page }, before, ["--update-pending"]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /refusing to raise/);
  const after = JSON.parse(fs.readFileSync(path.join(FIXTURES, "no-raise", "pending.json"), "utf8"));
  assert.deepStrictEqual(after, before, "and it wrote nothing");
});

check("FIXTURE TREE: --update-pending records a fall and keeps the original date", () => {
  const { page } = inject("<p>Homes from $80,000</p>");
  const key = "client/src/pages/Reserve.tsx::money";
  const before = { total: 3, counts: { [key]: 3 }, entries: { [key]: { since: "2026-08-01" } } };
  const r = runGate("record-fall", { "client/src/pages/Reserve.tsx": page }, before, ["--update-pending"]);
  assert.strictEqual(r.code, 0, r.out);
  const after = JSON.parse(fs.readFileSync(path.join(FIXTURES, "record-fall", "pending.json"), "utf8"));
  assert.strictEqual(after.total, 1);
  assert.deepStrictEqual(after.counts, { [key]: 1 });
  assert.strictEqual(after.entries[key].since, "2026-08-01", "the date a fact was first recorded does not move");
  assert.match(r.out, /Set PENDING_CEILING to 1/);
});

// ── The gate, against the tree it actually guards ───────────────────────────

check("THE REAL TREE: the guard passes at this commit", () => {
  // The seeded list is measured, so this is the assertion that the number in
  // the JSON is the number in the client rather than a hopeful round figure.
  const r = spawnSync(process.execPath, [GUARD], { encoding: "utf8", cwd: REPO });
  assert.strictEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /village-fact guard passed/);
  // Derived from the constant, never written down. check-identity-keys.test
  // .mjs records why: an assertion that names the number broke the day the
  // list legitimately shrank, which is the one thing the list is supposed to
  // do, and a test that fails when the thing it guards succeeds teaches people
  // to edit the test without reading it.
  assert.match(r.stdout, new RegExp(`pending list ${PENDING_CEILING} \\(ceiling ${PENDING_CEILING}\\)`));
});

check("THE REAL TREE: the known defects the brief named are on the list", () => {
  // Named one at a time, because a scanner that silently stopped finding one
  // class of fact would still pass every fixture above: those fixtures prove
  // the rules fire on invented copy, and this proves they fired on the real
  // pages where these defects were found by hand.
  //
  // Recorded as CEILINGS, for the reason the assertion above gives. A lane
  // that reads these from settings lowers the count and this still passes; the
  // seeded figure stays here as the measurement it was on 2026-09-03.
  const seeded = {
    "client/src/pages/LoveLetter.tsx::money": 6, // the dropdown that collects money
    "client/src/pages/Opportunities.tsx::money": 8, // eight USD bands, no settings hook
    "client/src/pages/ResidentJourney.tsx::money": 2, // the $5k to $20k+ deposit band
    "client/src/components/SwapCard.tsx::money": 1, // the hard dollar prefix
    "client/src/pages/MasterPlan.tsx::unit": 1, // "Total Acres" over a hectares figure
    "client/src/pages/Admin.tsx::unit": 2, // the unit hints, one of which states a default
    "client/src/pages/InvestorJourney.tsx::person-name": 1, // a person named in a form reply
    "client/src/pages/Admin.tsx::token-name": 5, // includes the label at 10113
  };
  const real = JSON.parse(fs.readFileSync(REAL_PENDING, "utf8"));
  for (const [key, ceiling] of Object.entries(seeded)) {
    const found = real.counts[key] ?? 0;
    assert.ok(found <= ceiling, `${key} is recorded at ${found}, above the seeded ${ceiling}`);
    assert.ok(
      found > 0 || !(key in real.counts),
      `${key} is listed at zero; delete the entry instead of recording nothing`,
    );
  }
  // At least one of them still has to be there, or the scanner has gone blind
  // and every ceiling above is satisfied by finding nothing at all.
  assert.ok(
    Object.keys(seeded).some((k) => (real.counts[k] ?? 0) > 0),
    "every named defect is gone from the list at once, which is a blinded scanner more likely than a finished job",
  );
});

fs.rmSync(FIXTURES, { recursive: true, force: true });

console.log(`\n${run} check(s) passed\n`);
