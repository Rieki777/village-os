// @vitest-environment jsdom
/**
 * The header's home link, and the three states it has to survive.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, said up front so nobody reads more
 * into a green run than is there. jsdom does no layout: every
 * getBoundingClientRect() is 0x0 and elementFromPoint() answers nothing, so
 * a "the link is wider than zero pixels" assertion written here would pass
 * whatever the component rendered. That is worse than no test. The width was
 * therefore measured in a real browser against the live config payload, and
 * the numbers are in the lane report:
 *
 *     before   0.0px wide, click at the header's centre hits the container
 *     after  205.4px wide at 1272px, 171.2px at 375px, click hits the link
 *
 * What this file holds is the CAUSE of that width: whether the link renders
 * anything at all. An empty flex child is what made the anchor zero pixels
 * wide, and a wordmark is what makes it clickable. Delete the wordmark branch
 * in Layout.tsx and the first test here fails on the missing name.
 *
 * The footer's brand box is here for the same reason. It is not a control and
 * nothing about it is unclickable, but it made the identical mistake: an
 * unconditional 90px reservation cannot tell a config still in flight from a
 * village that has uploaded no mark, so every empty village published a hole
 * in its own footer.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";

const useGameConfigMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: [], loaded: true, failed: false }),
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => useGameConfigMock(),
  // The real one, copied rather than imported, because this factory is
  // hoisted above the imports. Its rule matters here: an empty string is a
  // deliberate "decorative" and must not inherit the fallback sentence.
  altOr: (value: string | undefined, fallback: string) =>
    typeof value === "string" ? value : fallback,
}));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/NotificationToasts", () => ({ default: () => null }));
vi.mock("./mobile/MobileTabBar", () => ({
  default: () => null,
  isBareRoute: () => false,
}));
vi.mock("./mobile/MobileFab", () => ({ default: () => null }));
vi.mock("./NextStepTrail", () => ({ default: () => null }));

import Layout from "./Layout";

function renderShell() {
  return render(
    <Router>
      <Layout>
        <p>page body</p>
      </Layout>
    </Router>,
  );
}

/** The header's home link. The shell renders a <nav>, not a <header>, so
 *  there is no `banner` landmark to hang this off. */
function homeLink() {
  return screen.getByRole("navigation").querySelector('a[href="/"]') as HTMLAnchorElement;
}

const CONFIG = {
  project: { name: "Willowbrook", tagline: "", memberName: "", location: "", adminPath: "/admin" },
  images: {} as Record<string, string>,
};

describe("the header home link", () => {
  beforeEach(() => {
    useGameConfigMock.mockReset();
  });

  it("wears the village name when the village has no logo, so there is something to click", () => {
    // The live deployment's exact state: a name, and nine empty image slots.
    useGameConfigMock.mockReturnValue({ ...CONFIG, project: { ...CONFIG.project, name: "Unnamed Village" } });

    renderShell();
    const link = homeLink();

    expect(link).toBeTruthy();
    expect(link.textContent?.trim()).toBe("Unnamed Village");
    // The name is the visible mark, and the label is still the one a screen
    // reader announces, so the two never disagree about which link this is.
    expect(link).toHaveAttribute("aria-label", "Unnamed Village home");
    expect(link.querySelector("img")).toBeNull();
  });

  it("wears the logo when the village has one, and does not print the name twice", () => {
    useGameConfigMock.mockReturnValue({
      ...CONFIG,
      images: { logo: "/uploads/logo.png", logoAlt: "The Willowbrook heart" },
    });

    renderShell();
    const link = homeLink();
    const img = link.querySelector("img");

    expect(img).toBeTruthy();
    expect(img).toHaveAttribute("src", "/uploads/logo.png");
    expect(img).toHaveAttribute("alt", "The Willowbrook heart");
    expect(link.textContent?.trim()).toBe("");
  });

  it("still reserves a width while the config is in flight, which is not the same fact as an unnamed village", () => {
    // null is "unknown", never "this village has no identity". The link has
    // to stay clickable through the load, so the placeholder carries a width
    // as well as the 64px height that stops the header shifting.
    useGameConfigMock.mockReturnValue(null);

    renderShell();
    const link = homeLink();
    const spacer = link.querySelector("span");

    expect(link).toHaveAttribute("aria-label", "Home");
    expect(spacer).toBeTruthy();
    expect(spacer!.style.width).not.toBe("");
    expect(spacer!.style.height).toBe("64px");
    expect(spacer!.getAttribute("aria-hidden")).toBe("true");
  });

  it("never renders an anchor with nothing in it at all", () => {
    // The shape of the original defect, stated once as its own rule: in every
    // state the link holds either a picture or a word. This is the assertion
    // that fails if a future edit collapses the three branches back into one
    // empty spacer.
    for (const cfg of [
      { ...CONFIG },
      { ...CONFIG, images: { logo: "/uploads/logo.png" } },
      null,
    ]) {
      useGameConfigMock.mockReturnValue(cfg);
      const { unmount } = renderShell();
      const link = homeLink();
      const hasPicture = link.querySelector("img") !== null;
      const hasWord = (link.textContent ?? "").trim().length > 0;
      const hasReservedBox = link.querySelector("span[style*='width']") !== null;
      expect(hasPicture || hasWord || hasReservedBox).toBe(true);
      unmount();
    }
  });
});

describe("the footer's brand box", () => {
  beforeEach(() => {
    useGameConfigMock.mockReset();
  });

  /** The footer column that carries the mark and the blurb. Matched on a
   *  class SUBSTRING rather than an escaped `.md\:col-span-1` selector: the
   *  colon needs a CSS escape, and getting that escape wrong returns null
   *  rather than throwing, which reads exactly like an absent element. */
  function brandColumn() {
    const col = screen.getByRole("contentinfo").querySelector('[class*="col-span-1"]');
    if (!col) throw new Error("footer brand column not found");
    return col as HTMLElement;
  }

  it("reserves its height only while the config is unknown", () => {
    useGameConfigMock.mockReturnValue(null);

    renderShell();
    const reserved = brandColumn().querySelector('div[style*="height"]');

    expect(reserved).toBeTruthy();
    expect((reserved as HTMLElement).style.height).toBe("90px");
  });

  it("reserves nothing once the village has answered and has no mark", () => {
    // The live deployment's state. 90px of empty column, above the blurb, on
    // every page of the site, is the footer's version of the header defect.
    useGameConfigMock.mockReturnValue({
      ...CONFIG,
      project: { ...CONFIG.project, footerBlurb: "A village on a ridge." },
    });

    renderShell();
    const column = brandColumn();

    expect(column.querySelector("img")).toBeNull();
    expect(column.querySelector('div[style*="height"]')).toBeNull();
    expect(column.textContent).toContain("A village on a ridge.");
  });

  it("draws the mark when the village has one", () => {
    useGameConfigMock.mockReturnValue({
      ...CONFIG,
      images: { heartLogo: "/uploads/heart.png", heartLogoAlt: "A hand-drawn heart" },
    });

    renderShell();
    const img = brandColumn().querySelector("img");

    expect(img).toHaveAttribute("src", "/uploads/heart.png");
    expect(img).toHaveAttribute("alt", "A hand-drawn heart");
  });
});
