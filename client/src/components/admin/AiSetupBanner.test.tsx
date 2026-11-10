// @vitest-environment jsdom
/**
 * "Set up your AI guide first": shown only while no AI can answer, at the top
 * of Admin Home and Make This Yours, and quiet for a village that switched the
 * helper off on purpose.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiSetupBanner from "./AiSetupBanner";

afterEach(() => vi.unstubAllGlobals());

describe("the AI setup banner", () => {
  it("asks for the key first when no AI is connected, and both buttons go somewhere", async () => {
    const onOpenTab = vi.fn();
    const onOpenHelper = vi.fn();
    render(<AiSetupBanner password="pw" onOpenTab={onOpenTab} onOpenHelper={onOpenHelper} initialStatus={{ on: false, guide: "Maia", off: "key", provider: null, available: [], names: {} }} />);
    expect(screen.getByRole("heading", { name: "Set up your AI guide first" })).toBeTruthy();
    expect(screen.getByText(/Maia helps you through the rest of setup/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add your Anthropic key" }));
    expect(onOpenTab).toHaveBeenCalledWith("integrations");
    await userEvent.click(screen.getByRole("button", { name: "Show me how" }));
    expect(onOpenHelper).toHaveBeenCalled();
  });

  it("is gone once an AI can answer, Claude or Sera", () => {
    const { rerender } = render(<AiSetupBanner password="pw" onOpenTab={vi.fn()} onOpenHelper={vi.fn()} initialStatus={{ on: true, guide: "Maia", off: null, provider: "anthropic", available: ["anthropic"], names: { anthropic: "Maia" } }} />);
    expect(screen.queryByTestId("ai-setup-banner")).toBeNull();
    rerender(<AiSetupBanner password="pw" onOpenTab={vi.fn()} onOpenHelper={vi.fn()} initialStatus={{ on: true, guide: "Sera", off: null, provider: "sera", available: ["sera"], names: { sera: "Sera" } }} />);
    expect(screen.queryByTestId("ai-setup-banner")).toBeNull();
  });

  it("does not nag a village that switched the helper off", () => {
    render(<AiSetupBanner password="pw" onOpenTab={vi.fn()} onOpenHelper={vi.fn()} initialStatus={{ on: false, guide: "Maia", off: "switch", provider: null, available: [], names: {} }} />);
    expect(screen.queryByTestId("ai-setup-banner")).toBeNull();
  });

  it("reads the helper's own status, with the admin's token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ on: false, guide: "", off: "key", provider: null, available: [], names: {} }) }) as any);
    vi.stubGlobal("fetch", fetchMock);
    render(<AiSetupBanner password="pw" onOpenTab={vi.fn()} onOpenHelper={vi.fn()} />);
    expect(await screen.findByTestId("ai-setup-banner")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/helper", expect.objectContaining({ headers: { Authorization: "Bearer pw" } }));
    expect(screen.getByText(/Your village guide helps you/)).toBeTruthy();
  });
});
