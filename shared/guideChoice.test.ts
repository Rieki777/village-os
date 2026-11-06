/**
 * Who a member talks to (Rye, 2026-10-24): the village's own guide or the
 * outside governance service's agent. The member's choice wins when that
 * guide can answer; otherwise the other answers and the page says so; with no
 * choice the outside agent goes first; and nothing answers when neither can.
 */
import { describe, expect, it } from "vitest";
import { GUIDE_WORDS, parseGuideId, resolveGuide, type GuideOption } from "./guideChoice";

const both = (village: boolean, saberra: boolean): GuideOption[] => [
  { id: "village", name: "Maia", named: true, available: village },
  { id: "saberra", name: "Sera", named: true, available: saberra },
];

describe("reading a stored choice", () => {
  it("knows the two guides and nothing else", () => {
    expect(parseGuideId("village")).toBe("village");
    expect(parseGuideId("saberra")).toBe("saberra");
    expect(parseGuideId("Maia")).toBeNull();
    expect(parseGuideId("")).toBeNull();
    expect(parseGuideId(null)).toBeNull();
    expect(parseGuideId(1)).toBeNull();
  });
});

describe("who answers", () => {
  it("answers as the member chose when that guide can answer", () => {
    const s = resolveGuide("village", both(true, true));
    expect(s.answering).toBe("village");
    expect(s.note).toBeNull();
    expect(s.canChoose).toBe(true);
  });

  it("falls back to the other guide, and says so, when the chosen one cannot answer", () => {
    const s = resolveGuide("saberra", both(true, false));
    expect(s.answering).toBe("village");
    expect(s.note).toBe(GUIDE_WORDS.fellBack("Sera", "Maia"));
    expect(s.canChoose).toBe(false);
  });

  it("starts with the outside agent for a member who never chose", () => {
    expect(resolveGuide(null, both(true, true)).answering).toBe("saberra");
    expect(resolveGuide(null, both(true, true)).note).toBeNull();
  });

  it("uses the village guide for a member who never chose while the agent is unreachable, with no note", () => {
    const s = resolveGuide(null, both(true, false));
    expect(s.answering).toBe("village");
    expect(s.note).toBeNull();
  });

  it("answers with nobody when neither guide can, so no page draws a button", () => {
    const s = resolveGuide("village", both(false, false));
    expect(s.answering).toBeNull();
    expect(s.note).toBeNull();
    expect(s.canChoose).toBe(false);
  });

  it("offers the choice only when both guides can answer", () => {
    expect(resolveGuide(null, both(true, false)).canChoose).toBe(false);
    expect(resolveGuide(null, both(false, true)).canChoose).toBe(false);
    expect(resolveGuide(null, both(true, true)).canChoose).toBe(true);
  });
});
