// @vitest-environment jsdom
/**
 * The agent accounts panel on the Players tab (addendum v6, B6). What each
 * case pins:
 *
 *   1. An agent account shows with its Agent badge, and marking another
 *      account sends that account's id.
 *   2. Saving the paths list sends the whole list, with who confirms each.
 *   3. When the doors answer 401 (not an admin) nothing renders.
 *   4. The paths show as a tree by area, with counts; search filters it, and Change and Remove work inside it.
 *   5. The approved writes read from the events, with whether the memory holds each.
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
  document: { paths: [{ method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "agent", label: "Task boards" }] as any[] },
  shipped: { paths: [] },
  edited: false,
  alwaysAPerson: [{ key: "erasure", words: "Erasing or anonymising a member is always a person's act." }],
};

const WRITES = [
  { writeKey: "k1", at: "2026-11-11T10:00:00.000Z", what: "Changed a role card's words", target: "r-gardener", approvedBy: "The lead", approvalNote: "Yes, that aim.", text: "x", memory: "sent", memoryError: null },
  { writeKey: "k2", at: "2026-11-11T09:00:00.000Z", what: "", target: null, approvedBy: null, approvalNote: null, text: "connector (vat_ab...): Seated a member in a role (r-tend), with approval from The lead", memory: "none", memoryError: null },
];

function stub(status = 200, paths: any = PATHS) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (status !== 200) return { ok: false, status, json: async () => ({ error: "auth_required" }) };
    if (String(url).endsWith("/admin/agent-accounts")) return { ok: true, status: 200, json: async () => ({ agents: ["u-agent"] }) };
    if (String(url).endsWith("/admin/agent-admin-paths")) return { ok: true, status: 200, json: async () => (method === "PUT" ? { document: JSON.parse(String(init!.body)).document } : paths) };
    if (String(url).endsWith("/admin/agent-approvals")) return { ok: true, status: 200, json: async () => ({ writes: WRITES }) };
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
    // It asks first: a "no" sends nothing, a "yes" marks it.
    const ask = vi.fn(() => false);
    vi.stubGlobal("confirm", ask);
    fireEvent.click(screen.getByText("Mark as an agent account"));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("Its tokens end"));
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    vi.stubGlobal("confirm", vi.fn(() => true));
    fireEvent.click(screen.getByText("Mark as an agent account"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/players/u-ana/agent"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/admin/players/u-ana/agent"))!.body).toEqual({ isAgent: true });
  });

  it("saves the whole paths list with who confirms each write", async () => {
    const calls = stub();
    render(<AgentsPanel password="tok" players={players} />);
    await screen.findByText("Agent");
    fireEvent.click(screen.getByText("Add a path"));
    // A new path opens for editing under "New, not saved yet".
    expect(screen.getByText("New, not saved yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/api/admin/events" } });
    fireEvent.change(screen.getByLabelText("What it is for"), { target: { value: "Gatherings" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))).toBe(true));
    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))!;
    expect(put.body.document.paths).toEqual([
      { method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "agent", label: "Task boards" },
      { method: "GET", path: "/api/admin/events", confirm: "person", label: "Gatherings" },
    ]);
  });

  it("pastes a list: shows what it adds and changes, keeps every path, and saves only on Save", async () => {
    const calls = stub();
    render(<AgentsPanel password="tok" players={players} />);
    await screen.findByText("Agent");
    fireEvent.click(screen.getByText("Paste a list"));
    fireEvent.change(screen.getByLabelText("Pasted paths"), { target: { value: JSON.stringify({ paths: [
      { method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "person", label: "Task boards, by a person" },
      { method: "GET", path: "/api/admin/events", confirm: "agent", label: "Events" },
    ] }) } });
    fireEvent.click(screen.getByText("Read the pasted list"));
    expect(await screen.findByText(/Adds 1, changes 1, already there 0/)).toBeTruthy();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByText("Put these on the list"));
    expect(screen.getByText("New, not saved yet")).toBeTruthy();
    expect(screen.getByText("/api/admin/events")).toBeTruthy();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body.document.paths).toEqual([
      { method: "PUT", path: "/api/admin/member-tasks/access/:userId", confirm: "person", label: "Task boards, by a person" },
      { method: "GET", path: "/api/admin/events", confirm: "agent", label: "Events" },
    ]);
  });

  it("refuses a pasted path the save would refuse, with the reason, and changes nothing", async () => {
    stub();
    render(<AgentsPanel password="tok" players={players} />);
    await screen.findByText("Agent");
    fireEvent.click(screen.getByText("Paste a list"));
    fireEvent.change(screen.getByLabelText("Pasted paths"), { target: { value: JSON.stringify([{ method: "DELETE", path: "/api/admin/players/:id", confirm: "agent", label: "x" }]) } });
    fireEvent.click(screen.getByText("Read the pasted list"));
    expect((await screen.findByRole("alert")).textContent).toContain("Erasing or anonymising a member is always a person's act.");
    expect(screen.queryByText("Put these on the list")).toBeNull();
    expect(screen.queryByText("New, not saved yet")).toBeNull();
    expect(screen.getByText("1 paths in 1 groups")).toBeTruthy();
  });

  it("shows the paths as a tree by area, filters it, and changes and removes a path inside it", async () => {
    const calls = stub(200, {
      ...PATHS,
      document: {
        paths: [
          { method: "GET", path: "/api/admin/faqs", confirm: "agent", label: "All FAQs" },
          { method: "PUT", path: "/api/admin/faqs/:pathway", confirm: "agent", label: "Replace FAQs" },
          { method: "DELETE", path: "/api/admin/faqs/:pathway/:id", confirm: "person", label: "Remove one FAQ" },
          { method: "PUT", path: "/api/admin/org/roles/:id", confirm: "agent", label: "Edit a role card" },
          { method: "GET", path: "/api/admin/events", confirm: "agent", label: "Events" },
        ],
      },
    });
    render(<AgentsPanel password="tok" players={players} />);
    await screen.findByText("Agent");
    expect(screen.getByText("5 paths in 3 groups")).toBeTruthy();
    // Closed groups show their name, count and summary; no path yet.
    const faqs = screen.getByRole("button", { name: /FAQs.*3.*1 read, 2 write, 1 a person confirms/ });
    expect(faqs.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Replace FAQs")).toBeNull();
    fireEvent.click(faqs);
    expect(screen.getByText("Replace FAQs")).toBeTruthy();
    expect(screen.getByText("/api/admin/faqs/:pathway/:id")).toBeTruthy();
    expect(screen.getAllByText("A person confirms").length).toBe(1);
    // Search opens every group that matches and hides the rest.
    fireEvent.change(screen.getByLabelText("Search the paths"), { target: { value: "role" } });
    expect(screen.getByText("1 of 5 paths match")).toBeTruthy();
    expect(screen.getByText("Edit a role card")).toBeTruthy();
    expect(screen.queryByText("Replace FAQs")).toBeNull();
    // Change opens the editor in place; Remove takes the path off.
    fireEvent.click(screen.getByRole("button", { name: "Change PUT /api/admin/org/roles/:id" }));
    fireEvent.change(screen.getByLabelText("What it is for"), { target: { value: "Edit a role card's words" } });
    fireEvent.change(screen.getByLabelText("Search the paths"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Events/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remove GET /api/admin/events" }));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))).toBe(true));
    const saved = calls.find((c) => c.method === "PUT" && c.url.endsWith("/admin/agent-admin-paths"))!.body.document.paths;
    expect(saved).toHaveLength(4);
    expect(saved[3]).toEqual({ method: "PUT", path: "/api/admin/org/roles/:id", confirm: "agent", label: "Edit a role card's words" });
    expect(saved.some((e: any) => e.path === "/api/admin/events")).toBe(false);
  });

  it("lists the approved writes from the events, with who approved, the note and the memory's answer", async () => {
    const calls = stub();
    render(<AgentsPanel password="tok" players={players} />);
    const region = await screen.findByRole("region", { name: "Approved agent writes" });
    expect(calls.some((c) => c.url.endsWith("/admin/agent-approvals"))).toBe(true);
    expect(region.textContent).toContain("Changed a role card's words");
    expect(region.textContent).toContain("(r-gardener)");
    expect(region.textContent).toContain("Approved by The lead");
    expect(region.textContent).toContain("Yes, that aim.");
    expect(region.textContent).toContain("In the memory");
    // A write whose memory record was never queued still shows, from the event's own line.
    expect(region.textContent).toContain("Seated a member in a role (r-tend)");
    expect(region.textContent).toContain("Not queued");
  });

  it("renders nothing for someone who is not an admin", async () => {
    const calls = stub(401);
    render(<AgentsPanel password="tok" players={players} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByText("Agent accounts")).toBeNull();
  });
});
