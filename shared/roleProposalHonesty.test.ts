import { describe, expect, it } from "vitest";
import { GROUP_PLAIN, guideName, honestyLine, onboardingRoleName, operationsRoleName, OPS_FALLBACK, opsPartner, seasonHeading } from "./roleProposalHonesty";
import { SETTINGS_GROUPS } from "./seatSettings";

describe("season heading", () => {
  it("names the season and the day it starts", () => {
    expect(seasonHeading("Season of Roots", "1 January 2027")).toBe("For Season of Roots, starting 1 January 2027.");
  });

  it("does not print an empty name", () => {
    expect(seasonHeading("", "1 January 2027")).toBe("For next season, starting 1 January 2027.");
    expect(seasonHeading("   ", "1 January 2027")).toBe("For next season, starting 1 January 2027.");
    expect(seasonHeading(null, "1 January 2027")).toBe("For next season, starting 1 January 2027.");
  });

  it("drops a blank start day", () => {
    expect(seasonHeading("Roots", "")).toBe("For Roots.");
    expect(seasonHeading("", "")).toBe("For next season.");
  });
});

describe("the operations role", () => {
  it("falls back when the chart has no operations role", () => {
    expect(operationsRoleName([])).toBeNull();
    expect(operationsRoleName([{ name: "Kitchen keeper" }])).toBeNull();
    expect(operationsRoleName(null)).toBeNull();
    expect(opsPartner(null)).toBe(OPS_FALLBACK);
    expect(opsPartner("")).toBe(OPS_FALLBACK);
    expect(OPS_FALLBACK.includes("@")).toBe(false);
  });

  it("uses the shortest live role whose name says operation", () => {
    expect(
      operationsRoleName([
        { name: "Human Operations and Onboarding Lead", active: true },
        { name: "Operations Steward", active: true },
        { name: "Example Operations", isExample: true },
        { name: "Old Operations", active: false },
      ]),
    ).toBe("Operations Steward");
  });

  it("drops an email-shaped name and never needs a village name", () => {
    expect(operationsRoleName([{ name: "operations@example.org" }])).toBeNull();
    expect(opsPartner("Operations Steward")).toBe("Operations Steward");
  });

  it("names the guide by a first name, and never by an email", () => {
    expect(guideName([{ name: "Operations Steward", holders: [{ name: "Rye Cordon" }, { name: "ops@example.org" }] }])).toBe("Rye");
    expect(guideName([{ name: "Operations Steward", holders: [{ name: "ops@example.org" }] }])).toBe("Operations Steward");
    expect(guideName([])).toBe(OPS_FALLBACK);
  });
});

describe("the role that welcomes people (verify B4)", () => {
  const chart = [
    { id: "tech-ops", name: "Technical Operations Steward", active: true },
    { id: "people", name: "Human Care & Onboarding Steward", active: true },
    { id: "gone", name: "Old Welcome Role", active: false },
    { id: "demo", name: "Example Welcome", isExample: true },
  ];

  it("is the role the village names by id, never a role that says Operations", () => {
    expect(onboardingRoleName(chart, "people")).toBe("Human Care & Onboarding Steward");
    expect(onboardingRoleName(chart, "  people ")).toBe("Human Care & Onboarding Steward");
  });

  it("names nobody when the village names none, or a role that is gone", () => {
    expect(onboardingRoleName(chart, "")).toBeNull();
    expect(onboardingRoleName(chart, null)).toBeNull();
    expect(onboardingRoleName(chart, "gone")).toBeNull();
    expect(onboardingRoleName(chart, "demo")).toBeNull();
    expect(onboardingRoleName(chart, "nope")).toBeNull();
    expect(opsPartner(onboardingRoleName(chart, ""))).toBe(OPS_FALLBACK);
  });
});

describe("a terms row", () => {
  it("leaves an open row for the operations role", () => {
    expect(honestyLine({ set: false, presetLabel: null, customised: false, partner: "Operations Steward", money: false })).toBe(
      "We'll fill this together with Operations Steward.",
    );
    expect(honestyLine({ set: false, presetLabel: null, customised: false, partner: "", money: true })).toBe(
      `We'll fill this together with ${OPS_FALLBACK}.`,
    );
  });

  it("names the preset a suggestion came from", () => {
    expect(honestyLine({ set: true, presetLabel: "Volunteer role", customised: false, partner: "Operations Steward", money: false })).toBe(
      "Suggested from Volunteer role.",
    );
  });

  it("says a money row is a proposal, confirmed with the operations role", () => {
    expect(honestyLine({ set: true, presetLabel: "Unpaid", customised: false, partner: "Operations Steward", money: true })).toBe(
      "Suggested from Unpaid. A proposal, not a promise. Confirmed with Operations Steward.",
    );
  });

  it("says when the member changed a suggestion, and when they wrote it themselves", () => {
    expect(honestyLine({ set: true, presetLabel: "Weekly", customised: true, partner: "Operations Steward", money: false })).toBe(
      "You changed this. It started from Weekly.",
    );
    expect(honestyLine({ set: true, presetLabel: null, customised: false, partner: "Operations Steward", money: false })).toBe("Written by you.");
  });

  it("has one plain line for every terms group", () => {
    for (const group of SETTINGS_GROUPS) {
      expect(GROUP_PLAIN[group].length).toBeGreaterThan(8);
      expect(GROUP_PLAIN[group].includes("@")).toBe(false);
    }
  });
});

describe("withPartnerName", () => {
  it("swaps only the fallback phrase for the chart's Ops role, deep in a card", async () => {
    const { withPartnerName, openRowLine, loadHoursLine } = await import("./roleProposalHonesty");
    const card = { a: { kind: "empty", words: openRowLine(null) }, list: [loadHoursLine(null), "Kept as written"] };
    const out = withPartnerName(card, "Operations Steward");
    expect(out.a.words).toBe("We'll fill this together with Operations Steward.");
    expect(out.list).toEqual(["We'll set the load together with Operations Steward.", "Kept as written"]);
    expect(withPartnerName(card, null)).toBe(card);
  });
});
