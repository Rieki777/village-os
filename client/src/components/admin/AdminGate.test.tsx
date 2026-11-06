// @vitest-environment jsdom
/**
 * The admin sign-in card, moved out of Admin.tsx and given its two other ways
 * in. What is pinned here:
 *
 *   1. The move kept the S1 behaviour: an admin's token reaches `onAuth`, and a
 *      signed-in member without the role gets the refusal, not the form.
 *   2. "Forgot your password?" tells the reset page it came from the admin,
 *      and the Google button carries the admin's own deep link so the round
 *      trip comes back to the same screen. Google is drawn only where it exists.
 *   3. A refused sign-in says what the server said. The card used to answer
 *      every failure "Wrong email or password.", including the 429 that the
 *      right password also gets once the account's budget is spent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const auth = vi.hoisted(() => ({
  state: { user: null as any, loading: false },
  login: vi.fn(),
  logout: vi.fn(),
}));
const village = vi.hoisted(() => ({ methods: { password: true, google: true, inviteOnly: false } }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ ...auth.state, login: auth.login, logout: auth.logout }),
}));
vi.mock("@/lib/gameApi", () => ({
  authToken: () => "member-token",
  useGameConfig: () => ({ project: { name: "Testville" } }),
}));
vi.mock("@/components/auth/signInMethods", () => ({
  fetchSignInMethods: () => Promise.resolve(village.methods),
}));

import AdminGate, { signInFailure } from "./AdminGate";

// A deep link to one admin screen. (The Module Library tab used to be the
// example; since 2026-10-09 it redirects to the public library before the gate.)
const DEEP_LINK = "/admin?tab=email-settings&from=launch";

beforeEach(() => {
  auth.state = { user: null, loading: false };
  auth.login.mockReset();
  auth.logout.mockReset();
  village.methods = { password: true, google: true, inviteOnly: false };
  window.history.replaceState({}, "", DEEP_LINK);
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("signInFailure", () => {
  it("rewords the credential refusal and says ADMIN_PASSWORD is not this password", () => {
    const said = signInFailure(new Error("Invalid credentials"));
    expect(said).toMatch(/^Wrong email or password\./);
    expect(said).toMatch(/ADMIN_PASSWORD/);
  });

  it("passes the rate limit through, because the right password is refused too", () => {
    expect(signInFailure(new Error("Too many attempts. Try again in a few minutes."))).toBe(
      "Too many attempts. Try again in a few minutes.",
    );
  });

  it("says the village could not be reached when nothing answered", () => {
    expect(signInFailure(new TypeError("Failed to fetch"))).toMatch(/could not reach/i);
    expect(signInFailure(new SyntaxError("Unexpected token '<'"))).toMatch(/could not reach/i);
  });
});

describe("AdminGate", () => {
  it("hands an admin's token to onAuth instead of drawing the form", async () => {
    auth.state = { user: { name: "Rye", role: "founder" }, loading: false };
    const onAuth = vi.fn();
    render(<AdminGate onAuth={onAuth} />);
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith("member-token"));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  // Q5 (Rye, 2026-11-01): a member READS the panel. What it may read is the server's call.
  it("lets a signed-in member without the role read the panel, with no form and no write control", async () => {
    auth.state = { user: { name: "Ash", role: "member" }, loading: false };
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      const body = url.endsWith("capabilities/holding")
        ? { powers: [{ capability: "org.seat", title: "The village's roles", consequence: "seat people", heldBy: null }], roles: [] }
        : url.endsWith("org/expiring")
          ? [{ assignmentId: "a1", roleName: "Land steward", holder: "Jess Okafor", lapsed: false }]
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    try {
      render(<AdminGate onAuth={vi.fn()} />);
      expect(screen.getByRole("heading", { name: "How the village is run" })).toBeInTheDocument();
      expect(await screen.findByText("The village's roles")).toBeInTheDocument();
      // Role (FirstName), never a full name, even for a documented holder sent in full.
      expect(await screen.findByText(/Land steward \(Jess\)/)).toBeInTheDocument();
      expect(screen.queryByText(/Okafor/)).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Not an admin" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
      // Only the reads the server allows members, and every one a GET.
      expect(fetched.sort()).toEqual(["/api/admin/capabilities/holding", "/api/admin/org/drafts", "/api/admin/org/expiring"]);
      // Nothing to press but signing out.
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Sign out and switch accounts"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says in one line that the panel opens to members, when the server refuses every read", async () => {
    auth.state = { user: { name: "Gus", role: "member" }, loading: false };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    try {
      render(<AdminGate onAuth={vi.fn()} />);
      expect(await screen.findByText(/The admin panel opens to members of the village/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("links the forgotten password to the reset page, saying it came from the admin", () => {
    render(<AdminGate onAuth={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Forgot your password?" });
    expect(link).toHaveAttribute("href", "/forgot-password?from=admin");
  });

  it("offers Google on a village that has it, returning to the deep link", async () => {
    render(<AdminGate onAuth={vi.fn()} />);
    const google = await screen.findByRole("link", { name: /continue with google/i });
    const href = new URL(google.getAttribute("href")!, "https://village.test");
    expect(href.pathname).toBe("/api/auth/google/start");
    expect(href.searchParams.get("next")).toBe(DEEP_LINK);
  });

  it("draws no Google button on a village without it", async () => {
    village.methods = { password: true, google: false, inviteOnly: false };
    render(<AdminGate onAuth={vi.fn()} />);
    // Let the methods answer land before asserting the absence.
    await screen.findByRole("link", { name: "Forgot your password?" });
    await Promise.resolve();
    expect(screen.queryByRole("link", { name: /google/i })).not.toBeInTheDocument();
  });

  it("speaks the server's rate-limit refusal rather than calling the password wrong", async () => {
    const user = userEvent.setup();
    auth.login.mockRejectedValue(new Error("Too many attempts. Try again in a few minutes."));
    render(<AdminGate onAuth={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "rye@example.org");
    await user.type(screen.getByLabelText("Password"), "the-right-one");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Try again in a few minutes.");
    expect(auth.login).toHaveBeenCalledWith("rye@example.org", "the-right-one");
  });
});
