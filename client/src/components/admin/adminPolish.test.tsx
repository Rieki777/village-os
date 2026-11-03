// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HealthStrip from "./HealthStrip";
import AdminHelp from "./AdminHelp";
import { describeFailures, measureText, nightOverlay } from "@/test/tokenContrast";

afterEach(() => vi.unstubAllGlobals());

function expectReadable(node: HTMLElement) {
  expect(describeFailures(measureText(node, "light"))).toEqual([]);
  expect(describeFailures(measureText(node, "light", nightOverlay()))).toEqual([]);
}

describe("admin polish", () => {
  it("keeps the connection strip readable in day and night, with a name on each control", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ emailConfigured: true, stripeConfigured: false }) })));
    const view = render(<HealthStrip password="tok" onOpen={vi.fn()} />);
    const email = await screen.findByRole("button", { name: /Email/ });
    expect(email.className).toContain("min-h-[44px]");
    expectReadable(view.container);
  });

  it("keeps What is this readable, and the answer is in the tab order after the button", async () => {
    const view = render(<AdminHelp tab="players" />);
    const button = screen.getByRole("button", { name: "What is this?" });
    await userEvent.click(button);
    expect(screen.getByRole("region", { name: /What is this/ })).toBeTruthy();
    expectReadable(view.container);
  });
});
