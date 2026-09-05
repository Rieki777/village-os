/**
 * The identity-key guard: platform defaults name no village.
 *
 * NO SHEBANG, and it has to stay that way. Every other guard in this directory
 * opens with `#!/usr/bin/env node`, and none of them is imported by a Vitest
 * test. This one is, by `shared/gameConfig.test.ts`, so it goes through Vite's
 * transform as well as node. A shebang and CRLF line endings TOGETHER make
 * that transform throw `SyntaxError: Invalid or unexpected token`; either one
 * alone is fine, which is why this ran green half a dozen times on a working
 * copy that still had LF and then failed the moment a checkout rewrote the
 * file with CRLF. Same carriage-return class that gave check-brand-refs a
 * different answer per machine (see scripts/check-brand-refs.test.mjs).
 *
 * Every caller runs it as `node scripts/check-identity-keys.mjs`, so the
 * shebang bought nothing. Its own test asserts the line is still absent.
 *
 * WHY THIS IS NOT THE BRAND GUARD. `scripts/check-brand-refs.mjs` matches
 * WORDS, and it exempts `shared/gameConfig.ts` by name because that file is
 * the declared identity home: a fork that correctly fills it with its own
 * village's name must not fail its own build. Both of those are right, and
 * together they leave a hole the size of the outage this guard exists to
 * prevent.
 *
 * Measured 2026-08-31 against the brand guard's own pattern
 * (/\b(amora|dominicalito|regencivics|amoracita)/i):
 *
 *     "Co-Become the Most Beautiful Village"                      no match
 *     "A regenerative village in Costa Rica where all beings
 *      belong and thrive."                                        no match
 *     "Dominicalito, Costa Rica"                                  match
 *
 * Two of the three strings that leaked one village's identity into every
 * fork's defaults contain no village name at all. No word-matching guard can
 * ever see them, however the pattern is extended, because there is no word to
 * extend it with. KEY PRESENCE is the property that survives: a slot is
 * empty, or it holds an approved platform-neutral value, or it holds
 * somebody's identity. That question is decidable without knowing a single
 * proper noun.
 *
 * ── THE KNOWN-PENDING LIST, AND WHY IT IS NOT ZERO YET ─────────────────────
 *
 * Five keys below are STILL POPULATED at main on purpose, and blanking them
 * today would repeat the original outage rather than fix it. The live
 * deployment reads its identity from these defaults and its database row was
 * never seeded, so for those five keys the platform default is the ONLY place
 * that village's values exist. The founder has to type them into the live
 * Admin screen FIRST. Deleting first deletes the value and the copy of it in
 * one move.
 *
 * So the guard ships ARMED with the five recorded, dated and printed on every
 * run. It is a ratchet, in the same discipline as
 * `scripts/image-budget-baseline.json` and `scripts/brand-refs-baseline.json`:
 *
 *   THE LIST MUST SHRINK TO ZERO once the founder has entered the values on
 *   the live Admin screen and they are confirmed present in the deployment's
 *   own record. Every entry removed is one key that can never quietly come
 *   back. When the last one goes, delete KNOWN_PENDING and PENDING_CEILING
 *   and leave the plain rule behind.
 *
 * The guard fails if the list grows, fails if a key outside the list is
 * populated, and fails if a listed key has been cleared but its entry is
 * still here. That last one is a red that means good news: delete the entry,
 * lower the ceiling by one, commit.
 *
 * ── FORKS ──────────────────────────────────────────────────────────────────
 *
 * This is an UPSTREAM guard. A fork's `shared/gameConfig.ts` is supposed to
 * carry that fork's own village name, and running this there would fail a
 * fork's build for doing the right thing, which is precisely the mistake this
 * repo already avoided by exempting the file from the brand guard. A fork
 * passes `--fork` (or sets VILLAGE_FORK=1) and gets the report with exit 0.
 *
 * Usage:
 *   node scripts/check-identity-keys.mjs           # the gate
 *   node scripts/check-identity-keys.mjs --json    # machine readable
 *   node scripts/check-identity-keys.mjs --fork    # a fork: report, never fail
 *
 * Read the exit code. The pending list prints on every run, pass or fail, so
 * it stays visible rather than becoming a silent allowance.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `new URL(...).pathname` with a drive-letter fixup. The
// hand-rolled form is what the older guards in this directory use and it
// leaves a checkout under a path containing a space reading `%20` as literal
// characters, so the guard looks for a file that is not there and reports the
// config as missing. The platform API handles the encoding and the drive
// letter both.
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const CONFIG_PATH = path.join(ROOT, "shared", "gameConfig.ts");

/**
 * The identity block: every string slot in GAME_CONFIG that answers "whose
 * village is this?". Fixed, because a derived list would shrink silently the
 * day somebody renames a key, and a guard that checks fewer things than it
 * did yesterday reports the same green either way.
 */
