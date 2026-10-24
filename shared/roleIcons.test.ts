/**
 * The role tile's icon: the keyword map in shared/roleIcons.ts, read name
 * first, then domain, then the star.
 */
import { describe, expect, it } from "vitest";
import { ROLE_ICONS, ROLE_ICON_KEYWORDS, roleIcon } from "./roleIcons";

describe("roleIcon", () => {
  it("gives the design's three roles the design's three icons", () => {
    expect(roleIcon("Human Operations & Onboarding Lead Steward")).toBe("door");
    expect(roleIcon("Front-End & Game Platform Steward")).toBe("screen");
    expect(roleIcon("Organizational Design & Governance Facilitator")).toBe("circles");
  });

  it("reads the name before the domain, and the domain only when the name says nothing", () => {
    expect(roleIcon("Front-End & Game Platform Steward", "how a newcomer's way in works")).toBe("screen");
    expect(roleIcon("Keeper of the Fourth Thing", "The village treasury and its budget.")).toBe("coins");
    expect(roleIcon("Keeper", null)).toBe("star");
    expect(roleIcon("", "")).toBe("star");
  });

  it("matches whole words, or word starts where a keyword ends in a star", () => {
    // "app" is not found inside "applicant".
    expect(roleIcon("Keeper", "Every applicant answered.")).toBe("star");
    expect(roleIcon("Garden Steward")).toBe("sprout");
    expect(roleIcon("Facilitator")).toBe("circles");
    expect(roleIcon("Workshops Host")).toBe("door");
    expect(roleIcon("Back-End Operations")).toBe("gear");
    expect(roleIcon("Story and Media")).toBe("speech");
    expect(roleIcon("Healing Circle Keeper")).toBe("circles");
    expect(roleIcon("Healing Keeper")).toBe("heart");
    expect(roleIcon("Learning Steward")).toBe("book");
    expect(roleIcon("Building Crew Lead")).toBe("house");
  });

  it("maps every icon but the star, and nothing else", () => {
    expect(ROLE_ICON_KEYWORDS.map(([icon]) => icon)).toEqual(ROLE_ICONS.filter((i) => i !== "star"));
  });
});
