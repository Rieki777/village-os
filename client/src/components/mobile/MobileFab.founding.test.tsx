// @vitest-environment jsdom
/**
 * M4 (go-live design pass): the shortcuts button covered hero words on the
 * founding team's pages on a phone. Those pages keep one act each, so the
 * button stays off them; everywhere else it is still there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/modules/ModuleProvider", () => ({ useModules: () => ({ modules: [] }) }));
vi.mock("@/lib/brochure", () => ({ useStoryPageShown: () => () => true }));

import MobileFab, { isFoundingRoute } from "./MobileFab";

afterEach(cleanup);

function at(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <MobileFab />
    </Router>,
  );
}

describe("the shortcuts button on the founding team's pages", () => {
  it.each(["/roles", "/steward", "/propose-a-role", "/propose-a-role/finance", "/application-status", "/application-status?id=4", "/role-applications/12"])(
    "stays off %s",
    (path) => {
      expect(isFoundingRoute(path)).toBe(true);
      at(path);
      expect(screen.queryByRole("button", { name: /shortcuts/i })).toBeNull();
    },
  );

  it.each(["/", "/quests", "/profile", "/rolesx", "/resident"])("CONTROL: is still offered on %s", (path) => {
    expect(isFoundingRoute(path)).toBe(false);
    at(path);
    expect(screen.getByRole("button", { name: "Open shortcuts" })).toBeTruthy();
  });
});
