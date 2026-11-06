// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminHeader from "./AdminHeader";
import { announceHandled } from "./handledToday";
import { describeFailures, measureText, nightOverlay } from "@/test/tokenContrast";

beforeEach(() => localStorage.clear());

function header(night: boolean, onNight = vi.fn(), onSignOut = vi.fn()) {
  return render(
    <AdminHeader
      villageName="North Wind"
      siteUrl="https://north.example"
      night={night}
      onNight={onNight}
      onSignOut={onSignOut}
    />,
  );
}

describe("admin header", () => {
  it("shows the village, the filter link, and a night look that starts off", async () => {
    const onNight = vi.fn();
    const onSignOut = vi.fn();
    header(false, onNight, onSignOut);
    expect(screen.getByRole("heading", { name: "North Wind Admin" })).toBeTruthy();
    expect(screen.getByText("north.example")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change the filters" }).getAttribute("href")).toBe("/modules");
    expect(screen.getByText(/Handled today: 0, on this device/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Night look, off" }));
    expect(onNight).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("counts a handled item without asking the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    header(false);
    announceHandled();
    expect(await screen.findByText(/Handled today: 1, on this device/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps readable text in day and night", () => {
    const day = header(false);
    expect(describeFailures(measureText(day.container, "light"))).toEqual([]);
    day.unmount();
    const night = header(true);
    expect(describeFailures(measureText(night.container, "light", nightOverlay()))).toEqual([]);
  });
});
