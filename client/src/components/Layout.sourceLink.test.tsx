// @vitest-environment jsdom
/**
 * THE FOOTER'S "SOURCE CODE" LINK (AGPL-3.0-or-later, section 13).
 *
 * Anyone who runs a changed version of Village OS for other people must offer
 * those people its source. Every village's footer therefore links to the
 * address in the village setting `platform.source_url`, served as `sourceUrl`
 * in the public config. These pin that the link renders from the setting, that
 * an empty or unsafe setting falls back to the public repository, and that the
 * link is absent only while the config is still loading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { DEFAULT_SOURCE_URL } from "@shared/sourceUrl";

const useGameConfigMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: [], loaded: true, failed: false }),
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => useGameConfigMock(),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("@/components/RewardMoment", () => ({ default: () => null }));
vi.mock("./mobile/MobileTabBar", () => ({ default: () => null, isBareRoute: () => false }));
vi.mock("./mobile/MobileFab", () => ({ default: () => null }));
vi.mock("./NextStepTrail", () => ({ default: () => null }));

import Layout from "./Layout";

const CONFIG = {
  project: { name: "Willowbrook", tagline: "", memberName: "", location: "", adminPath: "/admin" },
  images: {} as Record<string, string>,
};

function sourceLink(): HTMLAnchorElement | null {
  render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
  const links = Array.from(screen.getByRole("contentinfo").querySelectorAll("a")).filter(
    (a) => a.textContent?.trim() === "Source code",
  );
  expect(links.length).toBeLessThanOrEqual(1);
  return (links[0] as HTMLAnchorElement | undefined) ?? null;
}

describe("the footer's Source code link", () => {
  beforeEach(() => useGameConfigMock.mockReset());

  it("points at the address the village set", () => {
    useGameConfigMock.mockReturnValue({ ...CONFIG, sourceUrl: "https://code.example.org/our-village" });
    const link = sourceLink();
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://code.example.org/our-village");
  });

  it("points at the public Village OS repository when the config carries nothing (an older server)", () => {
    useGameConfigMock.mockReturnValue({ ...CONFIG });
    expect(sourceLink()!.getAttribute("href")).toBe(DEFAULT_SOURCE_URL);
  });

  it("CONTROL: an address that is not http or https never becomes the link", () => {
    useGameConfigMock.mockReturnValue({ ...CONFIG, sourceUrl: "javascript:alert(1)" });
    expect(sourceLink()!.getAttribute("href")).toBe(DEFAULT_SOURCE_URL);
  });

  it("renders nothing while the config is still loading", () => {
    useGameConfigMock.mockReturnValue(null);
    expect(sourceLink()).toBeNull();
  });
});
