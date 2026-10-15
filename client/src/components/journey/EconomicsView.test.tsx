// @vitest-environment jsdom
/**
 * "COPY FOR HYPHA" IS FOR A VILLAGE THAT HAS A HYPHA SPACE (2026-09-26).
 *
 * The economics view used to offer the button on every settlement in every
 * village, whether or not the village had ever heard of Hypha. It now reads
 * `hyphaSpace` off the command-centre payload the view already loads, and
 * this file holds both halves: no space, no button; a space, the button, and
 * it copies the settlement.
 *
 * And, since the view left a shopfront page for the Journey components, it
 * names the recognition token the way the village named it
 * (scripts/check-village-facts.mjs), never as a literal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/lib/gameApi", () => ({
  useCatalyst: () => ({ aName: "an admin" }),
  authToken: () => "a-token",
  // A village that renamed its recognition token: the view must say Seeds.
  useGameConfig: () => ({ currency: { name: "Seeds", nameLower: "seeds" } }),
}));

import { EconomicsView } from "./EconomicsView";
import { EconomicsView as FromTheTracker } from "@/pages/ProjectHistory";

/** One closed settlement, so there is a row a button could sit on. */
const payload = (hyphaSpace: unknown) => ({
  settlement: [
    {
      cycleId: "c1",
      cycleNumber: 1042,
      closedAt: "2026-09-20T00:00:00.000Z",
      poolToken: "SEED",
      poolCredited: 30,
      moon: null,
      totals: [
        { userId: "u1", name: "Wren", received: 7, receivedHearts: 2, receivedAcks: 5, distinctSenders: 3, credited: 30 },
      ],
    },
  ],
  modules: [],
  pendingConsents: [],
  staleMilestones: [],
  reconciliation: { invariants: { ok: true, problems: [] } },
  ...(hyphaSpace === undefined ? {} : { hyphaSpace }),
});

let answer: unknown;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => answer })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const draw = () =>
  render(
    <Router>
      <EconomicsView headers={() => ({ Authorization: "Bearer a-token" })} />
    </Router>,
  );

describe("Copy for Hypha", () => {
  it("is absent when the village has no Hypha space, and the settlement still shows", async () => {
    answer = payload(null);
    draw();
    await waitFor(() => expect(screen.getByText("Wren")).toBeTruthy());
    expect(screen.getByText("Cycle settlement report")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy for hypha/i })).toBeNull();
  });

  it("is absent when the server sends no field at all, or an empty one", async () => {
    for (const space of [undefined, "", "   "]) {
      answer = payload(space);
      const view = draw();
      await waitFor(() => expect(screen.getByText("Wren")).toBeTruthy());
      expect(screen.queryByRole("button", { name: /copy for hypha/i }), JSON.stringify(space)).toBeNull();
      view.unmount();
    }
  });

  it("shows once a space is set, names it, and copies the settlement", async () => {
    answer = payload("our-space");
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    draw();
    const button = await screen.findByRole("button", { name: /copy for hypha/i });
    expect(button.getAttribute("title")).toContain("our-space");
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(text).toContain("Wren: 7 received (2 seeds + 5 acknowledgments) from 3 member(s)");
    expect(text).toContain("Pool released: 30 SEED");
  });
});

describe("the recognition token", () => {
  it("is called what the village calls it, in the table and in the note", async () => {
    answer = payload(null);
    draw();
    await waitFor(() => expect(screen.getByText("Wren")).toBeTruthy());
    expect(screen.getByRole("columnheader", { name: "Seeds" })).toBeTruthy();
    expect(screen.getByText(/Seeds and written acknowledgments are never blended/)).toBeTruthy();
    expect(screen.queryByText(/gratitude/i)).toBeNull();
  });
});

describe("where the view lives", () => {
  it("is still exported by the tracker page under its old name", () => {
    expect(FromTheTracker).toBe(EconomicsView);
  });
});
