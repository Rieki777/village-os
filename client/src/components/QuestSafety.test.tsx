// @vitest-environment jsdom
/**
 * What a physical quest asks of the body, on the quest page: the minimum age,
 * the badges and the safety note, and the one-time age band for a member who
 * has not said it. Nothing for a quest that asks nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const gameFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gameApi", () => ({ gameFetch }));

import QuestSafety from "./QuestSafety";

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

beforeEach(() => gameFetch.mockReset());

describe("QuestSafety", () => {
  it("shows the age, the badges and the note, and asks a member without a band to say it once", async () => {
    gameFetch.mockImplementation((path: string, init?: RequestInit) => {
      path = String(path ?? "");
      if (path.endsWith("/safety")) return ok({ physical: true, minAge: 18, requiredBadges: [{ id: "saw", name: "Saw ticket" }], safetyNote: "Boots on site." });
      if (path === "/api/me/age-band" && !init) return ok({ band: null });
      if (path === "/api/me/age-band") return ok({ band: "18plus" });
      return ok({});
    });
    render(<QuestSafety questId="q1" signedIn />);
    expect(await screen.findByText("Everyone on this quest is at least 18.")).toBeTruthy();
    expect(screen.getByText("You need: Saw ticket")).toBeTruthy();
    expect(screen.getByText("Boots on site.")).toBeTruthy();
    fireEvent.click(await screen.findByText("18 or older"));
    await waitFor(() => expect(screen.queryByText("18 or older")).toBeNull());
    expect(gameFetch).toHaveBeenCalledWith("/api/me/age-band", { method: "POST", body: JSON.stringify({ band: "18plus" }) });
  });

  it("draws nothing for a quest that asks nothing of the body", async () => {
    gameFetch.mockImplementation(() => ok({ physical: false, minAge: null, requiredBadges: [], safetyNote: null }));
    const { container } = render(<QuestSafety questId="q2" signedIn />);
    await waitFor(() => expect(gameFetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
