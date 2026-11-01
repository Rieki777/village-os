// @vitest-environment jsdom
/**
 * THE LANDING PAGE'S WINDOW ONTO THE MAP PROMISES NOTHING ABOUT THE LAND.
 *
 * It said every building "traces to something true: a funded build, a claimed
 * quest, a filled role", the same promise the map's own guide made in her
 * first line, the council stop, the Sanctuary card and the Now tip. On
 * 2026-10-02 those four were taken back (shared/mapArtifactWelcomeWalk.test.ts),
 * because the map's seed is sample data, and this was their twin on the
 * village's front page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => ({ id, lifecycle: "public" }),
}));

import MapPeek from "./MapPeek";

/**
 * THE FOUR-MEGABYTE MAP WAITS FOR A CONNECTION THAT CAN AFFORD IT.
 *
 * The header promises the live map stays a still card on `saveData` and on
 * 2g or 3g. The test matched 2g only (`(^|-)(2g|slow-2g)$`), so a 3g visitor
 * who scrolled the home page downloaded the whole map (sweep, 2026-10-31).
 * Each case mounts the card with the card already in view, so the only thing
 * standing between it and the iframe is the connection check.
 */
describe("MapPeek on a metered connection", () => {
  const withConnection = (connection: unknown) => {
    Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    const { container, unmount } = render(<Router><MapPeek /></Router>);
    const live = !!container.querySelector("iframe");
    unmount();
    return live;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as any).connection;
  });

  it.each([
    ["3g", { effectiveType: "3g" }],
    ["2g", { effectiveType: "2g" }],
    ["slow-2g", { effectiveType: "slow-2g" }],
    ["saveData on 4g", { effectiveType: "4g", saveData: true }],
  ])("stays a still card on %s", (_name, connection) => {
    expect(withConnection(connection)).toBe(false);
  });

  it.each([
    ["4g", { effectiveType: "4g" }],
    ["no connection API (Safari)", undefined],
  ])("goes live on %s", (_name, connection) => {
    expect(withConnection(connection)).toBe(true);
  });
});

describe("MapPeek", () => {
  it("invites a visitor in and says how the map works, with no promise about what is on it", () => {
    render(<Router><MapPeek /></Router>);
    expect(screen.getByRole("heading", { name: "See the village" })).toBeTruthy();
    const words = document.body.textContent ?? "";
    expect(words).toContain("The village drawn as a map you can walk. Step in and tap any building to open its door.");
    expect(words).not.toMatch(/traces to something true|funded build|claimed quest/);
  });
});
