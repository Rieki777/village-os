// @vitest-environment jsdom
/**
 * Login is the page this whole programme's UI lane opened on: "every member
 * of every village passes through" it, and its amber call-to-action measured
 * 1.32:1 against the real page background before this lane's fix (see
 * client/src/index.css's amber-ink comment for the full measurement). These
 * tests hold two different things: the accessible-name/labelling contract
 * the file's own comments call out as load-bearing, and a REGRESSION GUARD
 * for the contrast fix itself - a future edit that quietly reintroduces
 * `text-amber` on this link should fail here, not wait for a human with a
 * contrast meter to notice.
 *
 * `Layout` is mocked to a passthrough: this file's job is the form and the
 * CTA link, not the site shell it renders inside (nav, footer, mobile menu -
 * covered by their own future tests, not duplicated here).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import type { ReactNode } from "react";

const loginMock = vi.fn();

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ login: loginMock }),
}));

import Login from "./Login";

function renderLogin() {
  return render(
    <Router>
      <Login />
    </Router>,
  );
}

describe("Login", () => {
  it("labels both fields so a screen reader announces them, not 'edit text, blank'", () => {
    renderLogin();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("submits the entered credentials to AuthContext's login", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/^email$/i), "rye@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(loginMock).toHaveBeenCalledWith("rye@example.com", "hunter2");
  });

  it("speaks a failed sign-in instead of only showing it - role=alert", async () => {
    loginMock.mockRejectedValueOnce(new Error("Wrong password"));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/^email$/i), "rye@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password");
  });

  it("keeps the Create an account link off the failing text-amber token (contrast regression guard)", () => {
    // The exact defect this lane measured and fixed: text-amber on this
    // page's background reads 1.32:1 against the real body colour, nowhere
    // near AA's 4.5:1 floor. amber-ink (index.css) is the replacement,
    // measured 5.01:1 on the same background. This assertion is a tripwire:
    // if `text-amber` (without `-ink`) ever comes back on this link, this
    // test fails before a person has to notice with a contrast meter.
    renderLogin();
    const createAccount = screen.getByRole("link", { name: /create an account/i });
    const classes = createAccount.className.split(/\s+/);
    expect(classes).toContain("text-amber-ink");
    expect(classes).not.toContain("text-amber");
  });
});
