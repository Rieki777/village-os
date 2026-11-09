// @vitest-environment jsdom
/**
 * The next-step box under a claimed quest: it reads the box from the server
 * once the member holds a claim, names the role with its live holder, gives a
 * vacant role the open-roles link instead of a person, and shows nothing at
 * all before a claim or when the box could not be read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ResolvedNextStep } from "@shared/questNextStep";

const gameFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gameApi", () => ({ gameFetch }));

import NextStepBox from "./NextStepBox";

const answer = (status: number, body: unknown) =>
  gameFetch.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body });

const NEXT: ResolvedNextStep = {
  talkTo: { kind: "role", roleId: "build-steward", circleId: "dev", source: "circle", vacant: false, structureKey: null },
  talkToLive: { roleName: "Build Steward", circleName: "Development", holders: ["Rick"] },
  firstTask: { kind: "step", text: "Walk the site with the steward" },
  crew: { kind: "invite", crewId: "c1", path: "/quests/q1?crew=AbC", size: 3 },
  when: { kind: "date", at: "2027-01-10T14:00:00.000Z", source: "starts" },
};

beforeEach(() => gameFetch.mockReset());

describe("NextStepBox", () => {
  it("reads the box for a claimed quest and shows all four parts", async () => {
    answer(200, { claimId: "claim-1", next: NEXT });
    render(<NextStepBox questId="q1" claimStatus="claimed" />);
    expect(await screen.findByText("Your next step")).toBeTruthy();
    expect(gameFetch).toHaveBeenCalledWith("/api/game/quests/q1/next");
    expect(screen.getByText("Talk to Build Steward (Rick)")).toBeTruthy();
    expect(screen.getByText("Walk the site with the steward")).toBeTruthy();
    expect(screen.getByText("Your crew has 3 so far.")).toBeTruthy();
    expect(screen.getByText("Copy the crew link")).toBeTruthy();
    expect(screen.getByText(/^Starts /)).toBeTruthy();
  });

  it("offers the open roles for a role nobody holds, and names no person", async () => {
    answer(200, { next: { ...NEXT, talkTo: { ...NEXT.talkTo, vacant: true }, talkToLive: { ...NEXT.talkToLive!, holders: [] } } });
    render(<NextStepBox questId="q1" claimStatus="claimed" />);
    expect(await screen.findByText("Nobody holds Build Steward yet.")).toBeTruthy();
    expect(screen.getByText("See the open roles").closest("a")?.getAttribute("href")).toBe("/roles");
  });

  it("says plainly when there is no date and no first step written", async () => {
    answer(200, { next: { ...NEXT, firstTask: { kind: "read", questId: "q1" }, when: { kind: "none" }, crew: { kind: "start", questId: "q1" } } });
    render(<NextStepBox questId="q1" claimStatus="claimed" />);
    expect(await screen.findByText("No date yet. Agree one when you talk.")).toBeTruthy();
    expect(screen.getByText("Start a crew and invite friends").closest("a")?.getAttribute("href")).toBe("/quests/q1#quest-crews");
  });

  it("shows nothing before a claim, and nothing when the box could not be read", async () => {
    const { container, rerender } = render(<NextStepBox questId="q1" claimStatus={undefined} />);
    expect(gameFetch).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
    answer(503, { error: "next_step_unavailable" });
    rerender(<NextStepBox questId="q1" claimStatus="claimed" />);
    await waitFor(() => expect(gameFetch).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe("");
  });
});
