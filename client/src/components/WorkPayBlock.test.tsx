// @vitest-environment jsdom
/**
 * The full pay on a card (Rye, 2026-10-30: each quest and role shows its full
 * pay, cash, tokens, Voice and badge, before you take it on). What is proved
 * here is that the block draws each part the server sent and invents none:
 * a badge sits beside the figure and never changes it, Voice is named for
 * what it is, and absent pay draws nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { WorkPay } from "@shared/workValue";
import WorkPayBlock from "./WorkPayBlock";
import { forgetDisplayRates } from "@/lib/workPay";

beforeEach(() => {
  forgetDisplayRates();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAY: WorkPay = {
  value: null,
  lines: [
    { token: "village-credit", name: "Village Credits", amount: 40 },
    { token: "village-voice", name: "Village Voice", amount: 5, voice: true },
  ],
  source: "own",
  cadence: "once",
  cashPay: { minor: 2000000, currency: "CRC" },
  badges: [{ badge: "Builder", token: "village-voice", name: "Village Voice", factor: 2 }],
};

describe("WorkPayBlock", () => {
  it("draws cash, tokens, Voice and the badge on the card chip", () => {
    const { container } = render(<WorkPayBlock pay={PAY} />);
    const text = container.textContent ?? "";
    expect(text).toContain("cash");
    expect(text).toContain("40 Village Credits");
    expect(text).toContain("5 Village Voice");
    expect(text).toContain("×2 Village Voice with the Builder badge");
  });

  it("names Voice for what it is and lists each badge on the full block, figures untouched", () => {
    const { container } = render(<WorkPayBlock pay={PAY} variant="full" />);
    expect(container.querySelector("[data-work-pay-voice]")?.textContent).toBe("Village Voice is your say in the village's decisions.");
    expect(container.querySelector("[data-work-pay-badges]")?.textContent).toContain("×2 Village Voice with the Builder badge.");
    // The badge never multiplies the figure the card states.
    expect(container.textContent).toContain("5 Village Voice");
    expect(container.textContent).not.toContain("10 Village Voice");
  });

  it("draws no badge or Voice line when the work has none", () => {
    const plain: WorkPay = { ...PAY, lines: [PAY.lines[0]!], badges: [] };
    const { container } = render(<WorkPayBlock pay={plain} variant="full" />);
    expect(container.querySelector("[data-work-pay-voice]")).toBeNull();
    expect(container.querySelector("[data-work-pay-badges]")).toBeNull();
  });

  it("draws nothing at all for absent pay", () => {
    const { container } = render(<WorkPayBlock pay={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});
