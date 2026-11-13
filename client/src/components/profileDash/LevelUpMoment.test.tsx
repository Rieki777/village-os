// @vitest-environment jsdom
/**
 * A DOOR OPENED (the prune, wave 1). The moment names the door a crossing
 * opened and never the rung: no stage name, no "n of 12", no share line. A
 * fern unfurls round the portrait, still under reduced motion. The sound
 * hook still plays once, as the moment arrives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";

const playMoment = vi.fn();
vi.mock("@/lib/sound", () => ({ playMoment: (...a: unknown[]) => playMoment(...a) }));

import LevelUpMoment from "./LevelUpMoment";

i18n.load("en", {});
i18n.activate("en");
const render = (ui: ReactElement) => rtlRender(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

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

describe("LevelUpMoment", () => {
  it("names the door, never the rung, and offers no share", async () => {
    motion(false);
    const onClose = vi.fn();
    render(
      <LevelUpMoment
        advance={{ fromStage: "participant", toStage: "member", unlocked: ["ballot.vote", "forum.post"], at: "2026-11-11T00:00:00Z" }}
        name="Ana Lucia"
        portrait={null}
        onClose={onClose}
      />,
    );
    expect(playMoment).toHaveBeenCalledTimes(1);
    expect(screen.getByText("A door opened")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "You can now cast a vote on a ballot." })).toBeTruthy();
    expect(screen.getByText("You can now start a thread in the forum.")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/member|stage|reached|of \d+/i);
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
    // The fern unfurls round the portrait (lazy, so it arrives after a tick).
    await vi.waitFor(() => expect(document.querySelector('[data-testid="door-fern"] .nk')).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back to my sheet" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says something kind when a crossing opened nothing, and is still under reduced motion", async () => {
    motion(true);
    render(
      <LevelUpMoment
        advance={{ fromStage: "member", toStage: "quest-seeker", unlocked: [], at: "2026-11-11T00:00:00Z" }}
        name="Ana"
        portrait={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("A new step on your walk")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ana, the village saw what you carried." })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/quest-seeker|Quest Seeker/);
    await vi.waitFor(() => expect(document.querySelector(".nk")!.getAttribute("data-motion")).toBe("still"));
  });
});
