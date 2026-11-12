// @vitest-environment jsdom
/**
 * THE GUIDE BUTTON LIFTS OVER "YOUR TURN" (batch 158, D4 wiring).
 *
 * On a phone, the decider's your-turn door is a bar fixed at the bottom until
 * `lg`. The shortcuts button sat on top of it. index.css lifts the button while
 * a sticky your-turn bar is on the page. jsdom lays nothing out, so this holds
 * the two halves that make it: the bar carries the marker, and the rule in
 * index.css reads that marker, below `lg`, and lifts the button by a token
 * tall enough to clear the bar.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import YourTurn from "./YourTurn";

const css = fs.readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

afterEach(cleanup);

describe("the guide button and the your-turn bar", () => {
  it("marks the sticky bar, and only the sticky one", () => {
    const { container } = render(
      <Router>
        <YourTurn to="#round" label="Take your turn" shape="sticky" />
        <YourTurn to="#round" label="Take your turn" />
      </Router>,
    );
    expect(container.querySelectorAll('[data-your-turn="sticky"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-your-turn="door"]')).toHaveLength(1);
  });

  it("lifts the shortcuts button below lg while a sticky your-turn bar shows", () => {
    const block = css.match(/@media \(width < 64rem\) \{\s*:root:has\(\[data-your-turn="sticky"\]\) \[data-mobile-fab\] \{([^}]*)\}/);
    expect(block, "index.css lifts [data-mobile-fab] under [data-your-turn=sticky] below 64rem").toBeTruthy();
    expect(block![1]).toMatch(/translate:\s*0 calc\(-1 \* var\(--your-turn-h\)\)/);
  });

  it("lifts it far enough to clear the bar: the door's 44px, its line and padding", () => {
    const h = css.match(/--your-turn-h:\s*([\d.]+)rem/);
    expect(h).toBeTruthy();
    expect(Number(h![1])).toBeGreaterThanOrEqual(6.5);
  });
});
