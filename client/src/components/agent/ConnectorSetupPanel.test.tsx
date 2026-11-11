// @vitest-environment jsdom
/**
 * The connector panel (the lead, 2026-11-11): what it says, the address it
 * shows, the admin's switch, and the per-person dismissal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectorSetupPanel, { connectorDismissKey, connectorUrl } from "./ConnectorSetupPanel";

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* storage refused */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the connector panel", () => {
  it("says what the connector is and shows the documented address", () => {
    render(<ConnectorSetupPanel moment="key" origin="https://village.example.org/" person="u-1" />);
    expect(screen.getByText(/only with your approval in the chat/)).toBeTruthy();
    expect(screen.getByText(/Every change it makes is recorded/)).toBeTruthy();
    expect(screen.getByTestId("connector-url").textContent).toBe("https://village.example.org/api/agent/v1/mcp");
    expect(connectorUrl("https://v.example/")).toBe("https://v.example/api/agent/v1/mcp");
    expect(screen.getByText(/Add custom connector/)).toBeTruthy();
  });

  it("shows no switch to a member", () => {
    render(<ConnectorSetupPanel moment="download" person="u-1" initialSwitch={true} />);
    expect(screen.queryByTestId("connector-switch")).toBeNull();
  });

  it("shows an admin the switch in its current state and saves a change as that variable", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as any);
    vi.stubGlobal("fetch", fetchMock);
    render(<ConnectorSetupPanel moment="key" isAdmin password="pw" person="admin" initialSwitch={true} />);
    const box = screen.getByRole("checkbox", { name: /Our agent may make the changes we approve in the chat/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText(/still needs an approval note from a person/)).toBeTruthy();
    await userEvent.click(box);
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/variables/agents.lead_approved_writes");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ value: "false" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pw");
    expect(screen.getByText(/does only what it did before/)).toBeTruthy();
  });

  it("goes away when dismissed, for that person only, and stays away", async () => {
    const { unmount } = render(<ConnectorSetupPanel moment="key" person="u-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByTestId("connector-setup")).toBeNull();
    expect(window.localStorage.getItem(connectorDismissKey("u-1"))).toBe("1");
    unmount();
    render(<ConnectorSetupPanel moment="key" person="u-1" />);
    expect(screen.queryByTestId("connector-setup")).toBeNull();
    cleanup();
    render(<ConnectorSetupPanel moment="key" person="u-2" />);
    expect(screen.getByTestId("connector-setup")).toBeTruthy();
  });
});
