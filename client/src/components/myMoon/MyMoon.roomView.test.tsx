// @vitest-environment jsdom
/**
 * Room view, for sharing a screen in the circle: one switch hides every
 * amount, the score and the moon load, and shows them again when it is off.
 * The moon here is invented, and its amounts are odd on purpose so a stray
 * one is easy to find in the rendered text.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatMoney } from "@shared/money";
import { MOON_WORDS, MY_MOON_WORDS } from "@shared/moonRecap";
import { MyMoonView } from "./MyMoon";
import { invoice, myMoon } from "./myMoon.fixture";

afterEach(cleanup);

const AMOUNT = formatMoney(123456, "USD");

function renderMoon(over: Parameters<typeof myMoon>[0] = {}, initialRoomView = false) {
  const reload = vi.fn(async () => null);
  render(<MyMoonView data={myMoon(over)} villageRoles={[]} onCycle={() => {}} reload={reload} initialRoomView={initialRoomView} />);
}

const text = () => document.body.textContent ?? "";

describe("My moon, Room view", () => {
  it("shows the amounts, the score and the moon load to the member", () => {
    renderMoon();
    expect(text()).toContain(AMOUNT);
    expect(screen.getByTestId("moon-score")).toBeTruthy();
    expect(screen.getByTestId("moon-load").textContent).toContain(MY_MOON_WORDS.moonLoadOf(3));
  });

  it("hides every amount, the score and the moon load when switched on", () => {
    renderMoon();
    fireEvent.click(screen.getByRole("button", { name: MOON_WORDS.roomView }));
    expect(screen.getByRole("button", { name: MOON_WORDS.roomView }).getAttribute("aria-pressed")).toBe("true");
    expect(text()).not.toContain(AMOUNT);
    expect(text()).not.toContain("1,234");
    expect(document.querySelector("[data-amount]")).toBeNull();
    expect(screen.queryByTestId("moon-score")).toBeNull();
    expect(screen.queryByTestId("moon-load")).toBeNull();
    expect(screen.queryByText("Very full")).toBeNull();
    expect(screen.getAllByText(MY_MOON_WORDS.hiddenInRoom).length).toBeGreaterThan(0);
  });

  it("hides the pay route form and the copyable work summary too", () => {
    renderMoon({ invoice: invoice({ status: "approved", workSummary: `Work summary, total ${AMOUNT}` }) }, true);
    expect(screen.queryByTestId("pay-route")).toBeNull();
    expect(screen.queryByRole("button", { name: MOON_WORDS.copySummary })).toBeNull();
    expect(text()).not.toContain(AMOUNT);
  });

  it("brings everything back when switched off again", () => {
    renderMoon({}, true);
    expect(text()).not.toContain(AMOUNT);
    fireEvent.click(screen.getByRole("button", { name: MOON_WORDS.roomView }));
    expect(text()).toContain(AMOUNT);
    expect(screen.getByTestId("moon-score")).toBeTruthy();
  });

  it("shows no invoice part at all when no role's terms carry money", () => {
    renderMoon({ invoiceNeeded: false, invoice: null, noTermsLine: null });
    expect(screen.queryByTestId("invoice")).toBeNull();
    expect(text()).not.toContain(AMOUNT);
  });

  it("names the walkthrough day, the send-by day and the guide only when the village set one", () => {
    renderMoon();
    expect(text()).toContain("5 November 2026");
    expect(text()).toContain("Send by Monday 9 November 2026");
    expect(screen.queryByText("Open the End of Moon guide")).toBeNull();
    cleanup();
    renderMoon({ guideUrl: "https://example.org/guide" });
    const link = screen.getByText("Open the End of Moon guide") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.org/guide#sheet");
  });
});
