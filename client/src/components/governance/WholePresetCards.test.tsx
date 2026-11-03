// @vitest-environment jsdom
/**
 * Whole-role presets are tap cards: plain label, official word, one line,
 * one example. Money says it is a proposal, not a promise. Not sure yet
 * names who fills the open rows, and falls back when the chart names nobody.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { WHOLE_PRESETS } from "@shared/seatPresets";
import { GLOSSARY_TITLE, MONEY_PROMISE, NOT_SURE_YET, recommendsPay } from "@shared/termCards";
import { OPS_FALLBACK } from "@shared/roleProposalHonesty";
import SeatSettingsEditor from "./SeatSettingsEditor";

describe("terms preset tap cards", () => {
  it("offers the four roles and Not sure yet, and never recommends pay", () => {
    render(<SeatSettingsEditor value={{ v: 1 }} onChange={() => {}} />);
    const list = document.querySelector("[data-whole-presets]") as HTMLElement;
    for (const w of WHOLE_PRESETS) {
      const card = within(list).getByRole("button", { name: w.label });
      expect(card.className).toContain("min-h-[44px]");
      expect(card.className).toContain("max-w-full");
      expect(card.textContent).toContain("How often you meet (rhythm)");
      expect(card.textContent).toContain(w.blurb);
      expect(card.textContent).toContain(MONEY_PROMISE);
      expect(recommendsPay(card.textContent ?? "")).toBe(false);
    }
    const unsure = within(list).getByRole("button", { name: new RegExp(NOT_SURE_YET) });
    expect(unsure.className).toContain("min-h-[44px]");
    expect(unsure.textContent).toContain(OPS_FALLBACK);
    expect(unsure.textContent).not.toContain(MONEY_PROMISE);
  });

  it("names the operations role the page was given, and opens the jargon", () => {
    render(<SeatSettingsEditor value={{ v: 1 }} onChange={() => {}} partner="Operations Steward" />);
    expect(screen.getByRole("button", { name: new RegExp(NOT_SURE_YET) }).textContent).toContain("Operations Steward");
    const gloss = screen.getByText(GLOSSARY_TITLE).closest("details") as HTMLElement;
    expect(gloss.textContent).toContain("How often you meet");
    expect(gloss.textContent).toContain("Clocks");
    expect(gloss.textContent).toContain("Domain");
    expect(recommendsPay(gloss.textContent ?? "")).toBe(false);
  });

  it("fills from a card, and Not sure yet clears back to open", () => {
    const seen = vi.fn();
    render(<SeatSettingsEditor value={{ v: 1, pay: { kind: "none" } }} onChange={seen} />);
    fireEvent.click(screen.getByRole("button", { name: WHOLE_PRESETS[0].label }));
    const filled = seen.mock.calls.at(-1)?.[0] as { term?: unknown } | undefined;
    expect(filled?.term).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(NOT_SURE_YET) }));
    expect(seen.mock.calls.at(-1)?.[0]).toEqual({ v: 1 });
  });
});
