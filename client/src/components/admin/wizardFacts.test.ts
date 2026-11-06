import { describe, expect, it } from "vitest";
import { SETUP_CONTENT_EDITORS } from "./setupProgress";
import { PAGE_OFF_HINT, contentEditorHint } from "./wizardFacts";

describe("the wizard's content step, said honestly for a village with its brochure pages off", () => {
  const brochure = SETUP_CONTENT_EDITORS.filter((c) => c.brochure);
  const own = SETUP_CONTENT_EDITORS.filter((c) => !c.brochure);

  it("marks the five editors whose words only show on a brochure page", () => {
    expect(brochure.map((c) => c.tab).sort()).toEqual(["faqs", "investor-summary", "milestones", "team", "visit-config"]);
  });

  it("says nobody sees them yet while the pages are off, and nothing changes while they are on", () => {
    for (const c of brochure) {
      expect(contentEditorHint(c, false)).toBe(PAGE_OFF_HINT);
      expect(contentEditorHint(c, true)).toBe(c.hint);
      expect(contentEditorHint(c, null), "still loading reads as unknown").toBe(c.hint);
    }
    for (const c of own) expect(contentEditorHint(c, false)).toBe(c.hint);
  });
});
