// @vitest-environment jsdom
/**
 * One set of path names on the homepage: each path card's title and second
 * line are the village's path words (Admin, Paths & Stages), served on
 * /api/game/config, wherever the village has not written its own card words
 * (Admin, Pages, Home). Mocked the way Home.pageSwitch.test.tsx mocks the page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";
import { resolveVillagePathWords, servedPaths } from "@shared/villagePaths";
import { pageVarsFrom } from "@shared/pageContent/vars";

let gameConfig: Record<string, unknown>;
let storedHome: unknown;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/BuildProgress", () => ({ default: () => null }));
vi.mock("@/components/SeasonBanner", () => ({ default: () => null }));
vi.mock("@/components/VillagePulse", () => ({ default: () => null }));
vi.mock("@/components/MapPeek", () => ({ default: () => null }));
vi.mock("@/lib/gameApi", () => ({
  useBrandImages: () => ({ hero: "" }),
  useGameConfig: () => gameConfig,
  useVillageLinks: () => ({ siteUrl: "", eventsUrl: "", contactEmail: "", mailTo: () => "" }),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
}));
vi.mock("@/hooks/useVillageContent", () => ({
  readVillageSection: (section: string) => Promise.resolve(section === "page-home" ? storedHome : null),
}));

import Home from "./Home";

const project = { name: "Willowbrook", tagline: "", location: "" };
const withPaths = (doc: unknown) => {
  gameConfig = { ...gameConfig, paths: servedPaths(resolveVillagePathWords(doc), pageVarsFrom({ project })) };
};

/** Each card's title and second line, in the order drawn. */
async function cards() {
  render(
    <Router>
      <Home />
    </Router>,
  );
  await screen.findByRole("heading", { level: 1 });
  return Array.from(document.querySelectorAll("#choose-path h3")).map((h) => `${h.textContent} | ${h.nextElementSibling?.textContent}`);
}

beforeEach(() => {
  gameConfig = { project, currency: { name: "Thanks" }, brochurePages: true, brochureHidden: [] };
  storedHome = null;
  withPaths(null);
});

describe("the path cards' names", () => {
  it("are the platform's while nothing was renamed, the control for the cases below", async () => {
    expect(await cards()).toEqual([
      "Investor | Capital Contributor",
      "Village Steward | Co-Creator",
      "Resident | Co-Creator",
      "Prosperity Creator | Business Builder",
    ]);
  });

  it("follow a rename when the village wrote no card words, {words} filled, and the button says the new name", async () => {
    withPaths({ paths: { resident: { label: "Neighbour", role: "Lives in {village}" } } });
    expect((await cards())[2]).toBe("Neighbour | Lives in Willowbrook");
    expect(screen.getByText("Choose Neighbour")).toBeTruthy();
  });

  it("CONTROL: keep the card words the village saved, and the rename reaches the cards it left alone", async () => {
    withPaths({ paths: { resident: { label: "Neighbour" }, investor: { label: "Backer" } } });
    storedHome = { paths: { cards: [{ id: "resident", title: "Settler", subtitle: "Here for good", description: "Ours." }] } };
    const drawn = await cards();
    expect(drawn[2]).toBe("Settler | Here for good");
    expect(drawn[0]).toBe("Backer | Capital Contributor");
  });

  it("a journey switched off on its own keeps its card out, renamed or not", async () => {
    withPaths({ paths: { investor: { label: "Seedfunder" } } });
    gameConfig.brochureHidden = ["/investor"];
    const drawn = await cards();
    expect(drawn).toHaveLength(3);
    expect(document.body.textContent).not.toContain("Seedfunder");
  });
});
