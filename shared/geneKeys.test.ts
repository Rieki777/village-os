/**
 * GENE KEYS AND HUMAN DESIGN, HELD TO WHAT THE PUBLIC CALCULATORS SAID.
 *
 * Every birth here is invented ("Amora Test" on the calculators) and was run
 * through genekeys.com/free-profile, humandesignchart.org and arcanepattern.com
 * on 2026-10-22. The expectations are what those sites printed, not what this
 * code produced, so a regression in the sky maths or the type rules fails here.
 * The scripts that ran them live outside the repo (Desktop/Amora/GENEKEYS-spike).
 */
import { describe, expect, it } from "vitest";
import {
  BODIES, PROFILES, SPHERES, analyse, chartProblems, gateLine, lineWord, oppositeGate, profileOf, sphereOf,
  type Chart,
} from "./geneKeys";
import { chartAt, resultsAcross, zonedToUtc } from "./geneKeysSky";

const kl = (a: { gate: number; line: number }) => `${a.gate}.${a.line}`;
const activation = (chart: Chart) => (["lifesWork", "evolution", "radiance", "purpose"] as const).map((s) => kl(sphereOf(chart, s))).join(" ");

/** genekeys.com, Activation Sequence: Life's Work, Evolution, Radiance, Purpose. */
const GENEKEYS_COM = [
  { name: "New York, Radiance 1% into its line", zone: "America/New_York", local: [1990, 6, 15, 14, 30], keys: "12.2 11.2 36.5 6.5" },
  { name: "London, 2 min before a Life's Work line change", zone: "Europe/London", local: [2001, 7, 10, 4, 2], keys: "53.3 54.3 51.6 57.6" },
  { name: "London, 3 min after it", zone: "Europe/London", local: [2001, 7, 10, 4, 7], keys: "53.4 54.4 51.6 57.6" },
  { name: "Reykjavik 1960, read with today's offset as genekeys.com does", zone: "Atlantic/Reykjavik", local: [1960, 1, 10, 2, 30], keys: "54.4 53.4 32.1 42.1" },
  { name: "Tokyo, 2 min before a Radiance line change", zone: "Asia/Tokyo", local: [1995, 3, 3, 14, 54], keys: "63.1 64.1 5.3 35.3" },
  { name: "Tokyo, 4 min after it", zone: "Asia/Tokyo", local: [1995, 3, 3, 15, 0], keys: "63.1 64.1 5.4 35.4" },
  { name: "Adelaide, half-hour zone in summer time", zone: "Australia/Adelaide", local: [1985, 1, 20, 9, 15], keys: "60.4 56.4 50.6 3.6" },
] as const;

/** Human Design type, profile and authority as the calculators printed them. */
const HUMAN_DESIGN = [
  { name: "T1 New York", zone: "America/New_York", local: [1990, 6, 15, 14, 30], type: "Manifestor", profile: "2/5", authority: "Emotional" },
  { name: "T2 London", zone: "Europe/London", local: [2001, 7, 10, 4, 2], type: "Generator", profile: "3/6", authority: "Emotional" },
  { name: "T3 London", zone: "Europe/London", local: [2001, 7, 10, 4, 7], type: "Generator", profile: "4/6", authority: "Emotional" },
  { name: "T5 Tokyo", zone: "Asia/Tokyo", local: [1995, 3, 3, 14, 54], type: "Generator", profile: "1/3", authority: "Sacral" },
  { name: "T6 Tokyo", zone: "Asia/Tokyo", local: [1995, 3, 3, 15, 0], type: "Generator", profile: "1/4", authority: "Sacral" },
  { name: "T7 Adelaide", zone: "Australia/Adelaide", local: [1985, 1, 20, 9, 15], type: "Generator", profile: "4/6", authority: "Sacral" },
  // The node model decides these two: the mean node would make N2 a Projector and N3 a Manifesting Generator.
  { name: "N2 London, true node", zone: "Europe/London", local: [1989, 12, 18, 8, 0], type: "Generator", profile: "5/1", authority: "Emotional" },
  { name: "N3 London, true node", zone: "Europe/London", local: [1983, 1, 1, 11, 0], type: "Generator", profile: "2/4", authority: "Sacral" },
  // humandesignchart.org prints Generator here; arcanepattern.com and the standard rule say Manifesting Generator.
  { name: "N1 London, Sacral reaches the Throat through the G", zone: "Europe/London", local: [1992, 11, 18, 4, 0], type: "Manifesting Generator", profile: "2/4", authority: "Sacral" },
] as const;

const birth = (zone: string, l: readonly number[]) => chartAt(zonedToUtc(l[0], l[1], l[2], l[3], l[4], zone));

