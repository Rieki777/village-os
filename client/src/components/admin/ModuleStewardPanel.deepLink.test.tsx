// @vitest-environment jsdom
/**
 * A SETUP LINK LANDS ON THE CONTROL, AND THE ADDRESS DOES NOT LINGER.
 *
 * Rye, 2026-09-21, on a module that owns a place-dependent default: "Yes - and
 * whenever this happens have a link to direct people to exactly what they
 * need." Three things have to be true for that to be kept, and each is a way
 * it could quietly not be:
 *
 *   1. The module's page says what it is waiting for AT EVERY LIFECYCLE. A
 *      village whose calendar went live a year ago, which is the one most
 *      likely to be drawing the wrong seasons, has to be told too.
 *   2. `#setting-<key>` opens the settings and focuses that dial.
 *   3. The fragment is then taken out of the address, so a reload or Back
 *      does not grab focus for a question answered days ago.
 *
 * These moved here from Admin.modulesDeepLink.test.tsx when the admin Module
 * Library tab was retired into the module's own page (Rye, 2026-10-09). The
 * promises are the same; the address is `/modules/<id>#setting-<key>` now.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ModuleStewardPanel from "./ModuleStewardPanel";
import type { LibraryViewer } from "@shared/moduleSwitch";

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
  capabilities: [],
  maxLifecycle: "public",
  examplesAvailable: false,
  showingExamples: false,
  config: {},
  health: [],
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

const steward: LibraryViewer = { mode: "steward", launched: false, canSwitch: true, canPause: true };

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/admin/variables")) return { status: 200, ok: true, json: async () => VARIABLES };
      return { status: 404, ok: false, json: async () => ({}) };
    }),
  );

const at = (hash: string) => window.history.replaceState({}, "", `/modules/events${hash}`);

const panel = (over: Record<string, unknown> = {}, viewer: LibraryViewer = steward) => {
  const m = moduleRow(over);
  return render(<ModuleStewardPanel m={m} all={[m]} extra={{ orphans: [], hypha: null }} viewer={viewer} onChanged={() => {}} />);
};

describe("a module's page, arriving from a setup link", () => {
  beforeEach(() => {
    at("");
    stubFetch();
  });
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("says what a LIVE module is still waiting for, and links to the dial", () => {
    panel();
    expect(screen.getByText(/Say which hemisphere this village is in first/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Set Hemisphere" });
    expect(link.getAttribute("href")).toBe("/modules/events#setting-calendar.hemisphere");
  });

  it("says the same while the module is off, because settings are set up first", () => {
    panel({ lifecycle: "off", served: "off" });
    expect(screen.getByText(/Say which hemisphere this village is in first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set Hemisphere" }).getAttribute("href")).toBe(
      "/modules/events#setting-calendar.hemisphere",
    );
  });

  it("says nothing on a module that is ready", () => {
    panel({ ready: { ...HEMISPHERE_READY, ready: true } });
    expect(screen.queryByText(/Say which hemisphere/)).toBeNull();
  });

  it("opens the settings and focuses the dial the address names", async () => {
    at("#setting-calendar.hemisphere");
    panel();
    await waitFor(() => {
      expect((document.activeElement as HTMLElement)?.getAttribute("aria-label")).toBe("Hemisphere");
    });
  });

  it("takes the fragment out of the address once it has been used", async () => {
    at("#setting-calendar.hemisphere");
    panel();
    await waitFor(() => {
      expect(window.location.hash).toBe("");
      expect(window.location.pathname).toBe("/modules/events");
    });
  });

  it("leaves the settings closed on an address with no fragment", () => {
    panel();
    expect(screen.queryByLabelText("Hemisphere")).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("the switch, after launch", () => {
  beforeEach(() => stubFetch());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("lets an admin who is not the holder narrow, and keeps the wider rungs dead", () => {
    panel({ lifecycle: "members", served: "members" }, { mode: "steward", launched: true, canSwitch: false, canPause: true });
    expect(screen.getByRole("button", { name: "Everyone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Off" })).not.toBeDisabled();
    expect(screen.getByText(/widening this is the village's call/)).toBeInTheDocument();
  });

  it("asks for the funds card before a money module turns on, and never a browser confirm", async () => {
    const confirm = vi.spyOn(window, "confirm");
    panel({ lifecycle: "off", served: "off", legalReview: true, setup: "none", ready: null });
    screen.getByRole("button", { name: "Preview" }).click();
    expect(await screen.findByText(/touches money/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
});
