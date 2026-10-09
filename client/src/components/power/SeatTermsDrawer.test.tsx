// @vitest-environment jsdom
/**
 * THE SETTINGS DRAWER, RENDERED.
 *
 * What a reader meets under the live card: nothing at all when the host
 * passed no terms, and otherwise one trigger that says what it opens and
 * where, rows for the groups that are set, the money line on every money row,
 * and one line naming what is not set. The words themselves are pinned in
 * shared/seatSettings.test.ts; this file holds the drawing.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { fromProposedSeat } from "@shared/roleSheetInputs";
import { normaliseProposedSeat } from "@shared/proposedSeats";
import { MONEY_LINE, type SeatSettings } from "@shared/seatSettings";
import { applyPreset, presetById } from "@shared/seatPresets";
import SeatTermsDrawer, { DRAWER_WORDS } from "./SeatTermsDrawer";
import SeatTradingCard from "./SeatTradingCard";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

const TERMS: SeatSettings = {
  v: 1,
  term: { endsOn: null, noticeDays: 14 },
  pay: { kind: "fixed", currency: "EUR", amountMinor: 80000, per: "month" },
  bonus: { kind: "equity", capWords: "Up to a set share" },
  quests: { perMoonMin: 3, perMoonMax: 5, doneWhenRequired: true },
};

describe("SeatTermsDrawer", () => {
  it("renders nothing without props, and nothing for null terms", () => {
    const bare = render(<SeatTermsDrawer />);
    expect(bare.container).toBeEmptyDOMElement();
    bare.unmount();
    const empty = render(<SeatTermsDrawer settings={null} />);
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();
    // Control: the same component with terms draws its trigger.
    render(<SeatTermsDrawer settings={TERMS} />);
    expect(screen.getByRole("button", { name: /Settings/ })).toBeInTheDocument();
  });

  it("has one trigger with aria-expanded and aria-controls naming the body it opens", () => {
    render(<SeatTermsDrawer settings={TERMS} />);
    const trigger = screen.getByRole("button", { name: new RegExp(DRAWER_WORDS.trigger) });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const bodyId = trigger.getAttribute("aria-controls")!;
    expect(bodyId).toBeTruthy();
    const body = document.getElementById(bodyId)!;
    expect(body).not.toBeNull();
    expect(body).not.toBeVisible();
    expect(trigger).toHaveTextContent(DRAWER_WORDS.triggerSub);

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(body).toBeVisible();
  });

  it("draws a row per set group, the money line on money rows, and names what is not set", () => {
    render(<SeatTermsDrawer settings={TERMS} defaultOpen />);
    const trigger = screen.getByRole("button", { name: new RegExp(DRAWER_WORDS.trigger) });
    const body = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    const b = within(body);
    expect(b.getByText("Until the season ends")).toBeInTheDocument();
    expect(b.getByText("€800 a month")).toBeInTheDocument();
    expect(b.getByText("3 to 5 quests a moon")).toBeInTheDocument();
    // Pay and bonus are both money rows; term and quests are not.
    expect(b.getAllByText(MONEY_LINE)).toHaveLength(2);
    expect(b.getByText(/Not set yet: Clocks, Rhythm, Allowance, Scoreboard, Ending/)).toBeInTheDocument();
    expect(body.textContent).not.toMatch(/\b0\b/);
  });

  it("opens a row to its lines, its preset and the customised mark", () => {
    const picked = applyPreset(null, presetById("platform:three-to-five-done-when-by-consent")!);
    const tweaked: SeatSettings = { ...picked, quests: { ...picked.quests!, perMoonMax: 6 } };
    render(<SeatTermsDrawer settings={tweaked} defaultOpen />);
    const row = screen.getByRole("button", { name: /Quests/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const lines = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(lines).toHaveTextContent("Started from Three to five a moon, by consent");
    expect(lines).toHaveTextContent(DRAWER_WORDS.customised);
  });

  it("gives the adoption link a 44px tap target", () => {
    render(<SeatTermsDrawer settings={TERMS} defaultOpen adopted={{ how: "vote", on: "2026-10-09", href: "/decisions/b-1" }} />);
    const link = screen.getByRole("link", { name: "Adopted by vote, 9 Oct 2026" });
    expect(link.className.split(/\s+/)).toContain("min-h-11");
  });

  it("says when terms could not be read instead of guessing", () => {
    render(<SeatTermsDrawer unreadable defaultOpen />);
    expect(screen.getByText(DRAWER_WORDS.unreadable)).toBeInTheDocument();
  });

  it("sits in the card's settings tray, and the card face never carries a term", () => {
    const input = fromProposedSeat(normaliseProposedSeat({ role_name: "Seed Keeper", aim: "Keep seed." }, []));
    const ctx = { now: new Date("2026-10-09T12:00:00Z"), season: null, classNames: null };
    const { container } = render(
      <SeatTradingCard input={input} ctx={ctx} faces="stacked" settings={<SeatTermsDrawer settings={TERMS} defaultOpen />} />,
    );
    const article = container.querySelector("article[data-power-card]")!;
    expect(article.textContent).not.toContain("€800");
    expect(article.textContent).not.toContain(MONEY_LINE);
    const tray = container.querySelector("[data-seat-terms]")!;
    expect(article.contains(tray)).toBe(false);
    expect(tray.textContent).toContain("€800 a month");
  });
});
