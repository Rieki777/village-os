// @vitest-environment jsdom
/**
 * The claim page exists because two people have been locked out of their own
 * village this year, and both lockouts lasted days for the same reason: the
 * thing that refused them did not say which thing it was.
 *
 * So the contract these tests hold is not "the form submits". It is that every
 * refusal this endpoint can return produces a DIFFERENT, actionable sentence,
 * and that the bootstrap password never leaves the request body. A page that
 * answered all five refusals with "something went wrong" would pass a naive
 * render test and reproduce the outage it was built to end.
 *
 * `Layout` is mocked to a passthrough: the site shell is not what is under
 * test here.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import Bootstrap from "./Bootstrap";

function renderPage() {
  return render(
    <Router>
      <Bootstrap />
    </Router>,
  );
}

/** Fill the form and submit. Returns the fetch mock's recorded call. */
async function claim(fetchMock: ReturnType<typeof vi.fn>) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/your email/i), "founder@example.com");
  await user.type(screen.getByLabelText(/bootstrap password/i), "the-shared-word");
  await user.click(screen.getByRole("button", { name: /claim this village/i }));
  return fetchMock.mock.calls[0];
}

function mockFetch(status: number, body: unknown) {
  const f = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("claiming a village", () => {
  beforeEach(() => vi.restoreAllMocks());
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("sends the password in the body and never in the URL", async () => {
    const f = mockFetch(200, { emailed: true });
    renderPage();
    const [url, init] = await claim(f);

    expect(String(url)).toBe("/api/admin/bootstrap");
    expect(String(url)).not.toContain("the-shared-word");
    // The whole point: a credential in a query string lands in server logs,
    // browser history and any proxy in between.
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      email: "founder@example.com",
      password: "the-shared-word",
    });
  });

  it("shows the claim link when no mail provider is configured", async () => {
    // The state EVERY fresh village boots in, and the one that stranded an
    // operator for two days when the server answered a bare emailed:true.
    const f = mockFetch(200, {
      emailed: false,
      emailNote: "No email provider is configured on this deployment, so nothing was sent.",
      claimUrl: "https://village.example/set-password?token=abc123",
    });
    renderPage();
    await claim(f);

    expect(screen.getByText(/no email provider is configured/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set-password\?token=abc123/i });
    expect(link).toHaveAttribute("href", "https://village.example/set-password?token=abc123");
  });

  /**
   * Each refusal gets its own next step. These four assertions are the
   * regression guard: collapsing any two of them back into one generic message
   * is the defect this page was built to remove.
   */
  it.each([
    [503, "no bootstrap password set", /ADMIN_PASSWORD to the environment/i],
    [401, "auth_required", /not this deployment's bootstrap password/i],
    [403, "Already bootstrapped.", /BREAK_GLASS_ADMIN_EMAIL/i],
    [409, "standing example identity", /real address of your own/i],
  ])("answers %i with the step that actually unblocks the founder", async (status, err, hint) => {
    const f = mockFetch(status as number, { error: err });
    renderPage();
    await claim(f);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(hint as RegExp);
  });

  it("does not claim success when the server refuses", async () => {
    const f = mockFetch(403, { error: "Already bootstrapped." });
    renderPage();
    await claim(f);

    // A page that showed "you are the founder" over a 403 would be the
    // save-honesty defect this codebase has a whole guard for.
    expect(screen.queryByText(/you are this village/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /claim this village/i })).toBeInTheDocument();
  });
});
