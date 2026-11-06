// @vitest-environment jsdom
/**
 * THE TYPE STEP AND WHO CARRIES A VOTE (audit of Wave 4, 2026-10-01).
 *
 * The agreement became conductable this wave, so its card went live for every
 * member. Its route, like the seat's and the purpose statement's, opens the
 * vote itself and asks the opener for `proposal.open`, which an ordinary
 * admitted member does not hold: such a member wrote the whole agreement and
 * was refused at the last step. The server already sent `mayOpenBallot` and no
 * client code read it. These cases hold the card to it, and keep a type that
 * goes to the village's sensing step (a dial change) open to every member.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TypeCards from "./TypeCards";

const CONDUCTABLE = ["mechanics", "power_transfer", "power_grant", "power_return", "role_seat", "gps_change", "agreement"];
const ADVISORY = ["role_application", "badge_grant", "quest_payout"];

const draw = (mayOpenBallot: boolean, onChoose = vi.fn()) =>
  render(
    <TypeCards
      chosen={null}
      conductable={CONDUCTABLE}
      advisory={ADVISORY}
      mayOpenAdvisory={mayOpenBallot}
      mayOpenBallot={mayOpenBallot}
      onChoose={onChoose}
      onPractice={vi.fn()}
    />,
  );

const card = (title: string) => screen.getByText(title).closest("button") as HTMLButtonElement;

describe("a type whose route opens the vote itself", () => {
  it("is carried by somebody else for a member who may not open a vote, and says who", () => {
    const onChoose = vi.fn();
    draw(false, onChoose);
    for (const title of ["Write an agreement", "Seat someone in a role", "Change what this village is for"]) {
      const b = card(title);
      expect(b.disabled, title).toBe(true);
      expect(b.textContent, title).toContain("A member who holds the power to open votes puts this one to the village.");
      expect(b.textContent, `${title}: the village can open it, so it is not called impossible`).not.toContain(
        "This village cannot open that kind of decision yet.",
      );
    }
    fireEvent.click(card("Write an agreement"));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("is live for a member who may open a vote", () => {
    const onChoose = vi.fn();
    draw(true, onChoose);
    const b = card("Write an agreement");
    expect(b.disabled).toBe(false);
    fireEvent.click(b);
    expect(onChoose).toHaveBeenCalledWith("agreement");
  });

  it("leaves a change to a dial open to every member, since it goes to the village's sensing step first", () => {
    draw(false);
    expect(card("Change a rule").disabled).toBe(false);
  });
});
