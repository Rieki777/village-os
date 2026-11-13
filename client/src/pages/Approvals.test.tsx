// @vitest-environment jsdom
/** /approvals asks for nothing while nobody is signed in: no request, so no 401 in the console. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const auth = vi.hoisted(() => ({ value: { loading: false, user: null } as { loading: boolean; user: unknown } }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useOptionalAuth: () => auth.value }));
vi.mock("@/lib/gameApi", () => ({ authToken: () => "" }));
vi.mock("@/components/approvals/ApprovalInbox", () => ({
  default: () => {
    void fetch("/api/approval-inbox");
    return <p>inbox</p>;
  },
}));

import Approvals from "./Approvals";

afterEach(() => vi.unstubAllGlobals());

describe("/approvals", () => {
  it("makes no request for a signed-out visitor", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    auth.value = { loading: false, user: null };
    render(<Approvals />);
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("waits while the session is read", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    auth.value = { loading: true, user: null };
    render(<Approvals />);
    expect(f).not.toHaveBeenCalled();
  });

  it("reads the inbox for a signed-in member", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    auth.value = { loading: false, user: { id: "u1" } };
    render(<Approvals />);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
