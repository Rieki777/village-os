// @vitest-environment jsdom
/**
 * Saving the village's Anthropic key on Integrations opens the connector panel,
 * with the admin's switch; saving any other key does not (the lead, 2026-11-11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IntegrationsTab } from "./Admin";

const CARDS = [
  { key: "assistant_api_key", title: "Assistant key", tier: "connected", credential: true, unlocks: "Lets the assistant answer.", placeholder: "sk-ant-..." },
  { key: "other_api_key", title: "Other key", tier: "connected", credential: true, unlocks: "Something else.", placeholder: "ok_..." },
];
const VARIABLES = { categories: [{ name: "Connector", variables: [{ key: "agents.lead_approved_writes", value: "true" }] }] };

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* refused */ }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const ok = (b: unknown) => ({ status: 200, ok: true, json: async () => b }) as any;
    if (u.includes("/admin/variables")) return ok(VARIABLES);
    if (u.includes("/admin/integrations/") && init?.method === "PUT") return ok({ success: true });
    if (u.includes("/admin/integrations")) return ok({ cards: CARDS, secrets: [] });
    return { status: 404, ok: false, json: async () => ({}) } as any;
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function saveKey(title: string) {
  render(<IntegrationsTab password="pw" />);
  const card = (await screen.findByText(title)).closest("div.bg-white") as HTMLElement;
  const field = card.querySelector("input") as HTMLInputElement;
  await userEvent.type(field, "sk-ant-0123456789");
  const save = Array.from(card.querySelectorAll("button")).find((b) => /save|connect|set/i.test(b.textContent ?? "")) as HTMLButtonElement;
  await userEvent.click(save);
}

describe("Integrations, after the Anthropic key", () => {
  it("opens the connector panel with the switch on its current state", async () => {
    await saveKey("Assistant key");
    await waitFor(() => expect(screen.getByTestId("connector-setup")).toBeTruthy());
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Our agent may make the changes we approve in the chat/ }) as HTMLInputElement).checked).toBe(true));
  });

  it("stays quiet for any other key", async () => {
    await saveKey("Other key");
    await waitFor(() => expect((globalThis.fetch as any).mock.calls.some((c: any[]) => c[1]?.method === "PUT")).toBe(true));
    expect(screen.queryByTestId("connector-setup")).toBeNull();
  });
});
