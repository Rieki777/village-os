// @vitest-environment jsdom
/**
 * The doors into the role editor: drawn for a holder of the power to decide the
 * structure and nobody else, and the editor is its own chunk, so a reader who is
 * not one never fetches it. Saving sends the words as written; nothing is sent
 * on "Use Sera's range" except the read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/gameApi", () => ({ authToken: vi.fn(() => "token") }));

import { authToken } from "@/lib/gameApi";
import EditRoleButton from "./EditRoleButton";
import { forgetEditAccess } from "./useEditAccess";

const STATE = {
  id: "r1",
  name: "Reader",
  circleId: "c1",
  isExample: false,
  words: { name: "Reader", aim: "Old aim", domain: "Old domain", accountabilities: ["a", "b", "c"] },
  parameters: { recruiting: false },
  parameterKeys: ["recruiting"],
  pay: null,
  archetypes: [],
};

function server(door: "power" | "admin" | null, calls: Array<{ url: string; method: string; body: any }> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.endsWith("/access")) return json({ door });
      if (url.endsWith("/api/archetypes")) return json([]);
      if (url.endsWith("/sera")) return json({ differences: [], pay: { kind: "range", currency: "USD", minMinor: 100000, maxMinor: 100000, per: "month" }, payFrom: null, readAt: null });
      if (method === "POST") return json({ success: true, changed: ["Purpose"], state: { ...STATE, words: { ...STATE.words, aim: "New aim" } } });
      return json({ state: STATE, door: "power", lacksToList: [], roles: [] });
    }),
  );
}

afterEach(() => {
  cleanup();
  forgetEditAccess();
  vi.unstubAllGlobals();
  vi.mocked(authToken).mockReturnValue("token");
});

describe("Edit this role", () => {
  it("draws nothing for a reader without the power, and asks nothing when signed out", async () => {
    server(null);
    const { container } = render(<EditRoleButton roleId="r1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    cleanup();
    forgetEditAccess();
    vi.mocked(authToken).mockReturnValue(null);
    vi.mocked(fetch).mockClear();
    const out = render(<EditRoleButton roleId="r1" />);
    expect(out.container.textContent).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("draws the button for a holder, opens the editor on press, shows a changed field in gold, and saves the words as written", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    server("power", calls);
    render(<EditRoleButton roleId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit this role" }));
    const aim = (await screen.findByLabelText("Purpose")) as HTMLTextAreaElement;
    expect(aim.value).toBe("Old aim");
    expect(aim.closest("[data-changed]")?.getAttribute("data-changed")).toBe("false");
    fireEvent.change(aim, { target: { value: "New aim" } });
    expect(aim.closest("[data-changed]")?.getAttribute("data-changed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save and update the role" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/r1"))).toBe(true));
    const save = calls.find((c) => c.method === "POST" && c.url.endsWith("/r1"))!;
    expect(save.body.words.aim).toBe("New aim");
    expect(save.body.parameters).toEqual({ recruiting: false });
  });

  it("'Use Sera's range' fills the form and sends no save", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    server("power", calls);
    render(<EditRoleButton roleId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit this role" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Sera's range" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Sera's range is in the form/));
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect((screen.getByLabelText("Kind of pay") as HTMLSelectElement).value).toBe("range");
  });
});
