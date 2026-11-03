// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AdminSeraChip, SeraAdminHome } from "./AdminSeraLink";

afterEach(() => vi.unstubAllGlobals());

describe("Sera board link", () => {
  it("shows the chip for a steward and hides it otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ viewer: { mode: "steward" } }) })));
    const steward = render(<AdminSeraChip password="tok" />);
    expect((await screen.findByRole("link", { name: "Sera board" })).getAttribute("href")).toBe("/modules/saberra");
    steward.unmount();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ viewer: { mode: "member" } }) })));
    render(<AdminSeraChip password="tok" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Sera board" })).toBeNull();
  });

  it("points back at the board from admin", () => {
    render(<SeraAdminHome />);
    expect(screen.getByRole("link", { name: "Open the Sera board" }).getAttribute("href")).toBe("/modules/saberra");
  });
});
