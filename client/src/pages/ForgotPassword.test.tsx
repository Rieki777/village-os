// @vitest-environment jsdom
/**
 * "Back to sign in" goes back to the door the member came from. The admin
 * sign-in card links here with `?next=/admin…`; anything that is not an
 * internal path falls back to /login, so a crafted link cannot send anyone
 * offsite from a page about their password.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import ForgotPassword from "./ForgotPassword";

function backLink(search: string): string | null {
  window.history.replaceState({}, "", `/forgot-password${search}`);
  render(<ForgotPassword />);
  return screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href");
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("ForgotPassword", () => {
  it("returns to /login by default", () => {
    expect(backLink("")).toBe("/login");
  });

  it("returns to the admin deep link it was sent from", () => {
    expect(backLink(`?${new URLSearchParams({ next: "/admin?tab=modules&module=saberra" })}`)).toBe(
      "/admin?tab=modules&module=saberra",
    );
  });

  it.each(["//evil.example", "/\\evil.example", "https://evil.example"])("refuses %s as a destination", (next) => {
    expect(backLink(`?${new URLSearchParams({ next })}`)).toBe("/login");
  });
});
