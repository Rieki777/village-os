// @vitest-environment jsdom
/**
 * The agent accounts panel on the Players tab (addendum v6, B6). What each
 * case pins:
 *
 *   1. An agent account shows with its Agent badge, and marking another
 *      account sends that account's id.
 *   2. Saving the paths list sends the whole list, with who confirms each.
 *   3. When the doors answer 401 (not an admin) nothing renders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AgentsPanel from "./AgentsPanel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const players = [
  { id: "u-agent", name: "Claude (Operations agent)" },
  { id: "u-ana", name: "Ana Ruiz" },
] as any[];

const PATHS = {
  document: { paths: [{ method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "agent", label: "Task boards" }] },
  shipped: { paths: [] },
  edited: false,
  alwaysAPerson: [{ key: "erasure", words: "Erasing or anonymising a member is always a person's act." }],
};

function stub(status = 200) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (status !== 200) return { ok: false, status, json: async () => ({ error: "auth_required" }) };
    if (String(url).endsWith("/admin/agent-accounts")) return { ok: true, status: 200, json: async () => ({ agents: ["u-agent"] }) };
    if (String(url).endsWith("/admin/agent-admin-paths")) return { ok: true, status: 200, json: async () => (method === "PUT" ? { document: JSON.parse(String(init!.body)).document } : PATHS) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
  return calls;
}

describe("the agent accounts panel", () => {
  it("shows an agent with its badge, and marks another account by id", async () => {
    const calls = stub();
    render(<AgentsPanel password="tok" players={players} />);
    expect(await screen.findByText("Agent")).toBeTruthy();
    expect(screen.getByText("Erasing or anonymising a member is always a person's act.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Account to mark as an agent's"), { target: { value: "u-ana" } });
    fireEvent.click(screen.getByText("Mark as an agent account"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/players/u-ana/agent"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/admin/players/u-ana/agent"))!.body).toEqual({ isAgent: true });
  });

  it("saves the whole paths list with who confirms each write", async () => {
    const calls = stub();
    render(<AgentsPanel password="tok" players={players} />);
    await screen.findByText("Agent");
    fireEvent.click(screen.getByText("Add a path"));
    const paths = screen.getAllByLabelText("Path");
    fireEvent.change(paths[1], { target: { value: "/api/admin/events" } });
    fireEvent.change(screen.getAllByLabelText("What it is for")[1], { target: { value: "Gatherings" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))).toBe(true));
    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))!;
    expect(put.body.document.paths).toEqual([
      { method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "agent", label: "Task boards" },
      { method: "GET", path: "/api/admin/events", confirm: "person", label: "Gatherings" },
    ]);
  });

  it("renders nothing for someone who is not an admin", async () => {
    const calls = stub(401);
    render(<AgentsPanel password="tok" players={players} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByText("Agent accounts")).toBeNull();
  });
});
