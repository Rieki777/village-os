/**
 * PULL A CARD, the pure part: the day's sky read and checked, the room read as
 * a group, and the plain reading in Amora's words.
 *
 * Every person is invented, and every chart is computed from an invented birth
 * by the code the browser runs. The sky dates are checked against published
 * calendars: Mercury retrograde 1 to 25 April 2024 and 5 to 28 August 2024,
 * Mercury and Venus both retrograde at the end of October 2026.
 */
import { describe, expect, it } from "vitest";
import { chartAt, moonVoidUntil, skyAt, zonedToUtc } from "./geneKeysSky";
import * as Astronomy from "astronomy-engine";
import { voiceLint } from "./comms/voiceLint";
import {
  SIGNS, callNames, moodOf, moonPhaseName, parseSky, plainReading, readRoom, skyLines, suggestionsFor, type CardPerson, type CardSky,
} from "./sessionCard";

const WREN = chartAt(zonedToUtc(1990, 6, 15, 14, 30, "America/New_York"));
const KAI = chartAt(zonedToUtc(2001, 7, 10, 4, 2, "Europe/London"));
const JUNO = chartAt(zonedToUtc(1995, 3, 3, 14, 54, "Asia/Tokyo"));

const AUG = skyAt(new Date("2024-08-05T17:00:00Z"));

describe("the sky of the day", () => {
  it("reads signs, the phase and retrogrades the calendars agree with", () => {
    const april = skyAt(new Date("2024-04-10T12:00:00Z"));
    expect(SIGNS[april.signs.Sun]).toBe("Aries");
    expect(april.retro).toEqual(["Mercury"]);
    expect(moonPhaseName(april.moonPhase)).toBe("Waxing crescent");
    const october = skyAt(new Date("2026-10-30T23:00:00Z"));
    expect(SIGNS[october.signs.Sun]).toBe("Scorpio");
    expect(october.retro).toEqual(expect.arrayContaining(["Mercury", "Venus", "Saturn"]));
    expect(october.retro).not.toContain("Jupiter");
    expect(AUG.retro).toEqual(expect.arrayContaining(["Mercury", "Saturn", "Neptune", "Pluto"]));
  });

  it("finds the Moon void of course once its last aspect in a sign is made, and not before", () => {
    expect(moonVoidUntil(Astronomy.MakeTime(new Date("2024-08-05T12:00:00Z")))).toBeNull();
    const until = AUG.moonVoidUntil;
    expect(until).not.toBeNull();
    // It ends as the Moon changes sign.
    const before = skyAt(new Date(Date.parse(until!) - 60_000)), after = skyAt(new Date(Date.parse(until!) + 60_000));
    expect(after.signs.Moon).toBe((before.signs.Moon + 1) % 12);
  });

  it("survives the trip to the server, and the server refuses a sky that was not read from the sky", () => {
    const now = Date.parse(AUG.at);
    expect(parseSky(JSON.parse(JSON.stringify(AUG)), now)).toEqual(AUG);
    const bad = (patch: Partial<Record<keyof CardSky, unknown>>) => parseSky({ ...AUG, ...patch }, now);
    expect(bad({ gates: { ...AUG.gates, Sun: { gate: 65, line: 1 } } })).toBeNull();
    expect(bad({ signs: { ...AUG.signs, Moon: 12 } })).toBeNull();
    expect(bad({ moonPhase: 1.5 })).toBeNull();
    expect(bad({ at: new Date(now - 3 * 86400_000).toISOString() })).toBeNull();
    expect(bad({ moonVoidUntil: new Date(now + 5 * 86400_000).toISOString() })).toBeNull();
    expect(parseSky({ ...AUG, retro: ["Mercury", "Ceres"] }, now)?.retro).toEqual(["Mercury"]);
  });
});

