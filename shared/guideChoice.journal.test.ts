import { describe, expect, it } from "vitest";
import { journalGuide, resolveGuide, type GuideOption } from "./guideChoice";

const both: GuideOption[] = [
  { id: "village", name: "Maia", named: true, available: true },
  { id: "saberra", name: "Sera", named: true, available: true },
];

describe("the journal asks first", () => {
  it("keeps journal words with the village guide until the member chooses Sera", () => {
    const unchosen = resolveGuide(null, both);
    expect(unchosen.answering).toBe("saberra");
    const j = journalGuide(unchosen);
    expect(j.answering).toBe("village");
    expect(j.note).toContain("Your journal words only go to Sera when you do.");
    expect(j.canChoose).toBe(true);
  });

  it("lets Sera answer the journal once the member chose her", () => {
    expect(journalGuide(resolveGuide("saberra", both)).answering).toBe("saberra");
  });

  it("changes nothing for a member who chose the village guide, or when Sera is out of reach", () => {
    expect(journalGuide(resolveGuide("village", both)).answering).toBe("village");
    const noKey = resolveGuide(null, [{ ...both[0]!, available: false }, both[1]!]);
    expect(journalGuide(noKey)).toMatchObject({ answering: null });
    expect(journalGuide(noKey).note).toContain("once you choose to talk to Sera");
  });
});
