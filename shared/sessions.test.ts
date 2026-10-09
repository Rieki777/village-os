/**
 * Live Sessions: the contract's pure parts. The room's state machine, the
 * shared breath, item clocks, consent tallies, the arrival summary, closing,
 * text cleaning and the two audiences of the minutes.
 */
import { describe, expect, it } from "vitest";
import {
  ARRIVAL_MAX,
  CONSENT_LABELS,
  ENTRY_LABELS,
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_STAGES,
  STAGE_DEFS,
  AIM_DEFS,
  FACILITATION_LABELS,
  agendaFit,
  applySessionAction,
  arrivalIsLow,
  arrivalSummary,
  breathAt,
  buildMinutes,
  cleanDueOn,
  cleanLine,
  cleanText,
  consentNeedsWords,
  consentTally,
  defaultSessionState,
  normalizeSessionState,
  parseResponseTarget,
  parseSessionAction,
  roundSpeakers,
  timebox,
  unownedActions,
  type MinutesInput,
  type SessionEntry,
  type SessionItem,
} from "./sessions";

const T0 = 1_900_000_000_000;

describe("the room's state", () => {
  it("starts at drop in with nothing running", () => {
    const s = defaultSessionState();
    expect(s.stage).toBe("dropin");
    expect(s.startedAt).toBeNull();
    expect(s.breath.startedAt).toBeNull();
    expect(s.round.order).toEqual([]);
  });

  it("moves through the stages and clears a round when the stage changes", () => {
    let s = applySessionAction(defaultSessionState(), { type: "round", label: "Arrival", order: [3, 4] }, T0);
    s = applySessionAction(s, { type: "go", stage: "agenda" }, T0 + 1000);
    expect(s.stage).toBe("agenda");
    expect(s.stageStartedAt).toBe(T0 + 1000);
    expect(s.round.order).toEqual([]);
    expect(applySessionAction(s, { type: "go", stage: "agenda" }, T0 + 5000)).toBe(s);
  });

  it("starts the session clock once", () => {
    const a = applySessionAction(defaultSessionState(), { type: "start" }, T0);
    const b = applySessionAction(a, { type: "start" }, T0 + 9999);
    expect(b.startedAt).toBe(T0);
  });

  it("an item's clock starts with the item, and its grace resets when another starts", () => {
    let s = applySessionAction(defaultSessionState(), { type: "item", itemId: 7 }, T0);
    s = applySessionAction(s, { type: "extend", minutes: 5 }, T0);
    expect(s.itemExtraMin).toBe(5);
    s = applySessionAction(s, { type: "item", itemId: 8 }, T0 + 60_000);
    expect(s.activeItemId).toBe(8);
    expect(s.itemStartedAt).toBe(T0 + 60_000);
    expect(s.itemExtraMin).toBe(0);
    s = applySessionAction(s, { type: "extend", minutes: -10 }, T0);
    expect(s.itemExtraMin).toBe(0);
    expect(applySessionAction(defaultSessionState(), { type: "extend", minutes: 5 }, T0).itemExtraMin).toBe(0);
  });

  it("a round calls two names at a time and ends after the last speaker", () => {
    let s = applySessionAction(defaultSessionState(), { type: "round", label: "Check-in", order: [1, 2, 3] }, T0);
    expect(roundSpeakers(s.round)).toEqual({ now: 1, next: 2, done: false });
    s = applySessionAction(s, { type: "next" }, T0);
    s = applySessionAction(s, { type: "next" }, T0);
    expect(roundSpeakers(s.round)).toEqual({ now: 3, next: null, done: false });
    s = applySessionAction(s, { type: "next" }, T0);
    s = applySessionAction(s, { type: "next" }, T0);
    expect(roundSpeakers(s.round)).toEqual({ now: null, next: null, done: true });
    s = applySessionAction(s, { type: "previous" }, T0);
    expect(roundSpeakers(s.round).now).toBe(3);
  });

  it("refuses actions it does not know, and cleans the ones it does", () => {
    expect(parseSessionAction({ type: "go", stage: "lunch" })).toBeNull();
    expect(parseSessionAction({ type: "breath", run: "yes" })).toBeNull();
    expect(parseSessionAction({ type: "breath", run: true, rounds: 4 })).toBeNull();
    expect(parseSessionAction({ type: "item", itemId: 0 })).toBeNull();
    expect(parseSessionAction({ type: "extend", minutes: 1.5 })).toBeNull();
    expect(parseSessionAction({ type: "round", label: "x", order: [1, "2"] })).toBeNull();
    expect(parseSessionAction({ type: "round", label: "  Check-in ", order: [2, 2, 3] })).toEqual({ type: "round", label: "Check-in", order: [2, 3] });
    expect(parseSessionAction({ type: "item", itemId: null })).toEqual({ type: "item", itemId: null });
    expect(parseSessionAction(null)).toBeNull();
  });

  it("normalises whatever was stored, falling back to defaults", () => {
    expect(normalizeSessionState("not json")).toEqual(defaultSessionState());
    const s = normalizeSessionState(JSON.stringify({ stage: "items", activeItemId: 4, itemExtraMin: 999, breath: { pattern: "box", rounds: 3, startedAt: T0 }, round: { order: [5, "x", 6], at: 9 } }));
    expect(s.stage).toBe("items");
    expect(s.activeItemId).toBe(4);
    expect(s.itemExtraMin).toBe(0);
    expect(s.breath).toEqual({ pattern: "box", rounds: 3, startedAt: T0 });
    expect(s.round.order).toEqual([5, 6]);
    expect(s.round.at).toBe(0);
  });
});

