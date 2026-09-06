/**
 * The identity guard's own guard.
 *
 * Two things are being proved, and the second matters more than the first.
 *
 * IT REFUSES. A populated key outside the pending list fails, a pending entry
 * whose key has gone clean fails, a grown list fails, and a key that vanished
 * from the config fails. Each of those is checked against a real config tree
 * on disk, run as a child process, reading the exit code.
 *
 * IT CAN STILL SEE. The reader is text-based, so it can lose sight of a key
 * without losing its green. Every refusal case below is paired with a
 * positive control that must come back clean, and the parser cases exist
 * because a reader that returned an empty object would pass every refusal
 * test in this file by finding nothing to object to.
 *
 * The fixture villages are invented. This file lives in a ratchet zone where
 * a new file's allowance for real village names is zero, and a test that had
 * to name someone to work would be the same mistake it is testing for.
 *
 * Run: node scripts/check-identity-keys.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  IDENTITY_KEYS,
  KNOWN_PENDING,
  PENDING_CEILING,
  auditIdentity,
  isViolation,
  parseConfigValues,
} from "./check-identity-keys.mjs";

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-identity-keys.mjs");

let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

console.log("\ncheck-identity-keys: key presence, and a list that only shrinks\n");

// ── The reader ──────────────────────────────────────────────────────────────

const SAMPLE = `
export interface GameConfig {
  project: { name: string; tagline: string };
}
export const GAME_CONFIG: GameConfig = {
  project: {
    // A comment with a { brace } and a "quoted string" in it.
    name: "Unnamed Village",
    /* A block comment
       spanning lines, with a } in it. */
    siteUrl: "https://example.test/a//b",
    tagline: "",
  },
  currency: {
    name: "Gratitude",
    equity: { symbol: "EQUITY", name: "Village Equity", address: "", chainId: 8453 },
  },
  paths: [
    { id: "investor", label: "Investor" },
  ],
  season: {
    seasons: [ { id: "one", name: "Season One" } ],
    timezone: "UTC",
  },
};
`;

check("reads nested keys as dotted paths", () => {
  const v = parseConfigValues(SAMPLE);
  assert.strictEqual(v["project.name"], "Unnamed Village");
  assert.strictEqual(v["currency.equity.symbol"], "EQUITY");
  assert.strictEqual(v["currency.equity.address"], "");
});

check("keeps an empty string, which is a value and not an absence", () => {
  const v = parseConfigValues(SAMPLE);
  assert.ok("project.tagline" in v, "an empty slot must still be reported as present");
  assert.strictEqual(v["project.tagline"], "");
});

check("is not fooled by a double slash inside a string", () => {
  assert.strictEqual(parseConfigValues(SAMPLE)["project.siteUrl"], "https://example.test/a//b");
});

check("is not fooled by braces inside comments", () => {
  const v = parseConfigValues(SAMPLE);
  assert.strictEqual(v["currency.name"], "Gratitude", "a } in a block comment must not close the object");
});

check("skips arrays whole, so a list record is never mistaken for a slot", () => {
  const v = parseConfigValues(SAMPLE);
  assert.ok(!Object.keys(v).some((k) => k.includes("investor")), "array contents must not become keys");
  assert.ok(!Object.keys(v).some((k) => k.includes("Season One")), "nor must season records");
  assert.strictEqual(v["season.timezone"], "UTC", "and reading must resume after the array");
});

check("reads the interface's own braces without falling out of the literal", () => {
  // The anchor is GAME_CONFIG, so the interface above it is skipped entirely.
  assert.strictEqual(parseConfigValues(SAMPLE)["project.name"], "Unnamed Village");
});

check("returns null when there is no GAME_CONFIG to read", () => {
  assert.strictEqual(parseConfigValues("export const SOMETHING_ELSE = { a: 1 };"), null);
});

check("survives CRLF, which has silently blinded a guard in this repo before", () => {
  // check-brand-refs reported a different answer per machine for exactly this
  // reason: JavaScript's dot excludes the carriage return, so a line-anchored
  // rule never reached the end of a line on a Windows checkout. .gitattributes
  // is not relied on here; the reader is proved against both endings.
  const crlf = parseConfigValues(SAMPLE.replace(/\n/g, "\r\n"));
  const lf = parseConfigValues(SAMPLE);
  assert.deepStrictEqual(crlf, lf, "a Windows checkout must read the same as a Linux one");
  assert.strictEqual(crlf["project.name"], "Unnamed Village");
  assert.strictEqual(crlf["currency.equity.symbol"], "EQUITY");
});

// ── The rules ───────────────────────────────────────────────────────────────

check("an approved neutral value is not a violation, a village's is", () => {
  assert.strictEqual(isViolation("project.name", "Unnamed Village"), false);
  assert.strictEqual(isViolation("project.name", ""), false);
  assert.strictEqual(isViolation("project.name", "Riverside Commons"), true);
});

check("a key with no approved values may only ever be empty", () => {
  assert.strictEqual(isViolation("project.tagline", ""), false);
  assert.strictEqual(isViolation("project.tagline", "Any words at all"), true);
});

/** A config in which only the known-pending keys are populated. */
function cleanValues(overrides = {}) {
  const values = {};
  for (const k of IDENTITY_KEYS) values[k] = "";
  values["project.name"] = "Unnamed Village";
  for (const p of KNOWN_PENDING) values[p.key] = "something the founder has not moved yet";
  return { ...values, ...overrides };
}

check("POSITIVE CONTROL: the pending five alone are accepted", () => {
  const r = auditIdentity(cleanValues());
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.unexpected, []);
  assert.deepStrictEqual(r.stale, []);
  assert.strictEqual(r.ceiling, null);
});

check("REFUSES a populated key outside the pending list", () => {
  const r = auditIdentity(cleanValues({ "project.memberName": "Riverside folk" }));
  assert.deepStrictEqual(r.unexpected, ["project.memberName"]);
});

check("REFUSES a pending entry whose key has gone clean", () => {
  // Was project.tagline until 2026-08-31, then project.location until
  // 2026-09-03. Both graduated the same way: the founder entered the village's
  // own value in the live Admin first, so the village holds its own copy, and
  // only then did the platform default go neutral or empty. Repointed each
  // time at a key that is still pending rather than deleted, because the rule
  // it covers stays live while any remain. Two do.
  const r = auditIdentity(cleanValues({ "project.fiatCurrency": "" }));
  assert.deepStrictEqual(r.stale, ["project.fiatCurrency"]);
});

check("REFUSES emptying the tagline now that it carries a neutral default", () => {
  // The graduation is what makes this reachable. While tagline sat in
  // KNOWN_PENDING an empty value read as "the founder has taken it into their
  // own record", which is the good outcome. Now that the default is a real
  // platform sentence, emptying it removes a fallback every village renders,
  // and that is the exact shape of the outage this guard was built after.
  // `includes`, not `deepStrictEqual`, and the reason is worth writing down:
  // cleanValues() builds its fixture with every key empty, so on that fixture
  // the emptied rule legitimately names all nine NEUTRAL keys at once. What
  // this test is for is that project.tagline is now among them, which it was
  // not while the key sat in KNOWN_PENDING.
  const r = auditIdentity(cleanValues({ "project.tagline": "" }));
  assert.ok(r.emptied.includes("project.tagline"), "an emptied neutral default must be caught");
  assert.ok(!r.stale.includes("project.tagline"), "and it is no longer a stale pending entry");
});

check("REFUSES a key that has vanished from the config", () => {
  const values = cleanValues();
  delete values["images.favicon"];
  assert.deepStrictEqual(auditIdentity(values).missing, ["images.favicon"]);
});

check("REFUSES a grown pending list", () => {
  const grown = [...KNOWN_PENDING, { key: "project.memberName", since: "2026-09-01", why: "smuggled in" }];
  const r = auditIdentity(cleanValues({ "project.memberName": "Riverside folk" }), grown, PENDING_CEILING);
  assert.deepStrictEqual(r.unexpected, [], "the new entry does cover the key");
  // Derived from the constants, never hardcoded. This assertion said
  // { listed: 6, ceiling: 5 } and broke the day the list legitimately shrank
  // from five to four, which is the one thing this list is supposed to do. A
  // test that fails when the thing it guards succeeds teaches people to edit
  // the test without reading it.
  assert.deepStrictEqual(
    r.ceiling,
    { listed: KNOWN_PENDING.length + 1, ceiling: PENDING_CEILING },
    "and the ceiling is what refuses it",
  );
});

check("REFUSES a shrunk list whose ceiling did not follow it down", () => {
  const shrunk = KNOWN_PENDING.slice(1);
  const values = cleanValues({ [KNOWN_PENDING[0].key]: "" });
  // Derived, for the same reason as the assertion above it.
  assert.deepStrictEqual(auditIdentity(values, shrunk, PENDING_CEILING).ceiling, {
    listed: KNOWN_PENDING.length - 1,
    ceiling: PENDING_CEILING,
  });
});

check("ACCEPTS the shrink when the ceiling comes down with it", () => {
  const shrunk = KNOWN_PENDING.slice(1);
  const values = cleanValues({ [KNOWN_PENDING[0].key]: "" });
  const r = auditIdentity(values, shrunk, PENDING_CEILING - 1);
  assert.strictEqual(r.ceiling, null);
  assert.deepStrictEqual(r.stale, []);
  assert.deepStrictEqual(r.unexpected, []);
});

check("the guard carries no shebang, which would break the Vitest import", () => {
  // shared/gameConfig.test.ts imports this module, so it goes through Vite's
  // transform as well as node. A shebang and CRLF line endings together make
  // that transform throw `SyntaxError: Invalid or unexpected token`; either
  // alone is fine, which is how it passed on an LF working copy and failed
  // the moment a checkout rewrote the file with CRLF. Named here so the next
  // person to add `#!` gets this sentence rather than that SyntaxError.
  const source = fs.readFileSync(GUARD, "utf8");
  assert.ok(!source.startsWith("#!"), "check-identity-keys.mjs must not open with a shebang");
  // Control: the assertion is looking at the right file, and would see one.
  assert.ok(source.includes("IDENTITY_KEYS"), "the file being read is the guard");
});

