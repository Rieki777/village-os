// @vitest-environment jsdom
/**
 * WHAT A NEWCOMER DRAFTED, WAITING AFTER SIGN-UP (role draft board, 9 Nov).
 * The draft lives in the browser they drafted in. On the character page it
 * offers the characters they picked and the roles they drafted, and they
 * choose what to keep; nothing is joined or proposed for them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ROLE_DRAFT_KEY } from "@shared/roleDraft";
import DraftCarry from "./DraftCarry";

const CAST = [
  { key: "catalyzing", name: "The Catalyst" },
  { key: "facilitating", name: "The Spaceholder" },
];

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DraftCarry", () => {
  it("says nothing when there is no draft", () => {
    const { container } = render(<DraftCarry cast={CAST} roleNames={{}} onPickCharacter={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("offers each drafted character on the stage, and applies with the drafted roles", () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: ["catalyzing", "facilitating", "../made-up"], picks: ["lfs", "garden"] }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ roles: [] }), { status: 200 })));
    const pick = vi.fn();
    render(<DraftCarry cast={CAST} roleNames={{ lfs: "Lead Financial Steward" }} onPickCharacter={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "Show The Spaceholder" }));
    expect(pick).toHaveBeenCalledWith("facilitating");
    // A stored key the cast does not know is never offered.
    expect(screen.queryByRole("button", { name: /made-up/ })).toBeNull();
    expect(screen.getByText(/Lead Financial Steward/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Apply with your draft/ }).getAttribute("href")).toBe("/propose-a-role?role=lfs&role=garden&from=%2Froles%2Fdraft");
    vi.unstubAllGlobals();
  });

  it("sends a member, told by the terms tier of the chart, to one role application", async () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: [], picks: ["lfs", "garden"] }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ roles: [{ id: "lfs", name: "Lead Financial Steward", termsOffer: null }] }), { status: 200 })));
    render(<DraftCarry cast={CAST} onPickCharacter={() => {}} />);
    const link = await screen.findByRole("link", { name: /Apply for the roles you drafted/ });
    expect(link.getAttribute("href")).toBe("/propose?type=role_application&seat=lfs&seat=garden&from=%2Froles%2Fdraft");
    vi.unstubAllGlobals();
  });

  it("clears the draft when they are done with it", () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: ["catalyzing"], picks: [] }));
    render(<DraftCarry cast={CAST} roleNames={{}} onPickCharacter={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear my draft" }));
    expect(localStorage.getItem(ROLE_DRAFT_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear my draft" })).toBeNull();
  });
});

describe("a drafted role they were already adopted for", () => {
  it("says it is theirs, and offers to apply only for the rest", async () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: [], picks: ["lfs", "events"] }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/governance/role-applications")) {
          return new Response(JSON.stringify({ applications: [{ candidate: { id: "u-juno" }, status: "adopted", seats: [{ id: "lfs" }] }, { candidate: { id: "someone-else" }, status: "adopted", seats: [{ id: "events" }] }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ roles: [{ id: "lfs", name: "Lead Financial Steward" }, { id: "events", name: "Events Manager" }] }), { status: 200 });
      }),
    );
    render(<DraftCarry cast={CAST} userId="u-juno" onPickCharacter={() => {}} />);
    expect(await screen.findByText("Adopted, and yours from the start of next season: Lead Financial Steward.")).toBeTruthy();
    const link = await screen.findByRole("link", { name: /Apply with your draft/ });
    expect(link.getAttribute("href")).toBe("/propose-a-role?role=events&from=%2Froles%2Fdraft");
  });

  it("offers no Apply when every drafted role is already theirs", async () => {
    localStorage.setItem(ROLE_DRAFT_KEY, JSON.stringify({ chars: [], picks: ["lfs"] }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("role-applications")
          ? new Response(JSON.stringify({ applications: [{ candidate: { id: "u-juno" }, status: "adopted", seats: [{ id: "lfs" }] }] }), { status: 200 })
          : new Response(JSON.stringify({ roles: [{ id: "lfs", name: "Lead Financial Steward" }] }), { status: 200 }),
      ),
    );
    render(<DraftCarry cast={CAST} userId="u-juno" onPickCharacter={() => {}} />);
    await screen.findByText(/Adopted, and yours/);
    expect(screen.queryByRole("link", { name: /Apply/ })).toBeNull();
  });
});
