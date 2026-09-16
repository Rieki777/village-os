// @vitest-environment jsdom
/**
 * The invitation panel at the top of a member's own profile.
 *
 * The states worth pinning are the ones a member would misread: nothing drawn
 * while the answer is unknown, the reason in place of a button when the gate
 * would refuse, the link shown once and only after the server made it, and the
 * server's own sentence when it says no.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const gameFetch = vi.fn();
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...args: unknown[]) => gameFetch(...args) }));

import InvitePanel, { type InviteList } from "./InvitePanel";

/** A response as the panel reads one: `ok` and a JSON body. */
const answer = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

const list = (over: Partial<InviteList> = {}): InviteList => ({
  mayInvite: true,
  closed: null,
  days: 14,
  cap: 20,
  open: 0,
  invites: [],
  ...over,
});

beforeEach(() => {
  gameFetch.mockReset();
});

describe("InvitePanel", () => {
  it("draws nothing when the list cannot be read", async () => {
    gameFetch.mockReturnValueOnce(answer({ error: "unavailable" }, 500));
    const { container } = render(<InvitePanel />);
    await waitFor(() => expect(gameFetch).toHaveBeenCalledWith("/api/me/invites"));
    expect(container).toBeEmptyDOMElement();
  });

  it("says what opens inviting to somebody the gate would refuse, and offers no button", async () => {
    gameFetch.mockReturnValueOnce(answer(list({ mayInvite: false, closed: "Inviting somebody opens at Contributor." })));
    render(<InvitePanel />);
    expect(await screen.findByText(/opens at Contributor/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /make an invitation link/i })).toBeNull();
  });

  it("makes a link, shows it with a way to copy it, and reads the list back", async () => {
    gameFetch
      .mockReturnValueOnce(answer(list()))
      .mockReturnValueOnce(answer({ id: "inv-1", path: "/register?invite=TOKEN", expiresInDays: 14 }))
      .mockReturnValueOnce(answer(list({ open: 1, invites: [{ id: "inv-1", standing: "open", daysLeft: 14, usedBy: null }] })));
    const user = userEvent.setup();
    render(<InvitePanel />);

    // No link exists before anybody asked for one.
    expect(screen.queryByLabelText(/your invitation link/i)).toBeNull();
    await user.click(await screen.findByRole("button", { name: /make an invitation link/i }));

    const field = (await screen.findByLabelText(/your invitation link/i)) as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/register?invite=TOKEN`);
    expect(gameFetch).toHaveBeenCalledWith("/api/invites", expect.objectContaining({ method: "POST" }));
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(await screen.findByText(/14 days left/)).toBeInTheDocument();
  });

  it("shows the server's own sentence when a link cannot be made, and shows no link", async () => {
    gameFetch
      .mockReturnValueOnce(answer(list()))
      .mockReturnValueOnce(answer({ error: "You have 20 invitations nobody has used yet." }, 409));
    const user = userEvent.setup();
    render(<InvitePanel />);
    await user.click(await screen.findByRole("button", { name: /make an invitation link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/20 invitations nobody has used yet/);
    expect(screen.queryByLabelText(/your invitation link/i)).toBeNull();
  });

  it("names who used a link, and offers to withdraw only the one still waiting", async () => {
    const used = { id: "inv-used", standing: "used" as const, daysLeft: 0, usedBy: { name: "Wren", handle: "wren" } };
    const gone = { id: "inv-gone", standing: "revoked" as const, daysLeft: 0, usedBy: null };
    gameFetch
      .mockReturnValueOnce(answer(list({ open: 1, invites: [used, { id: "inv-open", standing: "open", daysLeft: 3, usedBy: null }, gone] })))
      .mockReturnValueOnce(answer({ revoked: true }))
      .mockReturnValueOnce(answer(list({ invites: [used, { id: "inv-open", standing: "revoked", daysLeft: 0, usedBy: null }, gone] })));
    const user = userEvent.setup();
    render(<InvitePanel />);

    expect(await screen.findByRole("link", { name: /used by wren/i })).toHaveAttribute("href", "/profile/wren");
    const withdraw = screen.getAllByRole("button", { name: /withdraw/i });
    expect(withdraw).toHaveLength(1);

    await user.click(withdraw[0]);
    await waitFor(() =>
      expect(gameFetch).toHaveBeenCalledWith("/api/invites/inv-open/revoke", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /withdraw/i })).toHaveLength(0));
  });
});
