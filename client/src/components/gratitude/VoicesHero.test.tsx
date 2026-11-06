// @vitest-environment jsdom
/**
 * The voices hero holds its place while it loads, and only while it loads.
 *
 * It used to render nothing until /api/game/gratitude/voices answered, so the
 * wall opened with the sentence and the send panel at the top of the screen
 * and the voices arrived above them a moment later and pushed everything off
 * the bottom: a 0.71 layout shift measured cold on the live wall at 390 wide.
 * Now an empty block stands in until the read settles. The other half of the
 * contract is unchanged and pinned here too: a read that fails, or an answer
 * with no voices, still renders nothing at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import VoicesHero from "./VoicesHero";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function answerWith(fn: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fn));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const pending = (container: HTMLElement) => container.querySelector("[data-voices-pending]");

describe("VoicesHero while the voices are read", () => {
  it("holds the hero's place with an empty block that says nothing", () => {
    answerWith(() => new Promise<Response>(() => {}));
    const { container } = render(<VoicesHero />);
    const block = pending(container);
    expect(block).not.toBeNull();
    expect(block!.getAttribute("aria-hidden")).toBe("true");
    expect(block!.textContent).toBe("");
  });

  it("gives the place to the voices when they arrive", async () => {
    answerWith(async () => json({ voices: [{ id: "v1", message: "You carried water to the new beds.", isExample: false }] }));
    const { container } = render(<VoicesHero />);
    expect(await screen.findByText("You carried water to the new beds.")).toBeTruthy();
    expect(pending(container)).toBeNull();
  });
});

describe("VoicesHero once the read has settled with nothing to show", () => {
  it("renders nothing after a failed read", async () => {
    answerWith(async () => {
      throw new Error("offline");
    });
    const { container } = render(<VoicesHero />);
    await waitFor(() => expect(pending(container)).toBeNull());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for an answer with no voices", async () => {
    answerWith(async () => json({ voices: [] }));
    const { container } = render(<VoicesHero />);
    await waitFor(() => expect(pending(container)).toBeNull());
    expect(container.innerHTML).toBe("");
  });
});
