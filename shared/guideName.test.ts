/**
 * The village guide's name, by who is reading (Rye, 2026-10-22): a village's
 * own name when it has one, and otherwise "your village guide" to a founder
 * or admin and "the village guide" to members and the public. Never hidden,
 * and never another village's name.
 */
import { describe, expect, it } from "vitest";
import {
  UNNAMED_GUIDE,
  fillGuideName,
  guideAudience,
  guideName,
  guideNameAtSentenceStart,
  guidePromptName,
  type GuideAudience,
} from "./guideName";

const AUDIENCES: GuideAudience[] = ["founder", "admin", "member", "public"];

describe("a village that named its guide", () => {
  it("reads the same name to every audience", () => {
    for (const audience of AUDIENCES) {
      expect(guideName("Juniper", audience), audience).toEqual({ name: "Juniper", named: true });
    }
  });

  it("drops the spaces around a typed name and keeps its spelling", () => {
    expect(guideName("  bee  ", "member")).toEqual({ name: "bee", named: true });
  });
});

describe("a village that has not named its guide", () => {
  it("says 'your village guide' to the people who can name it", () => {
    expect(guideName("", "founder")).toEqual({ name: "your village guide", named: false });
    expect(guideName("", "admin")).toEqual({ name: "your village guide", named: false });
  });

  it("says 'the village guide' to members and the public", () => {
    expect(guideName("", "member")).toEqual({ name: "the village guide", named: false });
    expect(guideName("", "public")).toEqual({ name: "the village guide", named: false });
  });

  it("treats a missing, blank or non-text name as unnamed, and never fills in a name of its own", () => {
    for (const source of [undefined, null, "", "   ", 7, {}, ["Juniper"]]) {
      const got = guideName(source, "public");
      expect(got, JSON.stringify(source)).toEqual({ name: UNNAMED_GUIDE.shared, named: false });
      expect(got.name).not.toMatch(/Maia/);
    }
  });
});

describe("who is reading", () => {
  it("is the public when nobody is signed in", () => {
    expect(guideAudience(null)).toBe("public");
    expect(guideAudience(undefined)).toBe("public");
  });

  it("follows the account's role, and any other signed-in person is a member", () => {
    expect(guideAudience({ role: "founder" })).toBe("founder");
    expect(guideAudience({ role: "admin" })).toBe("admin");
    expect(guideAudience({ role: "member" })).toBe("member");
    expect(guideAudience({})).toBe("member");
    expect(guideAudience({ role: null })).toBe("member");
  });
});

describe("the name at the start of a sentence", () => {
  it("raises the neutral label's first letter", () => {
    expect(guideNameAtSentenceStart(UNNAMED_GUIDE.shared)).toBe("The village guide");
    expect(guideNameAtSentenceStart(UNNAMED_GUIDE.own)).toBe("Your village guide");
  });

  it("leaves a capitalised name as the village typed it", () => {
    expect(guideNameAtSentenceStart("Juniper")).toBe("Juniper");
    expect(guideNameAtSentenceStart("")).toBe("");
  });
});

describe("the village's own greeting", () => {
  it("fills {name} mid-sentence as it is", () => {
    expect(fillGuideName("Hi, I'm {name}. What are you dreaming of bringing?", "the village guide")).toBe(
      "Hi, I'm the village guide. What are you dreaming of bringing?",
    );
  });

  it("raises {name} where it opens the greeting or a sentence", () => {
    expect(fillGuideName("{name} here. Ask {name} anything. {name} listens.", "the village guide")).toBe(
      "The village guide here. Ask the village guide anything. The village guide listens.",
    );
  });

  it("reads the platform's default greeting cleanly while the guide is unnamed", () => {
    const greeting = "Hi, I'm {name}. I help people shape their offering to the village. There's no wrong way to start. What are you dreaming of bringing?";
    expect(fillGuideName(greeting, guideName("", "public").name)).toMatch(/^Hi, I'm the village guide\. I help people/);
  });
});

describe("the name a system prompt gives the guide", () => {
  it("is the village's own name, or the reader-neutral label", () => {
    expect(guidePromptName("Juniper")).toBe("Juniper");
    expect(guidePromptName("")).toBe("the village guide");
    expect(`You are ${guidePromptName(undefined)}, the launch guide`).toBe("You are the village guide, the launch guide");
  });
});
