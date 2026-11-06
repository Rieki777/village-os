/**
 * THE EXAMPLES A FOUNDER IS SHOWN NAME NOBODY'S VILLAGE (readiness R065).
 *
 * Admin's examples were the first village's own facts: its ground
 * (9.2345, -83.8412, under a kilometre from its georeference), its timezone
 * and its two Costa Rican seasons, in the Land tab's placeholder, the
 * coordinate parser's three refusals and the season dial's error. The
 * replacements are deliberately nobody's: 12.3456, -45.6789 is placeholder
 * digits in the open Atlantic, the seasons are farm words any climate has,
 * and the timezone placeholder is one of the IANA examples the season
 * refusal already names.
 *
 * AN EXAMPLE IS A PROMISE THAT IT WORKS, so each one shown here is fed back to
 * the parser it is shown beside, and must be accepted.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCoordinates } from "./land";
import { parseVillageSeasons, villageSeasonsProblem } from "./villageSeasons";
import { VARIABLES_BY_KEY } from "./gameVariables";

const FIRST_VILLAGE = /9\.23\d*|-?83\.8\d*|9 14 04|83 50 28|Costa[ _]Rica|Dry: 12-01|Green: 05-01/;

/** The refusals a founder can meet, one input each. */
const REFUSALS = {
  unreadable: "somewhere near the river",
  oneNumber: "12.5",
};

describe("the coordinate parser's examples", () => {
  const messages = Object.values(REFUSALS).map((input) => {
    const r = parseCoordinates(input);
    if (r.ok) throw new Error(`expected a refusal for ${input}`);
    return r.message;
  });

  it("name no village's ground", () => {
    for (const m of messages) expect(m).not.toMatch(FIRST_VILLAGE);
  });

  it("are pairs the parser accepts, and the decimal and the degrees name the same point", () => {
    const all = messages.join(" ");
    const decimal = all.match(/-?\d+\.\d+, -?\d+\.\d+/)?.[0];
    const dms = all.match(/\d+ \d+ \d+\.\d [NS] \d+ \d+ \d+\.\d [EW]/)?.[0];
    expect(decimal, "a decimal example is shown").toBeTruthy();
    expect(dms, "a degrees-and-minutes example is shown").toBeTruthy();
    const a = parseCoordinates(decimal!);
    const b = parseCoordinates(dms!);
    if (!a.ok || !b.ok) throw new Error("an example the parser refuses");
    expect(Math.abs(a.lat - b.lat)).toBeLessThan(0.0001);
    expect(Math.abs(a.lon - b.lon)).toBeLessThan(0.0001);
  });
});

describe("the Land tab's placeholder", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "components", "admin", "LandTab.tsx"), "utf8");
  const placeholder = source.match(/placeholder="(-?\d+\.\d+, -?\d+\.\d+)"/)?.[1];

  it("is a pair the parser accepts, and names no village's ground", () => {
    expect(placeholder).toBeTruthy();
    expect(placeholder).not.toMatch(FIRST_VILLAGE);
    expect(parseCoordinates(placeholder!).ok).toBe(true);
  });
});

describe("the season examples", () => {
  const problem = villageSeasonsProblem("not a season list") ?? "";
  const dial = VARIABLES_BY_KEY["calendar.seasons"];

  it("name no village's seasons, in the refusal and on the dial", () => {
    expect(problem).toBeTruthy();
    expect(problem).not.toMatch(FIRST_VILLAGE);
    expect(dial, "the season dial is still described").toBeTruthy();
    expect(String(dial!.description)).not.toMatch(FIRST_VILLAGE);
  });

  it("are lists the parser accepts", () => {
    const example = problem.match(/such as (.+)\.$/)?.[1];
    expect(example).toBeTruthy();
    expect(parseVillageSeasons(example!)?.length).toBe(2);
  });
});

describe("the season timezone placeholder", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "client", "src", "components", "admin", "SeasonTimezoneField.tsx"), "utf8");

  it("is a real zone and names no village's clock", () => {
    const placeholder = source.match(/placeholder="([^"]+)"/)?.[1] ?? "";
    expect(placeholder).not.toMatch(FIRST_VILLAGE);
    expect(() => new Intl.DateTimeFormat("en", { timeZone: placeholder })).not.toThrow();
  });
});
