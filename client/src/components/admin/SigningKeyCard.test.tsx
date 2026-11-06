// @vitest-environment jsdom
/**
 * The signing key card, rendered (readiness R069): what an admin SEES when the
 * key is stranded, and that nothing can be sent until the confirmation is
 * typed, which is the server's rule shown before the server has to say it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SigningKeyCard from "./SigningKeyCard";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const KEY = { kid: "abcd1234abcd1234", createdAt: "2026-08-31T00:00:00.000Z", canSign: true, confirmWith: "make a new key" };

function stubFetch(read: Record<string, unknown>, write: { ok: boolean; body: unknown } = { ok: true, body: { ok: true, kid: "ffff0000ffff0000" } }) {
  const calls: Array<{ url: string; init: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url: String(url), init });
      const isWrite = (init.method ?? "GET") !== "GET";
      return { ok: isWrite ? write.ok : true, status: isWrite && !write.ok ? 503 : 200, json: async () => (isWrite ? write.body : read) };
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the village signing key card", () => {
  it("says a stranded key is why the signed pages answer 503, and offers a new one", async () => {
    stubFetch({ ...KEY, atRest: "unreadable", canSign: false });
    render(<SigningKeyCard password="t" />);
    await waitFor(() => expect(screen.getByText(/cannot open the key/i)).toBeTruthy());
    expect(screen.getByText(/abcd1234abcd1234/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make a new key" })).toBeTruthy();
  });

  it("says nothing alarming about a sealed key", async () => {
    stubFetch({ ...KEY, atRest: "sealed" });
    render(<SigningKeyCard password="t" />);
    await waitFor(() => expect(screen.getByText(/Village signing key/)).toBeTruthy());
    expect(screen.queryByText(/cannot open the key/i)).toBeNull();
    expect(screen.queryByText(/stored unsealed/i)).toBeNull();
  });

  it("sends nothing until the confirmation is typed, then sends exactly what was typed", async () => {
    const calls = stubFetch({ ...KEY, atRest: "sealed" });
    const user = userEvent.setup();
    render(<SigningKeyCard password="t" />);
    await user.click(await screen.findByRole("button", { name: "Make a new key" }));
    const replace = screen.getByRole("button", { name: "Replace the key" }) as HTMLButtonElement;
    expect(replace.disabled, "the control: nothing typed, nothing to press").toBe(true);
    await user.type(screen.getByLabelText("Type the confirmation"), "make a new key");
    expect(replace.disabled).toBe(false);
    await user.click(replace);
    await waitFor(() => expect(calls.some((c) => c.init.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init.method === "POST")!;
    expect(post.url).toContain("/admin/identity/signing-key/rotate");
    expect(JSON.parse(post.init.body)).toEqual({ confirm: "make a new key" });
  });
});
