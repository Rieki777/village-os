// @vitest-environment jsdom
/**
 * THE SETUP WIZARD'S IDENTITY STEP, RENDERED, because "the two boxes are gone"
 * is a claim about a screen and the only honest way to check a screen is to
 * draw it.
 *
 * What was wrong with those boxes: "Recognition currency name" and "Currency,
 * lowercase" wrote `brand.currency`, and `mergedConfig()` (server/index.ts)
 * computes `pick(registryName, pick(brandName, configName))` for that name.
 * `drizzle/0006` always seeds a name into `tokens`, so `registryName` is never
 * blank and the brand field never won. `nameLower` is derived from the winning
 * name and had no read path at all. A founder could type in either box, see
 * "Saved", and change nothing anybody could read.
 *
 * So this test asks the rendered step three things: neither label is on the
 * screen, the replacement line is, and pressing it opens the Tokens tab. The
 * first two would both pass on a blank screen, which is why the third is here.
 *
 * `fetch` is stubbed. The panels this step embeds (look, typography, identity
 * pack) each fetch on mount and each tolerate a refusal, so one catch-all stub
 * that answers the brand document and says no to everything else is enough to
 * draw the step without pretending to be a server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { GAME_CONFIG } from "@shared/gameConfig";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SetupWizard } from "@/pages/Admin";

const BRAND = {
  project: { name: "Somewhere", tagline: "", memberName: "", location: "", footerBlurb: "", siteUrl: "", eventsUrl: "", contactEmail: "" },
  // Still in the stored document, and nothing on this screen may write it.
  currency: { name: "", nameLower: "" },
  images: Object.fromEntries(Object.keys(GAME_CONFIG.images).map((k) => [k, ""])),
  setup: { identity: false, images: false, numbers: false, content: false, map: false, technical: false },
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/admin/brand")) {
        return { ok: true, json: async () => ({ brand: BRAND, defaults: GAME_CONFIG }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
}

describe("the Setup Wizard's Identity step", () => {
  beforeEach(stubFetch);
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("carries no currency box, and sends a founder to Tokens instead", async () => {
    const onOpenTab = vi.fn();
    render(<Router><SetupWizard password="secret" onOpenTab={onOpenTab} /></Router>);

    // The step drew: a live label from the same grid the two dead ones were in.
    expect(await screen.findByText("Project name")).toBeInTheDocument();

    expect(screen.queryByText("Recognition currency name")).toBeNull();
    expect(screen.queryByText(/Currency, lowercase/)).toBeNull();

    expect(screen.getByText("What your tokens are called")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open Tokens/ }));
    expect(onOpenTab).toHaveBeenCalledWith("tokens");
  });

  it("does not write brand.currency when identity is saved", async () => {
    render(<Router><SetupWizard password="secret" onOpenTab={vi.fn()} /></Router>);
    await screen.findByText("Project name");

    await userEvent.click(screen.getByRole("button", { name: "Save identity" }));

    const put = (globalThis.fetch as any).mock.calls.find(
      (c: any[]) => c[1]?.method === "PUT" && String(c[0]).includes("/admin/brand"),
    );
    expect(put).toBeTruthy();
    const body = JSON.parse(put[1].body);
    expect(body).toHaveProperty("project");
    // The route merges rather than replaces, so leaving the key out keeps an
    // old stored value where it is. This screen just stops adding to it.
    expect(body).not.toHaveProperty("currency");
  });
});