describe("the shared breath", () => {
  it("is idle until started and done after its rounds", () => {
    expect(breathAt({ pattern: "settle", rounds: 3, startedAt: null }, T0)).toEqual({ state: "idle" });
    expect(breathAt({ pattern: "settle", rounds: 3, startedAt: T0 }, T0 + 31_000)).toEqual({ state: "done" });
  });

  it("every screen reads the same step from the same clock", () => {
    const b = { pattern: "settle" as const, rounds: 6, startedAt: T0 };
    const m = breathAt(b, T0 + 5_000);
    expect(m).toMatchObject({ state: "breathing", round: 1, kind: "out" });
    expect(breathAt(b, T0 + 12_000)).toMatchObject({ round: 2, kind: "in" });
  });
});

describe("time", () => {
  it("an item's clock is calm, then near at four fifths, then over, and grace adds to it", () => {
    expect(timebox(null, 10, 0, T0).phase).toBe("idle");
    expect(timebox(T0, 10, 0, T0 + 60_000).phase).toBe("calm");
    expect(timebox(T0, 10, 0, T0 + 8 * 60_000).phase).toBe("near");
    expect(timebox(T0, 10, 0, T0 + 10 * 60_000).phase).toBe("over");
    expect(timebox(T0, 10, 5, T0 + 10 * 60_000).phase).toBe("calm");
  });

  it("an agenda that asks for more than the time left says so", () => {
    const items = [
      { minutes: 20, status: "done" as const },
      { minutes: 30, status: "waiting" as const },
      { minutes: 20, status: "active" as const },
      { minutes: 15, status: "parked" as const },
    ];
    expect(agendaFit(items, 60, null, T0)).toEqual({ planned: 50, left: 60, over: false });
    expect(agendaFit(items, 60, T0, T0 + 20 * 60_000)).toEqual({ planned: 50, left: 40, over: true });
  });
});

