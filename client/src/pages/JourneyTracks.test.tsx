// @vitest-environment jsdom
/**
 * TWO PATHS OFF THE SAME FIRST STEPS (build list 8.6, 11 Nov 2026).
 *
 * The steward and resident pages share their first steps and the fork, both
 * written once on the steward page's words. What is held here: the resident
 * page shows the steward page's first steps and not its exceptions line (that
 * line stands in front of a role application), a tick on one page shows on the
 * other, each page marks its own path in the fork, and a village's own words
 * for the first steps reach both pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ComponentType, ReactNode } from "react";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const state = vi.hoisted(() => ({ pages: {} as Record<string, unknown> }));

vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/WhyCostaRica", () => ({ default: () => null }));
vi.mock("@/components/FaqSection", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useIsAdmin: () => false }));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Willowbrook" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Thanks", useValueTokenName: () => "Seeds" }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useBrandImages: () => ({}),
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "https://example.org/events", contactEmail: "", mailTo: () => "" }),
  useGameConfig: () => ({ project: { name: "Willowbrook", adminPath: "/admin" } }),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(state.pages[section] ?? null),
  useVillageContent: () => ({ content: null, loading: false, isPlaceholder: true }),
}));

import StewardJourney from "./StewardJourney";
import ResidentJourney from "./ResidentJourney";
import { FIRST_STEPS_KEY } from "@/components/tracks/FirstSteps";

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
};

const show = (Page: ComponentType) =>
  render(
    <Router>
      <Page />
    </Router>,
  );

const firstSteps = () => document.querySelector("#first-steps ol") as HTMLElement;

beforeEach(() => {
  state.pages = {};
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => vi.unstubAllGlobals());

describe("the resident page shares the steward page's first steps", () => {
  it("shows the same first steps, under its own heading, without the exceptions line", async () => {
    show(ResidentJourney);
    expect(await screen.findByText("Start with the first steps")).toBeInTheDocument();
    await waitFor(() => expect(firstSteps()).not.toBeNull());
    expect(firstSteps()).toHaveTextContent(/Come to an open call.*Walk the land with us.*Share a meal with the village/);
    expect(screen.queryByText(/you can still apply/)).toBeNull();
    expect(document.querySelector('[data-testid="first-steps-exceptions"]')).toBeNull();
  });

  it("reads a village's own first steps from the steward page's words", async () => {
    state.pages["page-journey-steward"] = {
      getToKnow: { items: [{ stage: "First", title: "Sit by the river", description: "Our own first step." }] },
      tracks: { residentTitle: "Make a home" },
    };
    show(ResidentJourney);
    await waitFor(() => expect(firstSteps()).not.toBeNull());
    expect(within(firstSteps()).getByText("Sit by the river")).toBeInTheDocument();
    expect(within(document.querySelector('[data-track="resident"]') as HTMLElement).getByRole("heading", { name: "Make a home" })).toBeInTheDocument();
  });

  it("keeps a tick from one page on the other", async () => {
    show(StewardJourney);
    await waitFor(() => expect(firstSteps()).not.toBeNull());
    fireEvent.click(within(firstSteps()).getByRole("checkbox", { name: /Walk the land with us/ }));
    expect(JSON.parse(localStorage.getItem(FIRST_STEPS_KEY) ?? "[]")).toEqual(["Walk the land with us"]);
    cleanup();
    show(ResidentJourney);
    await waitFor(() => expect(firstSteps()).not.toBeNull());
    await waitFor(() => expect(within(firstSteps()).getByRole("checkbox", { name: /Walk the land with us/ })).toHaveAttribute("aria-checked", "true"));
    expect(within(firstSteps()).getByRole("checkbox", { name: /Come to an open call/ })).toHaveAttribute("aria-checked", "false");
  });

  it("marks the home path as here on the resident page and links across to /steward", async () => {
    show(ResidentJourney);
    await screen.findByText("Two paths from here");
    const steward = document.querySelector('[data-track="steward"]') as HTMLElement;
    const resident = document.querySelector('[data-track="resident"]') as HTMLElement;
    expect(within(resident).getByText("You are here")).toBeInTheDocument();
    expect(within(steward).getByRole("link", { name: /Hold a role/ })).toHaveAttribute("href", "/steward");
  });

  it("draws no first steps on the resident page when the village hides its heading there", async () => {
    state.pages["page-journey-resident"] = { entry: { hidden: true } };
    show(ResidentJourney);
    await screen.findByText("Two paths from here");
    expect(document.querySelector("#first-steps")).toBeNull();
  });

  it("grows a seed for the resident path, and draws no filling bar", async () => {
    show(ResidentJourney);
    await screen.findByText(/steps completed/);
    expect(document.querySelector("#home-path .nk-life")).not.toBeNull();
    expect(document.querySelector("#home-path [style*='width']")).toBeNull();
  });
});
