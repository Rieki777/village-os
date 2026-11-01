// @vitest-environment jsdom
/**
 * /circles and /roles name the circle the others link back to from the
 * village's own rows (shared/coordinatingCircle.ts).
 *
 * Both pages typed "the General Coordinating Circle" into their copy, so a new
 * village, whose circles are flat, read one village's top circle on its own
 * pages. Each promise below has its known positive beside it: the village's
 * own top circle is named where its circles nest under one, and no circle is
 * named where they do not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/CircleScene", () => ({ default: () => null }));
vi.mock("@/components/CirclesMiniMap", () => ({ default: () => null }));
vi.mock("@/components/SeatClaimCard", () => ({ default: () => null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, token: null, loading: false }),
  useIsAdmin: () => false,
}));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authToken: () => null,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModule: () => undefined,
  useModuleOn: () => false,
}));
vi.mock("@/components/natural/useReducedMotion", () => ({
  useReducedMotion: () => true,
  prefersReducedMotion: () => true,
}));

import Circles from "./Circles";
import Roles from "./Roles";

class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const circle = (id: string, name: string, parentCircleId: string | null) => ({
  id,
  name,
  purpose: `What ${name} looks after`,
  parentCircleId,
  decidesBy: null,
  color: "sage",
  status: "active",
  isExample: false,
});

const seat = (id: string, name: string, circleId: string) => ({
  id,
  name,
  circleId,
  aim: `Keep the ${name.toLowerCase()} work going.`,
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  seats: 1,
  holderCount: 0,
  state: "open",
  stateSource: "derived",
  criticality: "normal",
  recruiting: true,
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: "2027-02-01T12:00:00.000Z",
  archetypes: [],
  isExample: false,
  holders: [],
});

/** A village whose circles nest under one it calls the Hearth Council. */
const NESTED = {
  people: { visible: true, membersOnly: false, signedIn: false },
  village: { decidesBy: "consent" },
  circles: [circle("hearth", "Hearth Council", null), circle("land", "Land & Water", "hearth")],
  roles: [seat("keeper", "Fire Keeper", "hearth"), seat("water", "Water Keeper", "land")],
};

/** A new village: flat circles, nobody's top circle. */
const FLAT = {
  ...NESTED,
  circles: [circle("land", "Land & Water", null), circle("care", "Care Circle", null)],
  roles: [seat("water", "Water Keeper", "land"), seat("nurse", "Night Nurse", "care")],
};

let org: typeof NESTED;

beforeEach(() => {
  org = NESTED;
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (u === "/api/org") return reply(org);
      if (u === "/api/season") return reply({ current: { name: "Season of Foundations", endsOn: "2099-03-21" }, daysLeft: 171 });
      return reply([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const page = (node: ReactNode) => render(<Router>{node}</Router>);

describe("/circles", () => {
  it("names the village's own top circle where its circles nest under one", async () => {
    page(<Circles />);
    fireEvent.click((await screen.findByRole("heading", { level: 3, name: "Land & Water" })).closest("button")!);

    const text = document.body.textContent ?? "";
    expect(text).toContain("is double-linked to the Hearth Council so information flows both ways.");
    expect(text).toContain("When decisions affect multiple circles, the Hearth Council,");
    expect(text).toContain("Every circle is double-linked to the Hearth Council by two people");
    expect(text).not.toContain("General Coordinating Circle");
  });

  it("never tells the top circle it is linked to itself", async () => {
    page(<Circles />);
    fireEvent.click((await screen.findByRole("heading", { level: 3, name: "Hearth Council" })).closest("button")!);

    expect(document.body.textContent).not.toContain("double-linked to the Hearth Council so information flows");
    expect(screen.getByText(/Each circle has autonomy within its domain and budget and uses consent-based decision-making\./)).toBeInTheDocument();
  });

  it("names no circle in a village whose circles are flat", async () => {
    org = FLAT;
    page(<Circles />);
    fireEvent.click((await screen.findByRole("heading", { level: 3, name: "Land & Water" })).closest("button")!);

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("General Coordinating Circle");
    expect(text).not.toContain("double-linked to the");
    expect(text).toContain("When decisions affect multiple circles, the circles involved decide together.");
  });
});

describe("/roles", () => {
  it("names the village's own top circle where its circles nest under one", async () => {
    page(<Roles />);
    await screen.findByRole("heading", { level: 3, name: "Water Keeper" });

    expect(screen.getByText(/and links back to the Hearth Council\.$/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("General Coordinating Circle");
  });

  it("names no circle in a village whose circles are flat", async () => {
    org = FLAT;
    page(<Roles />);
    await screen.findByRole("heading", { level: 3, name: "Water Keeper" });

    expect(screen.getByText("Working groups with real authority. Each circle has an aim (what it works toward) and a domain (what it decides on).")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("links back to");
  });
});
