// @vitest-environment jsdom
/**
 * MOONS PAST ASKS THE EVENTS API ONLY WHEN EVENTS IS ON, AND ALWAYS ASKS FOR
 * ITS OWN MOONS.
 *
 * The section sits on the gratitude wall, and gratitude is core, so it renders
 * on every village. It made two requests from one effect: the closed moons,
 * which are the section, and `/api/events`, used only to name a moon by the
 * village's own count. On a fresh fork events is off and has no routes, so
 * that second request was refused with a 404 on every visit.
 *
 * THE SECOND CASE IS THE ONE THAT MATTERS. Guarding the shared effect would
 * have silenced the 404 and ALSO stopped the section loading its moons, hiding
 * it on every village with events off. So the fix split the effect, and this
 * file holds both halves: no events request, and the moons still asked for.
 *
 * Counted as requests, never as the absence of an error. The provider's own
 * fetch is replaced as in ModuleGate.test.tsx, and `useModuleOn` runs the REAL
 * `moduleIsOn` over the catalog below.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const catalog = vi.hoisted(() => ({ modules: [] as any[], loaded: true, failed: false }));
vi.mock("@/modules/ModuleProvider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/ModuleProvider")>();
  return {
    ...real,
    useModules: () => ({ ...catalog }),
    useModuleOn: (id: string) => real.moduleIsOn(catalog, id),
  };
});
const EVENTS_ON = { id: "events", name: "Events", description: "", core: false, lifecycle: "public", hyphaLinks: [] };

import MoonsPast from "./MoonsPast";

const asked = (prefix: string) =>
  (fetch as any).mock.calls.filter((c: any[]) => String(c[0]).startsWith(prefix)).length;
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  catalog.modules = [EVENTS_ON];
  catalog.loaded = true;
  catalog.failed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: any) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).startsWith("/api/events") ? { moonOneCycle: 300 } : []),
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe("MoonsPast", () => {
  it("asks for its moons and for the moon count when events is on", async () => {
    render(<MoonsPast currency="credits" />);
    await settle();
    expect(asked("/api/game/cycle/distributions")).toBe(1);
    expect(asked("/api/events")).toBe(1);
  });

  it("still asks for its moons when events is off, and makes no events request", async () => {
    catalog.modules = [];
    render(<MoonsPast currency="credits" />);
    await settle();
    expect(asked("/api/events")).toBe(0);
    // The half a careless guard would have lost: the section's own data.
    expect(asked("/api/game/cycle/distributions")).toBe(1);
  });
});
