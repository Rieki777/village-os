// @vitest-environment jsdom
/**
 * THE FORM A FOUNDER CLEARS THE CONFLICT-DOOR ROW WITH (2026-09-27).
 *
 * The launch checklist's `conflict-door` row blocks the vote, and Departures is
 * the one place it is answered. The server refuses a malformed save
 * (`restorativeDoorProblem`, server/lib/exitPolicy.test.ts); this file holds
 * what the form itself promises:
 *
 *   the cover role cannot be chosen before an intake role, and choosing the
 *   cover's role as the intake role clears the cover, so the two never match;
 *   an emptied reply box sends null, never 0, so no number is invented;
 *   and the cover role says what it does TODAY, which is nothing yet: an intake
 *   reaches the intake role's holders only, and the checklist counts only them.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConflictDoorFields, type ConflictDoorDraft } from "./ConflictDoorFields";

const ROLES = [
  { id: "care", name: "Care" },
  { id: "elders", name: "Elders" },
  { id: "stewards", name: "Stewards" },
];

function draw(restorative: ConflictDoorDraft) {
  const onChange = vi.fn();
  render(<ConflictDoorFields restorative={restorative} roles={ROLES} onChange={onChange} inputCls="" />);
  return onChange;
}

const cover = () => screen.getByLabelText(/^Cover role/) as HTMLSelectElement;
const intake = () => screen.getByLabelText(/^Restorative intake role/) as HTMLSelectElement;
const reply = () => screen.getByLabelText(/^Promised reply time/) as HTMLInputElement;

describe("ConflictDoorFields", () => {
  it("keeps the cover role shut until an intake role is chosen", () => {
    draw({ intakeContactRole: "" });
    expect(cover().disabled).toBe(true);
  });

  it("clears the cover when the intake role is set to the cover's role", () => {
    const onChange = draw({ intakeContactRole: "care", coverRole: "elders" });
    expect(cover().disabled).toBe(false);
    fireEvent.change(intake(), { target: { value: "elders" } });
    expect(onChange).toHaveBeenCalledWith({ intakeContactRole: "elders", coverRole: "" });
  });

  it("clears the cover when the intake role is cleared", () => {
    const onChange = draw({ intakeContactRole: "care", coverRole: "elders" });
    fireEvent.change(intake(), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ intakeContactRole: "", coverRole: "" });
  });

  it("keeps the cover when the intake role moves to a third role", () => {
    const onChange = draw({ intakeContactRole: "care", coverRole: "elders" });
    fireEvent.change(intake(), { target: { value: "stewards" } });
    expect(onChange).toHaveBeenCalledWith({ intakeContactRole: "stewards" });
  });

  it("sends null for an emptied reply box, so the platform never supplies a number", () => {
    const onChange = draw({ intakeContactRole: "care", replyHours: 48 });
    expect(reply().value).toBe("48");
    fireEvent.change(reply(), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ replyHours: null });
  });

  it("shows each role's live holders in the picker, and links an unheld intake role to where a holder is seated (W2-intake-picker-holders)", () => {
    render(
      <ConflictDoorFields
        restorative={{ intakeContactRole: "care" }}
        roles={[
          { id: "care", name: "Care", liveHolderCount: 0 },
          { id: "elders", name: "Elders", liveHolderCount: 2 },
        ]}
        onChange={vi.fn()}
        inputCls=""
      />,
    );
    const options = Array.from(intake().options).map((o) => o.textContent);
    expect(options).toContain("Care (nobody holds it today)");
    expect(options).toContain("Elders (held by 2 today)");
    const seat = screen.getByRole("link", { name: /give the role a holder/i });
    expect(seat.getAttribute("href")).toBe("/admin?tab=game-roles");
    expect(screen.getByText(/Nobody holds the Care role today/)).toBeTruthy();
  });

  it("offers no seating link while the intake role has a live holder", () => {
    render(
      <ConflictDoorFields restorative={{ intakeContactRole: "elders" }} roles={[{ id: "elders", name: "Elders", liveHolderCount: 1 }]} onChange={vi.fn()} inputCls="" />,
    );
    expect(screen.queryByRole("link", { name: /give the role a holder/i })).toBeNull();
    expect(Array.from(intake().options).map((o) => o.textContent)).toContain("Elders (held by 1 today)");
  });

  it("says the cover role is recorded only, and that a request still reaches the intake role alone", () => {
    draw({ intakeContactRole: "care" });
    const label = cover().closest("label");
    expect(label?.textContent).toContain("Cover role, recorded only for now");
    expect(label?.textContent).toContain(
      "A request still goes only to the intake role, and the checklist counts only its holders.",
    );
    expect(label?.textContent).not.toContain("when the intake role cannot");
  });
});
