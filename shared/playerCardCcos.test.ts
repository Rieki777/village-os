/**
 * The CCOS sections of one role in full, in the player card's view model
 * (0274, Rye 2026-10-22), against the approved CCOS card:
 *
 *   - every new word comes out where the card draws it, with its plain
 *     heading and, where the village shows them, its CCOS term;
 *   - a role with none written carries nothing but "not written" slots, which
 *     the view draws only in "Edit my card";
 *   - an unread field stays unread;
 *   - the review chip reads the week of the role's own review date, and says
 *     "No review date set" otherwise;
 *   - the handover meter still counts its five card parts and the runbook,
 *     and never the CCOS words.
 */
import { describe, expect, it } from "vitest";
import { buildPlayerCard, type PlayerCardInput, type PlayerRoleIn, type RoleOut } from "./playerCard";
import { reviewChip, weekStartOf } from "./playerCardCcos";
import type { SeatSettings } from "./seatSettings";

const SETTINGS: SeatSettings = { v: 1, term: { endsOn: "2026-12-31", reviewOn: "2026-11-11" } };

const WORDS = {
  existsWhile: "people are still arriving and need a clear way in.",
  authorities: ["Manage applicant onboarding, intake workflows and role invitations.", "Front operations questions in partner discussions."],
  responsibilities: ["Answer role applications within 2 business days.", "Run onboarding calls with newcomers."],
  signsStretched: "Applications waiting longer than 2 business days.",
  flowsBack: "Runbooks and the intake agent from the Operations role.",
  stepBack: "Name it at the Friday check-in.",
  timeCommitment: "Part of a full-time season",
};

function role(over: Partial<PlayerRoleIn> = {}): PlayerRoleIn {
  return {
    id: "r1",
    name: "Human Operations & Onboarding Lead Steward",
    aim: "Everyone who comes to the village finds a clear way in and a role that fits.",
    whyItMatters: null,
    domain: "The onboarding process: how a newcomer is welcomed, invited and helped into a role. The circle decides who joins.",
    accountabilities: ["The applicant pipeline.", "Coaching circle members.", "Matching applicants to roles."],
    criticality: "high",
    circle: { id: "c1", name: "Community Anchor" },
    termEndsAt: "2026-12-31T06:00:00Z",
    archetypes: null,
    archetypesSuggested: false,
    bringMe: ["Someone who wants to join or help."],
    notMine: ["Binding legal or financial commitments."],
    runbook: null,
    worksWith: [],
    powers: [],
    tensions: [],
    settings: SETTINGS,
    ...over,
  };
}

function card(over: Partial<PlayerRoleIn> = {}, input: Partial<PlayerCardInput> = {}) {
  return buildPlayerCard({
    now: new Date("2026-10-22T18:00:00Z"),
    timeZone: "America/Costa_Rica",
    owner: { userId: "u-owner", displayName: "Lena Ortiz", avatar: null },
    viewerUserId: "u-owner",
    villageName: "Riverbend",
    season: { id: "s2", name: "Season of Foundations", startsOn: "2026-10-01", endsOn: "2026-12-31" },
    nextSeasonId: null,
    archetypeNames: {},
    roles: [role(over)],
    plan: null,
    seasonalGoals: null,
    tasks: [],
    signRows: {},
    howIHold: null,
    applications: [],
    roleNames: {},
    bonusTokenName: null,
    ...input,
  });
}

const one = (c: ReturnType<typeof card>): RoleOut => c.roles[0];

