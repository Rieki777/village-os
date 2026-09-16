// @vitest-environment jsdom
/**
 * A NEED THAT ARRIVED TWICE, AND WHERE IT WAS GOING.
 *
 * The hub's fulfil path is not idempotent despite a comment of theirs claiming
 * it is: the Crowdpooling session measured two stewards confirming at once
 * putting `quantityDelivered` at two where one was wanted, ten trials out of
 * ten, against a scratch database of their own on 2026-09-04. It does not cross
 * to us as a payout, because this bridge reads the meter and never the payoff.
 * It crosses as a need whose counts cannot all be true.
 *
 * MEASURED ON THIS PAGE BEFORE ANY OF IT WAS FIXED: such a need never reached
 * the meter at all. It failed `quantityDelivered < quantityWanted`, so its card
 * left the shelf, and it passed `quantityDelivered >= quantityWanted`, so it
 * became one silent tick inside "1 need already fully delivered". The double
 * count was invisible and the shelf simply showed one card fewer.
 *
 * It stays classed as met, because delivered at or above wanted IS met. What it
 * no longer does is go unsaid. This file drives the real page through a real
 * fetch of the real payload shape and reads the rendered DOM.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { slug: "harmony" }],
  Link: ({ children, href }: { children: ReactNode; href?: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => ({ id: "crowdpool", lifecycle: "public" }),
  useModules: () => ({ loaded: true }),
}));
vi.mock("@/lib/gameApi", () => ({ authToken: () => null }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: () => "Gratitude" }));

import CrowdpoolCampaign from "./CrowdpoolCampaign";

const need = (over: Record<string, unknown>) => ({
  id: "n1", name: "Cedar fence posts", kind: "item", capitalType: "material",
  description: null, estimatedValue: 3000, pledgedValue: 1800,
  quantityWanted: 200, quantityClaimed: 120, quantityDelivered: 80,
  needDeadline: null, priorityPinned: false, groupClaimable: false, ...over,
});

/**
 * The payload `/api/crowdpool/campaign` serves, with one need carrying the
 * doubled delivery and one ordinary open need beside it. `percentPledged`
 * sits below `percentDelivered` because that is the other thing the hub's
 * accepted-only pledged sum produces.
 */
const CAMPAIGN = {
  id: 79, slug: "harmony", title: "Harmony Valley", projectName: null, location: null,
  description: null, status: "active", currency: "USD",
  totalValue: 100000, pledgedTotal: 5000, financialTarget: 0,
  percentPledged: 5, percentDelivered: 40,
  startedAt: null, endsAt: null, daysRemaining: null,
  contributorsCount: 7, imageUrl: null, hubUrl: "https://hub.example.test/campaigns/79", isDemo: false,
  // The live hub's contract on 2026-09-14: the pledged total counts delivered.
  hubContract: { crowdpool: 2 },
  needs: [
    need({ id: "n1", name: "Yoga Instructor", quantityWanted: 1, quantityClaimed: 1, quantityDelivered: 2 }),
    need({ id: "n2" }),
  ],
  partners: [], events: [],
};

const serve = (campaign: unknown) =>
  vi.fn(async (url: string) => {
    if (String(url).includes("/api/crowdpool/campaign?")) {
      return {
        ok: true, status: 200,
        json: async () => ({ campaign, stale: false, lastSyncAt: "2026-09-04T00:00:00.000Z" }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ campaigns: [] }) };
  });

beforeEach(() => vi.stubGlobal("fetch", serve(CAMPAIGN)));

describe("the campaign page, given a need the hub delivered twice", () => {
  it("names the over-delivery instead of filing it away as quietly met", async () => {
    const { container } = render(<CrowdpoolCampaign />);
    await waitFor(() => expect(screen.getByText("Harmony Valley")).toBeTruthy());

    // Still counted as met, which it is.
    expect(container.textContent).toContain("1 need already fully delivered");
    // And no longer silent about it.
    const said = container.textContent ?? "";
    expect(said).toContain("More arrived than were wanted on 1 of them: Yoga Instructor.");
    expect(said).toContain("two stewards confirm it at once");
    expect(said).toContain("Nothing here changes what the hub recorded.");
  });

  it("says nothing about over-delivery when no need has any", async () => {
    vi.stubGlobal("fetch", serve({ ...CAMPAIGN, needs: [need({ id: "n2" })] }));
    const { container } = render(<CrowdpoolCampaign />);
    await waitFor(() => expect(screen.getByText("Harmony Valley")).toBeTruthy());
    expect(container.textContent).not.toContain("More arrived than were wanted");
  });

  /**
   * The other defect, met at the same place: on a hub at crowdpool contract 1
   * the pooled figure is a floor, because that hub drops a pledge out of its sum
   * once the delivery is confirmed. The page reads the contract off the payload
   * and prints the hub's own number, qualified or not. Nothing here recomputes it.
   */
  it("at contract 2, prints the hub's pooled figure plainly, with no floor language", async () => {
    const { container } = render(<CrowdpoolCampaign />);
    await waitFor(() => expect(screen.getByText("Harmony Valley")).toBeTruthy());
    // WITHOUT THE STYLESHEET. `container.textContent` concatenates the contents
    // of any `style` element too, so a bare word ban over it is testing the CSS
    // as well as the copy, and this one failed on a rule name no member reads.
    const chrome = container.cloneNode(true) as HTMLElement;
    chrome.querySelectorAll("style").forEach((s) => s.remove());
    const said = chrome.textContent ?? "";
    expect(said).toContain("$5,000 of $100,000");
    expect(said).not.toContain("at least $5,000");
    expect(said).not.toContain("floor");
    // The ring still draws the hub's own percentage, uncorrected.
    const ring = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent);
    expect(ring).toContain("5%");
    expect(ring).toContain("pooled");
    expect(ring).not.toContain("pooled or more");
  });

  /**
   * THREADED FROM THE PAYLOAD, not from anything the page decides for itself.
   * The same campaign served with no `hubContract`, and served at contract 1,
   * must word the figure as a floor on every surface that words it.
   */
  it("at contract 1 or with no contract served, names the floor on every surface", async () => {
    const { hubContract: _v2, ...unversioned } = CAMPAIGN;
    for (const campaign of [unversioned, { ...CAMPAIGN, hubContract: { crowdpool: 1 } }]) {
      vi.stubGlobal("fetch", serve(campaign));
      const { container, unmount } = render(<CrowdpoolCampaign />);
      await waitFor(() => expect(screen.getByText("Harmony Valley")).toBeTruthy());
      const chrome = container.cloneNode(true) as HTMLElement;
      chrome.querySelectorAll("style").forEach((s) => s.remove());
      const said = chrome.textContent ?? "";
      expect(said).toContain("at least $5,000 of $100,000");
      expect(said).toContain("what this page shows is a floor");
      const ring = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent);
      expect(ring).toContain("5%");
      expect(ring).toContain("pooled or more");
      expect(container.querySelector("svg[aria-label^='at least 5 percent pledged']")).toBeTruthy();
      unmount();
    }
  });

  it("refuses to narrate 40 percent delivered against 5 percent pooled as health", async () => {
    const { container } = render(<CrowdpoolCampaign />);
    await waitFor(() => expect(screen.getByText("Harmony Valley")).toBeTruthy());
    const note = container.querySelector(".cp-growth-note")!.textContent ?? "";
    expect(note).not.toContain("keeping pace");
    expect(note).toContain("Both cannot be true");
  });
});
