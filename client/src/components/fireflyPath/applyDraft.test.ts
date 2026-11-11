/**
 * THE APPLICATION'S SAVED DRAFT: what it keeps, what it never keeps, and how
 * long it lasts (components/fireflyPath/applyDraft.ts).
 */
import { describe, expect, it } from "vitest";
import { DRAFT_DAYS, draftKey, fromDraft, toDraft } from "./applyDraft";

const NOW = new Date("2026-11-11T20:00:00Z");
const STATE = {
  step: 2,
  reached: 3,
  knowUs: ["Visit the land"],
  why: "Because the land asks.",
  name: "Rowan",
  email: "rowan@example.test",
  about: { based: "Uvita", languages: "Spanish", story: "" },
  selfKnowledge: "Projector",
  links: [{ label: "Work", url: "https://example.org" }],
  aim: "Books kept true.",
  items: [{ title: "A model", doneWhen: "it runs", moves: "", serves: "g-1", date: "", roleId: "r1" }],
  marks: { aim: "Books kept true." },
  terms: { answers: {}, commitmentPct: 50 },
  rampUp: true,
  practical: { timeZone: "America/Costa_Rica", windows: ["weekday-mornings"], earliestStart: "2026-12-01" },
};

describe("the saved draft", () => {
  it("keeps the applicant's own words and the step, and reads back what it wrote", () => {
    const back = fromDraft(JSON.parse(JSON.stringify(toDraft(STATE, NOW))), NOW, 5);
    expect(back).toMatchObject({ ...STATE, savedAt: NOW.toISOString() });
  });

  it("never holds references, the consent, files or the agreements, whatever the page hands it", () => {
    const loaded = { ...STATE, about: { ...STATE.about, references: [{ name: "Ines", how: "fence", contact: "ines@example.org" }], consent: true }, files: ["portfolio.pdf"], agreed: { nda: true } } as any;
    const written = JSON.stringify(toDraft(loaded, NOW));
    for (const never of ["Ines", "ines@example.org", "consent", "portfolio.pdf", "references", "agreed", "nda"]) expect(written).not.toContain(never);
  });

  it("is one per role and per personal link", () => {
    expect(draftKey("r1", "")).not.toBe(draftKey("r2", ""));
    expect(draftKey("r1", "")).not.toBe(draftKey("r1", "tok"));
  });

  it("an old, broken or foreign draft is no draft, and a step out of range is held to the steps", () => {
    const old = new Date(NOW.getTime() - (DRAFT_DAYS + 1) * 24 * 60 * 60_000);
    expect(fromDraft(toDraft(STATE, old), NOW, 5)).toBeNull();
    for (const bad of [null, "text", [], { savedAt: "not a date" }]) expect(fromDraft(bad, NOW, 5)).toBeNull();
    expect(fromDraft({ ...toDraft(STATE, NOW), step: 99, reached: -4 }, NOW, 5)).toMatchObject({ step: 5, reached: 5 });
    expect(fromDraft({ ...toDraft(STATE, NOW), terms: { answers: [], commitmentPct: 7.5 } }, NOW, 5)?.terms).toEqual({ answers: {}, commitmentPct: null });
  });
});
