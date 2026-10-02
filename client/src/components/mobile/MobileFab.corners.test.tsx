// @vitest-environment jsdom
/**
 * THE SHORTCUTS BUTTON AND THE OTHER THINGS THAT WANT ITS CORNER.
 *
 * The button shows at every width (a ruling), always bottom right. Before
 * that it was phones only, so three neighbours that were safe on a desk met it
 * there for the first time:
 *
 *   the moon dock on /profile and /gratitude, which sat bottom right on a desk
 *   and lost the lower third of its moon under the trigger;
 *   the launch guide on /journey-to-launch, whose Send button sat under it;
 *   every z-50 modal, whose backdrop the button floated over, clickable.
 *
 * jsdom lays nothing out, so geometry is held by the classes that make it (an
 * anchor side and an offset), and the hiding rule is read out of index.css
 * itself and applied, so a change to that rule is what these cases test.
 * A last block holds index.css's breakpoints to Tailwind's own `md`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-rye", name: "Rye", role: "admin" }, loading: false }),
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => ({ modules: [{ id: "events", lifecycle: "public" }], loaded: true, failed: false }),
  useModuleOn: () => true,
}));
vi.mock("@/lib/haptics", () => ({ haptic: () => false }));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "a-token",
  gameFetch: (url: string) => fetch(url),
  // `MobileFab` reads the brochure switch through `useBrochurePages`, which
  // calls this. A wholesale `vi.mock` REPLACES the module, so an export the
  // component gained is simply absent here and every case in this file dies at
  // render with "No useGameConfig export is defined on the mock" - ten of them,
  // none of which is about the brochure pages at all.
  //
  // ON is the honest value. Before the switch existed every FAB_ACTIONS row
  // showed, so `brochurePages: true` is the state these corner and visibility
  // cases were written against, and they keep measuring what they always did.
  // Whether a shortcut row is filtered out is MobileFab.test.tsx's question.
  useGameConfig: () => ({ brochurePages: true }),
}));
// The launch page's shell and heavy neighbours, as JourneyToLaunch.test.tsx mocks them.
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/MicButton", () => ({ default: () => null }));
vi.mock("@/pages/ProjectHistory", () => ({ EconomicsView: () => null }));

import MobileFab from "./MobileFab";
import MoonDock from "@/components/profile/MoonDock";
import JourneyToLaunch from "@/pages/JourneyToLaunch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const INDEX_CSS = fs.readFileSync(path.join(ROOT, "client/src/index.css"), "utf8");

const lunar = {
  monthIndex: 3,
  cycleNumber: 340,
  monthCount: 12,
  name: "Seed Moon",
  isExampleName: false,
  day: 8,
  length: 29,
  monthStartsAt: "2026-03-01T00:00:00.000Z",
  monthEndsAt: "2026-03-30T00:00:00.000Z",
  phase: 0.27,
  phaseName: "First quarter",
};

const ROUTES: Record<string, unknown> = {
  "/api/events": { events: [], lunar, moonOneCycle: 300 },
  "/api/admin/launch": { items: [], blockingOpen: 0, recommendedOpen: 0, launchedAt: null, vote: null },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = ROUTES[String(url)];
      return { ok: !!body, status: body ? 200 : 404, json: async () => body ?? {} };
    }),
  );
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

const withRouter = (ui: ReactNode, at = "/profile") => {
  const { hook } = memoryLocation({ path: at });
  return <Router hook={hook}>{ui}</Router>;
};

const fabBox = () => document.querySelector<HTMLElement>("[data-mobile-fab]")!;

/** The utilities on an element with their breakpoint prefix dropped: `sm:right-6` reads `right-6`. */
const utilities = (el: Element) =>
  String(el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => c.slice(c.lastIndexOf(":") + 1));
const mdBottom = (el: Element) =>
  String(el.getAttribute("class") ?? "")
    .split(/\s+/)
    .find((c) => c.startsWith("md:bottom-"));

