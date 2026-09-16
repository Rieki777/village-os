// @vitest-environment jsdom
/**
 * Asking to join, for somebody nobody has invited yet.
 *
 * Two promises are pinned: the request lands in the queue as the type the
 * server allows, and the page that thanks somebody sends them on to the calls
 * and events instead of leaving them nowhere. A refusal is spoken, and what
 * they typed survives it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Hollow Oak" }));

import RequestMembership from "./RequestMembership";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^name$/i), "Juno Reed");
  await user.type(screen.getByLabelText(/^email$/i), "juno@example.test");
  await user.type(screen.getByLabelText(/what draws you/i), "I grow seed crops and would like to help.");
  return user;
}

describe("RequestMembership", () => {
  it("sends a membership request, and points somebody at the calls and events once it lands", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RequestMembership />);

    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: /send my request/i }));

    expect(fetchMock).toHaveBeenCalledWith("/api/forms/submit", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(sent.type).toBe("membership-request");
    expect(sent.hp).toBe("");
    expect(sent.data).toMatchObject({ name: "Juno Reed", email: "juno@example.test" });

    expect(await screen.findByRole("heading", { name: /thank you, juno/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see calls and events/i })).toHaveAttribute("href", "/events");
  });

  it("says a refusal out loud and keeps what was typed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<RequestMembership />);

    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: /send my request/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/did not send/i);
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("Juno Reed");
    expect(screen.queryByRole("heading", { name: /thank you/i })).toBeNull();
  });
});
