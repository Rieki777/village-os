/**
 * THE APPLICANT'S OWN ROLE CARD (Rye, 9 Nov 2026): "The finance card is the
 * organisation's lens on what it needs from a person. My role application
 * card shows what it looks like when someone has applied." The application is
 * the bridge between the two: for each section of the open role card, the
 * applicant answers with the matching section of their own.
 */
import { describe, expect, it } from "vitest";
import { CARD_LIMITS, cardOf, cardSummary, parseCard } from "./openProposalCard";

const CTX = {
  roleIds: new Set(["lfs", "events"]),
  accountabilitiesOf: (id: string) => (id === "lfs" ? ["One living model", "A cash view every Monday", "Bills and filings on time"] : []),
  goalIds: new Set(["g-investor", "g-community"]),
};

const GOOD = {
  roles: [
    { roleId: "lfs", moves: [{ text: "A cash view every Monday", target: "13 of 13 Mondays" }], firstMoon: [{ quest: "Publish the first Monday cash view", doneWhen: "it reaches every circle lead" }] },
    { roleId: "events", moves: [{ text: "Monthly potluck", target: "" }], firstMoon: [] },
  ],
  serves: [{ goalId: "g-investor", how: "Investors read one set of numbers." }],
  hours: "About 25 a week",
  agreed: { loveLetter: true, nda: true },
};

describe("parseCard", () => {
  it("takes a card whose outcomes are the role's own and whose goals are the season's", () => {
    const r = parseCard(GOOD, CTX);
    expect(r.ok).toBe(true);
    expect(r.ok && r.card.roles[0].moves[0]).toEqual({ text: "A cash view every Monday", target: "13 of 13 Mondays" });
  });

  it("refuses an outcome the role does not answer for, when the role lists them", () => {
    const r = parseCard({ ...GOOD, roles: [{ roleId: "lfs", moves: [{ text: "Run the cafe", target: "" }], firstMoon: [] }] }, CTX);
    expect(r).toMatchObject({ ok: false, field: "card" });
  });

  it("refuses a goal that is not the season's, and a role not in the proposal", () => {
    expect(parseCard({ ...GOOD, serves: [{ goalId: "g-made-up", how: "x" }] }, CTX).ok).toBe(false);
    expect(parseCard({ ...GOOD, roles: [{ roleId: "nope", moves: [], firstMoon: [] }] }, CTX).ok).toBe(false);
  });

  it("needs the NDA promise ticked; the Love Letter is aligned with on the form, never ticked (Rye's answer 8)", () => {
    const r = parseCard({ ...GOOD, agreed: { loveLetter: true, nda: false } }, CTX);
    expect(r).toMatchObject({ ok: false, field: "agreed" });
    // No Love Letter tick at all: the card stands on the NDA alone.
    expect(parseCard({ ...GOOD, agreed: { nda: true } }, CTX)).toMatchObject({ ok: true, card: { agreed: { loveLetter: false, nda: true } } });
  });

  it("stays tolerant of a card sent with the old Love Letter tick, and keeps it as stored", () => {
    expect(parseCard({ ...GOOD, agreed: { loveLetter: true, nda: true } }, CTX)).toMatchObject({ ok: true, card: { agreed: { loveLetter: true, nda: true } } });
    expect(cardOf({ ...GOOD, agreed: { loveLetter: true, nda: true } })?.agreed).toEqual({ loveLetter: true, nda: true });
  });

  it("caps every list and every line", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ quest: `q${i}`, doneWhen: "d" }));
    expect(parseCard({ ...GOOD, roles: [{ roleId: "events", moves: [], firstMoon: many }] }, CTX).ok).toBe(false);
    expect(parseCard({ ...GOOD, hours: "x".repeat(CARD_LIMITS.hours + 1) }, CTX).ok).toBe(false);
  });
});

describe("cardOf and cardSummary", () => {
  it("reads a stored card back safely, and drops what is not one", () => {
    expect(cardOf("nonsense")).toBeUndefined();
    expect(cardOf(GOOD)?.roles).toHaveLength(2);
  });

  it("writes the card as the application's own words, naming the roles and the goals", () => {
    const text = cardSummary(cardOf(GOOD)!, (id) => ({ lfs: "Lead Financial Steward", events: "Events Manager" })[id] ?? id, (g) => ({ "g-investor": "Investor ready" })[g] ?? g);
    expect(text).toContain("Lead Financial Steward");
    expect(text).toContain("A cash view every Monday (13 of 13 Mondays)");
    expect(text).toContain("Publish the first Monday cash view: done when it reaches every circle lead");
    expect(text).toContain("Investor ready: Investors read one set of numbers.");
    expect(text).toContain("About 25 a week");
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});