describe("the moon dock and the shortcuts button never share a corner", () => {
  it("anchors the moon to the left at every width, and the button to the right", async () => {
    render(withRouter(<><MoonDock /><MobileFab /></>));
    const moon = await screen.findByRole("button", { name: /Moon 41/i });
    const fab = fabBox();

    expect(utilities(fab).filter((u) => u.startsWith("right-")).length).toBeGreaterThan(0);
    expect(utilities(fab).filter((u) => u.startsWith("left-"))).toEqual([]);

    // No breakpoint may move the moon to the right: before this it went
    // `sm:left-auto sm:right-6`, under the trigger from `md` up.
    expect(utilities(moon).filter((u) => u.startsWith("right-"))).toEqual([]);
    expect(utilities(moon)).not.toContain("left-auto");
    expect(utilities(moon).filter((u) => u.startsWith("left-")).length).toBeGreaterThan(0);
  });

  it("sits level with the button from md up, with no inline offset to beat the class", async () => {
    render(withRouter(<><MoonDock /><MobileFab /></>));
    const moon = await screen.findByRole("button", { name: /Moon 41/i });
    expect(moon.style.bottom).toBe("");
    expect(mdBottom(moon)).toBeDefined();
    expect(mdBottom(moon)).toBe(mdBottom(fabBox()));
  });

  it("opens its panel from the left as well", async () => {
    render(withRouter(<><MoonDock /><MobileFab /></>));
    fireEvent.click(await screen.findByRole("button", { name: /Moon 41/i }));
    const panel = await screen.findByRole("dialog");
    expect(panel.style.bottom).toBe("");
    expect(utilities(panel)).not.toContain("left-auto");
    expect(utilities(panel).filter((u) => u.startsWith("right-") && u !== "right-auto" && u !== "right-4")).toEqual([]);
  });
});

/**
 * The hiding rule, lifted out of index.css and applied to this document, so
 * these cases exercise the selector that ships rather than a copy of it.
 */
