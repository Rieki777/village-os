// @vitest-environment jsdom
/**
 * A NEW QUEST PRICED BY THE VILLAGE'S RULE (quest re-price Q3b), in Admin,
 * Quests. What each case pins:
 *
 *   1. "Use this price" fills the value box with the engine's figure; Post
 *      sends that figure, then records it beside its inputs at the pay door,
 *      so the pricing desk shows the quest as set.
 *   2. A price retyped after "Use this price" is the poster's own: the quest
 *      posts with it, and nothing is recorded as the rule's.
 *   3. A village with no rates says so, and the form still posts by hand.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuestsTab from "./QuestsTab";
import { forgetPayOptions } from "@/components/WorkValueEditor";
import { modelForVillage, suggestValuation } from "@shared/valuationEngine";
import type { ValuationModel } from "@shared/valuation";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetPayOptions();
});

const MODEL: ValuationModel = {
  ...modelForVillage("CRC"),
  version: 1,
  bands: [{ key: "general", label: "General help", hourValueMinor: 155455, source: { sentence: "Decree 45303-MTSS", date: "2026-10-31" } }],
};
const SUGGESTED = (() => {
  const s = suggestValuation(MODEL, { kind: "quest", lines: [{ band: "general", payee: "lead", estimatedHours: 4 }], complexity: "routine" }, { eeMeaningWritten: true });
  if (!s.ok) throw new Error("fixture model refused");
  return s.payees[0].expected.totalMinor;
})();

function routes(model: ValuationModel) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const map: Record<string, { status: number; body: unknown }> = {
    "GET /api/quests": { status: 200, body: [] },
    "GET /api/quests/pay-options": {
      status: 200,
      body: { currency: "CRC", quest: [{ token: "credits", name: "Credits", standard: 25, decimals: 2 }, { token: "earned-equity", name: "Earned Equity", standard: null, decimals: 2 }, { token: "village-voice", name: "Voice", standard: 10, decimals: 2 }], role: [] },
    },
    "GET /api/valuation/model": { status: 200, body: { model, eeMeaningWritten: true, tokenNames: {} } },
    "POST /api/admin/quests": { status: 200, body: { id: "q-new" } },
    "PUT /api/quests/q-new/pay": { status: 200, body: { success: true, state: "set" } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const hit = map[`${method} ${url}`] ?? { status: 404, body: { error: "no route" } };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  }));
  return calls;
}

async function priceByRule() {
  const hours = await screen.findByLabelText("Hours it takes");
  fireEvent.change(hours, { target: { value: "4" } });
  fireEvent.click(await screen.findByRole("button", { name: "Use this price" }));
  fireEvent.change(screen.getAllByLabelText("Title")[0], { target: { value: "Mulch the beds" } });
}

describe("posting a quest priced by the village's rule", () => {
  it("fills the value with the engine's figure, posts it, then records it beside its inputs", async () => {
    const calls = routes(MODEL);
    render(<QuestsTab password="tok" />);
    await priceByRule();
    const worth = screen.getAllByLabelText(/What it is worth/)[0] as HTMLInputElement;
    expect(Number(worth.value)).toBe(SUGGESTED / 100);

    fireEvent.click(screen.getByRole("button", { name: "Post quest" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body.valueMinor).toBe(SUGGESTED);
    expect(post.body.valueTokens.find((t: any) => t.token === "credits")?.amount).not.toBe(25);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/quests/q-new/pay");
    expect(put.body).toMatchObject({ set: { totalMinor: SUGGESTED }, work: { kind: "quest", lines: [{ band: "general", estimatedHours: 4 }] } });
  });

  it("treats a price retyped after Use this price as the poster's own, and records nothing as the rule's", async () => {
    const calls = routes(MODEL);
    render(<QuestsTab password="tok" />);
    await priceByRule();
    fireEvent.change(screen.getAllByLabelText(/What it is worth/)[0], { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: "Post quest" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.find((c) => c.method === "POST")!.body.valueMinor).toBe(900000);
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("says when the village has no rates, and leaves the price to the poster", async () => {
    routes({ ...MODEL, bands: [] });
    render(<QuestsTab password="tok" />);
    expect(await screen.findByText(/has not set its rates yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this price" })).toBeNull();
  });
});
