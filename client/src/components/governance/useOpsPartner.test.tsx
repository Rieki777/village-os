// @vitest-environment jsdom
/**
 * An open terms row names the role the village names to welcome people
 * (`org.onboarding_role`), read by id. A role whose name says "Operations"
 * is never picked for its name (verify report B4). A village that names none
 * keeps the fallback, and names no village.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OPS_FALLBACK } from "@shared/roleProposalHonesty";
import SeatSettingsEditor from "./SeatSettingsEditor";
import SeatTermsDrawer from "@/components/power/SeatTermsDrawer";
import { resetOnboardingRoleRead } from "./useOpsPartner";

vi.mock("./pickSources", () => ({
  loadOrg: async () => ({
    roles: [
      { id: "tech-ops", name: "Technical Operations Steward", active: true },
      { id: "welcome", name: "Care and Onboarding Steward", active: true },
    ],
  }),
}));

function dial(value: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ variables: [{ key: "org.onboarding_role", value }] }), { status: 200 })),
  );
}

beforeEach(() => resetOnboardingRoleRead());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an open row names the role that welcomes people", () => {
  it("uses the role the village named by id, on the editor and the settings drawer", async () => {
    dial("welcome");
    render(<SeatSettingsEditor value={{ v: 1 }} onChange={() => {}} />);
    expect((await screen.findAllByText("We'll fill this together with Care and Onboarding Steward.")).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Technical Operations Steward");

    render(<SeatTermsDrawer settings={{ v: 1, pay: { kind: "none" } }} defaultOpen />);
    expect(await screen.findByText(/We'll fill this together with Care and Onboarding Steward: Term, Clocks/)).toBeTruthy();
  });

  it("never picks a role for saying Operations in its name (verify B4)", async () => {
    dial("");
    render(<SeatTermsDrawer settings={{ v: 1, pay: { kind: "none" } }} defaultOpen />);
    // Let the chart and the dial both arrive before reading what the drawer settled on.
    await new Promise((r) => setTimeout(r, 30));
    expect(await screen.findByText(new RegExp(`We'll fill this together with ${OPS_FALLBACK}: Term`))).toBeTruthy();
    expect(document.body.textContent).not.toContain("Technical Operations Steward");
  });
});
