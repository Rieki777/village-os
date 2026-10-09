// @vitest-environment jsdom
/**
 * ONE CHIP, TWO LADDERS. The profile's rung ladder must render exactly what it
 * did before the extraction; the role card's commitments ladder uses the
 * looks the profile never needed. Every chip states its meaning in words.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import LadderChip, { type LadderLook } from "./LadderChip";

const BASE = "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";

describe("LadderChip", () => {
  it("draws the profile's three looks with the profile's classes and icons", () => {
    const cases: Array<[LadderLook, string, string]> = [
      ["inverted", "bg-foreground text-background", "lucide-circle-check"],
      ["lit", "bg-muted text-foreground", "lucide-circle-check"],
      ["plain", "text-muted-foreground", "lucide-circle"],
    ];
    for (const [look, classes, icon] of cases) {
      const span = render(<LadderChip look={look} label="Guest" srWords=", walked" title="Guest: Has a profile." />).container
        .firstElementChild!;
      expect(span.tagName).toBe("SPAN");
      expect(span.getAttribute("class")).toBe(`${BASE} ${classes}`);
      expect(span.getAttribute("title")).toBe("Guest: Has a profile.");
      const svg = span.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("class")).toContain("h-3.5 w-3.5 shrink-0");
      // The icon, by its exact class token: "lucide-circle" is a prefix of the check's own name.
      expect(svg.getAttribute("class")!.split(/\s+/)).toContain(icon);
      expect(span.querySelector(".sr-only")!.textContent).toBe(", walked");
    }
  });

  it("marks only the current step", () => {
    const now = render(<LadderChip look="inverted" current label="Member" srWords=", where you stand" />).container.firstElementChild!;
    expect(now.getAttribute("aria-current")).toBe("step");
    const other = render(<LadderChip look="lit" label="Guest" srWords=", walked" />).container.firstElementChild!;
    expect(other.hasAttribute("aria-current")).toBe(false);
  });

  it("draws the charter's looks, with a quieter suffix and a gold check when written down", () => {
    const gilded = render(<LadderChip look="gilded" label="Aim" srWords=", written down" />).container.firstElementChild!;
    expect(gilded.getAttribute("class")).toContain("ring-notice/60");
    expect(gilded.querySelector("svg")!.getAttribute("class")).toContain("text-notice");
    const edged = render(<LadderChip look="edged" label="Term" suffix="set at seating" srWords=", set when someone is seated" />).container
      .firstElementChild!;
    expect(edged.getAttribute("class")).toContain("ring-border");
    expect(edged.querySelector("span.text-muted-foreground")!.textContent).toBe("set at seating");
    const dashed = render(<LadderChip look="dashed" label="Why it matters" srWords=", still to be written down" />).container
      .firstElementChild!;
    expect(dashed.getAttribute("class")).toContain("border-dashed");
  });

  it("appends a caller's classes after the look's, and draws no separator dot", () => {
    const span = render(<LadderChip look="lit" label="Aim" srWords=", written down" className="leading-snug" />).container.firstElementChild!;
    expect(span.getAttribute("class")).toBe(`${BASE} bg-muted text-foreground leading-snug`);
    expect(span.textContent).not.toContain("·");
  });
});