describe("the room, read as a group", () => {
  const people: CardPerson[] = [
    { userId: "m-wren", name: "Wren Alder", chart: WREN },
    { userId: "m-kai", name: "Kai Moss", chart: KAI },
    { userId: "m-juno", name: "Juno Ash", chart: JUNO },
    { userId: "m-sam", name: "Sam Reed", chart: null },
  ];
  const facts = readRoom(people, AUG);

  it("reads the people who said yes and welcomes the rest by name", () => {
    expect(facts.people.map((p) => p.name)).toEqual(["Wren", "Kai", "Juno"]);
    expect(facts.welcomed).toEqual([{ userId: "m-sam", name: "Sam" }]);
    expect(facts.people.find((p) => p.userId === "m-wren")).toMatchObject({ type: "Manifestor", authority: "Emotional", profile: "2/5" });
    expect(facts.emotional).toBeGreaterThanOrEqual(1);
  });

  it("names a channel the sky completes only where the person holds one gate of it and the sky the other", () => {
    for (const p of facts.people) {
      for (const l of p.lit) {
        const [a, b] = l.channel.split("-").map(Number);
        expect([a, b]).toContain(l.skyGate);
      }
    }
  });

  it("names a channel two people make together only when neither holds both gates", () => {
    for (const p of facts.people) {
      for (const t of p.together) expect(facts.people.map((x) => x.userId)).toContain(t.withUserId);
    }
  });

  it("keeps whole names where two people share a first name", () => {
    const names = callNames([{ userId: "a", name: "Ana Bell" }, { userId: "b", name: "Ana Cruz" }, { userId: "c", name: "Cy" }]);
    expect([...names.values()]).toEqual(["Ana Bell", "Ana Cruz", "Cy"]);
  });

  it("reads the day inward on a waning water moon and outward on a waxing fire moon", () => {
    expect(moodOf(0.8, 3)).toBe("inward");
    expect(moodOf(0.25, 4)).toBe("outward");
    expect(moodOf(0.25, 3)).toBe("steady");
  });
});

describe("the plain reading", () => {
  const people: CardPerson[] = [
    { userId: "m-wren", name: "Wren Alder", chart: WREN },
    { userId: "m-kai", name: "Kai Moss", chart: KAI },
    { userId: "m-sam", name: "Sam Reed", chart: null },
  ];
  const facts = readRoom(people, AUG);
  const card = plainReading(facts);

  it("names everyone present, gives each person read their own line, and labels each paragraph with its system", () => {
    const all = card.collective.map((c) => c.text).join(" ");
    expect(all).toMatch(/Wren/);
    expect(all).toMatch(/Kai/);
    expect(card.welcomed).toEqual(["Sam"]);
    expect(Object.keys(card.lines).sort()).toEqual(["m-kai", "m-wren"]);
    expect(card.lines["m-sam"]).toBeUndefined();
    expect(card.collective.map((c) => c.system)).toEqual(["human-design", "western"]);
  });

  it("names everyone in the room in its first line, and says who was read when that is not everyone", () => {
    const first = card.collective[0].text;
    expect(first).toMatch(/^Here today: Wren, Kai and Sam\. Read from their own lines: Wren and Kai, /);
    expect(first).not.toMatch(/Between you/);
    const all = plainReading(readRoom(people.filter((p) => p.chart), AUG)).collective[0].text;
    expect(all).toMatch(/^Here today: Wren and Kai\. Between you, /);
  });

  it("says the sky once: the panels carry the gates and signs, the reading does not repeat them", () => {
    const all = card.collective.map((c) => c.text).join(" ");
    expect(all).not.toMatch(new RegExp(`gate ${AUG.gates.Sun.gate}, line ${AUG.gates.Sun.line}`));
    const words = skyLines(facts);
    expect(words["human-design"]).toMatch(new RegExp(`gate ${AUG.gates.Sun.gate}, line ${AUG.gates.Sun.line}`));
    expect(words.western).toMatch(/Mercury.*retrograde/);
  });

  it("offers sleeping on a proposal to a room with an emotional authority, and holding a tension when the Moon is void", () => {
    const kinds = suggestionsFor(facts).map((s) => s.kind);
    expect(kinds).toContain("sleep-on-it");
    expect(kinds).toContain("review");
    expect(kinds).toContain("hold-conflict");
  });

  it("speaks in the house voice: no dash between clauses, none of the gate's filler words", () => {
    const words = [...card.collective.map((c) => c.text), ...Object.values(card.lines), ...card.suggestions.map((s) => s.words), ...Object.values(skyLines(facts))];
    for (const w of words) expect(voiceLint(w, "body"), w).toEqual([]);
  });

  it("reads nobody, and says nothing about a room chart, when nobody present said yes", () => {
    const empty = plainReading(readRoom([{ userId: "m-sam", name: "Sam Reed", chart: null }], AUG));
    expect(Object.keys(empty.lines)).toEqual([]);
    expect(empty.welcomed).toEqual(["Sam"]);
    expect(empty.collective.map((c) => c.text).join(" ")).not.toMatch(/Here today/);
  });
});