export const IDENTITY_KEYS = [
  "project.name",
  "project.tagline",
  "project.memberName",
  "project.catalystName",
  "project.location",
  "project.country",
  "project.fiatCurrency",
  "project.adminPath",
  "project.siteUrl",
  "project.eventsUrl",
  "project.contactEmail",
  "project.footerBlurb",
  "currency.name",
  "currency.nameLower",
  "currency.equity.symbol",
  "currency.equity.name",
  "currency.equity.address",
  "currency.voice.symbol",
  "currency.voice.name",
  "currency.voice.address",
  "images.hero",
  "images.investorHero",
  "images.residentHero",
  "images.stewardHero",
  "images.prosperityHero",
  "images.masterPlanHero",
  "images.logo",
  "images.heartLogo",
  "images.favicon",
];

/**
 * Values a key may hold while still belonging to nobody.
 *
 * These are the PLATFORM's own words, chosen to read as a blank a founder
 * should fill in. "Unnamed Village" is the shape of the whole idea: it is
 * what a template says when it has no name yet, and it is the string the live
 * site is currently showing because its record was never seeded. Anything not
 * listed here and not empty is somebody's identity, whoever they are.
 */
export const NEUTRAL = {
  "project.name": ["Unnamed Village"],
  "project.memberName": ["Village member", "Member"],
  // What a village calls whoever runs it. "Catalyst" is the platform's word
  // and names no village, the same standing as "Village member" above. A
  // village that says founder or steward puts that in its own record.
  "project.catalystName": ["Catalyst"],
  "project.adminPath": ["/admin"],
  // Retired from KNOWN_PENDING on 2026-08-31, in the order the list was built
  // for: the founder entered Amora's own tagline in the live Admin FIRST, so
  // the village holds its own copy, and only then did the default become a
  // neutral platform sentence. Doing it the other way round is what caused the
  // outage this guard exists because of.
  "project.tagline": ["healing the land and ourselves, together"],
  // Retired 2026-09-03, same ordering, same reason. The old default was
  // "A regenerative village in Costa Rica where all beings belong and
  // thrive.", so every village that never edited its footer told visitors it
  // was in Costa Rica. Confirmed first that the live village stores its own
  // footerBlurb in app_config.brand, so clearing the default here cannot
  // empty a rendered footer. `project.location` went the same day and needed
  // no entry: there is no neutral location, so its default is empty.
  "project.footerBlurb": ["A regenerative village where all beings belong and thrive."],
  "currency.name": ["Gratitude"],
  "currency.nameLower": ["gratitude"],
  "currency.equity.symbol": ["EQUITY"],
  "currency.equity.name": ["Village Equity"],
  "currency.voice.symbol": ["VOICE"],
  "currency.voice.name": ["Village Voice"],
};

/**
 * KNOWN-PENDING. Read the header before touching this. It only ever shrinks,
 * and every entry is a key whose value exists NOWHERE ELSE until the founder
 * has typed it into the live Admin screen.
 */
export const KNOWN_PENDING = [
  // project.country was here from 2026-08-31 and GRADUATED on 2026-09-02.
  // The reason it could go first, ahead of the other three, is that it was the
  // only one of the four with no reader: `defaultDisplayCurrency` takes it as
  // an argument and never looks at it, and nothing else in server/, shared/ or
  // client/src/ touches it. Blanking a key nothing renders cannot repeat the
  // outage, because there is no fallback anybody is standing on. The other
  // three all render somewhere, so they still wait on the founder.
  // project.location and project.footerBlurb were here too and GRADUATED
  // on 2026-09-03, on main, after reading the live village's own
  // app_config.brand and confirming it stores its own copy of both. That
  // is the ordering this guard exists to enforce, and it is the opposite
  // of country's reason above: those two DO render, so they had to wait
  // for the founder; country never rendered anywhere, so it did not.
  {
    key: "project.fiatCurrency",
    since: "2026-08-31",
    why: "prices render against it, so clearing it before the founder sets one changes displayed money",
  },
];

/**
 * 2026-08-31: five. 2026-09-02: three, when project.country graduated.
 * THIS NUMBER ONLY EVER FALLS.
 *
 * It has to equal KNOWN_PENDING.length, so adding an entry means editing a
 * number a line under the sentence forbidding it. That is the point: the list
 * cannot grow by accident, only by a deliberate edit that shows up in a diff
 * next to this comment.
 */
export const PENDING_CEILING = 1;

// ── Reading the config ──────────────────────────────────────────────────────

