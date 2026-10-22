import { describe, expect, it } from "vitest";
import { buildPlayerCard, type PlayerCardInput, type PlayerRoleIn, type SignOut, type Slot } from "./playerCard";
import { roleHandover, roleHealth } from "./playerCardHealth";
import { roleWordPayload, roleWordsIn, PERSONAL_EDIT_KEYS, PERSONAL_STORED_NOW, ROLE_EDIT_KEYS, ROLE_WORD_FIELD } from "./playerCardEdit";
import type { SignReading } from "./roleSigns";
import type { SeatSettings } from "./seatSettings";

const TZ = "America/Costa_Rica";
const NOW = new Date("2026-10-22T18:00:00Z");
const NONE: Slot<SignOut[]> = { kind: "empty", words: "No signs named yet" };

const counted = (n: number): SignReading => ({
  kind: "counted",
  key: "applications-answered",
  label: "Role applications answered within 2 business days",
  countedFrom: "Counted from the application page.",
  now: { n, of: 10, source: "x" },
  trend: null,
});
const sign = (n: number, target: number | null): SignOut => ({
  roleId: "r1",
  roleTitle: "Water Keeper",
  measure: "Answered",
  value: `${n} of 10`,
  from: null,
  reading: counted(n),
  target: target === null ? null : { n: target, source: "t" },
  sheetKey: "applications-answered",
});

describe("a role's health: three facts and one dot, never a score", () => {
  it("says within term, review due, and signs on track when every targeted sign meets its number", () => {
    const settings: SeatSettings = { v: 1, term: { reviewOn: "2026-11-16" }, scoreboard: { measures: [{ measure: "A", countedBy: "applications-answered", targetCount: 8 }] } };
    const h = roleHealth({ termEndsAt: "2026-12-31T06:00:00Z", settings }, { kind: "shown", value: [sign(9, 8)] }, NOW, TZ)!;
    expect(h.facts.map((f) => f.words)).toEqual(["Within term, to 31 Dec 2026", "Review due 16 Nov 2026", "Signs on track"]);
    expect(h.dot).toBe("steady");
    expect(h.dotWords).toBe("Steady");
    expect(JSON.stringify(h)).not.toMatch(/%|score/i);
  });

  it("says No target set unless a sign names both what counts it and a number", () => {
    const settings: SeatSettings = { v: 1, scoreboard: { measures: [{ measure: "Words only" }, { measure: "Counted, no number", countedBy: "circle-met" }] } };
    const h = roleHealth({ termEndsAt: null, settings }, NONE, NOW, TZ)!;
    expect(h.facts.map((f) => f.words)).toEqual(["No term set", "No review date set", "No target set"]);
    expect(h.dot).toBe("look");
  });

  it("counts how many targeted signs are on track, and a passed term or review needs attention", () => {
    const settings: SeatSettings = {
      v: 1,
      term: { reviewOn: "2026-10-01" },
      scoreboard: { measures: [{ measure: "A", countedBy: "applications-answered", targetCount: 8 }, { measure: "B", countedBy: "applications-answered", targetCount: 8 }] },
    };
    const h = roleHealth({ termEndsAt: "2026-10-01T06:00:00Z", settings }, { kind: "shown", value: [sign(9, 8), sign(3, 8)] }, NOW, TZ)!;
    expect(h.facts.map((f) => f.words)).toEqual(["Term ended 1 Oct 2026", "Review date passed 1 Oct 2026", "1 of 2 signs on track"]);
    expect(h.dot).toBe("act");
  });

  it("leaves out what the reader could not read: a stranger sees no review and no sign fact", () => {
    const h = roleHealth({ termEndsAt: "2026-12-31T06:00:00Z", settings: undefined }, { kind: "unread" }, NOW, TZ)!;
    expect(h.facts.map((f) => f.key)).toEqual(["term"]);
    expect(roleHealth({ termEndsAt: undefined, settings: undefined }, { kind: "unread" }, NOW, TZ)).toBeNull();
  });
});

describe("the handover meter: four checks, read as a count", () => {
  const base = {
    aim: "Keep the water clean.",
    domain: "The tanks.",
    accountabilities: ["Testing the spring"],
    termEndsAt: "2026-12-31T06:00:00Z",
    settings: null,
    circle: { id: "c1", name: "Land" },
  };

  it("reads 2 of 4 ready, never a percentage, and the runbook is Not counted yet", () => {
    const h = roleHandover({ ...base, holderCount: 1, covered: false, circleDecisions: 3 });
    expect(h.summary).toBe("2 of 4 ready");
    expect(h.checks.find((c) => c.key === "runbook")).toMatchObject({ state: "not-counted", words: "Not counted yet" });
    expect(JSON.stringify(h)).not.toContain("%");
  });

  it("counts a second holder, or a deputy or successor, as someone ready to step in", () => {
    expect(roleHandover({ ...base, holderCount: 2, covered: false, circleDecisions: 0 }).checks.find((c) => c.key === "stepIn")?.state).toBe("ready");
    expect(roleHandover({ ...base, holderCount: 1, covered: true, circleDecisions: 0 }).checks.find((c) => c.key === "stepIn")?.words).toBe(
      "A deputy or successor is written down",
    );
  });

  it("names what a card is missing", () => {
    const h = roleHandover({ ...base, aim: null, accountabilities: [], termEndsAt: null, holderCount: 1, covered: false, circleDecisions: 0 });
    expect(h.checks[0].words).toBe("Missing: aim, what it answers for, a term");
    expect(h.summary).toBe("0 of 4 ready");
  });
});

