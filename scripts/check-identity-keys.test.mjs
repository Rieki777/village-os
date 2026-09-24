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
  listsLookBroken,
  neutralKeysNotChecked,
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

check("a NEUTRAL entry the guard never walks is caught", () => {
  // The rule itself: an entry with a watcher is fine, one without is not.
  assert.deepStrictEqual(neutralKeysNotChecked({ "a.b": ["x"] }, ["a.b"]), []);
  assert.deepStrictEqual(neutralKeysNotChecked({ "a.b": ["x"] }, []), ["a.b"]);
});

check("EMPTY LISTS ARE A BROKEN READER, NEVER A CLEAN SWEEP", () => {
  /*
   * Every rule in this file is a filter, and a filter over an empty set returns
   * an empty set. So the failure being guarded is not "a key slipped through",
   * it is "nothing was looked at and the run said the same green".
   *
   * The lists are derived rather than hand-kept, which is what keeps them from
   * going stale, and is exactly why this floor is easy to leave out: a derived
   * list feels like it cannot be wrong. It can still be EMPTY.
   */
  assert.strictEqual(listsLookBroken({ "a.b": ["x"] }, ["a.b"]), false);
  assert.strictEqual(listsLookBroken({}, ["a.b"]), true, "no NEUTRAL entries at all");
  assert.strictEqual(listsLookBroken({ "a.b": ["x"] }, []), true, "nothing in IDENTITY_KEYS");
  assert.strictEqual(listsLookBroken({}, []), true, "both gone");
  // And the sweep it sits under really would have reported nothing.
  assert.deepStrictEqual(neutralKeysNotChecked({}, []), []);
});

check("prose naming GAME_CONFIG above the declaration does not move the anchor", () => {
  /*
   * THIS HAPPENED, on 2026-09-09. The reader anchored on the first textual
   * occurrence of "GAME_CONFIG" anywhere in the file. A comment was added above
   * the declaration to explain a placeholder, the anchor landed in the prose,
   * and the guard reported six keys missing from a file that still held every
   * one. It failed loudly, which is the design working, but a guard any
   * sentence can move is a guard whose next break is somebody documenting it.
   */
  // THE INTERVENING BRACE IS THE WHOLE POINT. My first version of this fixture
  // put the prose immediately above the declaration and PASSED against the
  // broken reader, because the next `{` after the prose was still the right
  // one. In the real file an `export interface GameConfig {` sits between them,
  // and that brace is what the old anchor walked into. A fixture without it
  // tests nothing and reads as protection.
  const withProse = `
/**
 * A comment that mentions GAME_CONFIG before the declaration, the way a real
 * explanation of a placeholder inside it has to.
 */
export interface GameConfig {
  project: { name: string };
}

export const GAME_CONFIG = {
  project: { name: "Unnamed Village" },
};
`;
  const v = parseConfigValues(withProse);
  assert.strictEqual(v["project.name"], "Unnamed Village");
});

