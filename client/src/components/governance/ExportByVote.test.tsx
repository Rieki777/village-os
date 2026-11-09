// @vitest-environment jsdom
/**
 * The two faces of an export by vote, rendered: the ask on Decisions and the
 * one download on the decision. What a member SEES, and what each button sends.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AskForExport, ExportDelivery } from "./ExportByVote";

type Reply = { ok: boolean; body: unknown };
function stubFetch(route: (url: string, init: any) => Reply) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url: String(url), init });
      const r = route(String(url), init);
      return { ok: r.ok, status: r.ok ? 200 : 403, json: async () => r.body, blob: async () => new Blob(["x"]) };
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the download on the decision", () => {
  it("offers the named steward the one download, and sends it with the member's request", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
    const calls = stubFetch((url) =>
      url.endsWith("/standing") ? { ok: true, body: { granted: true, forYou: true, stewardLive: true, deliveredAt: null } } : { ok: true, body: {} },
    );
    const user = userEvent.setup();
    render(<ExportDelivery ballotId="bal-1" />);
    await user.click(await screen.findByRole("button", { name: "Download the copy" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/bal-1/download"))).toBe(true));
  });

  it("tells everyone else it went, and offers nobody a second one", async () => {
    stubFetch(() => ({ ok: true, body: { granted: true, forYou: false, stewardLive: true, deliveredAt: "2026-11-06T10:00:00.000Z" } }));
    render(<ExportDelivery ballotId="bal-1" />);
    await waitFor(() => expect(screen.getByText(/downloaded on 2026-11-06 10:00 UTC/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Download the copy" })).toBeNull();
  });

  it("shows nothing on a decision that authorised nothing", async () => {
    stubFetch(() => ({ ok: true, body: { granted: false, forYou: false, stewardLive: false, deliveredAt: null } }));
    const { container } = render(<ExportDelivery ballotId="bal-1" />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});

describe("the ask on Decisions", () => {
  it("names a sitting steward and a reason, and sends only those", async () => {
    const calls = stubFetch((url) =>
      url.endsWith("/stewards")
        ? { ok: true, body: { stewards: [{ userId: "u-ada", label: "Steward (Ada)" }] } }
        : { ok: true, body: { ballot: { id: "bal-9" } } },
    );
    const user = userEvent.setup();
    render(<AskForExport />);
    await user.click(screen.getByRole("button", { name: "Ask the village for one copy of its database" }));
    const ask = screen.getByRole("button", { name: "Ask the village" }) as HTMLButtonElement;
    expect(ask.disabled, "the control: nothing chosen").toBe(true);
    await user.selectOptions(await screen.findByRole("combobox"), "u-ada");
    await user.type(screen.getByRole("textbox"), "The password holder has left the village.");
    expect(ask.disabled).toBe(false);
    await user.click(ask);
    await waitFor(() => expect(screen.getByRole("link", { name: "Read it and vote" }).getAttribute("href")).toBe("/decisions/bal-9"));
    const post = calls.find((c) => c.init.method === "POST")!;
    expect(JSON.parse(post.init.body)).toEqual({ stewardUserId: "u-ada", reason: "The password holder has left the village." });
  });
});
