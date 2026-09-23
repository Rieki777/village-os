// @vitest-environment jsdom
/**
 * The phone's tool strip over the map, and the lens row it carries.
 *
 * Rye, 2026-09-21: "I don't see a bar with the tools". On a phone the chips
 * that change the picture sat a screen and a half below it. These pin what the
 * strip promises: every chip says whether it is on, every chip does its one
 * thing, the resources chip exists only where the module does, and the lens's
 * domain chips answer for the domain they name.
 *
 * Where the strip sits (over the map, 40px chips, the map still above the tab
 * bar, no sideways scroll) is geometry, measured in a real phone browser by
 * scratchpad/verify-phone-map.mjs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MapToolStrip from "./MapToolStrip";
import LensRow from "./LensRow";
import type { PowerData } from "./types";

afterEach(cleanup);

function strip(overrides: Partial<Parameters<typeof MapToolStrip>[0]> = {}) {
  const props = {
    mode: "now" as const,
    onMode: vi.fn(),
    lensOn: false,
    onLens: vi.fn(),
    resourcesModule: true,
    resourcesOn: false,
    onResources: vi.fn(),
    linesOn: false,
    onLines: vi.fn(),
    ...overrides,
  };
  render(<MapToolStrip {...props} />);
  return props;
}

describe("the tool strip over a phone's map", () => {
  it("says which chips are on", () => {
    strip({ mode: "vision", lensOn: true, linesOn: false });
    expect(screen.getByRole("button", { name: "Vision" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Now" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "How we decide" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Links/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("each chip does its own thing and nothing else", () => {
    const p = strip();
    fireEvent.click(screen.getByRole("button", { name: "Vision" }));
    expect(p.onMode).toHaveBeenCalledWith("vision");
    fireEvent.click(screen.getByRole("button", { name: "How we decide" }));
    fireEvent.click(screen.getByRole("button", { name: "Resources" }));
    fireEvent.click(screen.getByRole("button", { name: /Links/ }));
    expect(p.onLens).toHaveBeenCalledTimes(1);
    expect(p.onResources).toHaveBeenCalledTimes(1);
    expect(p.onLines).toHaveBeenCalledTimes(1);
    expect(p.onMode).toHaveBeenCalledTimes(1);
  });

  it("has no resources chip where the module is off", () => {
    strip({ resourcesModule: false });
    expect(screen.queryByRole("button", { name: "Resources" })).toBeNull();
    // The others are all still there.
    expect(screen.getByRole("button", { name: "How we decide" })).toBeTruthy();
  });

  it("carries what it is handed under the chips, and nothing when handed nothing", () => {
    const base = {
      mode: "now" as const,
      onMode: () => {},
      lensOn: true,
      onLens: () => {},
      resourcesModule: false,
      resourcesOn: false,
      onResources: () => {},
      linesOn: false,
      onLines: () => {},
    };
    const { rerender } = render(
      <MapToolStrip {...base}>
        <p>the lens key</p>
      </MapToolStrip>,
    );
    expect(screen.getByText("the lens key")).toBeTruthy();
    rerender(<MapToolStrip {...base} />);
    expect(screen.queryByText("the lens key")).toBeNull();
    // Only the chip row is left: no empty box under it.
    expect(document.querySelector("[data-map-tool-strip]")?.children.length).toBe(1);
  });
});

describe("the lens row", () => {
  const DATA = {
    circles: [{ id: "a", name: "A", decidesBy: "consent" }],
    power: {
      decidesBy: null,
      glossary: {
        domains: [
          { id: "money", label: "Money", gloss: "Budgets and spending" },
          { id: "people", label: "People", gloss: "Who holds which seat" },
        ],
        decidesBy: [{ id: "consent", label: "Consent", gloss: "No reasoned objection" }],
      },
    },
  } as unknown as PowerData;

  it("names every domain plus the overall view, and marks the one in force", () => {
    render(<LensRow data={DATA} domain="money" onDomain={() => {}} />);
    const group = screen.getByRole("group", { name: "Which domain" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Overall", "Money", "People"]);
    expect(screen.getByRole("button", { name: "Money" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Overall" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("answers the domain it names, and null for the overall view", () => {
    const onDomain = vi.fn();
    render(<LensRow data={DATA} domain={null} onDomain={onDomain} />);
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    fireEvent.click(screen.getByRole("button", { name: "Overall" }));
    expect(onDomain.mock.calls).toEqual([["people"], [null]]);
  });
});
