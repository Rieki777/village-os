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
import { liveConsequence } from "./capabilityConsequence";

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
      // One power adds the live number its sentence depends on (comms.manage, the months mail is kept).
      expect(row.consequence).toBe(liveConsequence(row.capability));
      expect(row.consequence.startsWith(CAPABILITY_CONSEQUENCE[row.capability])).toBe(true);
    }
    const comms = read.find((r) => r.capability === "comms.manage");
    expect(comms?.consequence).toMatch(/kept \d+ months? as the village is set now$/);
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