check("the shipped list and the shipped ceiling agree", () => {
  assert.strictEqual(KNOWN_PENDING.length, PENDING_CEILING);
  assert.deepStrictEqual(
    KNOWN_PENDING.filter((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.since)),
    [],
    "every pending entry carries the date it was recorded",
  );
});

// ── The gate, against a real tree, reading the exit code ────────────────────

const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), "identity-keys-"));

/** A whole config file with the given project block, everything else clean. */
function configSource({ project = {}, dropFavicon = false } = {}) {
  const p = {
    name: "Unnamed Village",
    // Was "A line the founder has not moved yet", a stand-in for a key still on
    // KNOWN_PENDING. project.tagline graduated into NEUTRAL on 2026-08-31, so a
    // CLEAN fixture has to carry the neutral value or the guard is right to
    // refuse it. A test that wants tagline to violate passes its own string.
    tagline: "healing the land and ourselves, together",
    memberName: "Village member",
    // Added 2026-09-03 with the key itself. "Catalyst" is the platform's own
    // word for whoever runs a village and belongs to none of them, so it is a
    // NEUTRAL value and a clean fixture carries it. A test that wants this key
    // to violate passes its own string.
    catalystName: "Catalyst",
    // Was "Somewhere the founder has not moved yet". project.location graduated
    // on 2026-09-03 and its platform default is EMPTY, because there is no
    // neutral location, so a clean fixture is empty here for the same reason
    // the tagline above carries a sentence.
    location: "",
    // Was "ZZ", a stand-in for a key still on KNOWN_PENDING, for the same
    // reason tagline above was once a stand-in. project.country graduated on
    // 2026-09-02 (nothing reads it, so blanking it changed no village's
    // screen), so a CLEAN fixture now has to carry the empty value or the
    // guard is right to refuse it. A test that wants country to violate passes
    // its own string.
    country: "",
    fiatCurrency: "ZZZ",
    adminPath: "/admin",
    siteUrl: "",
    eventsUrl: "",
    contactEmail: "",
    // Was "A sentence the founder has not moved yet". Graduated the same day
    // into NEUTRAL, so a clean fixture carries the neutral sentence.
    footerBlurb: "A regenerative village where all beings belong and thrive.",
    ...project,
  };
  const images = ["hero", "investorHero", "residentHero", "stewardHero", "prosperityHero", "masterPlanHero", "logo", "heartLogo", "favicon"]
    .filter((k) => !(dropFavicon && k === "favicon"))
    .map((k) => `    ${k}: "",`)
    .join("\n");
  return `export const GAME_CONFIG = {
  project: {
${Object.entries(p).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`).join("\n")}
  },
  currency: {
    name: "Gratitude",
    nameLower: "gratitude",
    equity: { symbol: "EQUITY", name: "Village Equity", address: "", chainId: 8453, decimals: 18 },
    voice: { symbol: "VOICE", name: "Village Voice", address: "", chainId: 8453, decimals: 18 },
  },
  images: {
${images}
  },
};
`;
}

/**
 * Build a tree with a copy of the guard in it, run it, return exit and output.
 *
 * spawnSync, not execFileSync: execFileSync throws away stderr on a SUCCESSFUL
 * run, which made the --fork case below assert against stdout alone and pass
 * for the wrong reason. Both streams, both outcomes, every time.
 */
function runGate(label, source, args = [], env = {}) {
  const root = path.join(FIXTURES, label);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.copyFileSync(GUARD, path.join(root, "scripts", "check-identity-keys.mjs"));
  if (source !== null) fs.writeFileSync(path.join(root, "shared", "gameConfig.ts"), source);
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "check-identity-keys.mjs"), ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`, stdout: r.stdout || "", stderr: r.stderr || "" };
}

