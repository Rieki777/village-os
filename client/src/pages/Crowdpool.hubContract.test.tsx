// @vitest-environment jsdom
/**
 * THE LIST PAGE WORDS EACH CARD OFF ITS OWN HUB CONTRACT.
 *
 * Rye ruled on 2026-09-14 that this side reads the hub's contract version, and
 * the hub publishes it at `meta.contract` (hub commit 3c70b12c). At crowdpool 1
 * the pledged total sums accepted pledges only and is a floor; at crowdpool 2 it
 * counts fulfilled and thanked too. `/api/crowdpool/campaigns` carries the
 * reading on every card as `hubContract`.
 *
 * One village can link several raisings, and each can point at a different hub
 * (`hubBaseUrl` is per campaign), so the reading is per card and never one
 * answer for the page. This drives the real page through a stubbed fetch of the
 * route's card shape and reads the rendered DOM: a contract 2 card prints a
 * total, and a card with no contract prints a floor, side by side.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("wouter", () => ({
  Link: ({ children, href, className }: { children: ReactNode; href?: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => ({ id: "crowdpool", lifecycle: "public" }),
  useModules: () => ({ loaded: true }),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => null }));

import Crowdpool from "./Crowdpool";

const card = (over: Record<string, unknown>) => ({
  key: "harmony", slug: "harmony", title: "Harmony Valley", projectName: null, status: "active",
  currency: "USD", totalValue: 107400, pledgedTotal: 20700, percentPledged: 19, percentDelivered: 4,
  daysRemaining: 45, contributorsCount: 7, imageUrl: null, isDemo: false,
  reachable: true, stale: false, lastSyncAt: "2026-09-14T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        campaigns: [
          card({ key: "harmony", slug: "harmony", title: "Harmony Valley", hubContract: { crowdpool: 2 } }),
          card({
            key: "second", slug: "second", title: "Second Raising",
            totalValue: 100000, pledgedTotal: 5000, percentPledged: 5,
          }),
        ],
      }),
    })),
  );
});

describe("the list page, given one card at contract 2 and one with no contract", () => {
  it("prints the contract 2 card as a total and the other as a floor", async () => {
    const { container } = render(<Crowdpool />);
    await waitFor(() => expect(container.querySelectorAll("a[href^='/campaign/']").length).toBe(2));
    const [v2, unversioned] = Array.from(container.querySelectorAll("a[href^='/campaign/']"));

    expect(v2.textContent).toContain("$20,700 of $107,400 pooled");
    expect(v2.textContent).not.toContain("at least");
    expect(v2.querySelector("svg")!.getAttribute("aria-label")).toBe("19 percent pooled");

    expect(unversioned.textContent).toContain("at least $5,000 of $100,000 pooled");
    expect(unversioned.querySelector("svg")!.getAttribute("aria-label")).toBe("at least 5 percent pooled");
  });
});
