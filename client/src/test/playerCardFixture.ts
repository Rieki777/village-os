/**
 * A player card payload built by the real model, for the card's client tests.
 * `rolesN` roles; every slot filled at the member or self tier.
 */
import { buildPlayerCard, type PlayerCardInput, type PlayerRoleIn } from "@shared/playerCard";
import type { CardLevel, PlayerCardPayload } from "@shared/playerCardPayload";
import type { SignReading } from "@shared/roleSigns";
import type { SeatSettings } from "@shared/seatSettings";

const SETTINGS: SeatSettings = {
  v: 1,
  term: { endsOn: "2026-12-31", reviewOn: "2026-11-16", noticeDays: 14 },
  clocks: { pay: "calendar-month", work: "moon" },
  pay: { kind: "fixed", currency: "USD", amountMinor: 700000, per: "month" },
  scoreboard: {
    measures: [
      { measure: "Role applications answered within 2 business days", countedBy: "applications-answered", targetCount: 8 },
      { measure: "Gatherings held on time" },
    ],
  },
};

const READING: SignReading = {
  kind: "counted",
  key: "applications-answered",
  label: "Role applications answered within 2 business days",
  countedFrom: "Counted from when each role application was filed and when it was decided.",
  now: { n: 9, of: 10, source: "x" },
  trend: { kind: "compare", before: { n: 7, of: 10, source: "x" }, direction: "up" },
};

export const FIXTURE_ROLE_TITLE = (n: number) => `Steward of Circle Work Number ${n}`;

/** One fixture role, for a test that needs to change a field before the model reads it. */
export function fixtureRole(n: number): PlayerRoleIn {
  return role(n);
}

function role(n: number): PlayerRoleIn {
  return {
    id: `r${n}`,
    name: FIXTURE_ROLE_TITLE(n),
    aim: "Everyone who comes here finds a clear way in and a role that fits.",
    whyItMatters: null,
    domain: "How a newcomer is welcomed and helped into a role.",
    accountabilities: ["The applicant pipeline, designed and run."],
    criticality: "high",
    circle: { id: "c1", name: "Community Anchor" },
    termEndsAt: "2026-12-31T06:00:00Z",
    archetypes: null,
    archetypesSuggested: false,
    bringMe: ["The newcomer list for the week."],
    notMine: null,
    runbook: "https://example.org/intake-runbook",
    worksWith: [{ roleId: "r-ops", roleName: "Operations & Platform Steward", about: "the intake agent" }],
    powers: [],
    tensions: [{ id: "t1", status: "open", raisedBy: "u-owner", text: "Intake is slow on weekends." }],
    settings: SETTINGS,
    holderCount: 1,
    covered: false,
    circleDecisions: 2,
    pendingWords: n === 1 ? ["purpose"] : [],
  };
}

export function fixturePayload(rolesN: number, level: CardLevel = "self", extra: Partial<PlayerCardInput> = {}): PlayerCardPayload {
  const input: PlayerCardInput = {
    now: new Date("2026-10-22T18:00:00Z"),
    timeZone: "America/Costa_Rica",
    owner: { userId: "u-owner", displayName: "Lena Ortiz", avatar: null },
    viewerUserId: level === "self" ? "u-owner" : "u-reader",
    villageName: "Riverbend",
    season: { id: "s2", name: "Season of Foundations", startsOn: "2026-10-01", endsOn: "2026-12-31" },
    nextSeasonId: "s3",
    archetypeNames: {},
    roles: Array.from({ length: rolesN }, (_, i) => role(i + 1)),
    plan: { aim: "Every role has a ratified card.", goals: [{ goal: "Clear organisation", howItHelps: null }] },
    seasonalGoals: null,
    tasks: rolesN ? [{ id: "t1", title: "Onboarding pipeline", roleId: "r1", status: "open" }] : [],
    signRows: {},
    howIHold: null,
    applications: [],
    roleNames: {},
    bonusTokenName: null,
    loadRead: null,
    growingEdge: null,
    whoCouldHoldNext: null,
    accomplished: [],
    ...extra,
    signReader: (key) => (key === "applications-answered" ? READING : { kind: "not-counted", key, words: "Not counted yet" }),
  };
  return {
    card: buildPlayerCard(input),
    viewer: { level, isSelf: level === "self" },
    timeZone: input.timeZone,
    sheets: {
      "applications-answered": {
        title: READING.kind === "counted" ? READING.label : "",
        countedFrom: "Counted from the application page.",
        rows: [{ at: "2026-10-12T16:00:00Z", words: "Answered within 2 business days", who: "Marco" }],
        note: "First names only. Listed in the order it happened.",
      },
    },
    links: { apply: "/roles", plan: "/season-plans/mine", ...(level === "self" ? { wallet: "/wallet", newApplication: "/propose?type=role_application" } : {}) },
  };
}
