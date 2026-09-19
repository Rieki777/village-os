// @vitest-environment jsdom
/**
 * Register carries the same amber CTA link as Login, plus the four PATHS
 * pills - "Investor", "Village Steward", "Resident", "Prosperity Creator" -
 * which this lane also fixed after finding the SAME defect shape live on
 * this page (text-amber and text-teal/text-teal-light used as small
 * foreground text, never checked as text by shared/brandTokens.ts - see the
 * PATHS array's own comments for the measured before/after ratios). Both
 * fixes get a regression guard here, same reasoning as Login.test.tsx.
 *
 * THE FORM WAITS FOR THE VILLAGE'S ANSWER NOW (joining by invitation, Rye
 * 2026-09-09), so every case that reaches for a field finds it rather than
 * getting it: a form that appeared and then gave way to "joining is by
 * invitation" would be the page contradicting itself. `signInMethods` is
 * mocked so each case says which village it is in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import type { ReactNode } from "react";

const registerMock = vi.fn();
const village = vi.hoisted(() => ({ methods: { password: true, google: false, inviteOnly: false } }));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ register: registerMock }),
}));
vi.mock("@/components/auth/signInMethods", () => ({
  fetchSignInMethods: () => Promise.resolve(village.methods),
}));

import Register from "./Register";

function renderRegister() {
  return render(
    <Router>
      <Register />
    </Router>,
  );
}

beforeEach(() => {
  registerMock.mockReset();
  village.methods = { password: true, google: false, inviteOnly: false };
  window.history.replaceState({}, "", "/register");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/register");
});

describe("Register", () => {
  it("labels every field, including the two password fields separately", async () => {
    renderRegister();
    expect(await screen.findByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("refuses to submit when the passwords do not match, without calling register", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(await screen.findByLabelText(/^name$/i), "Rye");
    await user.type(screen.getByLabelText(/^email$/i), "rye@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter2");
    await user.type(screen.getByLabelText(/confirm password/i), "different");
    await user.click(screen.getByRole("button", { name: /investor/i }));
    await user.click(screen.getByRole("button", { name: /create account/i }));

    // findByRole("alert"), not findByText: the box now carries role="alert",
    // the same as Login.tsx's, so the refusal is SPOKEN and not merely
    // painted red. Asserting the role is what makes that a guarantee - the
    // text assertion this replaced passed just as happily while a screen
    // reader said nothing.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/passwords do not match/i);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("refuses to submit with no path chosen, without calling register", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(await screen.findByLabelText(/^name$/i), "Rye");
    await user.type(screen.getByLabelText(/^email$/i), "rye@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter2");
    await user.type(screen.getByLabelText(/confirm password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    // Same role="alert" guarantee as above.
    expect(await screen.findByRole("alert")).toHaveTextContent(/select at least one path/i);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("speaks a registration the server turned down, not just paints it red", async () => {
    // The third thing that lands in that box, and the only one that is not a
    // client-side guard: a rejected register(). Same role, same box.
    registerMock.mockRejectedValueOnce(new Error("That email is already here"));
    const user = userEvent.setup();
    renderRegister();

    await user.type(await screen.findByLabelText(/^name$/i), "Rye");
    await user.type(screen.getByLabelText(/^email$/i), "rye@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter2");
    await user.type(screen.getByLabelText(/confirm password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /investor/i }));
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already here/i);
  });

  it("submits name, email, password and the chosen paths together", async () => {
    registerMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderRegister();

    await user.type(await screen.findByLabelText(/^name$/i), "Rye");
    await user.type(screen.getByLabelText(/^email$/i), "rye@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter2");
    await user.type(screen.getByLabelText(/confirm password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /investor/i }));
    await user.click(screen.getByRole("button", { name: /village steward/i }));
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(registerMock).toHaveBeenCalledWith("Rye", "rye@example.com", "hunter2", ["investor", "steward"]);
  });

  it("keeps the Sign In link off the failing text-amber token (contrast regression guard)", () => {
    renderRegister();
    const signIn = screen.getByRole("link", { name: /sign in/i });
    const classes = signIn.className.split(/\s+/);
    expect(classes).toContain("text-amber-ink");
    expect(classes).not.toContain("text-amber");
  });

  it("keeps the path pills off text-amber/text-teal/text-teal-light as foreground text (contrast regression guard)", async () => {
    // Measured before this lane's fix: text-amber 1.43:1, text-teal (soft)
    // 2.33:1, text-teal-light (mid) 4.20:1 - all below AA's 4.5:1 floor, on
    // this exact page's tint. text-amber-ink and text-teal-deep are the
    // replacements (4.90:1 and 9.5+:1 respectively). This only checks the
    // classes present on the button, not a live contrast computation - the
    // computation lives in shared/brandTokens.ts and this lane's report.
    renderRegister();
    await screen.findByLabelText(/^name$/i);
    // Unanchored: the accessible name is the whole button (label AND
    // description text), not the label alone.
    for (const name of [/investor/i, /village steward/i, /^resident\b/i, /prosperity creator/i]) {
      const pill = screen.getByRole("button", { name });
      const classes = pill.className.split(/\s+/);
      expect(classes, `${name} pill`).not.toContain("text-amber");
      expect(classes, `${name} pill`).not.toContain("text-teal");
      expect(classes, `${name} pill`).not.toContain("text-teal-light");
    }
  });
});

describe("Register, in a village that joins by invitation", () => {
  beforeEach(() => {
    village.methods = { password: true, google: false, inviteOnly: true };
  });

  /** Answer the link check the way the server would, and nothing else. */
  function linkChecksAs(answer: Record<string, unknown>) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => answer });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("holds somebody with no link at the door, and shows them the two ways forward", async () => {
    renderRegister();
    expect(await screen.findByRole("heading", { name: /is by invitation/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^name$/i), "no form to fill in").toBeNull();
    expect(screen.getByRole("link", { name: /ask to join/i })).toHaveAttribute("href", "/request-membership");
    expect(screen.getByRole("link", { name: /see calls and events/i })).toHaveAttribute("href", "/events");
    // Somebody who already belongs is not stranded here.
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("opens the form for somebody holding a good link, says who sent it, and sends the link with the account", async () => {
    window.history.replaceState({}, "", "/register?invite=TOKEN-FROM-WREN");
    const fetchMock = linkChecksAs({ inviteOnly: true, valid: true, invitedBy: "Wren", daysLeft: 12 });
    registerMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderRegister();

    expect(await screen.findByText(/Wren invited you/)).toHaveTextContent(/12 more days/);
    expect(fetchMock).toHaveBeenCalledWith("/api/invites/check?token=TOKEN-FROM-WREN");

    await user.type(screen.getByLabelText(/^name$/i), "Juno");
    await user.type(screen.getByLabelText(/^email$/i), "juno@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter2");
    await user.type(screen.getByLabelText(/confirm password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /resident/i }));
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(registerMock).toHaveBeenCalledWith("Juno", "juno@example.com", "hunter2", ["resident"], "TOKEN-FROM-WREN");
  });

  it("tells somebody whose link no longer works why, in place of the form", async () => {
    window.history.replaceState({}, "", "/register?invite=SPENT");
    linkChecksAs({ inviteOnly: true, valid: false, error: "This invitation has already been used. Ask the person who sent it for a new one." });
    renderRegister();

    expect(await screen.findByRole("alert")).toHaveTextContent(/already been used/);
    expect(screen.getByRole("heading", { name: /is by invitation/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });
});
