// @vitest-environment jsdom
/**
 * The departure card on /exit-policy, where the delete screen's "Leave the
 * village instead" lands (`?focus=begin-departure`, Rye, 2026-10-30). It has
 * to exist under that id, be brought into view when the link asks for it, and
 * say that cash still owed keeps the account as tokens do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as any}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", name: "Ash" } }) }));
vi.mock("@/components/alignment/LeavingEnds", () => ({ default: () => null, useTermsLeavingEnds: () => null }));
vi.mock("@/components/auth/ConfirmWithGoogle", () => ({
  useIdentityConfirm: () => ({ confirmed: false, returnError: "", reset: () => {} }),
  IdentityConfirmField: () => null,
  identityBody: () => ({}),
  identityReady: () => false,
}));

import ExitPolicy from "@/pages/ExitPolicy";

const policy = {
  placeholder: true,
  voluntary: { noticePeriodDays: 30, valuationMethod: "Terms.", unwindSteps: ["A step"] },
  involuntary: { process: "Process." },
  restorative: { steps: ["Repair"] },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ policy }), { status: 200, headers: { "Content-Type": "application/json" } })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the departure card the delete screen points at", () => {
  it("carries the id the link names, and says cash still owed keeps the account", async () => {
    render(<ExitPolicy />);
    const card = (await screen.findByText("Begin your own departure")).closest("#begin-departure");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("If you still hold tokens, or the village still owes you cash");
  });

  it("is brought into view and focused when the link asks for it", async () => {
    window.history.replaceState(null, "", "/exit-policy?focus=begin-departure");
    render(<ExitPolicy />);
    await waitFor(() => expect(document.activeElement?.id).toBe("begin-departure"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
