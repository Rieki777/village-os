// @vitest-environment jsdom
/**
 * ModuleGate is the one gate every module page renders when its module is
 * invisible to the current viewer (R36). Its own header comment spells out
 * a real product incident it exists to prevent: "the catalog is unknown" is
 * NOT the same fact as "every module is off", and conflating them made a
 * dropped manifest request render ten working pages as 404s. These tests
 * hold that distinction, and the loading-race / signed-in-never-told-to-
 * sign-in rules right below it, so a future edit that quietly collapses any
 * of the four states back together fails here instead of shipping.
 *
 * `useModules`, `useAuth` and `useGameConfig` are mocked rather than driven
 * through their real providers: this component's whole job is choosing which
 * of four cards to show given a manifest/session state, and the real
 * providers each do their own network fetching, which is a different
 * component's contract to test. `Layout` is mocked to a passthrough so a
 * test failure here points at ModuleGate, not at the site shell it happens
 * to render inside.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import type { ReactNode } from "react";

const useModulesMock = vi.fn();
const useAuthMock = vi.fn();
const useGameConfigMock = vi.fn();

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/modules/ModuleProvider", () => ({
  useModules: () => useModulesMock(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));
vi.mock("@/lib/gameApi", () => ({
  useGameConfig: () => useGameConfigMock(),
}));

import ModuleGate from "./ModuleGate";

function renderGate(props: { moduleId: string; name: string }) {
  return render(
    <Router>
      <ModuleGate {...props} />
    </Router>,
  );
}

const BASE_MODULES = { modules: [], hypha: { configured: false, orgUrl: "", links: {} }, signInToSee: [], loaded: true, failed: false, refresh: vi.fn() };

describe("ModuleGate", () => {
  it("says the catalog could not be read, and does NOT claim the module is off", () => {
    // The exact incident the component's own comment names: a failed fetch
    // must never be reported as "this village hasn't enabled this module" -
    // that is a false statement about WHY the reader cannot see it.
    useModulesMock.mockReturnValue({ ...BASE_MODULES, failed: true, loaded: false });
    useAuthMock.mockReturnValue({ user: null, loading: false });
    useGameConfigMock.mockReturnValue(null);

    renderGate({ moduleId: "forum", name: "Forum" });

    expect(screen.getByText(/didn.t load/i)).toBeInTheDocument();
    expect(screen.queryByText(/hasn.t opened this room/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("offers both doors to a signed-out visitor when the module is sign-in-to-see", () => {
    useModulesMock.mockReturnValue({ ...BASE_MODULES, signInToSee: ["forum"] });
    useAuthMock.mockReturnValue({ user: null, loading: false });
    useGameConfigMock.mockReturnValue(null);

    renderGate({ moduleId: "forum", name: "Forum" });

    expect(screen.getByText(/opens when you sign in/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/login?next="),
    );
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute("href", "/register");
  });

  it("holds a quiet loader while the session is still being read, never a sign-in prompt", () => {
    // AuthProvider reads the token synchronously and the user asynchronously,
    // so there is a real window where `token` exists and `user` does not.
    // Rendering "Sign in" during that window is the bug this state guards.
    useModulesMock.mockReturnValue({ ...BASE_MODULES, signInToSee: ["forum"] });
    useAuthMock.mockReturnValue({ user: null, loading: true });
    useGameConfigMock.mockReturnValue(null);

    renderGate({ moduleId: "forum", name: "Forum" });

    expect(screen.queryByText(/opens when you sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^sign in$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("never tells an already-signed-in member to sign in - falls through to the module-off card", () => {
    useModulesMock.mockReturnValue({ ...BASE_MODULES, signInToSee: ["forum"] });
    useAuthMock.mockReturnValue({ user: { id: "u1", name: "Rye" }, loading: false });
    useGameConfigMock.mockReturnValue({ project: { name: "Riverbend" } });

    renderGate({ moduleId: "forum", name: "Forum" });

    expect(screen.queryByText(/opens when you sign in/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Riverbend hasn.t opened this room/i)).toBeInTheDocument();
  });

  it("names the village by its configured name, not a hardcoded one, when a module is off", () => {
    useModulesMock.mockReturnValue({ ...BASE_MODULES, signInToSee: [] });
    useAuthMock.mockReturnValue({ user: null, loading: false });
    useGameConfigMock.mockReturnValue({ project: { name: "Riverbend" } });

    renderGate({ moduleId: "quests", name: "Quests" });

    expect(screen.getByText(/Riverbend hasn.t opened this room/i)).toBeInTheDocument();
    // The ruled sentence (R56/R43 Q8): says WHO can turn it on, never invites
    // a proposal - no member-authored proposal kind touches a lifecycle.
    expect(screen.queryByText(/make a proposal/i)).not.toBeInTheDocument();
    expect(screen.getByText(/only the team running the village can/i)).toBeInTheDocument();
  });

  it("falls back to a generic name when no project config has loaded yet", () => {
    useModulesMock.mockReturnValue({ ...BASE_MODULES, signInToSee: [] });
    useAuthMock.mockReturnValue({ user: null, loading: false });
    useGameConfigMock.mockReturnValue(null);

    renderGate({ moduleId: "quests", name: "Quests" });

    expect(screen.getByText(/This village hasn.t opened this room/i)).toBeInTheDocument();
  });
});
