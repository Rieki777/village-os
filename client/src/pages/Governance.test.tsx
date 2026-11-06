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
 * And the starter words: true of any village, so a new one is told no
 * governance method, no conflict practice and no circle it does not have.
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
/** A field's default, read off the spec, so a reworded default moves its test with it. */
const said = (sectionId: string, key = "heading") =>
  GOVERNANCE_PAGE.sections.find((s) => s.id === sectionId)!.fields.find((f) => f.key === key)!.default;
/** The steward section waits for the window, so it is found, never got. */
const stewardsHeading = () => screen.findByRole("heading", { name: said("stewards") });

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

    for (const hidden of ["principles", "circles", "conflict", "hypha", "cta"]) {
      expect(screen.queryByText(said(hidden)), hidden).toBeNull();
    }
    expect(screen.getByText(said("decision"))).toBeInTheDocument();
    expect(screen.getByText(said("rules"))).toBeInTheDocument();
  });

  it("draws the circle cards a village writes, and none until it does", async () => {
    renderPage();
    await headline();
    expect(screen.getByRole("link", { name: new RegExp(said("circles", "linkLabel")) })).toHaveAttribute("href", "/circles");
    expect(screen.queryByText(/General Coordinating Circle|Development Circle|Community Circle/)).toBeNull();

    stored["page-governance"] = { circles: { items: [{ name: "Water Circle", body: "Wells, tanks and the creek." }] } };
    renderPage();
    expect(await screen.findByText("Water Circle")).toBeInTheDocument();
    expect(screen.getByText("Wells, tanks and the creek.")).toBeInTheDocument();
  });
});

describe("the page with nothing saved", () => {
  it("says the starter words, filled with the village's own name and commitment", async () => {
    renderPage();

    expect(await headline()).toHaveTextContent("How Willowbrook Decides");
    expect(screen.getByText(/^Here is how a proposal becomes a decision in Willowbrook/)).toBeInTheDocument();
    expect(screen.getByText("Anyone can propose")).toBeInTheDocument();
    expect(screen.getByText("The village decides, in the way it agreed for that kind of decision.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign the Village Pledge" })).toHaveAttribute("href", "/love-letter");
  });

  it("states no governance method, conflict practice or circle as this village's fact", async () => {
    renderPage();
    await headline();
    await stewardsHeading();
    const text = document.body.textContent ?? "";

    for (const claim of [/sociocra/i, /nonviolent communication/i, /consent/i, /paramount objection/i, /mediation/i, /General Coordinating/, /Development Circle/, /\bfive circles\b/i]) {
      expect(text, String(claim)).not.toMatch(claim);
    }
  });

  it("goes without its closing invitation while brochure pages are off", async () => {
    gameConfig = { ...gameConfig!, brochurePages: false };
    renderPage();
    await headline();

    expect(screen.queryByText(said("cta"))).toBeNull();
    expect(screen.getByText(said("circles"))).toBeInTheDocument();
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

    expect(screen.queryByText(said("hypha"))).toBeNull();
    expect(screen.queryByText(/has a space on Hypha/)).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(said("hypha", "linkLabel")) })).toBeNull();
  });

  it("is drawn, with its link to the guide, once the link is set", async () => {
    hyphaConfigured = true;
    renderPage();
    await headline();

    expect(screen.getByText(said("hypha"))).toBeInTheDocument();
    expect(screen.getByText("Willowbrook has a space on Hypha, an open-source platform for proposals and votes. What happens there can be read and traced.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(said("hypha", "linkLabel")) })).toHaveAttribute("href", "/co-creators-guide");
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
