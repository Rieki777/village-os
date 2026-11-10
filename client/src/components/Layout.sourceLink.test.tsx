// @vitest-environment jsdom
/**
 * THE FOOTER'S SOURCE LINKS (AGPL-3.0-or-later, section 13).
 *
 * Every village's footer links the upstream Village OS source, a platform
 * constant. A village that runs changed code sets `village.source_url`, served
 * as `villageSourceUrl` in the public config, and the footer then shows a
 * second link named for the village. Blank, or anything that is not https,
 * shows no second link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { UPSTREAM_SOURCE_URL } from "@shared/sourceUrl";

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

function footerLinks(): { upstream: HTMLAnchorElement | null; village: HTMLAnchorElement | null } {
  render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
  const links = Array.from(screen.getByRole("contentinfo").querySelectorAll("a"));
  const text = (a: Element) => a.textContent?.trim() ?? "";
  return {
    upstream: (links.find((a) => text(a) === "Village OS source") as HTMLAnchorElement | undefined) ?? null,
    village: (links.find((a) => /source$/.test(text(a)) && text(a) !== "Village OS source") as HTMLAnchorElement | undefined) ?? null,
  };
}

describe("the footer's source links", () => {
  beforeEach(() => useGameConfigMock.mockReset());

  it("always links the upstream Village OS source once the config has answered", () => {
    useGameConfigMock.mockReturnValue({ ...CONFIG });
    expect(footerLinks().upstream!.getAttribute("href")).toBe(UPSTREAM_SOURCE_URL);
  });

  it("shows the village's own link, named for the village, from the setting", () => {
    useGameConfigMock.mockReturnValue({ ...CONFIG, villageSourceUrl: "https://code.example.org/our-village" });
    const { upstream, village } = footerLinks();
    expect(upstream).not.toBeNull();
    expect(village).not.toBeNull();
    expect(village!.getAttribute("href")).toBe("https://code.example.org/our-village");
    expect(village!.textContent?.trim()).toBe("Willowbrook's source");
  });

  it("hides the village link when the setting is blank or absent", () => {
    for (const cfg of [{ ...CONFIG }, { ...CONFIG, villageSourceUrl: "" }]) {
      useGameConfigMock.mockReturnValue(cfg);
      const { unmount } = render(<span />);
      unmount();
      expect(footerLinks().village).toBeNull();
      document.body.innerHTML = "";
    }
  });

  it("CONTROL: a non-https address never becomes a link", () => {
    for (const bad of ["http://code.example.org/x", "javascript:alert(1)"]) {
      useGameConfigMock.mockReturnValue({ ...CONFIG, villageSourceUrl: bad });
      expect(footerLinks().village).toBeNull();
      document.body.innerHTML = "";
    }
  });

  it("renders neither link while the config is still loading", () => {
    useGameConfigMock.mockReturnValue(null);
    const { upstream, village } = footerLinks();
    expect(upstream).toBeNull();
    expect(village).toBeNull();
  });
});
