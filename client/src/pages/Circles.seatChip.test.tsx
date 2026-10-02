// @vitest-environment jsdom
/**
 * /circles: A SEAT CHIP OPENS THE SEAT'S ROLE CARD.
 *
 * The seats under "Key Focus Areas" were inert spans: the only way from a
 * circle to one of its seats was a different page. Each is a button now, and
 * it opens the role card in the phone sheet, which already moves focus in,
 * hands it back on close and closes on Escape. This file holds that path, and
 * the one door the card opens here: a raised hand, only while the map module
 * is on for this reader, and never the map's contact relay.
 *
 * The scene art and the mini map are stubbed: they are each their own
 * subject, and neither is what a chip does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ token: "a-token" as string | null }));
const catalog = vi.hoisted(() => ({ modules: [] as Array<{ id: string; name: string; lifecycle: string }> }));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/CircleScene", () => ({ default: () => null }));
vi.mock("@/components/CirclesMiniMap", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => session.token,
}));
// The catalog by its real rule (`moduleIsOn`, for a catalog that loaded).
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => catalog.modules.find((m) => m.id === id),
  useModuleOn: (id: string) => catalog.modules.some((m) => m.id === id && m.lifecycle !== "off"),
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import Circles from "./Circles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const ORG = {
  people: { visible: true, membersOnly: false, signedIn: true },
  village: { decidesBy: "consent" },
  circles: [{ id: "land", name: "Land & Water", purpose: "The ground and its water", decidesBy: null, color: "sage", status: "active" }],
  roles: [
    {
      id: "seed-keeper",
      name: "Seed Keeper",
      circleId: "land",
      aim: "Keep the seed library alive.",
      domain: "The seed library",
      accountabilities: [],
      whyItMatters: null,
      seats: 2,
      holderCount: 1,
      state: "partial",
      stateSource: "derived",
      criticality: "normal",
      recruiting: false,
      representsCircle: false,
      howChosen: null,
      howChosenGloss: null,
      termEnds: "2027-02-01T12:00:00.000Z",
      archetypes: [],
      isExample: false,
      holders: [{ userId: "u-ines", name: "Ines", kind: "member", focus: null, lapsed: false, isAgent: false }],
    },
    {
      id: "tank-warden",
      name: "Tank Warden",
      circleId: "land",
      aim: "Keep the tanks sound.",
      domain: null,
      accountabilities: [],
      whyItMatters: null,
      seats: 1,
      holderCount: 1,
      state: "filled",
      stateSource: "derived",
      criticality: "normal",
      recruiting: false,
      representsCircle: false,
      howChosen: null,
      howChosenGloss: null,
      termEnds: "2027-02-01T12:00:00.000Z",
      archetypes: [],
      isExample: false,
      holders: [{ userId: "u-oto", name: "Oto", kind: "member", focus: null, lapsed: false, isAgent: false }],
    },
  ],
};

const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  session.token = "a-token";
  catalog.modules = [{ id: "map", name: "Village map", lifecycle: "members" }];
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      asked.push(u);
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u === "/api/org") return reply(ORG);
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openCircle() {
  render(
    <Router>
      <Circles />
    </Router>,
  );
  const header = (await screen.findByRole("heading", { level: 3, name: "Land & Water" })).closest("button")!;
  fireEvent.click(header);
}

describe("a seat chip on /circles", () => {
  it("is a button that opens a dialog named after the seat, with the role card inside", async () => {
    await openCircle();
    const chip = screen.getByRole("button", { name: "Seed Keeper" });
    expect(chip.getAttribute("aria-haspopup")).toBe("dialog");
    // Closed: no dialog yet. The control is the open state below.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(chip);
    const dialog = screen.getByRole("dialog", { name: "Seed Keeper" });
    // The sheet's own panel is the night ground, so a light page draws no white frame.
    expect(dialog.className).toContain("sheet-night");
    const card = within(dialog).getByRole("article");
    expect(card.hasAttribute("data-power-card")).toBe(true);
    expect(within(card).getByRole("heading", { level: 3, name: "Seed Keeper" })).toBeTruthy();
    // Not embedded here: the card says its own circle and state (on both
    // faces, so a reader who turned it over still has them).
    expect(within(card).getAllByText("Land & Water").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("Partly held").length).toBeGreaterThan(0);
    // The seat's history, below the card and outside it.
    await waitFor(() => expect(asked).toContain("/api/org/roles/seed-keeper/history"));
  });

  it("closes on Escape and hands focus back to the chip", async () => {
    await openCircle();
    const chip = screen.getByRole("button", { name: "Seed Keeper" });
    chip.focus();
    fireEvent.click(chip);
    const dialog = screen.getByRole("dialog", { name: "Seed Keeper" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("offers a raised hand while the map module is on, and never the contact relay", async () => {
    await openCircle();
    fireEvent.click(screen.getByRole("button", { name: "Seed Keeper" }));
    const dialog = screen.getByRole("dialog", { name: "Seed Keeper" });
    expect(within(dialog).getByRole("button", { name: "Raise your hand for Seed Keeper" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Contact/ })).toBeNull();
  });

  it("offers no relay on a full seat either, and no note about reaching its holder", async () => {
    await openCircle();
    fireEvent.click(screen.getByRole("button", { name: "Tank Warden" }));
    const dialog = screen.getByRole("dialog", { name: "Tank Warden" });
    // Known positive: the holder is drawn, so the card rendered its roster.
    expect(within(dialog).getByText("Oto")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Contact/ })).toBeNull();
    expect(within(dialog).queryByText("Held, and not reachable through the map yet.")).toBeNull();
  });

  it("offers no hand while the map module is off for this reader", async () => {
    catalog.modules = [];
    await openCircle();
    fireEvent.click(screen.getByRole("button", { name: "Seed Keeper" }));
    const dialog = screen.getByRole("dialog", { name: "Seed Keeper" });
    // Known positive: the card is there, with its roster.
    expect(within(dialog).getByText("Holding it now")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Raise your hand/ })).toBeNull();
  });
});
