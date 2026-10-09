// @vitest-environment jsdom
/**
 * THE EXTRACTED FIGURE MUST NOT RESTYLE THE PROFILE.
 *
 * Figure came out of StandingRow so the role card could draw its numbers with
 * the same part, and the judged risk was that the extraction would quietly
 * change the profile. These tests pin the profile's markup class for class,
 * through StandingRow itself, and then check the seat layout the card uses.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Seeds" }));

import Figure from "./Figure";
import StandingRow from "@/components/profile/StandingRow";

const STANDING = (value: string, label: string, ink: string) =>
  `<div class="border-border pr-6 last:border-0 last:pr-0 sm:border-r sm:pr-8">` +
  `<span class="block font-display text-3xl font-bold tabular-nums sm:text-4xl ${ink}">${value}</span>` +
  `<span class="mt-1 block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">${label}</span>` +
  `</div>`;

describe("Figure, standing layout (the profile's)", () => {
  it("renders the profile's markup by default", () => {
    const { container } = render(<Figure value="12" label="Powers open" tone="living" />);
    expect(container.innerHTML).toBe(STANDING("12", "Powers open", "text-open"));
    expect(render(<Figure value="3" label="Paths walked" />).container.innerHTML).toBe(
      STANDING("3", "Paths walked", "text-card-foreground"),
    );
  });

  it("is what StandingRow draws, figure for figure", () => {
    const { container } = render(
      <StandingRow standing={{ held: { units: 1234, decimals: 2 }, powersOpen: 12, pathsWalked: 3, questsDone: 0 }} />,
    );
    const row = container.firstElementChild!;
    expect(Array.from(row.children).map((c) => c.outerHTML)).toEqual([
      STANDING("12.34", "Seeds held", "text-notice"),
      STANDING("12", "Powers open", "text-open"),
      STANDING("3", "Paths walked", "text-card-foreground"),
      STANDING("0", "Quests done", "text-card-foreground"),
    ]);
  });

  it("still hides a row with nothing above zero, and leaves an unread figure out", () => {
    expect(render(<StandingRow standing={{ held: null, powersOpen: 12, pathsWalked: 0, questsDone: 0 }} />).container.innerHTML).toBe("");
    const { container } = render(<StandingRow standing={{ held: null, powersOpen: null, pathsWalked: 2, questsDone: null }} />);
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});

describe("Figure, seat layout (the role card's)", () => {
  it("puts the label first in reading order and the number in the body face", () => {
    const { container } = render(
      <dl>
        <Figure value="1" label="Held now" tone="gold" face="body" layout="seat" />
      </dl>,
    );
    const wrap = container.querySelector("dl > div")!;
    expect(Array.from(wrap.children).map((c) => c.tagName)).toEqual(["DT", "DD"]);
    expect(wrap.className).toContain("flex-col-reverse");
    const dd = wrap.querySelector("dd")!;
    expect(dd.textContent).toBe("1");
    expect(dd.className).toContain("font-body");
    expect(dd.className).not.toContain("font-display");
    expect(dd.className).toContain("text-notice");
    // Control: the default face is still the display serif.
    expect(render(<Figure value="1" label="x" layout="seat" />).container.querySelector("dd")!.className).toContain("font-display");
  });

  it("draws a read zero in plain ink", () => {
    const dd = render(<Figure value="0" label="Open places" tone={null} face="body" layout="seat" />).container.querySelector("dd")!;
    expect(dd.className).toContain("text-card-foreground");
    expect(dd.className).not.toMatch(/text-notice|text-open/);
  });
});
