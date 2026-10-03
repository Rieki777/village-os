// @vitest-environment jsdom
/**
 * A TIER PILL SAYS WHAT THE TIER MEANS, AND THE TIER ID STAYS IN THE DATA.
 *
 * A module of tier `connected` wore a pill reading "connected". On the
 * Integrations card that pill sat one span away from the key's own status,
 * "Not connected", so a founder read two answers to one question: is it
 * connected or not? The pill now reads "Outside service" on every surface
 * that draws one: the Integrations card, the admin Module Library card, the
 * tier filter on that library, the listing line under an enabled card, and
 * the public library card.
 *
 * Each negative here ("no element reads connected") is paired with a known
 * positive of the same shape: the managed pill, found by the same exact-text
 * query on the same card markup. An absent string on its own proves nothing,
 * since a card that failed to render would pass it too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { IntegrationsTab, ModulesTab } from "./Admin";
import ModuleCard, { type CatalogModule } from "@/components/modules/ModuleCard";

/** Exactly the old pill's word, any case, as the whole text of one element. */
const OLD_PILL = /^connected$/i;

const stub = (routes: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const hit = Object.keys(routes).find((path) => u.includes(path));
      return hit
        ? { status: 200, ok: true, json: async () => routes[hit] }
        : { status: 404, ok: false, json: async () => ({}) };
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the Integrations card", () => {
  const CARDS = [
    {
      key: "outside_records_api_key",
      title: "Outside Records",
      tier: "connected",
      credential: true,
      unlocks: "Keeps the village's records in step.",
      placeholder: "or_live_...",
    },
    {
      key: null,
      module: "lent-thing",
      title: "Lent Thing",
      tier: "managed",
      credential: false,
      entitled: true,
      unlocks: "Runs on a key the platform lends.",
    },
  ];

  it("reads Outside service beside Not connected, and never connected as a pill", async () => {
    stub({ "/admin/integrations": { cards: CARDS, secrets: [], stripeWebhookUrl: "https://example.test/hook" } });
    render(<IntegrationsTab password="secret" />);

    const title = await screen.findByText("Outside Records");
    const pill = within(title).getByText("Outside service");
    expect(pill.tagName).toBe("SPAN");
    // The status the old pill was confused with is still on the card.
    expect(screen.getByText("Not connected")).toBeInTheDocument();

    // Known positive: the same exact-text query finds the managed pill on
    // the same card markup, so the negative below is about the word.
    expect(within(screen.getByText("Lent Thing")).getByText(/^managed$/i).tagName).toBe("SPAN");
    expect(screen.queryByText(OLD_PILL)).toBeNull();
  });
});

describe("the admin Module Library", () => {
  const row = (over: Record<string, unknown>) => ({
    description: "A module",
    core: false,
    lifecycle: "off",
    served: "off",
    dataClass: "none",
    group: "coordinate",
    setup: "none",
    ready: { ready: true },
    requires: [],
    recommends: [],
    maxLifecycle: "public",
    examplesAvailable: false,
    showingExamples: false,
    config: {},
    ...over,
  });
  const MODULES = [
    row({
      id: "outside-records",
      name: "Outside Records",
      tier: "connected",
      lifecycle: "members",
      served: "members",
      listing: { tier: "connected", contractVersion: "1.2", acceptedAt: null, acceptedBy: null },
    }),
    row({ id: "lent-thing", name: "Lent Thing", tier: "managed" }),
    row({ id: "village-calendar", name: "Village Calendar", tier: "included" }),
  ];

  it("puts Outside service on the card, and never connected as a pill", async () => {
    stub({ "/admin/modules": { modules: MODULES, orphans: [], hypha: {} }, "/admin/variables": { categories: [] } });
    render(<ModulesTab password="secret" />);

    const heading = await screen.findByRole("heading", { name: /Outside Records/ });
    expect(within(heading).getByText("Outside service").tagName).toBe("SPAN");
    // Known positive, same query on the same markup.
    const managed = screen.getByRole("heading", { name: /Lent Thing/ });
    expect(within(managed).getByText(/^managed$/i).tagName).toBe("SPAN");
    // An included module wears no tier pill at all.
    const included = screen.getByRole("heading", { name: /Village Calendar/ });
    expect(within(included).queryByText("Outside service")).toBeNull();

    expect(screen.queryByText(OLD_PILL)).toBeNull();
  });

  it("names the tier the village accepted in the same words", async () => {
    stub({ "/admin/modules": { modules: MODULES, orphans: [], hypha: {} }, "/admin/variables": { categories: [] } });
    render(<ModulesTab password="secret" />);

    expect(await screen.findByText(/enabled as "Outside service" under library contract 1\.2/)).toBeInTheDocument();
    expect(screen.queryByText(/enabled as "?connected/)).toBeNull();
  });

  it("filters on the tier id and shows the pill's words", async () => {
    stub({ "/admin/modules": { modules: MODULES, orphans: [], hypha: {} }, "/admin/variables": { categories: [] } });
    render(<ModulesTab password="secret" />);

    const filter = (await screen.findByLabelText("Filter by tier")) as HTMLSelectElement;
    const byValue = (v: string) => Array.from(filter.options).find((o) => o.value === v);
    // The data keeps the id; only the visible label changed.
    expect(byValue("connected")?.textContent).toBe("Outside service");
    // Known positive: a tier with no pill words falls through to its id.
    expect(byValue("included")?.textContent).toBe("included");
    expect(byValue("managed")?.textContent).toBe("managed");
    expect(Array.from(filter.options).some((o) => OLD_PILL.test(o.textContent ?? ""))).toBe(false);
  });
});

describe("the public library card", () => {
  const card = (over: Partial<CatalogModule>): CatalogModule => ({
    id: "outside-records",
    name: "Outside Records",
    description: "A module",
    core: false,
    tier: "included",
    dataClass: "none",
    group: "coordinate",
    setup: "none",
    requires: [],
    recommends: [],
    legalReview: false,
    withdrawn: null,
    priceLine: null,
    pool: null,
    support: null,
    card: null,
    imageUrl: null,
    ...over,
  });

  it("reads Outside service for a connected module", () => {
    render(<ModuleCard module={card({ tier: "connected" })} />);
    expect(screen.getByText("Outside service").tagName).toBe("SPAN");
    expect(screen.queryByText(OLD_PILL)).toBeNull();
  });

  it("still reads managed for a managed module, the known positive", () => {
    render(<ModuleCard module={card({ id: "lent-thing", name: "Lent Thing", tier: "managed" })} />);
    expect(screen.getByText(/^managed$/i).tagName).toBe("SPAN");
    expect(screen.queryByText("Outside service")).toBeNull();
  });
});
