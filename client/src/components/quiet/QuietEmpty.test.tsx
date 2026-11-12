// @vitest-environment jsdom
/**
 * An empty state is one drawing, one heading, one sentence and at most one
 * edged door. The drawing is decoration (the words carry it), nothing in it
 * moves, and nothing in it counts anybody.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import QuietEmpty, { QuietDrawing } from "./QuietEmpty";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/journey/look";

afterEach(cleanup);

describe("QuietEmpty", () => {
  it("shows the heading, the sentence and one edged door to a page", () => {
    const { container } = render(
      <QuietEmpty drawing="meadow" title="The meadow is resting" door={{ label: "Propose a Quest", href: "/propose-quest" }}>
        No Quests posted yet.
      </QuietEmpty>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "The meadow is resting" })).toBeTruthy();
    expect(screen.getByText("No Quests posted yet.")).toBeTruthy();
    const doors = screen.getAllByRole("link");
    expect(doors).toHaveLength(1);
    expect(doors[0].getAttribute("href")).toBe("/propose-quest");
    // edged, never gold: the page's own main act keeps the gold
    expect(doors[0].className).toBe(BTN_SECONDARY);
    expect(doors[0].className).not.toContain(BTN_PRIMARY);
    expect(container.querySelectorAll("button, a")).toHaveLength(1);
  });

  it("keeps an in-page door a plain anchor, so the browser scrolls to it", () => {
    render(<QuietEmpty drawing="ring" title="t" door={{ label: "Carry a thanks", href: "#send" }} />);
    expect(screen.getByRole("link", { name: "Carry a thanks" }).getAttribute("href")).toBe("#send");
  });

  it("runs a door that is an act on this page", () => {
    const go = vi.fn();
    render(<QuietEmpty drawing="meadow" title="t" door={{ label: "Show every Quest", onClick: go }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show every Quest" }));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("offers no door when the act already sits beside the list", () => {
    const { container } = render(<QuietEmpty drawing="ring" title="No thanks yet" />);
    expect(container.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("takes the page's heading level", () => {
    render(<QuietEmpty drawing="bed" title="No seeds in this bed yet" level={3} />);
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
  });
});

describe("QuietDrawing", () => {
  it.each(["bed", "ring", "meadow"] as const)("draws %s still, hidden from a screen reader, with no numbers in it", (kind) => {
    const { container } = render(<QuietDrawing kind={kind} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-drawing")).toBe(kind);
    // nothing moves: no animation class, no SMIL
    expect(svg.querySelector("animate, animateTransform, animateMotion")).toBeNull();
    expect(svg.outerHTML).not.toMatch(/animate-|nat-breathe|nk-ff/);
    // nothing counts: no text at all inside a drawing
    expect(svg.querySelector("text")).toBeNull();
    expect(svg.textContent).toBe("");
  });
});
