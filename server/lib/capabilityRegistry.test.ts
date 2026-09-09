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
 * Whether anything anywhere gates on this key.
 *
 * MATCHES THE CALL, NOT THE KEY. `member.vouch` appears in server/index.ts
 * three times today, in lists of keys two proposal types REFUSE to move, and a
 * plain substring search would read those as evidence the key gates something.
 * Naming a key is not gating on it. The call is.
 *
 * One spelling covers it: every literal gate in the server is
 * `hasCapability("<key>", ctx)`, 74 of them at the time of writing, with no
 * wrapper taking a literal. If a second spelling ever appears, the control
 * below fails rather than this returning a quiet false.
 */
function isGatedOn(key: string): boolean {
  return new RegExp(String.raw`hasCapability\(\s*["'\`]` + key.replace(/\./g, String.raw`\.`)).test(GATES);
}

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
   * by iterating nothing. A matcher that had quietly stopped matching would
   * report the same green, which is the exact failure the registry exists to
   * prevent one level up. So the matcher is proved against a key that is
   * definitely gated, every run, whatever the list holds.
   */
  it("can tell a gated key from an ungated one, so the next test means something", () => {
    expect(isGatedOn("event.rsvp"), "a key gated in server/index.ts must match").toBe(true);
    expect(isGatedOn("forum.post"), "a second, to catch a one-off").toBe(true);
    expect(isGatedOn("no.such.capability"), "an invented key must not match").toBe(false);
  });

  /*
   * THE CLAIM NOTHING CHECKED, until 2026-09-09.
   *
   * An entry here says a key gates nothing. That was written true and there
   * was no reason it would stay true: `member.vouch` sat here from round 5
   * saying "the membrane's vouching step has not been built" while a lane
   * built it, and the day the route landed this file went on saying the
   * opposite with every test green. Nothing would ever have gone wrong because
   * of it, which is what made it survive.
   *
   * The header above NOT_YET_WIRED says a line comes out when the route lands.
   * That was a convention, and a convention is what failed. This is the same
   * sentence as an assertion.
   *
   * The forward direction is genuinely not checkable and the rot test above
   * says so: you cannot ask an Express app which routes a key gates. The
   * REVERSE direction is a grep. That asymmetry is the whole of this test.
   */
  it("names only keys that really gate nothing", () => {
    const wired = Object.keys(NOT_YET_WIRED).filter(isGatedOn);
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
