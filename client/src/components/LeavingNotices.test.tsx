// @vitest-environment jsdom
/**
 * WHAT LEAVING CANCELS, before the member confirms (round 3, finding 5).
 *
 * The delete panel and the departure page read the member's own notices and
 * show each sentence the server wrote, with the member's token on the read.
 * A member with nothing to cancel, or whose read failed, sees nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LeavingNotices, { useLeavingNotices } from "./LeavingNotices";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "tok-member" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SENTENCE =
  "1 recurring payment(s) still renewing through Stripe: Monthly membership (every month). " +
  "Deleting the account cancels each one in Stripe, and nothing already paid is refunded";

function Probe({ enabled = true, path }: { enabled?: boolean; path?: "delete" | "exit" }) {
  return <LeavingNotices notices={useLeavingNotices(enabled, path)} />;
}

describe("the notice before the delete", () => {
  it("shows the server's sentence, read with the member's own token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ notices: [{ domain: "subscriptions", count: 1, description: SENTENCE, blocking: false }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe />);
    expect(await screen.findByText(`${SENTENCE}.`)).toBeTruthy();
    expect(screen.getByText("Recurring payments")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/profile/leaving-notices");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-member");
  });

  it("asks for the departure's sentence on the departure page (round 4, finding 1)", async () => {
    // A departure keeps a member who holds tokens as a former member, and resolving it
    // cancels the payments (ruling 8); only the server knows which act, so the page says where it is.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ notices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe path="exit" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/profile/leaving-notices?for=exit");
  });

  it("reads nothing until the panel opens", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<Probe enabled={false} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("CONTROL: a member with nothing to cancel sees nothing", () => {
    const { container } = render(<LeavingNotices notices={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
