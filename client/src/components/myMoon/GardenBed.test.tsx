// @vitest-environment jsdom
/**
 * THE SCORE AS A GARDEN BED (the prune, wave 2, C11). The member's own view
 * draws what was tended as plants, with no ring and no percent. The band
 * sentences stay, folded under a note. The approvers' queue is the lead's
 * (D3) and is not rendered here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScoreBlock, gardenBed } from "./CoverageAndScore";

afterEach(cleanup);

const score = (done: number, partly: number, carry: number) => ({
  numHalves: done * 2 + partly,
  den: done + partly + carry,
  pct: done + partly + carry === 0 ? null : Math.round(((done + partly / 2) / (done + partly + carry)) * 100),
  done,
  partly,
  carry,
  leftOut: { letGo: 0, redirect: 0, lastWeekNotDone: 0, olderThanMoon: 0 },
});

describe("gardenBed", () => {
  it("plants one flower per done, one bud per partly, one seed per carry", () => {
    expect(gardenBed({ done: 2, partly: 1, carry: 1 })).toEqual(["flowered", "flowered", "bud", "seed"]);
    expect(gardenBed({ done: 0, partly: 0, carry: 0 })).toEqual([]);
  });
});

describe("ScoreBlock", () => {
  it("draws the bed and the role beds with no percent, no ring and no fraction", () => {
    const { container } = render(
      <ScoreBlock
        data={{
          taskScore: score(12, 1, 5),
          taskReading: { band: "steady", label: "Steady", says: "A steady moon.", lines: [], capped: false },
          seatCoverage: { on: 3, total: 4, pct: 75 },
          seatReading: null,
        }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/%|½| of \d+/);
    expect(screen.getByTestId("garden-bed").getAttribute("aria-label")).toBe("12 flowered, 1 in bud, 5 seed kept");
    expect(container.querySelectorAll('[data-testid="garden-bed"] [data-plant="flowered"]')).toHaveLength(12);
    expect(container.querySelectorAll('[data-testid="role-beds"] [data-plant="tended"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid="role-beds"] [data-plant="resting"]')).toHaveLength(1);
    // The band sentence is kept, folded under a gentle note.
    expect(container.querySelector("details")?.textContent).toContain("A steady moon.");
  });

  it("says plainly when nothing is counted yet", () => {
    render(<ScoreBlock data={{ taskScore: score(0, 0, 0), taskReading: null, seatCoverage: { on: 0, total: 0, pct: null }, seatReading: null }} />);
    expect(screen.getByTestId("moon-score").textContent).toContain("Nothing to count yet");
    expect(screen.queryByTestId("role-beds")).toBeNull();
  });
});
