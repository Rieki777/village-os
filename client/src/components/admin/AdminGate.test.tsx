// @vitest-environment jsdom
/**
 * The admin sign-in card, moved out of Admin.tsx and given its two other ways
 * in. What is pinned here:
 *
 *   1. The move kept the S1 behaviour: an admin's token reaches `onAuth`, and a
 *      signed-in member without the role gets the refusal, not the form.
 *   2. "Forgot your password?" and the Google button both carry the admin's
 *      own deep link, so the reset and the round trip come back to the same
 *      screen. The Google button is drawn only on a village that has Google.
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

const DEEP_LINK = "/admin?tab=modules&module=saberra";

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

  it("refuses a signed-in member without the role", () => {
    auth.state = { user: { name: "Ash", role: "member" }, loading: false };
    render(<AdminGate onAuth={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Not an admin" })).toBeInTheDocument();
  });

  it("links the forgotten password to the reset page, carrying the deep link", () => {
    render(<AdminGate onAuth={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Forgot your password?" });
    const href = new URL(link.getAttribute("href")!, "https://village.test");
    expect(href.pathname).toBe("/forgot-password");
    expect(href.searchParams.get("next")).toBe(DEEP_LINK);
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
