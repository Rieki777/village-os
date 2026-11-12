// @vitest-environment jsdom
/**
 * D-01 (go-live design pass): "Main Site" leaves the app, so it is edged with
 * an outward arrow and is never the page's gold act. M4: on a phone the page
 * ends with room for the shortcuts button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("@/modules/ModuleProvider", () => ({ useModules: () => ({ modules: [], loaded: true, failed: false }) }));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => ({ project: { name: "Willowbrook", siteUrl: "https://willowbrook.example" }, images: {} }),
  altOr: (value: string | undefined, fallback: string) => (typeof value === "string" ? value : fallback),
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("@/components/RewardMoment", () => ({ default: () => null }));
vi.mock("./mobile/MobileTabBar", () => ({ default: () => null, isBareRoute: () => false }));
vi.mock("./mobile/MobileFab", () => ({ default: () => null }));
vi.mock("./NextStepTrail", () => ({ default: () => null }));

import Layout from "./Layout";

afterEach(cleanup);

const shell = () =>
  render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );

describe("Main Site in the header", () => {
  it("is edged and says it opens elsewhere, never the gold fill", () => {
    shell();
    const link = screen.getByRole("link", { name: /Main Site/ });
    expect(link.className).not.toContain("bg-amber");
    expect(link.className).toContain("border");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.querySelector("svg")).toBeTruthy();
  });
});

describe("room for the shortcuts button", () => {
  it("pads the end of <main> on a phone only", () => {
    shell();
    const main = document.getElementById("main") as HTMLElement;
    expect(main.className).toContain("max-md:pb-[var(--fab-clear)]");
  });
});
