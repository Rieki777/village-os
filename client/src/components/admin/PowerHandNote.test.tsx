// @vitest-environment jsdom
/**
 * The inbox note for a hand raised for a power.
 *
 * It says what the hand asks for in one sentence, and it says that saying yes
 * grants nothing. That second sentence carries the weight: the inbox's status
 * select sits beside it, and "Accepted" on an offer to take on a power reads
 * like a grant to anybody who has not read how powers reach people. It names the
 * two screens that do grant one, and The Handover is the only screen that gives
 * a role a power, so a note naming Game Roles alone sent founders to a screen
 * that cannot.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { POWER_HAND_KEYS, PowerHandNote } from "./PowerHandNote";

describe("PowerHandNote", () => {
  it("says what the hand asks for, that saying yes grants nothing, and where a power is actually given", () => {
    render(
      <PowerHandNote
        data={{
          capability: "library.keep",
          powerLabel: "Keep the shared library and its loans",
          suits: ["The Architect"],
          note: "I keep the tool shed",
        }}
      />,
    );
    expect(screen.getByText("Asks to keep the shared library and its loans. It suits The Architect, which they play.")).toBeTruthy();
    const next = screen.getByText(/Saying yes here gives them nothing yet/).textContent ?? "";
    expect(next).toContain("seat them on a role that carries it under Game Roles");
    expect(next).toContain("give the power to a role under The Handover");
  });

  it("leaves the note itself to the inbox table, which prints what the member typed", () => {
    expect(POWER_HAND_KEYS).not.toContain("note");
  });
});
