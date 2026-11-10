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
    { roleId: "events", moves: [{ text: "Monthly potluck", target: "" }], firstMoon: [{ quest: "Hold the first potluck", doneWhen: "twelve neighbours have eaten" }] },
  ],
  serves: [{ goalId: "g-investor", how: "Investors read one set of numbers." }],
  commitmentPct: 60,
  agreed: { loveLetter: true, nda: true },
  terms: { answers: { term: { choice: "accept", note: "" } } },
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
    expect(parseCard({ ...GOOD, terms: { answers: { term: { choice: "talk", note: "x".repeat(400) } } } }, CTX).ok).toBe(false);
  });
});

describe("each role card names the season goals its work serves (guide v2, Rye 10 Nov 2026)", () => {
  const PER_ROLE = {
    ...GOOD,
    serves: [
      { goalId: "g-investor", how: "One model.", roleId: "lfs" },
      { goalId: "g-community", how: "Monthly potlucks.", roleId: "events" },
      { goalId: "g-investor", how: "Sponsors see the numbers.", roleId: "events" },
    ],
  };

  it("keeps each pick with its role, the same goal on two roles as two picks", () => {
    const r = parseCard(PER_ROLE, CTX);
    expect(r.ok && r.card.serves).toEqual(PER_ROLE.serves);
  });

  it("refuses a pick named for a role that is not in the proposal", () => {
    expect(parseCard({ ...GOOD, serves: [{ goalId: "g-investor", how: "", roleId: "gate" }] }, CTX)).toMatchObject({ ok: false, field: "card" });
  });

  it("holds the limit for each role card, not for the whole proposal", () => {
    const three = ["g-investor", "g-community"].map((goalId) => ({ goalId, how: "", roleId: "lfs" }));
    expect(parseCard({ ...GOOD, serves: [...three, { goalId: "g-investor", how: "", roleId: "events" }, { goalId: "g-community", how: "", roleId: "events" }] }, CTX).ok).toBe(true);
  });

  it("still reads a card sent before goals went on each role", () => {
    const r = parseCard(GOOD, CTX);
    expect(r.ok && r.card.serves).toEqual([{ goalId: "g-investor", how: "Investors read one set of numbers." }]);
  });

  it("writes each role's goals under that role, and first-moon goals, in the application's words", () => {
    const text = cardSummary(cardOf(PER_ROLE)!, (id) => ({ lfs: "Lead Financial Steward", events: "Events Manager" })[id] ?? id, (g) => ({ "g-investor": "Investor ready", "g-community": "Community" })[g] ?? g);
    const lfs = text.indexOf("Lead Financial Steward");
    const events = text.indexOf("Events Manager");
    expect(text).toContain("- Goal: Publish the first Monday cash view");
    expect(text.indexOf("- Serves the season goal: Investor ready: One model.")).toBeGreaterThan(lfs);
    expect(text.indexOf("- Serves the season goal: Investor ready: One model.")).toBeLessThan(events);
    expect(text.indexOf("- Serves the season goal: Community: Monthly potlucks.")).toBeGreaterThan(events);
    expect(text).not.toContain("Serves the season's goals:");
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
    expect(text).toContain("Commitment: 60%");
    expect(text).not.toMatch(/hour/i);
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});

describe("form v2: the person's practicalities and the terms (role journey brief v2, 5.4)", () => {
  const V2 = { ...GOOD, timeZone: "America/Costa_Rica", windows: ["weekday-mornings", "weekend-afternoons"], earliestStart: "2026-11-16", terms: { choice: "talk", note: "I'd like to discuss the hours." } };

  it("keeps a valid time zone, the usual windows, an earliest start and the terms choice", () => {
    const r = parseCard(V2, CTX);
    expect(r.ok && r.card).toMatchObject({ timeZone: "America/Costa_Rica", windows: ["weekday-mornings", "weekend-afternoons"], earliestStart: "2026-11-16", terms: { choice: "talk", note: "I'd like to discuss the hours." } });
  });

  it("refuses a made-up time zone, an unknown window and a date that is not one", () => {
    expect(parseCard({ ...V2, timeZone: "Mars/Olympus" }, CTX)).toMatchObject({ ok: false, field: "timeZone" });
    expect(parseCard({ ...V2, windows: ["midnight"] }, CTX)).toMatchObject({ ok: false, field: "windows" });
    expect(parseCard({ ...V2, earliestStart: "soon" }, CTX)).toMatchObject({ ok: false, field: "earliestStart" });
  });

  it("needs an answer for each written setting, and a note when the older whole choice is talk", () => {
    expect(parseCard({ ...V2, terms: undefined }, { ...CTX, writtenTerms: ["term"] })).toMatchObject({ ok: false, field: "terms" });
    expect(parseCard({ ...V2, terms: { choice: "talk", note: "" } }, CTX)).toMatchObject({ ok: false, field: "terms" });
    expect(parseCard({ ...V2, terms: { choice: "accept", note: "" } }, CTX).ok).toBe(true);
    // A card with no commitment is refused: there is no default.
    expect(parseCard({ ...V2, commitmentPct: undefined }, CTX)).toMatchObject({ ok: false, field: "terms" });
  });

  it("needs at least one of the season's goals when the season has any", () => {
    expect(parseCard({ ...V2, serves: [] }, CTX)).toMatchObject({ ok: false, field: "serves" });
    expect(parseCard({ ...V2, serves: [] }, { ...CTX, goalIds: new Set() }).ok).toBe(true);
  });

  it("writes the practicalities and a terms flag into the application's words", () => {
    const text = cardSummary(cardOf(V2)!, (id) => id, (g) => g);
    expect(text).toContain("Time zone: America/Costa_Rica");
    expect(text).toContain("Earliest start: 2026-11-16");
    expect(text).toContain("Wants to talk about the terms: I'd like to discuss the hours.");
  });
});
