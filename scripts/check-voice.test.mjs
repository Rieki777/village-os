/**
 * The guard's own guard.
 *
 * check-voice.mjs skips `server/**\/*.test.ts` string literals (by design:
 * "Tests describe behaviour to developers; they are not shipped language")
 * and scans `docs/knowledge` but not the rest of `docs/` (also by design:
 * everything else under docs/ is for developers). Both are documented in the
 * script's own header. Neither is a secret, but neither was ever a TESTED
 * fact before this file: the CI step's one-line comment ("Shipped language
 * follows the house writing rules... parsed with the TypeScript compiler")
 * does not mention either carve-out, so "voice guard green" can read as
 * "no em-dash anywhere" to someone who has not read the script.
 * SEASON2_FLEET_LEDGER.md 7n independently found two server test files
 * carrying em dashes with the guard green: re-verified here as pinned,
 * durable assertions instead of a one-time observation:
 *   `server/hygiene.routes.e2e.test.ts` and `server/adminReach.e2e.test.ts`
 *   both still do, at time of writing.
 *
 * This exercises the pure rule-matcher (`checkSpan`) directly for the "prove
 * it goes red" requirement, and asserts the scope constants (`isTest`,
 * `SCAN_ROOTS`) so the two carve-outs are a tested contract, not prose that
 * can silently drift from what the code does.
 *
 * Run: node scripts/check-voice.test.mjs
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkSpan, isTest, SCAN_ROOTS, seatNounHits, SEAT_GATHERING_FILES, SEAT_EXEMPT_DIRS } from "./check-voice.mjs";

const SCRIPT = fileURLToPath(new URL("./check-voice.mjs", import.meta.url));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let run = 0;
const check = (name, fn) => { fn(); run += 1; console.log(`  PASS  ${name}`); };

console.log("\ncheck-voice: the rule matcher, and the boundary of what it scans\n");

// ── The rule matcher goes RED on real violations ────────────────────────────

check("catches an em-dash", () => {
  const hits = checkSpan("we do not just sustain — we heal");
  assert.ok(hits.some(([kind]) => kind === "em-dash"), JSON.stringify(hits));
});

check("catches an en-dash too", () => {
  const hits = checkSpan("open 9–5, every day");
  assert.ok(hits.some(([kind]) => kind === "em-dash"), JSON.stringify(hits));
});

check("catches an AI filler word as a whole word, not a substring", () => {
  assert.ok(checkSpan("a truly robust system").some(([kind]) => kind === "ai-word"));
  // "leverage" the word, not e.g. "leveraged" mid-token misses on purpose,
  // guard against the matcher becoming either too loose or silently broken.
  assert.ok(checkSpan("we leverage this").some(([kind]) => kind === "ai-word"));
});

check("catches contrast framing", () => {
  const hits = checkSpan("this is not just a garden, but a covenant");
  assert.ok(hits.some(([kind]) => kind === "contrast-frame"), JSON.stringify(hits));
});

check("catches passive-inspiration phrasing", () => {
  assert.ok(checkSpan("come along on this journey together").some(([kind]) => kind === "passive-inspiration"));
});

check("catches a rhetorical-question opener", () => {
  assert.ok(checkSpan("Have you ever wondered what a village could be?").some(([kind]) => kind === "rhetorical-opener"));
});

// ── The rule matcher stays GREEN on ordinary prose ──────────────────────────

check("leaves plain prose alone", () => {
  assert.deepStrictEqual(checkSpan("The garden opens at nine and closes at five."), []);
});

check("hyphens are fine, only em/en dashes trip rule 1", () => {
  assert.deepStrictEqual(checkSpan("a well-being check and decision-making time"), []);
});

// ── Rule 6: a role is a role (Rye, 2026-10-21) ──────────────────────────────
// Literals arrive here as the voice guard reads them: quotes and all.

const seatFlags = (s) => seatNounHits(s).length > 0;

check("seat rule: flags the noun for a role", () => {
  for (const s of [
    '"Apply for a seat"',
    '"Decline the steward\'s seat"',
    '"Who has held this seat"',
    '"Choose the seats you keep, hand back or apply for"',
    '"a seat you would hold this season"',
    '"A power entrusted to a seat nobody sits in"',
    "} seat${",
    "Nobody holds a seat here yet.",
  ]) assert.ok(seatFlags(s), `should flag: ${s}`);
});

check("seat rule: the verb stays (Rye: \"You can use 'seat someone' for that verb\")", () => {
  for (const s of [
    '"Seat someone in a role"',
    '"Ask the village to seat a member in one of its roles"',
    '"You hold the power that seats people."',
    '"Could not seat them"',
    '"The people who seat roles read your offer"',
    '"seat software agents in the village\'s roles, and take them out again"',
    '"Seat and unseat the holders of the village\'s roles"',
    '"Everybody named has declined, so this vote seats nobody and the role starts empty."',
    '"nobody was seated"',
    "Seat",
  ]) assert.ok(!seatFlags(s), `should pass: ${s} -> ${JSON.stringify(seatNounHits(s))}`);
});

check("seat rule: a chair at a gathering is a seat", () => {
  for (const s of [
    '"Save me a seat"',
    '"Your seat at {{gathering.title}} is saved."',
    '"A seat fee is a whole number, or zero for free"',
    '"We\'ll write the moment a seat opens."',
    '"A seat opened at {{gathering.title}}"',
    '"Fees, donations, deposits, waitlist seats"',
  ]) assert.ok(!seatFlags(s), `should pass: ${s}`);
  // A sentence that names a gathering does not excuse a role seat beside it.
  assert.ok(seatFlags('"Say hello at the gathering, and ask the people who hold seats now"'));
  assert.ok(SEAT_GATHERING_FILES.some((re) => re.test("client/src/components/calendar/CommunityCalendarCard.tsx")));
  assert.ok(SEAT_GATHERING_FILES.some((re) => re.test("server/lib/comms/cantMakeIt.ts")));
  assert.ok(!SEAT_GATHERING_FILES.some((re) => re.test("client/src/pages/Roles.tsx")));
});

check("seat rule: ids, keys, class names and SQL are machinery", () => {
  for (const s of [
    '"org.seat"',
    '"seats"',
    "`/seat-applications/${",
    "`sheet-night seat-card-foil relative w-full rounded-[20px] ${",
    '"SELECT seat_price, seat_token FROM events WHERE id = ?"',
    '"id, circle_id, name, aim, domain, seats, criticality, active"',
    "`seats: [${",
    '"re-seats it each season"',
    '"seats - holderCount"',
  ]) assert.ok(!seatFlags(s), `should pass: ${s}`);
  assert.ok(SEAT_EXEMPT_DIRS.some((re) => re.test("shared/__fixtures__/regen-village-riverbend.json")));
});

// ── The two carve-outs, as tested facts rather than prose ───────────────────

check("isTest excludes .test.ts and .e2e.test.ts files", () => {
  assert.strictEqual(isTest("server/hygiene.routes.e2e.test.ts"), true);
  assert.strictEqual(isTest("server/adminReach.e2e.test.ts"), true);
  assert.strictEqual(isTest("client/src/lib/sound.test.ts"), true);
  assert.strictEqual(isTest("server/index.ts"), false);
  assert.strictEqual(isTest("client/src/pages/Home.tsx"), false);
});

check("isTest excludes anything under __tests__/", () => {
  assert.strictEqual(isTest("server/__tests__/whatever.ts"), true);
});

check("SCAN_ROOTS covers docs/knowledge only, not the rest of docs/", () => {
  assert.deepStrictEqual(SCAN_ROOTS, ["client/src", "server", "shared", "docs/knowledge"]);
  assert.ok(!SCAN_ROOTS.includes("docs"), "docs/ at large must not be a default scan root");
});

// ── "0 violations" must never read the same as "the walk did not run" ──────

check("a scan root that resolves to nothing is a hard failure, not a clean pass", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "this-path-does-not-exist-anywhere"], { encoding: "utf8" });
  assert.notStrictEqual(r.status, 0, `expected a non-zero exit, got ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr + r.stdout, /found ZERO files/, "must say WHY it refused, not print a silent pass");
  assert.doesNotMatch(r.stderr + r.stdout, /clean across/, "a zero-file run must never use the clean-pass wording");
});

// ── Re-verification against THIS repo's real files, not a fixture ──────────
// Proves the ledger's specific finding still holds today: an em-dash in a
// server test file's string literal is real, detectable BY THE MATCHER, and
// still invisible to the shipped guard's default run purely because of the
// isTest() exclusion, never because the pattern itself is too weak to see.

for (const rel of ["server/hygiene.routes.e2e.test.ts", "server/adminReach.e2e.test.ts"]) {
  check(`${rel} carries a real em-dash the matcher CAN see and isTest() excludes`, () => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.log(`    (skipped: ${rel} no longer exists)`);
      return;
    }
    const text = fs.readFileSync(abs, "utf8");
    const hasEmDash = text.split("\n").some((line) => checkSpan(line).some(([kind]) => kind === "em-dash"));
    assert.ok(hasEmDash, `expected an em-dash in ${rel}; if this now fails because the file was fixed, that is good news, update this fixture`);
    assert.strictEqual(isTest(rel), true, "and isTest() is exactly why the shipped guard never reports it");
  });
}

console.log(`\n${run} check(s) passed\n`);