describe("consent and arrival", () => {
  it("consent needs everyone here to answer and nobody to object", () => {
    expect(consentTally(["consent", "concern"], 3)).toMatchObject({ waiting: 1, consented: false });
    expect(consentTally(["consent", "concern", "consent"], 3)).toMatchObject({ consent: 2, concern: 1, consented: true });
    expect(consentTally(["consent", "object", "consent"], 3).consented).toBe(false);
    expect(consentTally([], 0).consented).toBe(false);
    expect(consentNeedsWords("consent")).toBe(false);
    expect(consentNeedsWords("object")).toBe(true);
  });

  it("the arrival round keeps numbers only, and a low room is two or more at five or under", () => {
    expect(arrivalSummary([])).toEqual({ count: 0, median: null, low: null, high: null });
    expect(arrivalSummary([7, 3, 11, null, 12, 0, 9])).toEqual({ count: 4, median: 8, low: 3, high: 11 });
    expect(arrivalSummary([4, 5, 6])).toMatchObject({ median: 5 });
    expect(arrivalIsLow(arrivalSummary([4, 5, 6]))).toBe(true);
    expect(arrivalIsLow(arrivalSummary([2]))).toBe(false);
    expect(arrivalIsLow(arrivalSummary([7, ARRIVAL_MAX]))).toBe(false);
  });

  it("knows its response targets", () => {
    expect(parseResponseTarget("agenda")).toBe("agenda");
    expect(parseResponseTarget("decision:42")).toBe("decision:42");
    expect(parseResponseTarget("decision:0")).toBeNull();
    expect(parseResponseTarget("decision:42x")).toBeNull();
    expect(parseResponseTarget("someone")).toBeNull();
  });
});

describe("closing", () => {
  it("a session closes only when every open action has a person or a seat", () => {
    const e = (id: number, over: Partial<SessionEntry>) => ({ id, kind: "action" as const, status: "open" as const, ownerUserId: null, ownerSeatId: null, ...over });
    expect(unownedActions([e(1, {}), e(2, { ownerUserId: 5 }), e(3, { ownerSeatId: "water" }), e(4, { status: "parked" }), { ...e(5, {}), kind: "note" as const }])).toEqual([1]);
  });
});

describe("text", () => {
  it("strips hidden characters and caps the length", () => {
    const zw = String.fromCharCode(0x200b);
    const rlo = String.fromCharCode(0x202e);
    const tag = String.fromCodePoint(0xe0041);
    expect(cleanLine(`  Water${zw} ${rlo}tanks${tag}  `, 120)).toBe("Water tanks");
    expect(cleanLine("   ", 120)).toBeNull();
    expect(cleanLine(42, 120)).toBeNull();
    expect(cleanLine("abcdef", 3)).toBe("abc");
    expect(cleanText("one\r\n\r\n\r\n\r\ntwo", 600)).toBe("one\n\ntwo");
    expect(cleanDueOn("2026-10-31")).toBe("2026-10-31");
    expect(cleanDueOn("2026-02-30")).toBeNull();
    expect(cleanDueOn("soon")).toBeNull();
  });
});

