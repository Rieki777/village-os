// @vitest-environment jsdom
/** The admin is told the panel's pay door closes at launch; a holder sees nothing (G-B3). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PayDoorNote from "./PayDoorNote";

afterEach(cleanup);

describe("the pay door note", () => {
  it("tells an admin before launch that the door closes when the launch vote carries", () => {
    render(<PayDoorNote door="admin-before-launch" />);
    expect(screen.getByText(/stays open until the launch vote carries/)).toBeTruthy();
  });
  it("tells an admin with no steward seated why the door is still open", () => {
    render(<PayDoorNote door="admin-no-steward" />);
    expect(screen.getByText(/the village has no steward yet/)).toBeTruthy();
  });
  it("shows a holder nothing", () => {
    const { container } = render(<PayDoorNote door="holder" />);
    expect(container.textContent).toBe("");
  });
});