check("FIXTURE TREE, positive control: the pending five alone exit 0", () => {
  const { code, out } = runGate("clean", configSource());
  assert.strictEqual(code, 0, out);
  assert.match(out, /identity guard passed/);
});

check("FIXTURE TREE: the pending list prints even on a passing run", () => {
  const { out } = runGate("clean-print", configSource());
  for (const p of KNOWN_PENDING) assert.ok(out.includes(p.key), `${p.key} must be printed`);
  assert.match(out, /only ever shrinks/);
});

check("FIXTURE TREE: a sixth key populated exits 1 and names it", () => {
  const { code, out } = runGate("sixth", configSource({ project: { memberName: "Riverside folk" } }));
  assert.strictEqual(code, 1);
  assert.match(out, /project\.memberName/);
});

check("FIXTURE TREE: a village name in project.name exits 1", () => {
  const { code, out } = runGate("named", configSource({ project: { name: "Riverside Commons" } }));
  assert.strictEqual(code, 1);
  assert.match(out, /project\.name/);
});

check("FIXTURE TREE: a cleared pending key exits 1 and asks for the bookkeeping", () => {
  // Drives whichever key is FIRST on the pending list rather than naming one.
  // This read project.tagline until that key graduated into NEUTRAL, at which
  // point clearing it stopped being a stale-entry case and became an emptied
  // one, and the test failed for a reason that had nothing to do with the rule
  // it covers.
  const pendingKey = KNOWN_PENDING[0].key;
  const field = pendingKey.replace(/^project\./, "");
  const { code, out } = runGate("cleared", configSource({ project: { [field]: "" } }));
  assert.strictEqual(code, 1);
  assert.match(out, new RegExp(pendingKey.replace(".", "\\.")));
  assert.match(out, new RegExp(`lower PENDING_CEILING to ${KNOWN_PENDING.length - 1}`));
});

