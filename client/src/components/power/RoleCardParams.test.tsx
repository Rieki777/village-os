// @vitest-environment jsdom
/**
 * The parameters block of the full card (role journey PR-C): drawn from the one
 * view model, with the pay range below the role for a reader who cannot open
 * the terms drawer, and Being written while the village holds Apply back.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RoleCardParams from "./RoleCardParams";
import { applyHrefFor, guardedAction, termsSlotFor } from "./SeatTermsSlot";

const card = {
  complete: true, missing: [], gated: true, track: "paid", villageGoals: ["Fund the land"], selectionCriteria: ["Careful"],
  conversations: [{ roleId: "h", roleName: "Human Operations Lead", minutes: 60 }, { roleId: "v", roleName: "Visionary Channel", minutes: 20, final: true }],
  whereWorked: "both", languages: ["English"], reviewAfterDays: 90,
  publicPay: { kind: "range", currency: "USD", minMinor: 200000, maxMinor: 300000, per: "month", note: "Depends on funding" },
};

describe("RoleCardParams", () => {
  it("draws the parameters, the commitment as a percentage with no hours, the interviews in order, and the pay range for a visitor", () => {
    render(<RoleCardParams seat={{ id: "r", timeCommitment: "40 hours a week", card: { ...card, commitmentPct: 40 } }} />);
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.queryByText(/Roughly|hours a week/)).toBeNull();
    expect(screen.getByText("1. Human Operations Lead, 1 hour")).toBeTruthy();
    expect(screen.getByText("2. Visionary Channel, 20 minutes, final approval")).toBeTruthy();
    expect(screen.getByTestId("public-pay").textContent).toContain("Depends on funding");
  });

  it("leaves the pay to the terms drawer for a reader of terms (control: the same card shows it without termsOffer)", () => {
    const { rerender } = render(<RoleCardParams seat={{ id: "r", termsOffer: null, card }} />);
    expect(screen.queryByTestId("public-pay")).toBeNull();
    rerender(<RoleCardParams seat={{ id: "r", card }} />);
    expect(screen.getByTestId("public-pay")).toBeTruthy();
  });

  it("says Being written and takes Apply away while the village gates an incomplete card", () => {
    const held = { id: "r", termsOffer: null, card: { ...card, complete: false, missing: ["aim", "term"] } };
    render(<RoleCardParams seat={held} />);
    expect(screen.getByTestId("being-written").textContent).toBe("Being written. Still to write: its aim, its term.");
    expect(applyHrefFor(held)).toBeNull();
    expect(guardedAction(held, <span>raise</span>)).toBeNull();
    // Controls: the complete card keeps its apply door and its action.
    const done = { id: "r", termsOffer: null, card };
    expect(applyHrefFor(done)).not.toBeNull();
    expect(guardedAction(done, <span>raise</span>)).not.toBeNull();
  });

  it("reaches a visitor with the block and no terms drawer", () => {
    expect(termsSlotFor({ id: "r", card })).toBeTruthy();
    expect(termsSlotFor({ id: "r" })).toBeUndefined();
  });
});
