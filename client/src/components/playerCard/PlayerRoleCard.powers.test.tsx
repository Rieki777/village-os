// @vitest-environment jsdom
/**
 * A10 (2026-10-31): a role's powers on the card, as a reader sees them.
 *
 * A power handed to the role is a live chip. A "Suited to" reading is a quiet
 * line under the chips, because the village has handed nothing over yet, and it
 * must never look like a power the holder has.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PlayerRoleCardView } from "./PlayerRoleCard";
import { fixturePayload, fixtureRole } from "@/test/playerCardFixture";

afterEach(cleanup);

const SEAT = { key: "org.seat", label: "Places people in roles" };
const DIAL = { key: "dial.set", label: "Turns the village's dials" };

const draw = (over: Record<string, unknown>) =>
  render(<PlayerRoleCardView data={fixturePayload(1, "self", { roles: [{ ...fixtureRole(1), ...over }] })} />);
const article = () => document.getElementById("role-r1")!;
const liveChips = () => Array.from(article().querySelectorAll('[data-role-chip="power"]')).map((c) => c.textContent);
const suitedLine = () => article().querySelector('[data-role-powers="suited"]');

describe("a role's powers on its card", () => {
  it("draws a handed-over power as a live chip, with no suited line", () => {
    draw({ powers: [SEAT], suited: [DIAL] });
    expect(liveChips()).toEqual(["Places people in roles"]);
    expect(suitedLine()).toBeNull();
  });

  it("draws what a role suits as a quiet line, never as a live chip", () => {
    draw({ powers: [], suited: [SEAT, DIAL] });
    expect(liveChips()).toEqual([]);
    expect(suitedLine()?.textContent).toBe(
      "Suited to: Places people in roles, Turns the village's dials. The village has not handed these over.",
    );
    // A dim line wraps with the rest of the card's text: it carries no width of its own.
    expect(suitedLine()?.className).toBe("pc-dim");
  });

  it("draws neither when the role has nothing handed over and suits nothing", () => {
    draw({ powers: [], suited: [] });
    expect(liveChips()).toEqual([]);
    expect(suitedLine()).toBeNull();
  });
});
