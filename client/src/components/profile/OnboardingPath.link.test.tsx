// @vitest-environment jsdom
/**
 * A step's link on the profile: a button that opens the https address in a new
 * tab without handing it this page, and nothing at all for an address that is
 * not https.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import OnboardingPath from "./OnboardingPath";

const item = (over: Record<string, unknown>) => ({
  key: "k", kind: "plain", title: "We go through the New Moon review together", owner: "holder", dueDay: 7, doneWhen: "We have been through it",
  source: "village", phase: "Set up", phaseFrom: 1, phaseTo: 7, doneAt: null, mayTick: true, ...over,
});

function serve(items: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    paths: [{ id: "p1", roleName: "A role", title: "Our first days", openedOn: "2026-11-01", dueOn: "2026-11-14", day: 3, buddyUserId: null, buddyName: "", mine: true, items, openCount: items.length, checkinsDue: [], checkins: [], mayFile: false }],
  }), { status: 200 })));
}

describe("a step's link", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("draws the label as a link that opens safely in a new tab", async () => {
    serve([item({ link: { label: "Open the New Moon guide", href: "https://claude.ai/artifact/6a9FFDFwWkkCPgBgTVx7vv" } })]);
    render(<OnboardingPath />);
    const a = (await screen.findByRole("link", { name: "Open the New Moon guide" })) as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://claude.ai/artifact/6a9FFDFwWkkCPgBgTVx7vv");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("draws nothing for a link that is not https, even if one reached the page", async () => {
    serve([item({ link: { label: "Sneaky", href: "javascript:alert(1)" } })]);
    render(<OnboardingPath />);
    await screen.findByText("We go through the New Moon review together");
    expect(screen.queryByRole("link", { name: "Sneaky" })).toBeNull();
  });

  it("draws no link for a step without one", async () => {
    serve([item({})]);
    render(<OnboardingPath />);
    await screen.findByText("We go through the New Moon review together");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
