// @vitest-environment jsdom
/**
 * The brochure switch, from the client's side (shared/brochure.ts has the rule).
 *
 * Three states, each with its own promise:
 *   - the config has not loaded:  nothing renders, so neither village sees the
 *     other's page flash past;
 *   - the switch is off:          the route is the ordinary not-found page, and
 *     the brochure page's own code is never loaded;
 *   - the switch is on:           the page renders exactly as before.
 *
 * The control is the third case: if `brochurePage` stopped rendering the page
 * at all, the first two would still pass, and only this one would go red.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Suspense, type ReactElement } from "react";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const config = { current: null as null | { brochurePages?: boolean; brochureHidden?: string[] } };
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => config.current,
}));

import { brochurePage, isBrochurePath, storyPageShown } from "./brochure";

function mount(loader: () => Promise<{ default: () => ReactElement }>) {
  const Page = brochurePage(loader);
  return render(
    <Suspense fallback={<p>loading</p>}>
      <Page />
    </Suspense>,
  );
}

describe("a brochure page", () => {
  beforeEach(() => {
    config.current = null;
  });

  it("renders nothing while the switch is unknown, and loads no page code", () => {
    const loader = vi.fn(async () => ({ default: () => <h1>The first village's story</h1> }));
    const { container } = mount(loader);
    expect(container.textContent).toBe("");
    expect(loader).not.toHaveBeenCalled();
  });

  it("is the not-found page in a village that does not serve the brochure pages", async () => {
    config.current = { brochurePages: false };
    const loader = vi.fn(async () => ({ default: () => <h1>The first village's story</h1> }));
    mount(loader);
    expect(await screen.findByText("Off the trail")).toBeTruthy();
    expect(screen.queryByText("The first village's story")).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("treats a server that never sent the field as off", async () => {
    config.current = {};
    mount(async () => ({ default: () => <h1>The first village's story</h1> }));
    expect(await screen.findByText("Off the trail")).toBeTruthy();
  });

  it("renders the page in a village that serves them", async () => {
    config.current = { brochurePages: true };
    mount(async () => ({ default: () => <h1>The first village's story</h1> }));
    expect(await screen.findByText("The first village's story")).toBeTruthy();
    expect(screen.queryByText("Off the trail")).toBeNull();
  });
});

/** The page mounted on its own route, visited at `at`, the way App.tsx mounts it. */
function visit(path: string, at: string, loader: () => Promise<{ default: () => ReactElement }>) {
  const Page = brochurePage(loader);
  const { hook } = memoryLocation({ path: at });
  return render(
    <Router hook={hook}>
      <Suspense fallback={<p>loading</p>}>
        <Route path={path} component={Page} />
      </Suspense>
    </Router>,
  );
}

describe("a story page switched off on its own", () => {
  beforeEach(() => {
    config.current = null;
  });

  it("no longer serves the page at its route: the not-found page, and the page's code is never loaded", async () => {
    config.current = { brochurePages: true, brochureHidden: ["/housing"] };
    const loader = vi.fn(async () => ({ default: () => <h1>Our homes</h1> }));
    visit("/housing", "/housing", loader);
    expect(await screen.findByText("Off the trail")).toBeTruthy();
    expect(screen.queryByText("Our homes")).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("stays off when the address is typed in capitals, which the router still opens", async () => {
    config.current = { brochurePages: true, brochureHidden: ["/housing"] };
    const loader = vi.fn(async () => ({ default: () => <h1>Our homes</h1> }));
    visit("/housing", "/HOUSING/", loader);
    expect(await screen.findByText("Off the trail")).toBeTruthy();
    expect(loader).not.toHaveBeenCalled();
  });

  it("leaves every other story page served, the control for the case above", async () => {
    config.current = { brochurePages: true, brochureHidden: ["/housing"] };
    visit("/visit", "/visit", async () => ({ default: () => <h1>Come and see</h1> }));
    expect(await screen.findByText("Come and see")).toBeTruthy();
    expect(screen.queryByText("Off the trail")).toBeNull();
  });

  it("is served again once its switch is back on", async () => {
    config.current = { brochurePages: true, brochureHidden: [] };
    visit("/housing", "/housing", async () => ({ default: () => <h1>Our homes</h1> }));
    expect(await screen.findByText("Our homes")).toBeTruthy();
  });

  it("still answers to the master switch, which hides it with the rest", async () => {
    config.current = { brochurePages: false, brochureHidden: [] };
    visit("/visit", "/visit", async () => ({ default: () => <h1>Come and see</h1> }));
    expect(await screen.findByText("Off the trail")).toBeTruthy();
  });
});

describe("whether a link to a page may be drawn", () => {
  it("draws every address outside the story pages, whatever the switches say", () => {
    expect(storyPageShown(null, "/quests")).toBe(true);
    expect(storyPageShown({ brochurePages: false }, "/governance")).toBe(true);
  });

  it("draws a story page only while it is served, with a query or a hash on the link", () => {
    const cfg = { brochurePages: true, brochureHidden: ["/housing"] };
    expect(storyPageShown(cfg, "/housing")).toBe(false);
    expect(storyPageShown(cfg, "/housing?tier=1#homes")).toBe(false);
    expect(storyPageShown(cfg, "/visit#visit-form")).toBe(true);
    expect(storyPageShown({ brochurePages: false, brochureHidden: [] }, "/visit")).toBe(false);
  });

  it("draws no story page before the config has answered, or from a server that never sent the list", () => {
    expect(storyPageShown(null, "/visit")).toBe(false);
    expect(storyPageShown({ brochurePages: true }, "/visit")).toBe(true);
  });
});

describe("isBrochurePath", () => {
  it("knows the brochure routes, with or without a query or a trailing slash", () => {
    expect(isBrochurePath("/investor")).toBe(true);
    expect(isBrochurePath("/love-letter?ref=footer")).toBe(true);
    expect(isBrochurePath("/project-history/")).toBe(true);
  });

  it("leaves home and every member surface alone", () => {
    for (const p of ["/", "/quests", "/gratitude", "/governance", "/claim", "/investor-relations"]) {
      expect(isBrochurePath(p)).toBe(false);
    }
  });
});
