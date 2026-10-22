// @vitest-environment jsdom
/**
 * THE PLAYER CARD'S CONTRAST, on both grounds it is drawn on.
 *
 * The owner reads it on the profile's night sheet (`.sheet-night`, measured
 * with `nightOverlay()`), and everybody else reads it on the light public
 * profile. Measured through client/src/test/tokenContrast.ts from the classes
 * each line and its ancestors carry, the same instrument as
 * SeatTradingCard.contrast.test.tsx. Floors: body text 4.5, large text 3.
 * The card draws no gradient, so nothing is flattened.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describeFailures, measureText, nightOverlay } from "@/test/tokenContrast";
import { fixturePayload } from "@/test/playerCardFixture";
import { PlayerRoleCardView } from "./PlayerRoleCard";

afterEach(() => cleanup());

const NIGHT = nightOverlay();
const root = () => document.querySelector("[data-player-card]")!;

const CASES: Array<[string, number, "self" | "member" | "stranger"]> = [
  ["no roles, the owner", 0, "self"],
  ["one role, a member", 1, "member"],
  ["six roles, the owner", 6, "self"],
];

describe("the player card clears every floor", () => {
  for (const [label, n, level] of CASES) {
    it(`on the owner's night sheet: ${label}`, () => {
      render(
        <div className="sheet-night">
          <PlayerRoleCardView data={fixturePayload(n, level)} />
        </div>,
      );
      const results = measureText(root(), "light", NIGHT);
      expect(results.length).toBeGreaterThan(10);
      expect(describeFailures(results)).toEqual([]);
    });

    it(`on the light public profile: ${label}`, () => {
      render(<PlayerRoleCardView data={fixturePayload(n, level)} />);
      const results = measureText(root(), "light");
      expect(results.length).toBeGreaterThan(10);
      expect(describeFailures(results)).toEqual([]);
    });
  }

  it("in edit mode, with every edit control showing", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "self")} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    expect(describeFailures(measureText(root(), "light", NIGHT))).toEqual([]);
    expect(describeFailures(measureText(root(), "light"))).toEqual([]);
  });
});