check("FIXTURE TREE: emptying a NEUTRAL key exits 1 and names the outage", () => {
  // The other half of the pair above, and the rule that was missing when the
  // live village lost its identity: taking a default OUT is what caused the
  // outage, and for a key with a declared neutral value it is now refused.
  const { code, out } = runGate("emptied-neutral", configSource({ project: { tagline: "" } }));
  assert.strictEqual(code, 1);
  assert.match(out, /project\.tagline/);
  assert.match(out, /OUTAGE/);
});

check("FIXTURE TREE: a renamed key exits 1 rather than checking one fewer thing", () => {
  const { code, out } = runGate("renamed", configSource({ dropFavicon: true }));
  assert.strictEqual(code, 1);
  assert.match(out, /images\.favicon/);
  assert.match(out, /was not found in GAME_CONFIG/);
});

check("FIXTURE TREE: no GAME_CONFIG at all exits 1", () => {
  const { code, out } = runGate("noconfig", "export const SOMETHING_ELSE = { a: 1 };\n");
  assert.strictEqual(code, 1);
  assert.match(out, /could not find the GAME_CONFIG literal/);
});

check("FIXTURE TREE: a missing config file exits 1", () => {
  const { code, out } = runGate("nofile", null);
  assert.strictEqual(code, 1);
  assert.match(out, /is not at/);
});

check("FIXTURE TREE: --fork reports the same finding and exits 0", () => {
  const r = runGate("fork", configSource({ project: { name: "Riverside Commons" } }), ["--fork"]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.stdout, /project\.name/, "a fork still gets told what was found");
  assert.match(r.stdout, /reported and not failed/);
});

check("FIXTURE TREE: --fork annotates nothing, because nothing failed", () => {
  const r = runGate("fork-clean-stderr", configSource({ project: { name: "Riverside Commons" } }), ["--fork"]);
  assert.ok(!r.out.includes("::error::"), "a green run must not emit error annotations");
  // Control: the same config without --fork does emit them, so the assertion
  // above is measuring the flag rather than a guard that never annotates.
  const control = runGate("fork-control", configSource({ project: { name: "Riverside Commons" } }));
  assert.strictEqual(control.code, 1);
  assert.ok(control.stderr.includes("::error::"), "the same finding must annotate when it is a failure");
});

check("FIXTURE TREE: VILLAGE_FORK=1 does the same as the flag", () => {
  const r = runGate("forkenv", configSource({ project: { name: "Riverside Commons" } }), [], { VILLAGE_FORK: "1" });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.stdout, /reported and not failed/);
});

check("FIXTURE TREE: --json carries the same verdict as the exit code", () => {
  const { code, out } = runGate("json", configSource({ project: { memberName: "Riverside folk" } }), ["--json"]);
  assert.strictEqual(code, 1);
  const line = out.split("\n").find((l) => l.trim().startsWith("{"));
  assert.ok(line, "a --json run must print an object");
  assert.deepStrictEqual(JSON.parse(line).unexpected, ["project.memberName"]);
});

fs.rmSync(FIXTURES, { recursive: true, force: true });

console.log(`\n${run} check(s) passed\n`);
