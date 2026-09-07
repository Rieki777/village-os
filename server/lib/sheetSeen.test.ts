/**
 * The surface-once rule, pinned. The cap is the part that matters: without it
 * a section somebody has no interest in sits at the top of their profile
 * forever, which is a nag wearing a feature's clothes.
 */
import { describe, expect, it } from "vitest";

import { MAX_SIGHTINGS, noteSeen, readSeen, settled } from "./sheetSeen";

describe("readSeen", () => {
  it("reads an empty map out of a member who has met nothing", () => {
    expect(readSeen(undefined)).toEqual({});
    expect(readSeen(null)).toEqual({});
    expect(readSeen({})).toEqual({});
    expect(readSeen({ notify: { email: true } })).toEqual({});
  });

  it("reads the counts a member has actually accumulated", () => {
    expect(readSeen({ sheetSeen: { ventures: 2, seats: 1 } })).toEqual({ ventures: 2, seats: 1 });
  });

  it("drops junk rather than trusting it, because prefs is a shared blob", () => {
    const got = readSeen({ sheetSeen: { ok: 1, bad: "yes", worse: {}, "": 2, ["x".repeat(70)]: 1 } });
    expect(got).toEqual({ ok: 1 });
  });

  it("clamps a count that somehow got above the cap or below zero", () => {
    expect(readSeen({ sheetSeen: { a: 99, b: -4 } })).toEqual({ a: MAX_SIGHTINGS, b: 0 });
  });

  it("is not fooled by an array, which JSON columns happily hold", () => {
    expect(readSeen({ sheetSeen: ["ventures"] })).toEqual({});
  });
});

describe("noteSeen", () => {
  it("counts a sighting", () => {
    expect(noteSeen({}, ["ventures"])).toEqual({ ventures: 1 });
    expect(noteSeen({ ventures: 1 }, ["ventures"])).toEqual({ ventures: 2 });
  });

  it("STOPS AT THE CAP, which is what keeps this from being a nag", () => {
    let seen = {};
    for (let i = 0; i < 10; i++) seen = noteSeen(seen, ["ventures"]);
    expect(seen).toEqual({ ventures: MAX_SIGHTINGS });
  });

  it("jumps to the cap when a member actually used the section", () => {
    // Shown once and then used: it has served its purpose and must not return.
    expect(noteSeen({ ventures: 1 }, ["ventures"], true)).toEqual({ ventures: MAX_SIGHTINGS });
  });

  it("leaves every other section alone", () => {
    expect(noteSeen({ seats: 2 }, ["ventures"])).toEqual({ seats: 2, ventures: 1 });
  });

  it("ignores ids that are not ids", () => {
    expect(noteSeen({}, ["", "x".repeat(70)] as string[])).toEqual({});
  });

  it("does not mutate what it was given", () => {
    const before = { ventures: 1 };
    noteSeen(before, ["ventures"]);
    expect(before).toEqual({ ventures: 1 });
  });
});

describe("settled", () => {
  it("is false until the cap and true at it", () => {
    expect(settled({}, "ventures")).toBe(false);
    expect(settled({ ventures: MAX_SIGHTINGS - 1 }, "ventures")).toBe(false);
    expect(settled({ ventures: MAX_SIGHTINGS }, "ventures")).toBe(true);
  });

  it("treats a section nobody has ever seen as unsettled, not as settled", () => {
    // The failure that would matter: a brand new section reading as already
    // met, so a member never gets shown the thing they just unlocked.
    expect(settled({ other: MAX_SIGHTINGS }, "ventures")).toBe(false);
  });
});
