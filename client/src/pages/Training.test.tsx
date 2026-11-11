// @vitest-environment jsdom
/**
 * TWO TRAINING PAGES AND A CHOOSER (the lead, 11 Nov 2026: community training
 * is on both the steward and the resident routes, holding the same content
 * for now, "but should have 2 different routes in admin").
 *
 * What is held here:
 *   - each track page reads ITS OWN saved words (page-training-steward or
 *     page-training-resident), never the other's;
 *   - /training draws one door per track, each named in that page's words and
 *     linking to that page;
 *   - the member's progress is words and a Seed of Life, never a percentage
 *     or a filling bar (docs/DESIGN_RULE.md);
 *   - the next lesson is the first required one not yet done.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useGameConfig: () => ({ project: { name: "Willowbrook" }, currency: { name: "Gratitude" } }),
  authToken: () => session.token,
  gameFetch: (url: string, init?: RequestInit) => fetch(url, init),
}));

const session = vi.hoisted(() => ({ token: "" as string }));

/** Each page's saved words, by content section. */
const stored = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(stored.current[section] ?? null),
}));

import Training from "./Training";
import { TRAINING_PAGES } from "@shared/pageContent/training";

const MODULES = [
  // The optional one comes first, so "next" has to skip it to reach a required one.
  { id: "m3", title: "Circles", description: "", type: "Workshop", url: "", order: 0, mandatory: false },
  { id: "m1", title: "Listening", description: "", type: "Practice", url: "https://example.org/1", order: 1, mandatory: true },
  { id: "m2", title: "Speaking", description: "", type: "Video", url: "", order: 2, mandatory: true },
];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  session.token = "";
  stored.current = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/training-modules")) return json(MODULES);
      if (url.startsWith("/api/game/training/completed")) return json({ completed: ["m1"] });
      return json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const inRouter = (node: ReactNode) => render(<Router>{node}</Router>);

describe("a track's training page", () => {
  it("reads its own saved words, never the other track's", async () => {
    stored.current = {
      "page-training-steward": { hero: { headline: "Stewards learn here" } },
      "page-training-resident": { hero: { headline: "Residents learn here" } },
    };
    const { unmount } = inRouter(<Training track="steward" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Stewards learn here" })).toBeTruthy();
    expect(screen.queryByText("Residents learn here")).toBeNull();
    unmount();

    inRouter(<Training track="resident" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Residents learn here" })).toBeTruthy();
    expect(screen.queryByText("Stewards learn here")).toBeNull();
  });

  it("falls back to its own defaults when the village saved nothing", async () => {
    inRouter(<Training track="resident" />);
    const eyebrow = TRAINING_PAGES.resident.sections[0].fields.find((f) => f.key === "eyebrow")!.default;
    await waitFor(() => expect(screen.getByText(eyebrow)).toBeTruthy());
  });

  it("shows a member's progress as words, with no percentage and no bar", async () => {
    session.token = "t";
    const { container } = inRouter(<Training track="steward" />);
    expect(await screen.findByText("1 of 3 lessons done")).toBeTruthy();
    expect(screen.getByText(/1 of 2 required lessons done/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+%/);
    expect(container.querySelector('[style*="width"]')).toBeNull();
    // The Seed of Life names the same count to a screen reader.
    expect(screen.getByRole("img", { name: "1 of 3 lessons done" })).toBeTruthy();
  });

  it("marks the first required lesson not yet done as next", async () => {
    session.token = "t";
    const { container } = inRouter(<Training track="steward" />);
    await screen.findByText("1 of 3 lessons done");
    const next = container.querySelector("[data-next]") as HTMLElement;
    expect(next).toBeTruthy();
    expect(within(next).getByRole("heading", { name: "Speaking" })).toBeTruthy();
    expect(container.querySelectorAll("[data-next]").length).toBe(1);
  });

  it("signed out, offers a sign-in in place of the record", async () => {
    inRouter(<Training track="steward" />);
    await screen.findByRole("heading", { name: "Listening" });
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByText(/of \d+ lessons done/)).toBeNull();
  });
});

describe("/training, the chooser", () => {
  it("draws one door per track, named in that page's words and linking to it", async () => {
    stored.current = {
      "page-training-steward": { door: { title: "For our stewards" } },
      "page-training-resident": { door: { title: "For our residents" } },
    };
    inRouter(<Training />);
    const nav = await screen.findByRole("navigation", { name: "Training pages" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/training/steward", "/training/resident"]);
    expect(within(links[0]).getByText("For our stewards")).toBeTruthy();
    expect(within(links[1]).getByText("For our residents")).toBeTruthy();
  });

  it("asks for no lessons and no record: it only chooses", async () => {
    session.token = "t";
    inRouter(<Training />);
    await screen.findByRole("navigation", { name: "Training pages" });
    const asked = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(asked.filter((u) => u.startsWith("/api/training-modules") || u.startsWith("/api/game/training"))).toEqual([]);
  });
});
