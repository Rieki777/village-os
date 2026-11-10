// @vitest-environment jsdom
/**
 * The Roles page's tension section prints the village's own conflict steps.
 *
 * It used to print a compiled process every fork published as its own: a
 * tension went up to a "Leadership Circle" no fork is given, and a change was
 * tried "for an agreed period, then evaluated", which nothing in the platform
 * schedules. It now shows the same village-written restorative steps as
 * /governance (client/src/components/governance/VillageConflictSteps.tsx,
 * whose whole state matrix is exercised in Governance.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

// framer-motion's `whileInView` reaches for IntersectionObserver, which jsdom
// does not implement. A stub that never fires is right: this asks what the
// page renders, not what it animates on scroll.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/AuthContext")>("@/contexts/AuthContext");
  return { ...actual, useIsAdmin: () => false, useAuth: () => ({ user: null }) };
});

import Roles from "./Roles";

const VILLAGE_STEPS = [
  "Talk it through over tea within the week",
  "Ask a listener to sit with you both",
];

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopIntersectionObserver);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/exit-policy") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          policy: { placeholder: false, restorative: { intakeContactRole: "", steps: VILLAGE_STEPS } },
          configured: true,
          platformWording: [],
        }),
      };
    }
    if (url === "/api/org") {
      return { ok: true, status: 200, json: async () => ({ roles: [], circles: [], people: null }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Roles page's tension section", () => {
  it("prints the village's own conflict steps where the compiled process used to be", async () => {
    render(
      <Router>
        <Roles />
      </Router>,
    );

    expect(await screen.findByText(VILLAGE_STEPS[0])).toBeTruthy();
    expect(screen.getByText(VILLAGE_STEPS[1])).toBeTruthy();
    expect(screen.getByRole("heading", { name: "When a Tension Is Between People" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/exit-policy");
    expect(screen.queryByText(/Leadership Circle/)).toBeNull();
    expect(screen.queryByText(/tries the change for an agreed period/)).toBeNull();
  });
});
