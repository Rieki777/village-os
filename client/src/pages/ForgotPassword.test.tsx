// @vitest-environment jsdom
/**
 * "Back to sign in" goes back to the door the member came from, chosen from
 * two fixed paths. The admin sign-in card links here with `?from=admin`.
 * Nothing from the URL becomes the link: a `next` path was tried first and
 * CodeQL refused it, because a browser drops a tab from a URL and
 * `/<tab>/evil.example` passes every startsWith check while landing offsite.
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

  it("returns to the admin card when it came from there", () => {
    expect(backLink("?from=admin")).toBe("/admin");
  });

  it.each(["?from=elsewhere", "?next=%2Fadmin", "?next=%2F%09%2Fevil.example", "?from=%2F%2Fevil.example"])(
    "never takes a destination from %s",
    (search) => {
      expect(backLink(search)).toBe("/login");
    },
  );
});
