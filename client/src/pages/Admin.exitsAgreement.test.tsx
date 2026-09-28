// @vitest-environment jsdom
/**
 * The Departures tab once the village has a conflict agreement: the
 * restorative path's fields give way to what the policy now carries and a
 * link to the agreement, because the policy's save refuses to change a block
 * the agreement holds. Before there is one, the fields are as they were.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExitsAdminTab } from "./Admin";
import { AGREEMENT_HREF } from "@/components/admin/RestorativeInAgreement";

const POLICY = {
  placeholder: false,
  voluntary: { noticePeriodDays: 21, valuationMethod: "Paid at the value the last cycle settled.", unwindSteps: ["Bring back anything borrowed"] },
  involuntary: { decidingDomainId: "", appealDomainId: "", process: "Two stewards sit with the person first.", grounds: [] },
  restorative: { intakeContactRole: "", steps: ["We talk it out. In the room: the two of us"] },
};

function serve(conflictAgreementStored: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/admin/exits")) {
        return { ok: true, status: 200, json: async () => ({ policy: POLICY, defaults: POLICY, circles: [], exits: [], conflictAgreementStored }) };
      }
      return { ok: true, status: 200, json: async () => [] };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the Departures tab and the conflict agreement", () => {
  beforeEach(() => serve(true));

  it("prints the restorative path the agreement carries and links to it, with no fields to edit", async () => {
    render(<ExitsAdminTab password="secret" />);
    const link = await screen.findByRole("link", { name: "Change it in the agreement" });
    expect(link.getAttribute("href")).toBe(AGREEMENT_HREF);
    expect(screen.getByText("We talk it out. In the room: the two of us")).toBeTruthy();
    expect(screen.queryByDisplayValue("We talk it out. In the room: the two of us")).toBeNull();
    // The rest of the policy still edits.
    expect(await screen.findByLabelText("How contributed value is honored")).toBeTruthy();
  });

  it("before there is an agreement, the restorative fields are there as before", async () => {
    serve(false);
    render(<ExitsAdminTab password="secret" />);
    expect(await screen.findByDisplayValue("We talk it out. In the room: the two of us")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Change it in the agreement" })).toBeNull();
  });
});
