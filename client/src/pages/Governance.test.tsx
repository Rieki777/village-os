// @vitest-environment jsdom
/**
 * How We Govern renders from its spec (shared/pageContent/governance.ts).
 *
 * THE WIRING TEST: a distinct marker typed into every field and every list row
 * must reach the page, with Hypha configured and brochure pages on so every
 * section draws. Beside it, the two facts this conversion stopped typing:
 *   - the steward's veto window is the village's `governance.veto_hours`,
 *     read from /api/game/mechanics, where the page used to say "three days"
 *     whatever the village had set;
 *   - the Hypha section follows whether the village has a Hypha space, where
 *     it used to describe one to every village.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { GOVERNANCE_PAGE } from "@shared/pageContent/governance";
import { markerDocument } from "@shared/pageContent/resolve";

let gameConfig: { project: Record<string, string>; currency: { name: string }; brochurePages?: boolean } | null;
let stored: Record<string, unknown>;
let hyphaConfigured: boolean;
let isAdmin: boolean;
/** What /api/game/mechanics answers: a veto window in hours, or a failure. */
let mechanics: { vetoHours: number } | "down";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// The live ballots are the village's real votes, not page words.
vi.mock("@/components/governance/LiveDecisionsBand", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => gameConfig,
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored[section] ?? null),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useHypha: () =>
    hyphaConfigured
      ? { configured: true, orgUrl: "https://dho.example.org/willowbrook", links: {} }
      : { configured: false, orgUrl: "", links: {} },
}));
vi.mock("@/contexts/AuthContext", () => ({ useIsAdmin: () => isAdmin }));

import Governance from "./Governance";

const renderPage = () =>
  render(
    <Router>
      <Governance />
    </Router>,
  );
const headline = () => screen.findByRole("heading", { level: 1 });
/** The steward section waits for the window, so it is found, never got. */
const stewardsHeading = () => screen.findByRole("heading", { name: "Stewards, and Why They Are Temporary" });

