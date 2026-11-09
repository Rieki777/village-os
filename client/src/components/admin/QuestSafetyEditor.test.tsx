// @vitest-environment jsdom
/**
 * The founder's door to what a quest asks of the body (build days S5). Before
 * this the safety route had no caller in the browser, so only curl could set
 * a quest physical (check-admin-reach). The editor reads the quest's rules,
 * offers only earned or granted badges, and says which open claims the new
 * rules now refuse.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuestSafetyEditor from "./QuestSafetyEditor";

const fetchMock = vi.fn();
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

describe("QuestSafetyEditor", () => {
  it("offers only earned or granted badges, saves the rules and names who they now refuse", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/game/quests/q1/safety")) return ok({ physical: false, minAge: null, requiredBadges: [], safetyNote: null, estimateHours: null });
      if (url.endsWith("/admin/badges")) return ok({ badges: [
        { id: "saw", name: "Saw ticket", kind: "earned", active: true },
        { id: "likes-tools", name: "Likes tools", kind: "self", active: true },
      ] });
      if (url.endsWith("/admin/quests/q1/safety") && init?.method === "PUT") return ok({ saved: true, openClaimsNowRefused: ["c1"] });
      return ok({});
    });
    render(<QuestSafetyEditor questId="q1" password="pw" />);
    fireEvent.click(await screen.findByLabelText("Physical work on site"));
    expect(await screen.findByLabelText("Saw ticket")).toBeTruthy();
    expect(screen.queryByLabelText("Likes tools"), "a badge members give themselves gates nothing").toBeNull();
    fireEvent.click(screen.getByLabelText("Saw ticket"));
    fireEvent.change(screen.getByLabelText("Safety note, shown as written"), { target: { value: "Boots on site." } });
    fireEvent.click(screen.getByText("Save safety"));

    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/admin/quests/q1/safety") && i?.method === "PUT")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/admin/quests/q1/safety") && i?.method === "PUT")!;
    expect(JSON.parse(String(init.body))).toEqual({ physical: true, minAge: null, requiredBadges: ["saw"], safetyNote: "Boots on site.", estimateHours: null });
    expect(await screen.findByText(/1 open claim/)).toBeTruthy();
  });
});