function readString(src, i) {
  const quote = src[i];
  let out = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      const next = src[j + 1];
      out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      j += 2;
      continue;
    }
    if (c === quote) return { value: out, end: j + 1 };
    out += c;
    j += 1;
  }
  return { value: out, end: j };
}

/** Skip a whole `[...]`, strings and nested brackets included. */
function skipArray(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") { j = readString(src, j).end; continue; }
    if (c === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j += 1; continue; }
    if (c === "/" && src[j + 1] === "*") { const e = src.indexOf("*/", j + 2); j = e < 0 ? src.length : e + 2; continue; }
    if (c === "[") depth += 1;
    if (c === "]") { depth -= 1; if (depth === 0) return j + 1; }
    j += 1;
  }
  return j;
}

/**
 * Every string-valued key in the GAME_CONFIG literal, flattened to dotted
 * paths. Text, not evaluation: this runs as plain node in CI with no
 * TypeScript toolchain, ahead of the build, and it must not need one.
 *
 * Arrays are skipped whole. Seasons, stages, paths and next actions are lists
 * of records, none of them an identity slot, and descending into them would
 * only invent dotted paths nobody can look up.
 *
 * The reading is cross-checked against the real typed object in
 * `shared/gameConfig.test.ts`, which imports GAME_CONFIG and compares every
 * key in IDENTITY_KEYS. A parser that quietly stopped finding a key would
 * otherwise report the same green as a clean config.
 */
