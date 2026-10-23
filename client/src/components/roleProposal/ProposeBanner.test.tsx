// @vitest-environment jsdom
/**
 * The profile banner that asks a member to propose their roles for next
 * season (role proposals PR B).
 *
 * What is pinned: it draws "Propose your roles for next season" with the one
 * reason the server says, for each of the three reasons, linking where the
 * payload says; it draws nothing when no nudge is due, when the read fails,
 * or when the payload is not one it can read; and signed out it asks the
 * server nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";

const session = vi.hoisted(() => ({ token: "t" as string | null }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gameApi", () => ({
  authToken: () => session.token,
  gameFetch: (...args: unknown[]) => fetchMock(...args),
}));

import ProposeBanner, { NUDGE_URL } from "./ProposeBanner";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const nudge = (reason: string | null, show = true) => ({ show, reason, heading: "x", reasonWords: "x", href: "/propose?type=role_application", linkWords: "x" });

const draw = () =>
  render(
    <Router>
      <ProposeBanner />
    </Router>,
  );

describe("the propose banner", () => {
  beforeEach(() => {
    session.token = "t";
    fetchMock.mockReset();
  });
  afterEach(cleanup);

  it.each([
    ["window-open", "The window is open"],
    ["review-due", "Your review is due"],
    ["window-closing", "The window closes in 2 business days"],
  ])("says why for %s, and links where the payload says", async (reason, words) => {
    fetchMock.mockResolvedValue(ok(nudge(reason)));
    draw();
    expect(await screen.findByText("Propose your roles for next season")).toBeTruthy();
    expect(screen.getByText(words)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Propose my roles/ });
    expect(link.getAttribute("href")).toBe("/propose?type=role_application");
    expect(fetchMock).toHaveBeenCalledWith(NUDGE_URL);
  });

  it("draws nothing when no nudge is due", async () => {
    fetchMock.mockResolvedValue(ok(nudge(null, false)));
    const { container } = draw();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("draws nothing when the read fails or answers something it cannot read", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "module_disabled" }) });
    const off = draw();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(off.container.textContent).toBe("");
    cleanup();
    fetchMock.mockResolvedValue(ok({ show: true, reason: "made-up", href: "/x" }));
    const odd = draw();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(odd.container.textContent).toBe("");
  });

  it("asks nothing while nobody is signed in", async () => {
    session.token = null;
    const { container } = draw();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
