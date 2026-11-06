// @vitest-environment jsdom
/**
 * Asking to join, for somebody nobody has invited yet.
 *
 * Two promises are pinned: the request lands in the queue as the type the
 * server allows, and the page that thanks somebody sends them on to the calls
 * and events instead of leaving them nowhere. A refusal is spoken, and what
 * they typed survives it. And somebody asking while signed in sends their
 * token, so the row names their account.
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
import { TOKEN_KEY } from "@/lib/gameApi";

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
    // The consent box reads its words first (/api/comms/consent), so find the submit by its address.
    const submit = fetchMock.mock.calls.find((c) => c[0] === "/api/forms/submit");
    const sent = JSON.parse(String(submit?.[1]?.body));
    expect(sent.type).toBe("membership-request");
    expect(sent.hp).toBe("");
    expect(sent.data).toMatchObject({ name: "Juno Reed", email: "juno@example.test" });

    expect(await screen.findByRole("heading", { name: /thank you, juno/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see calls and events/i })).toHaveAttribute("href", "/events");
  });

  it("moves focus to the thanks, since the button that sent it is gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }));
    render(<RequestMembership />);

    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: /send my request/i }));

    const thanks = await screen.findByRole("heading", { name: /thank you, juno/i });
    expect(document.activeElement).toBe(thanks);
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

/**
 * ASKING WHILE SIGNED IN NAMES THE ACCOUNT.
 *
 * The server stamps `userId` on a submission from the `Authorization` header
 * alone, and this page sent none, so a signed-in guest's request named nobody.
 * Signed in here means what it means in the app: a session token stored under
 * TOKEN_KEY, read through `authToken`.
 */
describe("RequestMembership, signed in", () => {
  afterEach(() => {
    localStorage.removeItem(TOKEN_KEY);
  });

  async function send() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<RequestMembership />);
    const user = await fillIn();
    await user.click(screen.getByRole("button", { name: /send my request/i }));
    await screen.findByRole("heading", { name: /thank you, juno/i });
    const submit = fetchMock.mock.calls.find((c) => c[0] === "/api/forms/submit");
    return submit?.[1] as RequestInit;
  }

  it("a guest who is signed in sends their token, so the request names their account", async () => {
    localStorage.setItem(TOKEN_KEY, "guest-session-token");
    const sent = await send();
    expect(sent.headers).toMatchObject({ Authorization: "Bearer guest-session-token", "Content-Type": "application/json" });
    expect(JSON.parse(String(sent.body)).type).toBe("membership-request");
  });

  it("CONTROL: somebody with no session sends no token, and the request is the stranger's it always was", async () => {
    const sent = await send();
    expect(sent.headers).not.toHaveProperty("Authorization");
    expect(sent.headers).toMatchObject({ "Content-Type": "application/json" });
  });
});
