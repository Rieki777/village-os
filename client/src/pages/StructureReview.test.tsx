// @vitest-environment jsdom
/**
 * The structure review page, against a plan built by the same shared function
 * the server uses, in the shape the first vendor sync sent: circles under the
 * vendor's own keys with its change log under "Notes", one structure holding
 * the seats, and two seats named the same as ONE live seat.
 *
 * What a steward has to be able to trust about it:
 *   - the primary action stays disabled until every seat that already exists
 *     has a choice, and two seats can never both take over one live seat;
 *   - leaving something out moves the counts, and leaving a new circle out
 *     takes its seats with it;
 *   - the vendor's raw fields are behind "What ... sent" and closed, and its
 *     change log is never shown as a purpose;
 *   - accepting sends exactly the decisions on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { planStructure, type PlanProposal } from "@shared/structurePlan";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
}));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useParams: () => ({ batchId: "sync-1" }),
}));

import StructureReview from "./StructureReview";

const PROPOSALS: PlanProposal[] = [
  {
    id: "xp-structure",
    kind: "org.proposed",
    payload: {
      title: "Structure suggested by the connected service",
      seats: [
        { name: "Operations Steward", circleName: "Community Anchor", aim: "Day to day coordination.", id: "rec-1" },
        { name: "Operations Steward", circleName: "Regenerative Business", aim: "Runs the ventures.", id: "rec-2" },
        { name: "Events Manager", circleName: "Regenerative Business", aim: "Gatherings.", id: "rec-3" },
        { name: "Marketing Lead", circleName: "Community Anchor", aim: "The story, outward.", id: "rec-4" },
      ],
    },
  },
  { id: "xp-anchor", kind: "circle.proposed", payload: { "Circle Name": "Community Anchor", Notes: "[Rewritten per V5]" } },
  { id: "xp-business", kind: "circle.proposed", payload: { "Circle Name": "Regenerative Business", Notes: "[Rewritten per V5]" } },
];

const PLAN = planStructure(
  PROPOSALS,
  [{ id: "general", name: "General Circle", parentCircleId: null, status: "active", isExample: false }],
  [{ id: "ops", name: "Operations Steward", circleId: "general", active: true, isExample: false, holders: 1 }],
);

let posted: any[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posted.push(body);
        return {
          ok: true,
          status: 200,
          json: async () =>
            body.dryRun
              ? { dryRun: true, lines: [{ reads: 'Create the circle "Community Anchor"', blocked: null }], blocked: 0 }
              : { success: true, draftId: "draft-1", blockedLines: [], leftInQueue: [] },
        };
      }
      expect(String(url)).toBe("/api/review/batches/sync-1/structure");
      return {
        ok: true,
        status: 200,
        json: async () => ({ batchId: "sync-1", moduleId: "saberra", receivedAt: "2026-10-09T17:24:00Z", title: "Structure suggested by the connected service", plan: PLAN }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const count = (label: string) => screen.getByTestId(`count-${label}`).textContent;
const accept = () => screen.getByRole("button", { name: "Accept into a draft" });

async function ready() {
  render(<StructureReview />);
  await screen.findByRole("heading", { level: 1, name: "Structure suggested by the connected service" });
}

describe("the structure review page", () => {
  it("keeps the primary action disabled until every seat that already exists is settled", async () => {
    await ready();
    expect(accept()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview as a draft" })).toBeDisabled();
    expect(count("Need your call")).toBe("2");
    expect(screen.getByTestId("bar-status").textContent).toContain("2 seats need your call");

    const [first, second] = [screen.getByTestId("conflict-xp-structure#0"), screen.getByTestId("conflict-xp-structure#1")];
    fireEvent.click(within(first).getByRole("button", { name: "Move the live seat here" }));
    expect(accept()).toBeDisabled();
    // The live seat can move once: the second match may not take it too.
    expect(within(second).getByRole("button", { name: "Move the live seat here" })).toBeDisabled();

    fireEvent.click(within(second).getByRole("button", { name: "Add as a second seat" }));
    // A second seat needs a name of its own before anything goes ahead.
    expect(accept()).toBeDisabled();
    fireEvent.change(within(second).getByRole("textbox"), { target: { value: "Ventures Operations Steward" } });
    expect(count("Need your call")).toBe("0");
    expect(accept()).toBeEnabled();
    expect(screen.getByTestId("bar-status").textContent).toContain("Ready");
  });

  it("moves the counts when something is left out, and takes a left-out circle's seats with it", async () => {
    await ready();
    expect(count("New circles")).toBe("2");
    expect(count("New seats")).toBe("2");

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Marketing Lead" }));
    expect(count("New seats")).toBe("1");

    fireEvent.click(screen.getByRole("checkbox", { name: "Include the circle Regenerative Business" }));
    expect(count("New circles")).toBe("1");
    expect(count("New seats")).toBe("0");
    expect(screen.getByRole("checkbox", { name: "Include Events Manager" })).not.toBeChecked();
    // The match inside it left with it, so only one call is still owed.
    expect(count("Need your call")).toBe("1");

    // Keeping a seat again keeps its circle.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Events Manager" }));
    expect(screen.getByRole("checkbox", { name: "Include the circle Regenerative Business" })).toBeChecked();
    expect(count("New circles")).toBe("2");
  });

  it("keeps what the vendor sent closed behind its disclosure, and never shows its change log as a purpose", async () => {
    await ready();
    const disclosures = screen.getAllByText("What Organisational Memory sent").map((s) => s.closest("details")!);
    expect(disclosures.length).toBe(PLAN.circles.length + PLAN.seats.length);
    expect(disclosures.every((d) => d.open === false)).toBe(true);
    // Every raw payload sits inside one of those, and nowhere else.
    for (const pre of Array.from(document.querySelectorAll("pre"))) expect(pre.closest("details")).not.toBeNull();
    for (const node of screen.getAllByText(/Rewritten per V5/)) expect(node.closest("details")).not.toBeNull();
  });

  it("previews, then accepts, sending exactly the decisions on screen", async () => {
    await ready();
    fireEvent.click(within(screen.getByTestId("conflict-xp-structure#0")).getByRole("button", { name: "Move the live seat here" }));
    fireEvent.click(within(screen.getByTestId("conflict-xp-structure#1")).getByRole("button", { name: "Leave it out" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Retire the old chart/ }));

    fireEvent.click(screen.getByRole("button", { name: "Preview as a draft" }));
    await screen.findByTestId("draft-preview");
    fireEvent.click(accept());
    await screen.findByTestId("accepted");

    expect(posted).toHaveLength(2);
    expect(posted[0].dryRun).toBe(true);
    expect(posted[1]).toEqual({
      exclude: ["xp-structure#1"],
      conflicts: { "xp-structure#0": { choice: "update" } },
      retireOldChart: true,
      dryRun: false,
    });
    await waitFor(() => expect(accept()).toBeDisabled());
  });

  it("offers the map as a list, where a seat jumps to its row", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Show the map as a list" }));
    const list = screen.getByTestId("structure-map-list");
    expect(within(list).getByText("Community Anchor")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Marketing Lead" }));
    expect(document.getElementById("row-xp-structure#3")!.className).toContain("bg-muted");
  });
});
