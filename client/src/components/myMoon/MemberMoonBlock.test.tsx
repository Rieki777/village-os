// @vitest-environment jsdom
/**
 * The This moon block on another member's profile: their sent items marked
 * Members, grouped by role, a count where items are held privately, and
 * nothing at all when there is nothing to show. Every person is invented.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MOON_WORDS, OUTSIDE_MY_ROLES, type MemberMoonResponse } from "@shared/moonRecap";
import { MemberMoonView } from "./MemberMoonBlock";

afterEach(cleanup);

const MOON: MemberMoonResponse["moon"] = {
  cycleId: "lunar-2026-10", firstDay: "2026-10-10", lastDay: "2026-11-08", periodWords: "10 October to 8 November 2026",
  endOfMoonFriday: "2026-11-05", sendBy: "2026-11-09", halfwayDay: "2026-10-25",
};

describe("MemberMoonView", () => {
  it("lists the member-visible items under each role, with a link only where one is given", () => {
    render(
      <MemberMoonView
        data={{
          moon: MOON,
          roles: [
            { roleId: "role-seeds", name: "Seed keeper", heldPrivately: 0, items: [
              { id: "mi-1", text: "Mapped the seed bank shelves", evidenceUrl: "https://example.org/map", seasonGoalId: null },
              { id: "mi-2", text: "Ran the seed swap", evidenceUrl: null, seasonGoalId: null },
            ] },
          ],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: MOON_WORDS.thisMoon })).toBeTruthy();
    expect(screen.getByText("Seed keeper")).toBeTruthy();
    expect((screen.getByText("Mapped the seed bank shelves") as HTMLAnchorElement).getAttribute("href")).toBe("https://example.org/map");
    expect(screen.getByText("Ran the seed swap").tagName).toBe("LI");
  });

  it("says how many items are held privately, and never their words", () => {
    render(
      <MemberMoonView
        data={{
          moon: MOON,
          roles: [
            { roleId: "role-seeds", name: "Seed keeper", heldPrivately: 1, items: [{ id: "mi-1", text: "Ran the seed swap", evidenceUrl: null, seasonGoalId: null }] },
            { roleId: null, name: OUTSIDE_MY_ROLES, heldPrivately: 2, items: [] },
          ],
        }}
      />,
    );
    expect(screen.getByText("1 item held privately")).toBeTruthy();
    expect(screen.getByText("2 items held privately")).toBeTruthy();
    expect(screen.getByText(OUTSIDE_MY_ROLES)).toBeTruthy();
  });

  it("carries no amount and no score", () => {
    render(<MemberMoonView data={{ moon: MOON, roles: [{ roleId: "r", name: "Seed keeper", heldPrivately: 0, items: [{ id: "i", text: "Ran the seed swap", evidenceUrl: null, seasonGoalId: null }] }] }} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[$€£]|\d+%|USD/);
  });

  it("draws nothing when the recap has nothing to show", () => {
    const { container } = render(<MemberMoonView data={{ moon: MOON, roles: [] }} />);
    expect(container.innerHTML).toBe("");
  });
});