beforeEach(() => {
  gameConfig = { project: { name: "Willowbrook", commitmentName: "Village Pledge" }, currency: { name: "Thanks" }, brochurePages: true };
  stored = {};
  hyphaConfigured = false;
  isAdmin = false;
  mechanics = { vetoHours: 72 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url) !== "/api/game/mechanics") return new Response("{}", { status: 404 });
      if (mechanics === "down") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      return new Response(
        JSON.stringify({
          variables: [
            { key: "governance.steward_council", parsed: false, value: "false" },
            { key: "governance.veto_hours", parsed: mechanics.vetoHours, value: String(mechanics.vetoHours) },
          ],
        }),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every field in the How We Govern spec reaches the page", () => {
  it("renders a distinct marker typed into each field and each list row", async () => {
    hyphaConfigured = true;
    const doc = markerDocument(GOVERNANCE_PAGE);
    stored["page-governance"] = doc;
    renderPage();
    await headline();
    // The marker document's stewards heading replaces the default, so wait on its first paragraph.
    await screen.findByText((doc.stewards as Record<string, string>).first);

    const text = document.body.textContent ?? "";
    const missing: string[] = [];
    for (const [sectionId, section] of Object.entries(doc)) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const values = Array.isArray(value)
          ? value.flatMap((row) => Object.entries(row as Record<string, string>).filter(([k]) => k !== "id").map(([, v]) => v))
          : [value as string];
        for (const v of values) if (!text.includes(v)) missing.push(`${sectionId}.${key} (${v})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("draws nothing of a section the village hid", async () => {
    hyphaConfigured = true;
    stored["page-governance"] = {
      principles: { hidden: true },
      circles: { hidden: true },
      conflict: { hidden: true },
      hypha: { hidden: true },
      cta: { hidden: true },
    };
    renderPage();
    await headline();
    await stewardsHeading();

    expect(screen.queryByText("The Core Principles")).toBeNull();
    expect(screen.queryByText("Circles and Their Domains")).toBeNull();
    expect(screen.queryByText("Conflict Resolution")).toBeNull();
    expect(screen.queryByText("The Hypha Platform")).toBeNull();
    expect(screen.queryByText("Ready to help govern?")).toBeNull();
    expect(screen.getByText("How a Decision Gets Made")).toBeInTheDocument();
    expect(screen.getByText("How Rules Evolve")).toBeInTheDocument();
  });

  it("draws no card for a circle list the village emptied, and keeps the link to its real circles", async () => {
    stored["page-governance"] = { circles: { items: [] } };
    renderPage();
    await headline();

    expect(screen.queryByText("General Coordinating Circle")).toBeNull();
    expect(screen.getByRole("link", { name: /See all circles in detail/ })).toHaveAttribute("href", "/circles");
  });
});

describe("the page with nothing saved", () => {
  it("keeps today's words, filled with the village's own name and commitment", async () => {
    renderPage();

    expect(await headline()).toHaveTextContent("Power Belongs to the Circle, Not the Person");
    expect(screen.getByText(/^Willowbrook uses sociocracy, a consent-based governance system/)).toBeInTheDocument();
    expect(screen.getByText("Consent over consensus")).toBeInTheDocument();
    expect(screen.getByText("If no one has a paramount objection, the proposal passes.")).toBeInTheDocument();
    expect(screen.getByText("Finance & Business Circle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign the Village Pledge" })).toHaveAttribute("href", "/love-letter");
  });

  it("goes without its closing invitation while brochure pages are off", async () => {
    gameConfig = { ...gameConfig!, brochurePages: false };
    renderPage();
    await headline();

    expect(screen.queryByText("Ready to help govern?")).toBeNull();
    expect(screen.getByText("Circles and Their Domains")).toBeInTheDocument();
  });
});

describe("the steward's veto window follows governance.veto_hours", () => {
  it("says three days at the 72-hour floor, as the page always did", async () => {
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has three days to stop it before it takes effect\./)).toBeInTheDocument();
  });

  it("says the village's own longer window", async () => {
    mechanics = { vetoHours: 120 };
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has five days to stop it before it takes effect\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("three days");
  });

  it("counts a window that is not whole days in hours", async () => {
    mechanics = { vetoHours: 100 };
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has 100 hours to stop it/)).toBeInTheDocument();
  });

  // The setting refuses anything under 72 and the engine floors a stored one
  // there (`vetoHoursFrom`), so a row from before the floor still gets the
  // three days the engine actually gives. The page never promises less.
  for (const below of [0, 1, 24, 71]) {
    it(`says the 72-hour floor for a stored ${below}, as the engine enforces it`, async () => {
      mechanics = { vetoHours: below };
      renderPage();
      await stewardsHeading();

      expect(screen.getByText(/a steward has three days to stop it before it takes effect\./)).toBeInTheDocument();
    });
  }

  it("says a whole number of days past the floor in words, and 30 days in figures", async () => {
    for (const [hours, words] of [[96, "four days"], [720, "30 days"], [73, "73 hours"]] as const) {
      mechanics = { vetoHours: hours };
      const { unmount } = renderPage();
      await stewardsHeading();
      expect(screen.getByText(new RegExp(`a steward has ${words} to stop it`))).toBeInTheDocument();
      unmount();
    }
  });

  it("follows the setting inside words the village wrote itself", async () => {
    mechanics = { vetoHours: 168 };
    stored["page-governance"] = { stewards: { first: "Our stewards get {veto} to pause a passed change." } };
    renderPage();
    await stewardsHeading();

    expect(screen.getByText("Our stewards get seven days to pause a passed change.")).toBeInTheDocument();
  });

  it("claims only the floor when the setting cannot be read", async () => {
    mechanics = "down";
    renderPage();
    await stewardsHeading();

    expect(screen.getByText(/a steward has at least three days to stop it/)).toBeInTheDocument();
  });
});

describe("a village that hides every section it may", () => {
  it("keeps the top of the page and draws nothing else, the Hypha note included", async () => {
    hyphaConfigured = false;
    isAdmin = true;
    stored["page-governance"] = Object.fromEntries(
      GOVERNANCE_PAGE.sections.filter((s) => s.hideable).map((s) => [s.id, { hidden: true }]),
    );
    renderPage();
    await headline();
    // Let the veto window arrive, so a steward section held back only for it would show up here.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/game/mechanics"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelectorAll("h2, h3")).toHaveLength(0);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(screen.queryByText(/Only admins see this note/)).toBeNull();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });
});

describe("the Hypha section follows the village's Hypha space", () => {
  it("is not drawn while the village has no Hypha DHO link", async () => {
    renderPage();
    await headline();
    await stewardsHeading();

    expect(screen.queryByText("The Hypha Platform")).toBeNull();
    expect(screen.queryByText(/Governance is logged on Hypha/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Learn more in the Game Guide/ })).toBeNull();
  });

  it("is drawn, with its link to the guide, once the link is set", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();

    expect(screen.getByText("The Hypha Platform")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Learn more in the Game Guide/ })).toHaveAttribute("href", "/co-creators-guide");
  });

  it("tells an admin, and only an admin, why it is missing", async () => {
    renderPage();
    await headline();
    expect(screen.queryByText(/Only admins see this note/)).toBeNull();

    isAdmin = true;
    renderPage();
    expect(await screen.findByText(/Only admins see this note/)).toHaveTextContent("Admin, Variables");
  });
});