describe("the minutes", () => {
  const item = (over: Partial<SessionItem>): SessionItem => ({
    id: 1, title: "Water", aim: "decide", minutes: 15, position: 1, status: "done", presenterUserId: null, addedBy: 1,
    startedAt: null, endedAt: null, usedSeconds: 900, fromSessionId: null, ...over,
  });
  const entry = (over: Partial<SessionEntry>): SessionEntry => ({
    id: 1, itemId: 1, kind: "note", text: "", status: "open", authorUserId: 1, ownerUserId: null, ownerName: null,
    ownerSeatId: null, ownerSeatName: null, dueOn: null, createdAt: "2026-10-09T17:00:00Z", ...over,
  });
  const input: MinutesInput = {
    title: "Land circle",
    circleName: "Land",
    createdAt: "2026-10-09T17:00:00Z",
    closedAt: "2026-10-09T18:00:00Z",
    durationMin: 60,
    stamp: { moonName: "Waxing gibbous", moonGlyph: "", moonOrdinal: 12, season: "spring", placeLine: null },
    facilitatorName: "Rowan",
    secretaryName: "Ash",
    peopleNames: ["Rowan", "Ash", "Kai"],
    arrival: { count: 3, median: 8, low: 6, high: 10 },
    items: [item({}), item({ id: 2, title: "Kitchen roster", aim: "explore", position: 2, status: "parked", usedSeconds: 0 })],
    entries: [
      entry({ id: 10, kind: "decision", text: "We fill the tanks on Mondays.", status: "done" }),
      entry({ id: 11, kind: "seed", text: "The pump needs a second person." }),
      entry({ id: 12, kind: "action", text: "Write the Monday rota, call kai@example.org", ownerUserId: 3, ownerName: "Kai", dueOn: "2026-10-16" }),
      entry({ id: 13, kind: "action", text: "Order filters", ownerSeatId: "water", ownerSeatName: "Water Steward", ownerUserId: 2, ownerName: "Ash" }),
      entry({ id: 14, kind: "note", text: "Rowan felt tired this week" }),
      entry({ id: 15, itemId: null, kind: "tension", text: "Nobody holds the tool shed." }),
    ],
    tallies: { 10: { consent: 2, concern: 1, object: 0, waiting: 0, consented: true } },
  };

  it("for the people who were there: names on actions, notes kept", () => {
    const md = buildMinutes(input, "people");
    expect(md).toContain("Facilitated by Rowan, notes by Ash.");
    expect(md).toContain("Present: Rowan, Ash, Kai.");
    expect(md).toContain("Arrival: median 8 of 11 (from 6 to 10).");
    expect(md).toContain("**Decided by consent:** We fill the tanks on Mondays. (2 consent, 1 with a concern, 0 objecting)");
    expect(md).toContain("held by Kai, by 2026-10-16");
    expect(md).toContain("held by Water Steward (Ash)");
    expect(md).toContain("Note: Rowan felt tired this week");
    expect(md).toContain("## Backlog for next time");
    expect(md).toContain("- Item: Kitchen roster (Explore)");
    expect(md).toContain("- Tension: Nobody holds the tool shed.");
  });

  it("shareable: names no person, removes contact details, drops notes", () => {
    const md = buildMinutes(input, "shareable");
    for (const name of ["Rowan", "Ash", "Kai"]) expect(md).not.toContain(name);
    expect(md).not.toContain("kai@example.org");
    expect(md).toContain("[email removed]");
    expect(md).toContain("3 people took part.");
    expect(md).toContain("held by a member, by 2026-10-16");
    expect(md).toContain("held by Water Steward.");
    expect(md).toContain("Moon 12 · Waxing gibbous · spring");
    expect(md).toContain("**Seed:** The pump needs a second person.");
  });
});

/** En and em dash, built from code points so neither lands in this file. */
const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

describe("the words", () => {
  const all: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") all.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(STAGE_DEFS);
  walk(AIM_DEFS);
  walk(CONSENT_LABELS);
  walk(ENTRY_LABELS);
  walk(FACILITATION_LABELS);
  walk(SESSION_COPY);

  it("covers every stage", () => {
    expect(Object.keys(STAGE_DEFS)).toEqual([...SESSION_STAGES]);
    expect(all.length).toBeGreaterThan(80);
  });

  it("carry no em-dashes and none of the words the voice gate refuses", () => {
    for (const line of all) {
      expect(line, line).not.toMatch(DASHES);
      expect(line, line).not.toMatch(/\b(delve|tapestry|foster|leverage|vibrant|crucial|seamless|robust|comprehensive|empower|utilize|unleash)\b/i);
      expect(line, line).not.toMatch(/\brather than\b|\bnot just\b|\bnot only\b/i);
    }
  });

  it("leaves room in every limit for what it caps", () => {
    expect(SESSION_LIMITS.minutesMin).toBeLessThan(SESSION_LIMITS.minutesMax);
    expect(SESSION_LIMITS.durationDefault).toBeGreaterThanOrEqual(SESSION_LIMITS.durationMin);
  });
});
