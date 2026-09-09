/**
 * The powers registry, and the three ways it can rot (0098).
 *
 * The registry is what lets a member ask "who moderates here?" instead of an
 * admin asking "can Ana moderate?". It is half derived and half declared, and
 * every one of these tests exists to make the declared half fail loudly
 * rather than quietly.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  NOT_YET_WIRED,
  POWERS,
  powersForReading,
  undescribedPowers,
  WIRED_BUT_HELD_BACK,
} from "./capabilityRegistry";
import { ALL_CAPABILITIES, TRANSFERABLE, type Capability } from "../../shared/capabilities";
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";

/**
 * Every file that mounts routes, concatenated, not just the big one.
 *
 * This read `server/index.ts` alone. Route handlers are moving out into
 * `server/routes/<domain>.ts` modules, and the first three that moved took
 * their paths with them: the rot test below went red naming four routes as
 * "no longer mounted" when all four were mounted, one file over. Read the
 * whole set, so a route module joins by existing rather than by somebody
 * remembering to add it here.
 */
function routeSources(): string {
  const files = [path.join(process.cwd(), "server", "index.ts")];
  const dir = path.join(process.cwd(), "server", "routes");
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(dir);
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

const SERVER = routeSources();

/**
 * Everything that can GATE, which is a wider set than everything that can mount.
 *
 * Kept separate from routeSources() on purpose rather than widening it. That
 * one answers "is this path still mounted", and feeding it more text can only
 * make a missing path look present, so growing its input silently weakens it.
 * This one answers the opposite question and wants every file that could hold
 * a gate: `hasCapability` is called with a literal from server/index.ts, from
 * server/routes/, and from server/lib/orgChart.ts, and the third of those is
 * outside routeSources() altogether.
 */
function gateSources(): string {
  const files: string[] = [path.join(process.cwd(), "server", "index.ts")];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(path.join(process.cwd(), "server", "routes"));
  walk(path.join(process.cwd(), "server", "lib"));
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

const GATES = gateSources();

/**
 * EVERY CAPABILITY ANY GATE NAMES, discovered instead of asked about.
 *
 * MATCHES THE CALL, NOT THE KEY, which is the first half. `member.vouch`
 * appears three times in server/index.ts today inside lists of keys that two
 * proposal types REFUSE to move. Naming a key is not gating on it.
 *
 * THREE SPELLINGS, NOT ONE, which is the half this got wrong first time and
 * the governance lane caught. Measured here: 59 `hasCapability("<key>"`, 7
 * `mayAct(req, "<key>")`, and 2 `mayAct(req, STEWARD_VETO)` where the argument
 * is a CONSTANT. A pattern matching only the first missed nine gated routes.
 *
 * `scripts/generate-governance-doc.mjs` learned this before we did, and its
 * route classifier says so in almost these words: a pattern that matched only
 * the literal read four gated routes as ungated, "which is the one kind of
 * mistake this classifier is not allowed to make". Read it before changing
 * this. The polarity here is inverted and so is the damage: that classifier
 * called a gated route ungated, and this would call a WIRED key unwired, which
 * is a live gate sitting in a list promising it gates nothing. Of the two
 * directions this one fails green.
 *
 * THE FLOOR IS WHY THIS IS A SET AND NOT THREE REGEXES. A fourth helper, or a
 * refactor routing gates through a wrapper, silently shrinks what this can
 * see, and a shrunken set passes every assertion below by finding nothing.
 * So the count is checked against a floor. A legitimate drop means lowering a
 * number in a diff somebody reads, which is the whole trick the ratchets in
 * scripts/ use.
 */
const GATE_HELPERS = ["hasCapability", "mayAct"];

/**
 * `export const NAME: Capability = "key"`, so a constant argument resolves.
 * One exists today (STEWARD_VETO); the scan finds them rather than listing it.
 */
function capabilityAliases(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export const ([A-Z][A-Z0-9_]*)\s*:\s*Capability\s*=\s*"([a-z][\w.]*)"/g;
  const shared = fs.readFileSync(path.join(process.cwd(), "shared", "capabilities.ts"), "utf8");
  for (const src of [GATES, shared]) {
    for (const m of src.matchAll(re)) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * The first argument that is a capability, whether it is written or named.
 *
 * Both helpers put the key last: `hasCapability(cap, ctx)` and
 * `mayAct(req, cap)`. So an optional leading identifier is skipped and the
 * next thing is either a quoted key or a SHOUTING_CONSTANT to resolve.
 */
function gatedCapabilities(): Set<string> {
  const alias = capabilityAliases();
  const out = new Set<string>();
  // A regex LITERAL, so the pattern needs no string escaping and cannot be
  // quietly defanged by a lost backslash. `.source` splices it after the
  // helper's name.
  const TAIL = /\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?(?:"([a-z][\w.]*)"|([A-Z][A-Z0-9_]{2,}))/.source;
  for (const helper of GATE_HELPERS) {
    for (const m of GATES.matchAll(new RegExp(helper + TAIL, "g"))) {
      if (m[1]) out.add(m[1]);
      else if (m[2] && alias.has(m[2])) out.add(alias.get(m[2]) as string);
    }
  }
  return out;
}

const GATED = gatedCapabilities();

/**
 * The floor. 19 distinct keys were gated at c04307e across both helpers. It is
 * a floor and not an equality so that gating a new key needs no edit here,
 * and a REAL drop is a number somebody lowers on purpose.
 */
const GATED_FLOOR = 19;

describe("the powers registry", () => {
  it("describes every power that can move, in one list or the other", () => {
    // A transferable key with no entry anywhere is a power a village can be
    // handed and can never read about.
    expect(undescribedPowers()).toEqual([]);
  });

  it("names nothing that is not a capability", () => {
    for (const p of POWERS) {
      expect(ALL_CAPABILITIES, p.capability).toContain(p.capability);
    }
    for (const key of Object.keys(NOT_YET_WIRED)) {
      expect(ALL_CAPABILITIES, key).toContain(key as Capability);
    }
  });

  it("lists each power once", () => {
    const keys = POWERS.map((p) => p.capability);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every unwired power a reason, and never an empty one", () => {
    for (const [key, reason] of Object.entries(NOT_YET_WIRED)) {
      expect(reason.length, key).toBeGreaterThan(40);
    }
  });

  it("does not claim a power is unwired while also describing its routes", () => {
    for (const key of Object.keys(NOT_YET_WIRED)) {
      expect(POWERS.some((p) => p.capability === key), key).toBe(false);
    }
  });

  /*
   * THE CONTROL FOR THE TEST BELOW, and it has to come first.
   *
   * NOT_YET_WIRED is empty most days, and on those days the test below passes
   * by iterating nothing. A scanner that had quietly stopped scanning would
   * report the same green, which is the exact failure the registry exists to
   * prevent one level up. So the scan is proved on every run, whatever the
   * list holds.
   *
   * THE FLOOR IS THE HALF THAT CATCHES A NEW SPELLING. Naming two keys proves
   * the scan is alive; it does not prove it still sees everything. A fourth
   * gate helper, or a refactor putting gates behind a wrapper, shrinks this
   * set without emptying it, and a shrunken set passes every assertion by
   * finding less. A real drop is then a number somebody lowers in a diff.
   */
  it("still finds every gate, so the next test means something", () => {
    expect(GATED.has("event.rsvp"), "a hasCapability gate must be found").toBe(true);
    expect(GATED.has("steward.veto"), "a mayAct gate named by a CONSTANT must be found").toBe(true);
    expect(GATED.has("no.such.capability"), "an invented key must not appear").toBe(false);
    expect(
      GATED.size,
      `only ${GATED.size} gated capabilities found, floor is ${GATED_FLOOR}. Either gating moved behind a helper GATE_HELPERS does not name, or a capability constant stopped matching. Both make the test below pass by seeing less`,
    ).toBeGreaterThanOrEqual(GATED_FLOOR);
  });

  /*
   * NAMING A KEY IS NOT GATING ON IT, and this is the reason the test above
   * checks a constant.
   *
   * member.vouch appears three times in server/index.ts inside lists of keys
   * that badge_grant and power_transfer REFUSE to move. A substring search
   * reads those as evidence the key gates something, and would fail this file
   * for a key that gates nothing at all.
   */
  it("does not mistake a key being mentioned for a key being gated", () => {
    expect(GATES.includes('"member.vouch"'), "the fixture for this test: the key is mentioned").toBe(true);
    expect(GATED.has("member.vouch"), "and mentioning it is not gating on it").toBe(false);
  });

  /*
   * THE CLAIM NOTHING CHECKED, until 2026-09-09.
   *
   * An entry here says a key gates nothing. That was written true and there
   * was no reason it would stay true: member.vouch sat here from round 5
   * saying "the membrane's vouching step has not been built" while a lane
   * built it, and the day that route lands this file goes on saying the
   * opposite with every test green. Nothing goes wrong because of it, which is
   * why it survives.
   *
   * The header above NOT_YET_WIRED says a line comes out when the route lands.
   * That was a convention, and a convention is what failed. This is the same
   * sentence as an assertion.
   *
   * The forward direction is genuinely not checkable and the rot test below
   * says so: you cannot ask an Express app which routes a key gates. The
   * reverse direction is a scan. That asymmetry is the whole of this test.
   */
  it("names only keys that really gate nothing", () => {
    const wired = Object.keys(NOT_YET_WIRED).filter((k) => GATED.has(k));
    expect(
      wired,
      "this key is gated somewhere in server/**, so it is a power now and its line here is a sentence a village would read and be wrong about. Delete the entry and add the key to POWERS with the routes it gates",
    ).toEqual([]);
  });

  /*
   * THE ROT TEST. The route list is declared, because there is no mechanical
   * way to ask an Express app which routes a key gates: the check is a
   * function call inside a closure, often behind a named helper. What CAN be
   * checked is that every path named here still exists in the server, so a
   * rename or a deletion breaks this file instead of leaving a village
   * reading a sentence about a door that is no longer there.
   */
  it("names only paths the server still mounts", () => {
    const missing: string[] = [];
    for (const p of POWERS) {
      for (const route of p.routes) {
        if (!SERVER.includes(`"${route}"`)) missing.push(`${p.capability}: ${route}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives every power at least one route, or it belongs in the unwired list", () => {
    for (const p of POWERS) {
      expect(p.routes.length, p.capability).toBeGreaterThan(0);
    }
  });

  it("sources its sentences from CAPABILITY_CONSEQUENCE and never re-types them", () => {
    const read = powersForReading(new Map());
    for (const row of read) {
      expect(row.consequence).toBe(CAPABILITY_CONSEQUENCE[row.capability]);
    }
  });

  it("keeps a stable order that owes nothing to who holds what", () => {
    // R55, and this is the mechanical half of it. Sorting by held and unheld
    // draws a completion bar out of a plain list.
    const none = powersForReading(new Map()).map((p) => p.capability);
    const some = powersForReading(
      new Map([["story.tell", { roleId: "r", roleName: "R", movedAt: "now", byBallot: true }]]),
    ).map((p) => p.capability);
    expect(some).toEqual(none);
    expect(none).toEqual(POWERS.map((p) => p.capability));
  });

  it("says a power is unheld by saying nothing about a holder, never by a placeholder", () => {
    const read = powersForReading(new Map());
    expect(read.every((p) => p.heldBy === null)).toBe(true);
  });

  /*
   * The ceremony routes and the admin holding route all refuse a
   * non-transferable key with one written sentence, and that sentence names
   * two reasons: a personal act, or plumbing. A key that is WIRED and still
   * refused is a third thing, and answering it with either of the other two
   * is a fallback inventing a fact. These two tests keep the third list exact
   * in both directions, so a key that crosses takes its line out on the same
   * day and a key that stops crossing gains one.
   */
  it("gives a reason to every wired power the map still refuses", () => {
    const heldBack = POWERS.filter((p) => TRANSFERABLE[p.capability] !== true).map((p) => p.capability);
    expect(Object.keys(WIRED_BUT_HELD_BACK).sort()).toEqual([...heldBack].sort());
  });

  it("never explains a power that can already move", () => {
    for (const key of Object.keys(WIRED_BUT_HELD_BACK)) {
      expect(TRANSFERABLE[key as Capability], key).not.toBe(true);
      expect(WIRED_BUT_HELD_BACK[key].length, key).toBeGreaterThan(40);
    }
  });

  it("describes every power a real deployment could hand over today", () => {
    // The other direction of the coverage check: every key the map says can
    // move is one a founder will see in the handover panel, so every one of
    // them needs a title and a surface written for a person.
    const movable = ALL_CAPABILITIES.filter((c) => TRANSFERABLE[c] === true);
    for (const cap of movable) {
      const entry = POWERS.find((p) => p.capability === cap);
      if (!entry) {
        expect(Object.keys(NOT_YET_WIRED), cap).toContain(cap);
        continue;
      }
      expect(entry.title.length, cap).toBeGreaterThan(3);
      expect(entry.surface.length, cap).toBeGreaterThan(10);
    }
  });
});