describe("the Activation Sequence matches genekeys.com", () => {
  for (const b of GENEKEYS_COM) {
    it(b.name, () => {
      expect(activation(birth(b.zone, b.local))).toBe(b.keys);
    });
  }
});

describe("type, profile and authority match the Human Design calculators", () => {
  for (const b of HUMAN_DESIGN) {
    it(b.name, () => {
      const chart = birth(b.zone, b.local);
      const d = analyse(chart);
      expect({ type: d.type, profile: profileOf(chart), authority: d.authority }).toEqual({ type: b.type, profile: b.profile, authority: b.authority });
    });
  }
});

describe("all 26 activations and all 11 spheres for one birth", () => {
  const chart = birth("America/New_York", [1990, 6, 15, 14, 30]);

  it("matches humandesignchart.org body by body, true node included", () => {
    const design = "36.5 6.5 13.3 7.3 34.1 36.3 19.4 41.3 15.4 61.3 58.6 38.6 1.5";
    const personality = "12.2 11.2 19.1 33.1 22.3 16.1 23.1 21.2 53.1 61.4 58.5 38.5 1.3";
    expect(BODIES.map((b) => kl(chart.design[b])).join(" ")).toBe(design);
    expect(BODIES.map((b) => kl(chart.personality[b])).join(" ")).toBe(personality);
  });

  it("matches genekeys.com sphere by sphere", () => {
    const spheres = "12.2 11.2 36.5 6.5 34.1 23.1 21.2 19.4 41.3 15.4 53.1";
    expect(SPHERES.map((s) => kl(sphereOf(chart, s))).join(" ")).toBe(spheres);
  });
});

describe("the wheel", () => {
  it("puts gate 25 at the March equinox and 41 at 2 Aquarius", () => {
    expect(gateLine(0).gate).toBe(25);
    expect(gateLine(302)).toEqual({ gate: 41, line: 1 });
    expect(gateLine(301.99).gate).toBe(60);
  });

  it("pairs every gate with one opposite, both ways", () => {
    for (let g = 1; g <= 64; g++) expect(oppositeGate(oppositeGate(g))).toBe(g);
    expect(oppositeGate(25)).toBe(46);
  });

  it("names lines with the Life's Work words", () => {
    expect([1, 2, 3, 4, 5, 6].map(lineWord)).toEqual(["Creator", "Dancer", "Changer", "Server", "Fixer", "Teacher"]);
  });
});

describe("a chart a browser sends is checked against the sky's own rules", () => {
  const real = birth("Europe/London", [2001, 7, 10, 4, 2]);

  it("passes a real chart, and only the twelve profiles ever appear", () => {
    expect(chartProblems(real)).toEqual([]);
    for (let i = 0; i < 40; i++) {
      const c = chartAt(new Date(Date.UTC(1950, 0, 1) + i * 1_000_003_000));
      expect(chartProblems(c)).toEqual([]);
      expect(PROFILES).toContain(profileOf(c));
    }
  });

  it("refuses an Earth that is not opposite the Sun", () => {
    const bad = structuredClone(real);
    bad.personality.Earth = { gate: 1, line: 3 };
    expect(chartProblems(bad)).toContain("personality Earth is not opposite the Sun.");
  });

  it("refuses a design Sun that is not 88 degrees back", () => {
    const bad = structuredClone(real);
    bad.design.Sun = { ...real.personality.Sun };
    bad.design.Earth = { ...real.personality.Earth };
    expect(chartProblems(bad)).toContain("The design Sun is not 88 degrees behind the personality Sun.");
  });

  it("refuses a line out of range and a missing side", () => {
    const bad = structuredClone(real);
    bad.design.Moon = { gate: 12, line: 7 };
    expect(chartProblems(bad)).toContain("design Moon is not a gate and line.");
    expect(chartProblems({ personality: real.personality })).toHaveLength(1);
  });
});

describe("birth time windows", () => {
  it("finds the London change at 4:05 to the minute", () => {
    const w = resultsAcross({ year: 2001, month: 7, day: 10 }, "Europe/London", 4 * 60 - 28, 4 * 60 + 32, 5);
    expect(w.map((x) => [x.from, x.to, x.result.profile])).toEqual([
      [212, 245, "3/6"],
      [245, 273, "4/6"],
    ]);
  });

  it("gives one window when time does not matter in the span", () => {
    const w = resultsAcross({ year: 1985, month: 1, day: 20 }, "Australia/Adelaide", 9 * 60, 9 * 60 + 20, 5);
    expect(w).toHaveLength(1);
    expect(w[0].result.profile).toBe("4/6");
  });
});
