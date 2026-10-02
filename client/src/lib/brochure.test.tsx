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
import { Suspense } from "react";

const config = { current: null as null | { brochurePages?: boolean } };
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => config.current,
}));

import { brochurePage, isBrochurePath } from "./brochure";

function mount(loader: () => Promise<{ default: () => JSX.Element }>) {
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
