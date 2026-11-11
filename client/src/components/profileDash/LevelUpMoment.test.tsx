// @vitest-environment jsdom
/**
 * THE LEVEL-UP MOMENT, AS A BLOOM (game feel wave 2). The sparks and the
 * "Stage reached" flash are gone; the portrait sits at the heart of a Seed of
 * Life with one circle per stage, the reached one drawing itself and the
 * whole seed opening when the ladder is complete. The sound hook still plays
 * once, as the moment arrives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";

const playMoment = vi.fn();
vi.mock("@/lib/sound", () => ({ playMoment: (...a: unknown[]) => playMoment(...a) }));

import LevelUpMoment, { seedOfStages } from "./LevelUpMoment";

i18n.load("en", {});
i18n.activate("en");
const render = (ui: ReactElement) => rtlRender(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const STAGES = [
  { id: "seed", name: "Seed" },
  { id: "sprout", name: "Sprout" },
  { id: "sapling", name: "Sapling" },
  { id: "tree", name: "Tree" },
];

function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  playMoment.mockClear();
});

describe("seedOfStages", () => {
  it("puts the reached stage on its own circle", () => {
    expect(seedOfStages(STAGES, "sapling")).toEqual({ total: 4, walked: 3 });
    expect(seedOfStages(STAGES, "tree")).toEqual({ total: 4, walked: 4 });
    // A stage the ladder no longer names reads as the whole ladder, never as nothing.
    expect(seedOfStages(STAGES, "gone")).toEqual({ total: 4, walked: 4 });
    expect(seedOfStages([], "x")).toEqual({ total: 1, walked: 1 });
  });
});

describe("LevelUpMoment", () => {
  it("plays its sound once and grows the seed, with no sparks and no flash", async () => {
    motion(false);
    const { container } = render(
      <LevelUpMoment
        advance={{ fromStage: "sprout", toStage: "sapling", unlocked: [], at: "2026-11-11T00:00:00Z" }}
        stages={STAGES}
        name="Ana Lucia"
        portrait={null}
        onClose={() => {}}
      />,
    );
    expect(playMoment).toHaveBeenCalledTimes(1);
    expect(playMoment).toHaveBeenCalledWith("stage_advance", "arrive");
    expect(screen.getByRole("heading", { name: "Sapling" })).toBeTruthy();
    expect(screen.queryByText("Stage reached")).toBeNull();
    const seed = await screen.findByRole("img", { name: "3 of 4 stages walked" });
    // The stage just reached draws itself; the two before it were already walked.
    expect(seed.querySelectorAll("circle.nk-draw")).toHaveLength(1);
    expect(seed.querySelectorAll('circle[data-state="closed"]')).toHaveLength(3);
    // Not the last stage: no bloom yet.
    expect(container.querySelector('[data-testid="seed-bloom"]')).toBeNull();
    expect(container.querySelectorAll(".bg-dash-gold-lit.absolute")).toHaveLength(0);
  });

  it("blooms on the last stage, and is still under reduced motion", async () => {
    motion(true);
    render(
      <LevelUpMoment
        advance={{ fromStage: "sapling", toStage: "tree", unlocked: [], at: "2026-11-11T00:00:00Z" }}
        stages={STAGES}
        name="Ana"
        portrait={null}
        onClose={() => {}}
      />,
    );
    await screen.findByRole("img", { name: "4 of 4 stages walked" });
    expect(screen.getByTestId("seed-bloom")).toBeTruthy();
    expect(document.querySelector(".nk")!.getAttribute("data-motion")).toBe("still");
  });
});
