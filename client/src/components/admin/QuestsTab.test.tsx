// @vitest-environment jsdom
/**
 * THE STARTER QUESTS IN ADMIN (Rye, sheet A8 / 19g, 2026-10-31), against the
 * payloads the routes send. This is the screen the Journey to Launch row
 * `starter-quests` links to. What each case pins:
 *
 *   1. A starter row offers Keep and nothing else: the save and delete routes
 *      refuse an example, so offering them would only teach the 409.
 *   2. Keep asks for a value first, the way posting a new quest does, and then
 *      sends the founder's words and the value to the keep door.
 *   3. The note above the list says how many starters wait, and clears the
 *      ones nobody kept after a confirm.
 *   4. A board with no starters shows no note at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuestsTab from "./QuestsTab";
import { forgetPayOptions } from "@/components/WorkValueEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetPayOptions();
});

const STARTER = {
  id: "ex-quest-welcome", title: "Welcome someone new", description: "Meet a newcomer.", circle: "Community Development",
  status: "Open", difficulty: "Beginner", tags: [], order: 1, isExample: true, valueMinor: null, valueTokens: null,
};
const OWN = {
  id: "q-own", title: "Fix the water tank", description: "Before the dry season.", circle: "Land Stewardship",
  status: "Open", difficulty: "Intermediate", tags: [], order: 2, isExample: false, valueMinor: 500000, valueCurrency: "USD", valueTokens: null,
};

function routes(map: Record<string, { status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: any; auth: string | undefined }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization });
    const hit = map[`${init?.method ?? "GET"} ${url}`] ?? { status: 404, body: { error: "no route" } };
    return { ok: hit.status < 300, status: hit.status, json: async () => hit.body };
  }));
  return calls;
}

const board = (quests: unknown[]) => ({
  "GET /api/quests": { status: 200, body: quests },
  "GET /api/quests/pay-options": { status: 200, body: { currency: "USD", quest: [], role: [] } },
});

describe("starter quests in Admin, Quests", () => {
  it("offers Keep on a starter, and Save and Delete only on the village's own quest", async () => {
    routes(board([STARTER, OWN]));
    render(<QuestsTab password="tok" />);
    expect(await screen.findByRole("button", { name: "Keep as a real quest" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Keep as a real quest" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    expect(screen.getByText("1 starter quest is waiting for you")).toBeTruthy();
  });

  it("asks for a value before it keeps, then sends the words and the value to the keep door", async () => {
    const calls = routes({
      ...board([STARTER]),
      "POST /api/admin/quests/ex-quest-welcome/keep": { status: 200, body: { ...STARTER, isExample: false, startersLeft: false } },
    });
    render(<QuestsTab password="tok" />);
    const keep = await screen.findByRole("button", { name: "Keep as a real quest" });
    await waitFor(() => expect(calls.some((c) => c.url === "/api/quests/pay-options")).toBe(true));

    fireEvent.click(keep);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.method === "POST"), "no value, so nothing is sent").toEqual([]);

    // The post form's value box comes first, then the starter row's.
    const worth = screen.getAllByLabelText(/What it is worth/);
    fireEvent.change(worth[1], { target: { value: "25" } });
    const titles = screen.getAllByLabelText("Title");
    fireEvent.change(titles[1], { target: { value: "Welcome whoever arrives" } });
    fireEvent.click(keep);

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const sent = calls.find((c) => c.method === "POST")!;
    expect(sent.url).toBe("/api/admin/quests/ex-quest-welcome/keep");
    expect(sent.auth).toBe("Bearer tok");
    expect(sent.body).toMatchObject({ title: "Welcome whoever arrives", valueMinor: 2500, status: "Open" });
  });

  it("clears the starters nobody kept, after a confirm", async () => {
    const calls = routes({
      ...board([STARTER, OWN]),
      "POST /api/admin/modules/quests/examples/clear": { status: 200, body: { success: true, removed: 1, retired: true } },
    });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    render(<QuestsTab password="tok" />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear the starters you have not kept" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/modules/quests/examples/clear")).toBe(true));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("says nothing about starters on a board that has none", async () => {
    routes(board([OWN]));
    render(<QuestsTab password="tok" />);
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText(/starter quest/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep as a real quest" })).toBeNull();
  });
});
