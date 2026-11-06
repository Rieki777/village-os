// @vitest-environment jsdom
/**
 * An open terms row names the operations role from the village's chart.
 * A chart with none keeps the fallback, and names no village.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OPS_FALLBACK } from "@shared/roleProposalHonesty";
import SeatSettingsEditor from "./SeatSettingsEditor";
import SeatTermsDrawer from "@/components/power/SeatTermsDrawer";

vi.mock("./pickSources", () => ({
  loadOrg: async () => ({ roles: [{ name: "Operations Steward", active: true }] }),
}));

describe("an open row names the chart's operations role", () => {
  it("uses the role the village named, on the editor and the settings drawer", async () => {
    render(<SeatSettingsEditor value={{ v: 1 }} onChange={() => {}} />);
    expect((await screen.findAllByText("We'll fill this together with Operations Steward.")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(OPS_FALLBACK);

    render(<SeatTermsDrawer settings={{ v: 1, pay: { kind: "none" } }} defaultOpen />);
    expect(await screen.findByText(/We'll fill this together with Operations Steward: Term, Clocks/)).toBeTruthy();
  });
});
