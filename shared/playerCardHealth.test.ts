import { describe, expect, it } from "vitest";
import { buildPlayerCard, type PlayerCardInput, type PlayerRoleIn, type SignOut, type Slot } from "./playerCard";
import { roleHandover, roleHealth } from "./playerCardHealth";
import { roleWordPayload, roleWordsIn, PERSONAL_EDIT_KEYS, ROLE_EDIT_KEYS, ROLE_WORD_FIELD } from "./playerCardEdit";
import { HANDOVER_CHECK_WORDS, ROLE_HANDOVER_WORDS, handoverChecks } from "./roleHandover";
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

describe("the handover meter: the four checks Rye approved, read as a count", () => {
  const base = {
    aim: "Keep the water clean.",
    domain: "The tanks.",
    accountabilities: ["Testing the spring"],
    bringMe: null,
    notMine: null,
    runbook: null,
    circle: { id: "c1", name: "Land" },
    circleDecisions: 0,
    holderCount: 1,
    covered: false,
  };
  const written = { ...base, bringMe: ["Water readings"], notMine: ["Money"], runbook: "https://example.org/runbook" };

  it("is card complete, runbook, decisions and someone ready to step in, as N of 4, never a percentage", () => {
    const h = roleHandover(base);
    expect(h.checks.map((c) => c.key)).toEqual(["card", "runbook", "decisions", "stepIn"]);
    expect(h.summary).toBe("0 of 4 ready");
    expect(roleHandover({ ...written, circleDecisions: 3, holderCount: 2 }).summary).toBe("4 of 4 ready");
    expect(JSON.stringify(h)).not.toMatch(/%|percent/i);
  });

  it("reads card complete and the runbook straight off handoverChecks, the five parts listed under the card", () => {
    for (const role of [base, written, { ...base, bringMe: ["x"] }, { ...base, aim: null, runbook: "Notes" }]) {
      const h = roleHandover(role);
      const shared = handoverChecks(role);
      expect(h.checks[0].state).toBe(shared.cardComplete ? "ready" : "not-yet");
      expect(h.checks[1].state).toBe(shared.runbook ? "ready" : "not-yet");
      expect(h.checks[0].parts?.map((p) => p.key)).toEqual(["purpose", "decide", "countOnMe", "bringMe", "notMine"]);
      expect(h.checks[0].parts?.map((p) => p.words)).toEqual(shared.checks.filter((c) => c.key !== "runbook").map((c) => c.words));
    }
  });

  it("says how many parts are written and which are missing", () => {
    expect(roleHandover({ ...base, bringMe: ["x"] }).checks[0].words).toBe("4 of 5 parts written: Not mine to hold missing");
    expect(roleHandover(base).checks[0].words).toBe("3 of 5 parts written: Bring me, Not mine to hold missing");
    expect(roleHandover(written).checks[0].words).toBe("All 5 parts written");
    expect(roleHandover(written).checks[1].words).toBe(HANDOVER_CHECK_WORDS.runbook.done);
    expect(roleHandover(base).checks[1].words).toBe(HANDOVER_CHECK_WORDS.runbook.missing);
  });

  it("counts decisions in the role's circle, and says when the role sits in no circle", () => {
    expect(roleHandover({ ...base, circleDecisions: 1 }).checks[2]).toMatchObject({ state: "ready", words: "1 decision recorded" });
    expect(roleHandover({ ...base, circleDecisions: 0 }).checks[2]).toMatchObject({ state: "not-yet", words: "0 decisions recorded" });
    expect(roleHandover({ ...base, circle: null }).checks[2]).toMatchObject({ state: "not-yet", words: "The role sits in no circle" });
  });

  it("counts a second holder, or a deputy or successor, as someone ready to step in", () => {
    expect(roleHandover({ ...base, holderCount: 2 }).checks[3]).toMatchObject({ state: "ready", words: "A second holder holds it too" });
    expect(roleHandover({ ...base, covered: true }).checks[3]).toMatchObject({ state: "ready", words: "A deputy or successor is written down" });
    expect(roleHandover(base).checks[3]).toMatchObject({ state: "not-yet", words: "Nobody named yet" });
  });

  it("says Not counted yet for what the reader could not read", () => {
    const h = roleHandover({ ...base, circleDecisions: undefined, holderCount: undefined, covered: undefined });
    expect(h.checks[2]).toMatchObject({ state: "not-counted", words: "Not counted yet" });
    expect(h.checks[3]).toMatchObject({ state: "not-counted", words: "Not counted yet" });
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
    expect(card.roles[0].handover.summary).toBe("1 of 4 ready");
    expect(buildPlayerCard({ ...input, roles: [{ ...role, bringMe: ["x"], notMine: ["y"], runbook: "Notes in the shed." }] }).roles[0].handover.summary).toBe(
      "3 of 4 ready",
    );
    expect(card.roles[0].pending).toEqual(["purpose"]);
  });
});

