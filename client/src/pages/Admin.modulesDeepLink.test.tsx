// @vitest-environment jsdom
/**
 * A SETUP LINK LANDS ON THE CONTROL, AND THE ADDRESS DOES NOT LINGER.
 *
 * Rye, 2026-09-21, on a module that owns a place-dependent default: "Yes - and
 * whenever this happens have a link to direct people to exactly what they
 * need." Three things have to be true for that to be kept, and each is a way
 * it could quietly not be:
 *
 *   1. The card says what the module is waiting for AT EVERY LIFECYCLE. The
 *      Go-live card only speaks in preview and this card said nothing at all,
 *      so a village whose calendar went live a year ago, which is the one most
 *      likely to be drawing the wrong seasons, could never have been told.
 *   2. `?setting=` opens that card's settings and focuses that dial.
 *   3. The key is then taken out of the URL. `setActiveTab` copies the whole
 *      query string forward between tabs, so a key left behind would grab
 *      focus every time a founder came back to Modules, for a question they
 *      answered days ago.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ModulesTab } from "./Admin";

const HEMISPHERE_READY = {
  ready: false,
  hint: "Say which hemisphere this village is in first",
  target: { kind: "setting", key: "calendar.hemisphere", label: "Hemisphere" },
};

const moduleRow = (over: Record<string, unknown> = {}) => ({
  id: "events",
  name: "Village Calendar",
  description: "The village's calendar",
  core: false,
  lifecycle: "public",
  served: "public",
  tier: "included",
  dataClass: "member-pii",
  group: "coordinate",
  setup: "required",
  ready: HEMISPHERE_READY,
  requires: [],
  recommends: [],
  maxLifecycle: "public",
  examplesAvailable: false,
  showingExamples: false,
  config: {},
  ...over,
});

const VARIABLES = {
  categories: [
    {
      name: "Calendar",
      variables: [
        {
          key: "calendar.hemisphere",
          label: "Hemisphere",
          description: "Which way the seasons turn",
          category: "Calendar",
          type: "choice",
          value: "north",
          default: "north",
          isDefault: true,
          answered: false,
          placeDependent: true,
          choices: [
            { value: "north", label: "Northern" },
            { value: "south", label: "Southern" },
          ],
          ring: "open",
          applyTiming: "instant",
          modules: ["events"],
        },
      ],
    },
  ],
};

const stubFetch = (modules: unknown[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/admin/modules")) {
        return { status: 200, ok: true, json: async () => ({ modules, orphans: [], hypha: {} }) };
      }
      if (u.includes("/admin/variables")) {
        return { status: 200, ok: true, json: async () => VARIABLES };
      }
      return { status: 404, ok: false, json: async () => ({}) };
    }),
  );

const at = (search: string) => window.history.replaceState({}, "", `/admin${search}`);

describe("the Modules tab, arriving from a setup link", () => {
  beforeEach(() => {
    at("?tab=modules");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("says what a LIVE module is still waiting for, and links to the dial", async () => {
    stubFetch([moduleRow()]);
    render(<ModulesTab password="secret" />);
    expect(await screen.findByText(/Say which hemisphere this village is in first/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Set Hemisphere" });
    expect(link.getAttribute("href")).toBe("/admin?tab=modules&module=events&setting=calendar.hemisphere");
  });

  it("says the same while the module is off, because settings are set up first", async () => {
    stubFetch([moduleRow({ lifecycle: "off", served: "off" })]);
    render(<ModulesTab password="secret" />);
    expect(await screen.findByText(/Say which hemisphere this village is in first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set Hemisphere" }).getAttribute("href")).toBe(
      "/admin?tab=modules&module=events&setting=calendar.hemisphere",
    );
  });

  it("says nothing on a module that is ready", async () => {
    stubFetch([moduleRow({ ready: { ...HEMISPHERE_READY, ready: true } })]);
    render(<ModulesTab password="secret" />);
    await screen.findByText("Village Calendar");
    expect(screen.queryByText(/Say which hemisphere/)).toBeNull();
  });

  it("opens the card's settings and focuses the dial the address names", async () => {
    at("?tab=modules&module=events&setting=calendar.hemisphere");
    stubFetch([moduleRow()]);
    render(<ModulesTab password="secret" />);
    await waitFor(() => {
      expect((document.activeElement as HTMLElement)?.getAttribute("aria-label")).toBe("Hemisphere");
    });
  });

  it("takes the setting out of the address once it has been used", async () => {
    at("?tab=modules&module=events&setting=calendar.hemisphere");
    stubFetch([moduleRow()]);
    render(<ModulesTab password="secret" />);
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=modules&module=events");
    });
  });

  it("leaves an address with no setting alone", async () => {
    at("?tab=modules&module=events");
    stubFetch([moduleRow()]);
    render(<ModulesTab password="secret" />);
    // The card's settings still open: that is what the module parameter has
    // always done, and nothing about this link is consumed.
    expect(await screen.findByLabelText("Hemisphere")).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=modules&module=events");
  });
});
