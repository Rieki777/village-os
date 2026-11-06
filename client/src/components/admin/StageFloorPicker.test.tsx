// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StageFloorPicker, floorAfterToggle } from "./StageFloorPicker";

const STAGES = [
  { id: "visitor", name: "Visitor" },
  { id: "guest", name: "Guest" },
  { id: "member", name: "Member" },
  { id: "sage", name: "Sage" },
];

afterEach(cleanup);

describe("floorAfterToggle", () => {
  it("ticking a level above the floor makes it the floor", () => {
    expect(floorAfterToggle(STAGES, null, 2)).toBe("member");
    expect(floorAfterToggle(STAGES, "guest", 3)).toBe("sage");
  });
  it("unticking a level at or below the floor drops the floor to the level beneath it", () => {
    expect(floorAfterToggle(STAGES, "member", 2)).toBe("guest");
    expect(floorAfterToggle(STAGES, "member", 1)).toBe("visitor");
    expect(floorAfterToggle(STAGES, "member", 0)).toBeNull();
  });
});

describe("StageFloorPicker", () => {
  it("shows the floor and every stage below it as ticked", () => {
    render(<StageFloorPicker stages={STAGES} value="member" onChange={() => {}} />);
    expect(screen.getByText("Granted: Member and below")).toBeInTheDocument();
    expect(screen.getByLabelText("Visitor")).toBeChecked();
    expect(screen.getByLabelText("Guest")).toBeChecked();
    expect(screen.getByLabelText("Member")).toBeChecked();
    expect(screen.getByLabelText("Sage")).not.toBeChecked();
  });
  it("sends the new floor when a level is ticked, and null when the grant is removed", () => {
    const onChange = vi.fn();
    render(<StageFloorPicker stages={STAGES} value="guest" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Sage"));
    expect(onChange).toHaveBeenLastCalledWith("sage");
    fireEvent.click(screen.getByRole("button", { name: "Remove the grant" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