check("a placeholder brace inside a string does not break the object walk", () => {
  // The other half of the same change: `{commitment}` sits inside a string
  // value in the real config, and a brace counter that did not skip strings
  // would lose the rest of the object from there on.
  const withBrace = `
export const GAME_CONFIG = {
  project: { name: "Signed the {commitment}", tagline: "after the brace" },
};
`;
  const v = parseConfigValues(withBrace);
  assert.strictEqual(v["project.name"], "Signed the {commitment}");
  assert.strictEqual(v["project.tagline"], "after the brace");
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

/**
 * A PENDING LIST OF OUR OWN, and the rules below are driven against this one
 * rather than the shipped `KNOWN_PENDING`.
 *
 * The shipped list reached ZERO on 2026-09-23 when project.fiatCurrency
 * graduated, which is the outcome the guard's header demands. Every rule it
 * governs is still live, because a future key can still need pending status:
 * `season.timezone` is the known candidate the moment the guard stops walking
 * a fixed list.
 *
 * These tests used to read the shipped list directly, indexing `KNOWN_PENDING[0]`
 * and slicing it. That worked while entries existed and does two bad things as
 * the list empties: the slicing cases THROW on an empty array, and the rest go
 * quietly vacuous, asserting that nothing is wrong with nothing. A guard whose
 * tests evaporate as it succeeds is the shape this repo keeps paying for.
 *
 * So the rules are tested against a fixture, and the SHIPPED list gets its own
 * separate assertion further down. Two entries, because shrink and grow both
 * need somewhere to go.
 */
const SAMPLE_PENDING = [
  { key: "project.memberName", since: "2026-01-01", why: "a fixture, so the rules stay testable at any list length" },
  { key: "project.catalystName", since: "2026-01-02", why: "the second, so a shrink has something to remove" },
];
const SAMPLE_CEILING = SAMPLE_PENDING.length;

/** A config in which only the given pending keys are populated. */
function cleanValues(overrides = {}, pending = SAMPLE_PENDING) {
  const values = {};
  for (const k of IDENTITY_KEYS) values[k] = "";
  values["project.name"] = "Unnamed Village";
  for (const p of pending) values[p.key] = "something the founder has not moved yet";
  return { ...values, ...overrides };
}

check("POSITIVE CONTROL: the pending keys alone are accepted", () => {
  const r = auditIdentity(cleanValues(), SAMPLE_PENDING, SAMPLE_CEILING);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.unexpected, []);
  assert.deepStrictEqual(r.stale, []);
  assert.strictEqual(r.ceiling, null);
  // The control on the control. If the fixture stopped populating anything,
  // every "refuses" case below would pass against an empty config.
  assert.deepStrictEqual(r.populated, SAMPLE_PENDING.map((p) => p.key));
});

check("REFUSES a populated key outside the pending list", () => {
  const r = auditIdentity(cleanValues({ "project.name": "Riverside Commons" }), SAMPLE_PENDING, SAMPLE_CEILING);
  assert.deepStrictEqual(r.unexpected, ["project.name"]);
});

check("REFUSES a pending entry whose key has gone clean", () => {
  // Was project.tagline until 2026-08-31, then project.location until
  // 2026-09-03, then project.fiatCurrency until 2026-09-23. Each graduation
  // meant repointing this at whatever was still pending, and the last one left
  // nothing to point at. It drives the fixture now, so the rule is covered at
  // any list length including zero.
  const key = SAMPLE_PENDING[0].key;
  const r = auditIdentity(cleanValues({ [key]: "" }), SAMPLE_PENDING, SAMPLE_CEILING);
  assert.deepStrictEqual(r.stale, [key]);
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
  const grown = [...SAMPLE_PENDING, { key: "project.footerBlurb", since: "2026-09-01", why: "smuggled in" }];
  const r = auditIdentity(cleanValues({ "project.footerBlurb": "Riverside words" }, grown), grown, SAMPLE_CEILING);
  assert.deepStrictEqual(r.unexpected, [], "the new entry does cover the key");
  // Derived from the fixture, never hardcoded. This assertion said
  // { listed: 6, ceiling: 5 } and broke the day the list legitimately shrank
  // from five to four, which is the one thing this list is supposed to do. A
  // test that fails when the thing it guards succeeds teaches people to edit
  // the test without reading it.
  assert.deepStrictEqual(
    r.ceiling,
    { listed: SAMPLE_CEILING + 1, ceiling: SAMPLE_CEILING },
    "and the ceiling is what refuses it",
  );
});

check("REFUSES a shrunk list whose ceiling did not follow it down", () => {
  const shrunk = SAMPLE_PENDING.slice(1);
  const values = cleanValues({ [SAMPLE_PENDING[0].key]: "" });
  // Derived, for the same reason as the assertion above it.
  assert.deepStrictEqual(auditIdentity(values, shrunk, SAMPLE_CEILING).ceiling, {
    listed: SAMPLE_CEILING - 1,
    ceiling: SAMPLE_CEILING,
  });
});

check("ACCEPTS the shrink when the ceiling comes down with it", () => {
  const shrunk = SAMPLE_PENDING.slice(1);
  const values = cleanValues({ [SAMPLE_PENDING[0].key]: "" });
  const r = auditIdentity(values, shrunk, SAMPLE_CEILING - 1);
  assert.strictEqual(r.ceiling, null);
  assert.deepStrictEqual(r.stale, []);
  assert.deepStrictEqual(r.unexpected, []);
});

check("ACCEPTS an empty pending list with a zero ceiling, which is today", () => {
  // The state the shipped guard is now in, tested as a rule rather than only
  // observed. An empty list is the END of the ratchet, so it has to be an
  // accepted configuration and not merely one nothing happens to reject.
  const r = auditIdentity(cleanValues({}, []), [], 0);
  assert.strictEqual(r.ceiling, null);
  assert.deepStrictEqual(r.stale, []);
  assert.deepStrictEqual(r.unexpected, []);
  assert.deepStrictEqual(r.populated, [], "nothing is populated once nothing is pending");
});

check("REFUSES an emptied list whose ceiling stayed up", () => {
  // The bookkeeping half of the graduation just made: clearing the last key
  // without lowering the ceiling has to be caught, or the ratchet's final
  // step is the one step nobody checks.
  assert.deepStrictEqual(auditIdentity(cleanValues({}, []), [], 1).ceiling, { listed: 0, ceiling: 1 });
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

check("the shipped list is EMPTY, and the ceiling is zero", () => {
  /*
   * Today's state, pinned deliberately rather than left as something the
   * assertion above happens to tolerate.
   *
   * This is the end of the ratchet: no key is waiting on the founder any more.
   * project.fiatCurrency was the last, and it graduated on 2026-09-23 once
   * Amora held its own currency in the live Admin screen.
   *
   * IT FAILING IS NOT AUTOMATICALLY A BUG. A future key can legitimately need
   * pending status, and `season.timezone` is the known candidate: it still
   * ships "America/Costa_Rica" and nothing watches it, because `auditIdentity`
   * walks a FIXED list and so catches a rename but never an addition. Whoever
   * adds that entry updates this test and says why in the same commit, which
   * is exactly the deliberate edit the ceiling comment asks for. What this
   * refuses is the list growing quietly.
   */
  assert.deepStrictEqual(KNOWN_PENDING, []);
  assert.strictEqual(PENDING_CEILING, 0);
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
    // Added 2026-09-09 with the key itself, same standing as catalystName
    // above: "membership agreement" is the platform's own word for the
    // thing a member signs and belongs to no village, so it is NEUTRAL and
    // a clean fixture carries it. A test that wants this key to violate
    // passes its own string.
    commitmentName: "membership agreement",
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
    // Was "ZZZ", the last stand-in for a key still on KNOWN_PENDING.
    // project.fiatCurrency graduated on 2026-09-23 with an EMPTY default,
    // after the founder entered the village's own currency on the live Admin
    // screen, so a CLEAN fixture is empty here for the same reason location
    // above is. There is no neutral currency to carry: `defaultDisplayCurrency`
    // answers CHF for a project that declares nothing, which is why blank
    // reaches the ruling without writing one country's money into this file.
    // A test that wants this key to violate passes its own string.
    fiatCurrency: "",
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
function runGate(label, source, args = [], env = {}, guardSource = null) {
  const root = path.join(FIXTURES, label);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  if (guardSource === null) fs.copyFileSync(GUARD, path.join(root, "scripts", "check-identity-keys.mjs"));
  else fs.writeFileSync(path.join(root, "scripts", "check-identity-keys.mjs"), guardSource);
  if (source !== null) fs.writeFileSync(path.join(root, "shared", "gameConfig.ts"), source);
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "check-identity-keys.mjs"), ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`, stdout: r.stdout || "", stderr: r.stderr || "" };
}

check("FIXTURE TREE, positive control: a wholly clean config exits 0", () => {
  const { code, out } = runGate("clean", configSource());
  assert.strictEqual(code, 0, out);
  assert.match(out, /identity guard passed/);
});

/**
 * The shipped guard with a PENDING ENTRY PUT BACK, for the CLI cases below.
 *
 * The shipped list is empty as of 2026-09-23, so the two rules about a pending
 * entry have nothing real to drive. They are still live rules, so they drive a
 * patched copy of the guard instead of quietly testing nothing.
 *
 * Both replacements are ASSERTED. A patch that silently matched nothing would
 * leave these tests running against the real empty list and reporting the same
 * green they report when they are working, which is the failure this whole
 * file exists to make impossible.
 */
function guardWithPending(entry) {
  const src = fs.readFileSync(GUARD, "utf8");
  const listed = src.replace(
    /export const KNOWN_PENDING = \[[\s\S]*?\n\];/,
    `export const KNOWN_PENDING = ${JSON.stringify([entry])};`,
  );
  assert.notStrictEqual(listed, src, "the KNOWN_PENDING literal must have been replaced");
  const ceilinged = listed.replace(/export const PENDING_CEILING = \d+;/, "export const PENDING_CEILING = 1;");
  assert.notStrictEqual(ceilinged, listed, "the PENDING_CEILING literal must have been replaced");
  return ceilinged;
}

const CLI_PENDING = {
  key: "project.memberName",
  since: "2026-01-01",
  why: "a fixture entry, so the CLI rules stay covered with the real list empty",
};

check("FIXTURE TREE: the pending list prints even on a passing run", () => {
  const source = configSource({ project: { memberName: "Riverside folk" } });
  const { code, out } = runGate("clean-print", source, [], {}, guardWithPending(CLI_PENDING));
  assert.strictEqual(code, 0, out);
  assert.ok(out.includes(CLI_PENDING.key), "a pending key must be printed on a PASSING run");
  assert.match(out, /only ever shrinks/);
});

check("FIXTURE TREE: an empty pending list still prints its denominator", () => {
  // The shipped shape now. The summary line is the guard telling a reader what
  // it looked at, and "0 known-pending (ceiling 0)" is the useful answer. A
  // run that printed nothing here would read the same as one that checked
  // nothing.
  const { code, out } = runGate("clean-empty-print", configSource());
  assert.strictEqual(code, 0, out);
  assert.match(out, /30 checked/);
  assert.match(out, /0 known-pending \(ceiling 0\)/);
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
  // Read project.tagline, then project.location, then whichever key was first
  // on the shipped list. That list reached zero on 2026-09-23, so it drives a
  // patched guard now: the rule is live for the next key that needs pending
  // status, and a test that could only run while the ratchet was unfinished
  // would be gone exactly when it starts mattering again.
  const field = CLI_PENDING.key.replace(/^project\./, "");
  const { code, out } = runGate("cleared", configSource({ project: { [field]: "Village member" } }), [], {}, guardWithPending(CLI_PENDING));
  assert.strictEqual(code, 1, out);
  assert.match(out, new RegExp(CLI_PENDING.key.replace(".", "\\.")));
  assert.match(out, /lower PENDING_CEILING to 0/);
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
