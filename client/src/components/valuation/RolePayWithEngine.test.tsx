// @vitest-environment jsdom
/**
 * The Treasurer's screen for a role's pay, rendered (spec 3.3, 3.4; research 03
 * and the UX pass, qa/03).
 *
 *   1. The setter's own figure is asked BEFORE the suggestion shows, so the
 *      suggestion cannot anchor it.
 *   2. The figure field is never prefilled: "Use the suggestion" is a choice.
 *   3. A figure outside the band asks a reason, and the screen says who signs
 *      next before anything is sent.
 *   4. Save sends the inputs and the figure; the server prices them again.
 *   5. The receipt names no hours and no hourly figure, and opens with a 44 px
 *      button that says what it does.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RolePayWithEngine from "./RolePayWithEngine";
import { modelForVillage } from "@shared/valuationEngine";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MODEL = {
  ...modelForVillage("CRC"),
  version: 1,
  bands: [{ key: "general", label: "General help", hourValueMinor: 155455, source: { sentence: "Decree 45303-MTSS", date: "2026-10-31" } }],
};

const setup = (put: (body: any) => any = () => ({ state: "set" })) => {
  const calls: Array<{ path: string; body: any; method?: string }> = [];
  const call = vi.fn(async (path: string, body?: any, method?: string) => {
    calls.push({ path, body, method });
    if (path === "/valuation/model") return { model: MODEL, eeMeaningWritten: true, tokenNames: { credits: "Village Credits", "earned-equity": "Earned Equity", "village-voice": "Village Voice" } };
    return put(body);
  });
  render(<RolePayWithEngine role={{ id: "garden-steward", name: "Garden Steward" }} call={call} onSaved={() => {}} />);
  return calls;
};

describe("setting a role's pay with the valuation engine", () => {
  it("asks the setter's own figure before showing the suggestion, and never prefills the figure", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Kind of work");
    await user.type(screen.getByLabelText(/Estimated effort for the moon/), "20");
    expect(screen.queryByText("Reward")).toBeNull();
    await user.type(screen.getByLabelText(/Your own figure first/), "60000");
    await user.click(screen.getByRole("button", { name: "Show the suggestion" }));
    expect(await screen.findByText("Reward")).toBeTruthy();
    expect(screen.getByText(/Your own figure was ₡60,000/)).toBeTruthy();
    expect(screen.queryByLabelText("Your figure")).toBeNull();
    expect((screen.getByRole("button", { name: "Set this role's pay" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks a reason for a figure outside the band, says who signs next, and sends the inputs and the figure", async () => {
    const calls = setup(() => ({ state: "awaiting_second" }));
    const user = userEvent.setup();
    await screen.findByText("Kind of work");
    await user.type(screen.getByLabelText(/Estimated effort for the moon/), "20");
    await user.click(screen.getByRole("button", { name: "Show the suggestion" }));
    await user.click(screen.getByLabelText("My own figure"));
    await user.type(screen.getByLabelText("Your figure"), "200000");
    expect(screen.getByText(/A second Treasurer or a steward then signs it/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Reason"), "Fairness with similar work");
    await user.click(screen.getByRole("button", { name: "Set this role's pay" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/org/roles/garden-steward/pay");
    expect(put.body).toMatchObject({ set: { totalMinor: 20000000 }, reason: "Fairness with similar work", work: { kind: "role", lines: [{ band: "general", estimatedHours: 20 }] } });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Waiting for a second signer/);
  });

  it("shows a receipt with no hours and no hourly figure", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Kind of work");
    await user.type(screen.getByLabelText(/Estimated effort for the moon/), "20");
    await user.click(screen.getByRole("button", { name: "Show the suggestion" }));
    await user.click(screen.getByRole("button", { name: "How this was worked out" }));
    const receipt = document.querySelector("[data-valuation-receipt]")!.textContent ?? "";
    expect(receipt).toMatch(/Base price/);
    expect(receipt).not.toMatch(/\bhours?\b/i);
    expect(receipt).not.toContain("1,554");
  });

  it("says the village has not set its rates, and where, when there are none", async () => {
    const call = vi.fn(async () => ({ model: { ...MODEL, bands: [] }, eeMeaningWritten: true, tokenNames: {} }));
    render(<RolePayWithEngine role={{ id: "r", name: "R" }} call={call} onSaved={() => {}} />);
    expect(await screen.findByText(/has not set its rates yet/)).toBeTruthy();
  });
});