describe("the button steps out while something else owns the screen", () => {
  beforeAll(() => {
    const rule = INDEX_CSS.match(/:root:has\([^{]*?\)\s*\[data-mobile-fab\]\s*\{\s*visibility:\s*hidden;?\s*\}/);
    expect(rule, "index.css carries the rule that hides the button").not.toBeNull();
    const style = document.createElement("style");
    style.textContent = rule![0];
    document.head.appendChild(style);
  });

  const visibility = () => getComputedStyle(fabBox()).visibility;

  it("shows the button when nothing is open, which is what makes the cases below mean something", () => {
    render(withRouter(<MobileFab />));
    expect(visibility()).not.toBe("hidden");
  });

  it("hides it under a hand-rolled aria-modal dialog (BreakGlass, ProposalWizard, WeeklyBrief)", () => {
    const { rerender } = render(withRouter(<MobileFab />));
    rerender(withRouter(<><MobileFab /><div role="dialog" aria-modal="true" aria-label="Break the glass" /></>));
    expect(visibility()).toBe("hidden");
    rerender(withRouter(<MobileFab />));
    expect(visibility()).not.toBe("hidden");
  });

  it("leaves it alone on desktop for a modal parked inside an md:hidden wrapper (the village map's SeatSheet)", () => {
    // `:has()` matches inside a display:none parent, so an unscoped rule hid
    // the button on desktop whenever a seat was selected. jsdom applies no
    // media queries, so this is the desktop half of the rule.
    const { rerender } = render(withRouter(<MobileFab />));
    rerender(
      withRouter(
        <>
          <MobileFab />
          <div className="md:hidden">
            <div role="dialog" aria-modal="true" aria-label="Water Steward" />
          </div>
        </>,
      ),
    );
    expect(visibility()).not.toBe("hidden");
  });

  it("hides it under a shadcn dialog's overlay", async () => {
    render(
      withRouter(
        <>
          <MobileFab />
          <Dialog open>
            <DialogContent>
              <DialogTitle>Request the pack</DialogTitle>
              <DialogDescription>A form.</DialogDescription>
            </DialogContent>
          </Dialog>
        </>,
      ),
    );
    await waitFor(() => expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull());
    expect(visibility()).toBe("hidden");
  });

  it("leaves it alone for the moon's own panel, which is not modal", async () => {
    render(withRouter(<><MoonDock /><MobileFab /></>));
    fireEvent.click(await screen.findByRole("button", { name: /Moon 41/i }));
    await screen.findByRole("dialog");
    expect(visibility()).not.toBe("hidden");
  });

  it("hides it while the launch guide holds the corner, and puts it back when the guide closes", async () => {
    render(withRouter(<><JourneyToLaunch /><MobileFab /></>, "/journey-to-launch"));
    expect(visibility()).not.toBe("hidden");
    fireEvent.click(await screen.findByRole("button", { name: /ask the guide/i }));

    const guide = document.querySelector<HTMLElement>("[data-hides-fab]");
    expect(guide, "the open guide carries the opt-in").not.toBeNull();
    // Over the button's z-[60] and the tab bar's z-50, on the modal tier.
    expect(guide!.className).toMatch(/(^|\s)z-\[70\](\s|$)/);
    expect(guide!.className).not.toMatch(/(^|\s)z-50(\s|$)/);
    expect(visibility()).toBe("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector("[data-hides-fab]")).toBeNull();
    expect(visibility()).not.toBe("hidden");
  });
});

/**
 * One unit for one breakpoint. Tailwind's `md` is `(width >= 48rem)`, and a rem
 * in a media query reads the browser's DEFAULT font size, so a px bound beside
 * it agrees only while that default is 16px. These two rules must be the exact
 * complement and the exact copy of the `md:` classes they sit beside (the
 * peek's and the tab bar's `md:hidden`, the button's `md:` position).
 */
describe("index.css bounds its phone-only rules with Tailwind's own md", () => {
  const require = createRequire(import.meta.url);
  const theme = fs.readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
  const md = theme.match(/--breakpoint-md:\s*([^;]+);/)?.[1].trim();

  /** Every `@media (...) { ... }` block in the file, comments removed. */
  const mediaBlocks = (() => {
    const css = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const out: Array<{ cond: string; body: string }> = [];
    const re = /@media\s*([^{]+)\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      let depth = 1;
      let i = re.lastIndex;
      for (; i < css.length && depth > 0; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
      }
      out.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
    }
    return out;
  })();

  it("reads md from Tailwind, so the cases below are against the real figure", () => {
    expect(md).toMatch(/rem$/);
  });

  it("lifts the button over the circle peek exactly below md", () => {
    const blocks = mediaBlocks.filter((b) => b.body.includes("[data-circle-peek]"));
    expect(blocks.length).toBe(1);
    expect(blocks[0].cond).toBe(`(width < ${md})`);
  });

  it("collapses the tab bar's band exactly from md", () => {
    const blocks = mediaBlocks.filter((b) => /--tabbar-h:\s*0px/.test(b.body));
    expect(blocks.length).toBe(1);
    expect(blocks[0].cond).toBe(`(width >= ${md})`);
  });

  /*
   * A journal sitting's Next landed under the button on a phone the moment a
   * step loaded (journal QA, 2026-10-02). The sitting carries
   * `data-hides-fab-phone`, and the rule that honours it lives below md only:
   * on a desk the button is nowhere near the sitting's controls.
   */
  it("steps the button out for a phone-only focused task, exactly below md", () => {
    const blocks = mediaBlocks.filter((b) => b.body.includes("[data-hides-fab-phone]"));
    expect(blocks.length).toBe(1);
    expect(blocks[0].cond).toBe(`(width < ${md})`);

    // jsdom applies no media queries, so apply the block's own body: this is
    // the phone half of the rule, as shipped.
    const style = document.createElement("style");
    style.textContent = blocks[0].body;
    document.head.appendChild(style);
    try {
      const { rerender } = render(withRouter(<MobileFab />));
      expect(getComputedStyle(fabBox()).visibility).not.toBe("hidden");
      rerender(withRouter(<><MobileFab /><div data-hides-fab-phone /></>));
      expect(getComputedStyle(fabBox()).visibility).toBe("hidden");
    } finally {
      style.remove();
    }
  });
});