export function parseConfigValues(src) {
  const anchor = src.indexOf("GAME_CONFIG");
  if (anchor < 0) return null;
  const open = src.indexOf("{", anchor);
  if (open < 0) return null;

  const out = {};
  const stack = [];
  let depth = 1;
  let key = null;
  let i = open + 1;

  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const { value, end } = readString(src, i);
      if (key !== null) { out[[...stack, key].join(".")] = value; key = null; }
      i = end;
      continue;
    }
    if (c === "{") { stack.push(key ?? "*"); key = null; depth += 1; i += 1; continue; }
    if (c === "}") { stack.pop(); key = null; depth -= 1; i += 1; continue; }
    if (c === "[") { i = skipArray(src, i); key = null; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k += 1;
      if (src[k] === ":") { key = src.slice(i, j); i = k + 1; continue; }
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

// ── The rules ───────────────────────────────────────────────────────────────

/** A key holds somebody's identity when it is neither empty nor approved. */
export function isViolation(key, value) {
  if (value === "") return false;
  return !(NEUTRAL[key] ?? []).includes(value);
}

/**
 * A key that HAS a declared neutral default and now holds nothing.
 *
 * THIS IS THE RULE THAT WOULD HAVE CAUGHT THE OUTAGE, and it was missing from
 * the first four. Those catch a village's identity being PUT INTO the
 * defaults. The act that actually took the live site down was the opposite
 * one: a value being TAKEN OUT of them, while the live deployment was still
 * reading its identity from there and its own record had never been seeded.
 *
 * `isViolation` returns false for "" by design, so every one of the first four
 * rules is silent on a blanking. The repair wave's proof lane replayed the
 * incident against those rules and reported it in one sentence: the state that
 * caused it is guarded, and the act that turned it into an outage is still
 * green.
 *
 * The check needs no new list to maintain, which is what makes it hold. Every
 * key in NEUTRAL is one somebody wrote an acceptable platform value for, and a
 * key is in there precisely because a village RENDERS it and the default is
 * the only fallback it has. So for those nine, empty is not a finished answer
 * the way a blank hero is. Empty is the removal of a fallback that a
 * deployment somewhere is standing on.
 *
 * Emptying one is still allowed. It just has to be said out loud, the same way
 * KNOWN_PENDING makes the reverse direction explicit.
 */
export function emptiedNeutralDefaults(values) {
  return Object.keys(NEUTRAL).filter(
    (k) => k in values && String(values[k]).trim() === "",
  );
}

/**
 * The five rules, over an already-parsed config. Pure, so the test can drive
 * it with values that do not exist on disk.
 */
export function auditIdentity(values, pending = KNOWN_PENDING, ceiling = PENDING_CEILING) {
  const pendingKeys = pending.map((p) => p.key);
  const missing = IDENTITY_KEYS.filter((k) => !(k in values));
  const populated = IDENTITY_KEYS.filter((k) => k in values && isViolation(k, values[k]));

  return {
    /** A key the parser could not find at all. The guard has gone blind. */
    missing,
    /** Somebody's identity in a slot nobody agreed to leave populated. */
    unexpected: populated.filter((k) => !pendingKeys.includes(k)),
    /** A pending entry whose key is now clean. Remove it, lower the ceiling. */
    stale: pendingKeys.filter((k) => !populated.includes(k)),
    /** The list grew, or it shrank without the ceiling following it down. */
    ceiling: pending.length === ceiling ? null : { listed: pending.length, ceiling },
    /** A neutral fallback somebody removed. The outage's actual shape. */
    emptied: emptiedNeutralDefaults(values),
    populated,
  };
}

// ── The gate ────────────────────────────────────────────────────────────────

function main(argv) {
  const fork = argv.includes("--fork") || process.env.VILLAGE_FORK === "1";

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`::error::shared/gameConfig.ts is not at ${CONFIG_PATH}. This guard reads the identity home by path; if the file moved, move this with it.`);
    return 1;
  }
  const values = parseConfigValues(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (values === null) {
    console.error("::error::could not find the GAME_CONFIG literal in shared/gameConfig.ts. The guard reads it as text; if the shape changed, this reading has to change with it rather than be left reporting green.");
    return 1;
  }

  const result = auditIdentity(values);

  console.log(`identity keys: ${IDENTITY_KEYS.length} checked, ${result.populated.length} populated, ${KNOWN_PENDING.length} known-pending (ceiling ${PENDING_CEILING})`);
  for (const p of KNOWN_PENDING) {
    console.log(`  PENDING  ${p.key}  (recorded ${p.since}) ${p.why}`);
  }
  console.log("  The pending list must reach zero once the founder has entered these on the live Admin screen. It only ever shrinks.");

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...result, keys: IDENTITY_KEYS.length, pending: KNOWN_PENDING.length, ceiling: PENDING_CEILING }));
  }

  const problems = [];
  for (const key of result.missing) {
    problems.push(`${key} is in IDENTITY_KEYS and was not found in GAME_CONFIG. Either the key was renamed, in which case rename it here too, or the reader broke. A guard that checks fewer keys than it did yesterday prints the same green as a clean config, so this is a failure rather than a note.`);
  }
  for (const key of result.unexpected) {
    problems.push(`${key} holds a value that is neither empty nor an approved platform-neutral one. Platform defaults belong to no village: every fork inherits this file, so a value here becomes thirteen villages' default. Put it in the deployment's own record through Admin, then clear it here. If it genuinely is a neutral platform default, add it to NEUTRAL with the reason.`);
  }
  for (const key of result.stale) {
    problems.push(`${key} is listed as known-pending and is now clean. Good news, and it needs the bookkeeping: delete its entry from KNOWN_PENDING and lower PENDING_CEILING to ${KNOWN_PENDING.length - 1}. A pending entry left behind is a standing permission for that key to be repopulated without anybody noticing.`);
  }
  for (const key of result.emptied) {
    problems.push(
      `${key} is empty, and it is a key with a declared neutral default (${(NEUTRAL[key] ?? []).map((v) => JSON.stringify(v)).join(" or ")}). ` +
        `THIS IS THE SHAPE OF THE 2026-08-31 OUTAGE. Emptying a default is not the same as never setting one: a village that renders this key and has no value of its own in its database was reading it from here, and clearing it takes that away with no error anywhere. ` +
        `If a live deployment holds its own copy already, restore the neutral value here and let the record win, which is how the overlay works. ` +
        `If the key genuinely should no longer exist, remove it from IDENTITY_KEYS and NEUTRAL together and say why in the same commit.`,
    );
  }
  if (result.ceiling) {
    const { listed, ceiling } = result.ceiling;
    problems.push(
      listed > ceiling
        ? `KNOWN_PENDING lists ${listed} key(s) and PENDING_CEILING is ${ceiling}. This list only ever shrinks. A key that has to stay populated is a decision to take with the founder, not a line to add here.`
        : `KNOWN_PENDING lists ${listed} key(s) and PENDING_CEILING is still ${ceiling}. Lower the ceiling to ${listed} so the ratchet holds at the number actually reached.`,
    );
  }

  // A fork gets every finding and none of the ::error:: markers. Annotating a
  // green build as failed teaches people to read past annotations, and a fork
  // carrying its own village's name here is doing the right thing.
  if (problems.length && fork) {
    console.log("\nnote: --fork, so these are reported and not failed. This gate is for the upstream platform, where the defaults belong to nobody. A fork's gameConfig.ts is its own identity home and is supposed to carry its village's name.");
    for (const p of problems) console.log(`  note: ${p}`);
    return 0;
  }
  for (const p of problems) console.error(`::error::${p}`);
  if (!problems.length) console.log("identity guard passed: every key outside the pending list is empty or platform-neutral.");
  return problems.length ? 1 : 0;
}

// Run as a gate only when invoked directly. Imported (by its own test, and by
// shared/gameConfig.test.ts) it is a library of rules with no side effects.
const invoked = process.argv[1] && path.resolve(process.argv[1]) === SELF;
if (invoked) process.exit(main(process.argv.slice(2)));
