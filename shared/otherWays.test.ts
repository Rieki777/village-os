/**
 * QA2-07: the two "Other ways to join" tiles on /roles are village words with
 * the lead's defaults, and their links can only ever be a page of this site or
 * an https address.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_OTHER_WAYS, GIFTS_HREF, OTHER_WAYS_DEFAULTS, OTHER_WAYS_KEYS, SEEDER_FALLBACK_HREF, otherWaysFrom, otherWaysOf } from "./otherWays";
import { VARIABLES_BY_KEY } from "./gameVariables";

describe("the other ways to join", () => {
  it("defaults to the lead's words, the resident page and the work-with-us door", () => {
    expect(DEFAULT_OTHER_WAYS).toEqual({
      seeder: { title: "Become a Founding Seeder", line: "Live here one day? Start on the resident path.", href: "/resident" },
      gifts: { title: "Offer your gifts", line: "Volunteer or work-trade: tell us what you would like to give.", href: "/work-with-us" },
    });
    expect(SEEDER_FALLBACK_HREF).toBe("/resident");
    expect(GIFTS_HREF).toBe("/work-with-us");
  });

  it("registers each word as a village setting whose default is the lead's word", () => {
    for (const [field, key] of Object.entries(OTHER_WAYS_KEYS)) {
      expect(VARIABLES_BY_KEY[key]?.default, key).toBe(OTHER_WAYS_DEFAULTS[field as keyof typeof OTHER_WAYS_DEFAULTS]);
      expect(VARIABLES_BY_KEY[key]?.category, key).toBe("The founding team");
    }
  });

  it("takes the village's own words, and the way to stay close as the resident tile's link", () => {
    const words: Record<string, string> = {
      [OTHER_WAYS_KEYS.seederTitle]: "Join the Friends",
      [OTHER_WAYS_KEYS.giftsLine]: "Come and help on Saturdays.",
      "org.stay_close_link": "/friends",
    };
    const ways = otherWaysFrom((k) => words[k] ?? "");
    expect(ways.seeder).toEqual({ title: "Join the Friends", line: OTHER_WAYS_DEFAULTS.seederLine, href: "/friends" });
    expect(ways.gifts).toEqual({ title: OTHER_WAYS_DEFAULTS.giftsTitle, line: "Come and help on Saturdays.", href: "/work-with-us" });
  });

  it("never links anywhere but this site or an https address", () => {
    for (const bad of ["//evil.example", "javascript:alert(1)", "http://plain.example", "  "]) {
      expect(otherWaysFrom((k) => (k === "org.stay_close_link" ? bad : "")).seeder.href, bad).toBe("/resident");
    }
    expect(otherWaysFrom((k) => (k === "org.stay_close_link" ? "https://friends.example/join" : "")).seeder.href).toBe("https://friends.example/join");
    expect(otherWaysOf({ seeder: { href: "//evil.example" }, gifts: { href: "javascript:x" } })).toEqual(DEFAULT_OTHER_WAYS);
  });

  it("reads an answer back safely, whatever arrives", () => {
    expect(otherWaysOf(undefined)).toEqual(DEFAULT_OTHER_WAYS);
    expect(otherWaysOf({ seeder: { title: 7, line: "  " } })).toEqual(DEFAULT_OTHER_WAYS);
    expect(otherWaysOf({ gifts: { title: "Give a day", href: "/work-with-us" } }).gifts.title).toBe("Give a day");
  });
});
