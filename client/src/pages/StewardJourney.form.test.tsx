// @vitest-environment jsdom
/**
 * The steward form swaps itself, and the button that sent it, for a welcome.
 * Before, focus fell to <body> and a screen reader heard nothing, so the
 * person could not tell whether it had gone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/FaqSection", () => ({ default: () => null }));
vi.mock("@/components/comms/PathConsentBox", () => ({ default: () => null, FORM_CONSENT_FIELD: "consent" }));
vi.mock("@/lib/gameApi", () => ({
  useVillageLinks: () => ({ eventsUrl: "" }),
  useBrandImages: () => ({}),
  altOr: (a: string | undefined, b: string) => a || b,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: (fallback: string) => fallback }));

import StewardJourney from "./StewardJourney";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StewardJourney form, once it is sent", () => {
  it("moves focus to the welcome", async () => {
    // jsdom has no IntersectionObserver, and framer-motion's whileInView needs one.
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }));
    const user = userEvent.setup();
    render(<StewardJourney />);
    await user.type(screen.getByLabelText(/your name/i), "Juno Reed");
    await user.type(screen.getByLabelText(/^email/i), "juno@example.test");
    await user.click(screen.getByRole("button", { name: /begin my stewardship journey/i }));

    const welcome = await screen.findByRole("heading", { name: /welcome, future steward/i });
    expect(document.activeElement).toBe(welcome);
  });
});