describe("a role with every CCOS word written", () => {
  const r = one(card(WORDS, { frameworkTerms: true }));

  it("draws each word in its section, under its plain heading", () => {
    expect(r.existsWhile).toEqual({
      heading: "This role exists while",
      term: "CCOS: Purpose, when the role should evolve or dissolve",
      text: { kind: "shown", value: WORDS.existsWhile },
    });
    expect(r.decide.heading).toBe("What I look after");
    expect(r.authorities).toEqual({ heading: "What I can decide on my own", term: "CCOS: Authorities", items: { kind: "shown", value: WORDS.authorities } });
    expect(r.responsibilities).toEqual({
      heading: "What I do regularly",
      term: "CCOS: Responsibilities / Actions",
      items: { kind: "shown", value: WORDS.responsibilities },
    });
    expect(r.holdingWell.heading).toBe("Holding this role well");
    expect(r.holdingWell.written).toBe(true);
    expect(r.holdingWell.parts.map((p) => [p.key, p.heading, p.term, p.text])).toEqual([
      ["signsStretched", "Signs I'm stretched", "CCOS: ARC Awareness, and the Energy & Sustainability Check", { kind: "shown", value: WORDS.signsStretched }],
      ["flowsBack", "What flows back", "CCOS: ARC Reciprocity", { kind: "shown", value: WORDS.flowsBack }],
      ["stepBack", "How I can step back", "CCOS: ARC Choice", { kind: "shown", value: WORDS.stepBack }],
    ]);
    expect(r.time).toEqual({ heading: "Time", term: "CCOS: Time Commitment", text: { kind: "shown", value: WORDS.timeCommitment } });
  });

  it("gives every plain heading its CCOS term", () => {
    expect([r.purpose.term, r.decide.term, r.countOnMe.term, r.working.term, r.notMine.term]).toEqual([
      "CCOS: Purpose",
      "CCOS: Domains",
      "CCOS: Accountabilities / Outcomes",
      "CCOS: Measurable Indicators (KPIs)",
      "CCOS: the edges of Domains and Authorities",
    ]);
  });

  it("carries the review week as a chip after the term date, and the terms key once for the card", () => {
    // The role's circle is drawn as a link to its card, beside the chips (circle cards PR 4).
    expect(r.chips).toEqual(["Key role", "Held until 31 Dec 2026", "Review week of 9 Nov"]);
    expect(r.circle).toEqual({ name: "Community Anchor", href: "/circles/c1" });
    expect(card(WORDS, { frameworkTerms: true }).termsKey).toBe("Underlined headings show the matching CCOS term when you hover or tap them.");
  });
});

/** What the server sends for a role nobody has written these words for: null, read and empty. */
const NONE = {
  existsWhile: null,
  authorities: null,
  responsibilities: null,
  signsStretched: null,
  flowsBack: null,
  stepBack: null,
  timeCommitment: null,
};

describe("a role with none of the CCOS words written", () => {
  const c = card(NONE);
  const r = one(c);

  it("carries only not-written slots, which the view draws nothing for outside Edit my card", () => {
    expect(r.existsWhile.text).toEqual({ kind: "empty", words: "Not written yet" });
    expect(r.authorities.items).toEqual({ kind: "empty", words: "Not written yet" });
    expect(r.responsibilities.items.kind).toBe("empty");
    expect(r.holdingWell.written).toBe(false);
    expect(r.holdingWell.parts.every((p) => p.text.kind === "empty")).toBe(true);
    expect(r.time.text.kind).toBe("empty");
  });

  it("shows no term and no terms key where the village does not show them", () => {
    expect([r.purpose.term, r.decide.term, r.authorities.term, r.existsWhile.term, r.time.term]).toEqual([null, null, null, null, null]);
    expect(c.termsKey).toBeNull();
  });

  it("reads a field a host left out as unread, never as empty, as a host from before 0274 sends", () => {
    const r2 = one(card({}));
    expect(r2.existsWhile.text.kind).toBe("unread");
    expect(r2.authorities.items.kind).toBe("unread");
    expect(r2.holdingWell.parts.every((p) => p.text.kind === "unread")).toBe(true);
    expect(r2.time.text.kind).toBe("unread");
  });
});

describe("the review chip", () => {
  it("names the Monday of the week the role's review date falls in", () => {
    expect(weekStartOf("2026-11-11")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09");
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(weekStartOf("2026-02-30")).toBeNull();
    expect(reviewChip({ v: 1, term: { reviewOn: "2026-11-16" } })).toBe("Review week of 16 Nov");
  });

  it("says No review date set for terms without one, and draws no chip when the terms were not read", () => {
    expect(reviewChip({ v: 1 })).toBe("No review date set");
    expect(reviewChip(null)).toBe("No review date set");
    expect(reviewChip(undefined)).toBeNull();
    expect(one(card({ settings: undefined })).chips).toEqual(["Key role", "Held until 31 Dec 2026"]);
    expect(one(card({ settings: null })).chips).toContain("No review date set");
  });
});

describe("the handover meter keeps Rye's four checks", () => {
  it("counts the five card parts and the runbook the same with or without the CCOS words", () => {
    const without = one(card({})).handover;
    const withAll = one(card(WORDS)).handover;
    expect(withAll).toEqual(without);
    expect(withAll.checks).toHaveLength(4);
  });
});
