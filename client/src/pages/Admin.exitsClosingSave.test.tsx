// @vitest-environment jsdom
/**
 * SAVING WHAT CLOSING MEANS LEAVES THE EXIT TERMS BEING TYPED ABOVE IT ALONE.
 *
 * The Departures tab holds two editors with two saves: the published exit
 * terms ("Publish policy") and the closing section (its own card and route).
 * The closing card used to be handed the tab's whole reload as `onSaved`, and
 * that reload replaces the terms editor's draft with the server's copy. A
 * founder working down the launch checklist, where both rows block and both
 * link here, would type the terms, save closing, and lose the terms without a
 * word (review of 2026-09-27).
 *
 * The card now hands back the section the server holds, and the tab refreshes
 * that alone. So this asserts what a founder would see: the words they typed
 * are still in the box, the tab did not fetch itself again, and the closing
 * card reads the adoption.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExitsAdminTab } from "./Admin";
import { PROPORTIONAL_CLOSING_STATEMENT } from "@shared/closingPolicies";

const POLICY = {
  placeholder: false,
  voluntary: {
    noticePeriodDays: 21,
    valuationMethod: "Paid at the value the last cycle settled.",
    unwindSteps: ["Bring back anything borrowed"],
  },
  involuntary: { decidingDomainId: "", appealDomainId: "", process: "Two stewards sit with the person first.", grounds: [] },
  restorative: { intakeContactRole: "", steps: ["Somebody who was not involved hears both people"] },
};

const HELD = { policyId: "proportional-closing-balance", statement: PROPORTIONAL_CLOSING_STATEMENT, adoptedAt: "2026-10-03T10:00:00.000Z" };

const calls = () => (globalThis.fetch as any).mock.calls as [string, any?][];
const exitsReads = () => calls().filter(([url, init]) => String(url).endsWith("/admin/exits") && !init?.method).length;

beforeEach(() => {
  // A server that remembers: once closing is adopted, a reload serves it too,
  // so a tab that reloads shows the same card and differs only in what it did
  // to the terms being typed.
  let closing: typeof HELD | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith("/admin/exit-policy/closing") && init?.method === "PUT") {
        closing = HELD;
        return { ok: true, status: 200, json: async () => ({ success: true, named: true, closing: HELD }) };
      }
      if (String(url).endsWith("/admin/exits")) {
        const policy = closing ? { ...POLICY, closing } : POLICY;
        return { ok: true, status: 200, json: async () => ({ policy, defaults: POLICY, circles: [], exits: [] }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the Departures tab's two saves", () => {
  it("adopting what closing means keeps the unsaved exit terms a founder is typing", async () => {
    render(<ExitsAdminTab password="secret" />);
    const terms = (await screen.findByLabelText("How contributed value is honored")) as HTMLTextAreaElement;
    expect(terms.value).toBe(POLICY.voluntary.valuationMethod);
    expect(exitsReads()).toBe(1);

    const typed = "Paid in full within one lunation, at the value the circle agreed.";
    fireEvent.change(terms, { target: { value: typed } });

    fireEvent.click(screen.getByRole("radio", { name: /Shared by closing-day balances/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /adopts these words/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save what closing means" }));

    // The card reads the adoption the server handed back.
    await screen.findByText(/Members read these words until new ones are adopted/);
    expect(calls().filter(([url, init]) => String(url).endsWith("/admin/exit-policy/closing") && init?.method === "PUT").length).toBe(1);

    expect((screen.getByLabelText("How contributed value is honored") as HTMLTextAreaElement).value, "the typed terms survive").toBe(typed);
    expect(exitsReads(), "the tab did not reload over the draft").toBe(1);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /adopts these words/ })).toBeChecked());
  });
});
