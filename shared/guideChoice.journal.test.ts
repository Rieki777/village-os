import { describe, expect, it } from "vitest";
import { JOURNAL_ON_SERA, journalGuide, resolveGuide, type GuideOption } from "./guideChoice";

const both: GuideOption[] = [
  { id: "village", name: "Maia", named: true, available: true },
  { id: "saberra", name: "Sera", named: true, available: true },
];

describe("the journal stays village-only (the coordinator's ruling (c), pending Rye)", () => {
  it("ships with the journal off Sera's road", () => {
    expect(JOURNAL_ON_SERA).toBe(false);
  });

  it("answers with the village guide whatever the member chose, offers no switch, and says why", () => {
    for (const choice of [null, "saberra", "village"] as const) {
      const j = journalGuide(resolveGuide(choice, both));
      expect(j.answering, String(choice)).toBe("village");
      expect(j.canChoose).toBe(false);
      expect(j.note).toBe("Your journal stays in the village. Maia answers here, and your journal words never go to Sera.");
    }
  });

  it("rests, and says so, when only Sera could answer", () => {
    const j = journalGuide(resolveGuide("saberra", [{ ...both[0]!, available: false }, both[1]!]));
    expect(j.answering).toBeNull();
    expect(j.note).toContain("so Sera does not answer here");
  });

  it("says nothing about Sera in a village without her", () => {
    expect(journalGuide(resolveGuide(null, [both[0]!])).note).toBeNull();
  });
});

describe("when turned on, the journal asks first (ruling (a))", () => {
  it("keeps journal words with the village guide until the member chooses Sera", () => {
    const j = journalGuide(resolveGuide(null, both), true);
    expect(j.answering).toBe("village");
    expect(j.note).toContain("Your journal words only go to Sera when you do.");
    expect(j.canChoose).toBe(true);
  });

  it("lets Sera answer once the member chose her, and the choice is one tap to undo", () => {
    const j = journalGuide(resolveGuide("saberra", both), true);
    expect(j.answering).toBe("saberra");
    expect(j.canChoose).toBe(true);
  });
});