describe("the model carries health, handover, the load read and pending words", () => {
  const role: PlayerRoleIn = {
    id: "r1",
    name: "Water Keeper",
    aim: "Clean water.",
    whyItMatters: null,
    domain: "The tanks.",
    accountabilities: ["Testing"],
    criticality: "normal",
    circle: { id: "c1", name: "Land" },
    termEndsAt: "2026-12-31T06:00:00Z",
    archetypes: null,
    archetypesSuggested: false,
    bringMe: null,
    notMine: null,
    runbook: null,
    worksWith: [],
    powers: [],
    tensions: [],
    settings: { v: 1, scoreboard: { measures: [{ measure: "Answered", countedBy: "applications-answered", targetCount: 5 }] } },
    holderCount: 1,
    covered: false,
    circleDecisions: 2,
    pendingWords: ["purpose"],
  };
  const input: PlayerCardInput = {
    now: NOW,
    timeZone: TZ,
    owner: { userId: "u1", displayName: "Lena Ortiz", avatar: null },
    viewerUserId: "u1",
    villageName: null,
    season: null,
    nextSeasonId: null,
    archetypeNames: null,
    roles: [role],
    plan: null,
    seasonalGoals: null,
    tasks: [],
    signRows: {},
    howIHold: null,
    applications: [],
    roleNames: {},
    bonusTokenName: null,
    loadRead: null,
    growingEdge: null,
    whoCouldHoldNext: null,
  };

  it("reads each sign through the host's memoised reader, once per measure and never from rows", () => {
    const asked: Array<[string | null, string | null]> = [];
    const card = buildPlayerCard({ ...input, signReader: (k, c) => (asked.push([k, c]), counted(7)) });
    expect(asked).toEqual([["applications-answered", "c1"]]);
    const tile = card.tiles.items.kind === "shown" ? card.tiles.items.value[0] : null;
    expect(tile?.health?.facts.map((f) => f.words)).toContain("Signs on track");
    expect(card.roles[0].working.items.kind === "shown" && card.roles[0].working.items.value[0].sheetKey).toBe("applications-answered");
  });

  it("says Not set this moon for an unset load read, and keeps the counted fact beside it", () => {
    const card = buildPlayerCard(input);
    expect(card.across.load.own).toEqual({ kind: "empty", words: "Not set this moon" });
    expect(card.across.load.caption).toBe("My own read, set each moon.");
    expect(buildPlayerCard({ ...input, loadRead: 4 }).across.load.own).toEqual({ kind: "shown", value: { step: 4, words: "Leaning heavy" } });
  });

  it("carries the handover meter and the words waiting on consent", () => {
    const card = buildPlayerCard(input);
    expect(card.roles[0].handover.summary).toBe("2 of 4 ready");
    expect(card.roles[0].pending).toEqual(["purpose"]);
  });
});

describe("who owns each word on the card", () => {
  it("splits personal and role words, and only the aim and the goal it serves are stored today", () => {
    expect(PERSONAL_STORED_NOW).toEqual(["aim", "servesGoal"]);
    expect(PERSONAL_EDIT_KEYS).toContain("loadRead");
    expect(ROLE_EDIT_KEYS).toEqual(["purpose", "decide", "countOnMe", "bringMe", "notMine"]);
  });

  it("turns a role word into an update_seat payload on a column that exists, and refuses the rest", () => {
    expect(roleWordPayload({ key: "purpose", text: " Clean water. " })).toEqual({ ok: true, key: "purpose", payload: { aim: "Clean water." } });
    expect(roleWordPayload({ key: "countOnMe", text: "One\n\nTwo" })).toEqual({ ok: true, key: "countOnMe", payload: { accountabilities: ["One", "Two"] } });
    expect(roleWordPayload({ key: "bringMe", text: "x" }).ok).toBe(false);
    expect(roleWordPayload({ key: "pay", text: "x" }).ok).toBe(false);
    expect(ROLE_WORD_FIELD.notMine).toBeNull();
  });

  it("reads back which role words an open draft would change", () => {
    expect(roleWordsIn({ aim: "x", accountabilities: ["y"] })).toEqual(["purpose", "countOnMe"]);
    expect(roleWordsIn({ termsOffer: {} })).toEqual([]);
  });
});