describe("who owns each word on the card", () => {
  it("splits personal and role words, and every role word has a home now", () => {
    expect(PERSONAL_EDIT_KEYS).toContain("loadRead");
    expect(ROLE_EDIT_KEYS).toEqual(["purpose", "decide", "countOnMe", "bringMe", "notMine", "runbook"]);
    expect(ROLE_WORD_FIELD).toEqual({
      purpose: "aim",
      decide: "domain",
      countOnMe: "accountabilities",
      bringMe: "bringMe",
      notMine: "notMine",
      runbook: "runbook",
    });
  });

  it("turns a role word into an update_seat payload, and refuses an unknown key", () => {
    expect(roleWordPayload({ key: "purpose", text: " Clean water. " })).toEqual({ ok: true, key: "purpose", payload: { aim: "Clean water." } });
    expect(roleWordPayload({ key: "countOnMe", text: "One\n\nTwo" })).toEqual({ ok: true, key: "countOnMe", payload: { accountabilities: ["One", "Two"] } });
    expect(roleWordPayload({ key: "pay", text: "x" }).ok).toBe(false);
  });

  it("proposes the handover words through the one parser: lists per line, the runbook as text, blank clears", () => {
    expect(roleWordPayload({ key: "bringMe", text: " Readings \n\n Questions " })).toEqual({ ok: true, key: "bringMe", payload: { bringMe: ["Readings", "Questions"] } });
    expect(roleWordPayload({ key: "notMine", text: "Money" })).toEqual({ ok: true, key: "notMine", payload: { notMine: ["Money"] } });
    expect(roleWordPayload({ key: "runbook", text: " https://example.org/run " })).toEqual({ ok: true, key: "runbook", payload: { runbook: "https://example.org/run" } });
    expect(roleWordPayload({ key: "notMine", text: "  " })).toEqual({ ok: true, key: "notMine", payload: { notMine: null } });
    expect(roleWordPayload({ key: "runbook", text: "" })).toEqual({ ok: true, key: "runbook", payload: { runbook: null } });
  });

  it("refuses with the parser's own sentences", () => {
    expect(roleWordPayload({ key: "runbook", text: "http://example.org" })).toEqual({ ok: false, error: ROLE_HANDOVER_WORDS.httpsOnly });
    expect(roleWordPayload({ key: "bringMe", text: Array.from({ length: 9 }, (_, i) => `Item ${i}`).join("\n") })).toEqual({
      ok: false,
      error: ROLE_HANDOVER_WORDS.tooMany,
    });
  });

  it("reads back which role words an open draft would change, the handover words included", () => {
    expect(roleWordsIn({ aim: "x", accountabilities: ["y"] })).toEqual(["purpose", "countOnMe"]);
    expect(roleWordsIn({ bringMe: ["a"], runbook: null })).toEqual(["bringMe", "runbook"]);
    expect(roleWordsIn({ termsOffer: {} })).toEqual([]);
  });
});
