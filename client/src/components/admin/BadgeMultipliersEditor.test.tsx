// @vitest-environment jsdom
/**
 * The badge definition row moved out of client/src/pages/Admin.tsx with the
 * per-token multiplier editor (0278). This holds the row to what it showed
 * there, plus the one thing it gained: what the badge multiplies, by token.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ currency: "USD", quest: [{ token: "village-voice", name: "Village Voice", standard: 10, decimals: 3 }], role: [] }),
  })),
);

import { BadgeDefinitionRow } from "./BadgeMultipliersEditor";

const badge = (over: Record<string, unknown> = {}) => ({
  id: "steward", name: "Steward", kind: "granted", active: true, isExample: false,
  capabilities: ["quest.consent"], denies: [], rule: null, description: "Keeps a circle",
  multiplier: null, multipliers: { "village-voice": 1.5 }, ...over,
});

describe("a badge definition row", () => {
  it("shows the name, kind, grants, description and what it multiplies", async () => {
    render(<BadgeDefinitionRow badge={badge()} call={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Steward")).toBeTruthy();
    expect(screen.getByText("(granted)")).toBeTruthy();
    expect(screen.getByText(/grants quest\.consent · Keeps a circle/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "multiplies Village Voice ×1.5" })).toBeTruthy());
  });

  it("switches the badge off through the same call, then reloads", async () => {
    const call = vi.fn(async () => ({ success: true }));
    const onSaved = vi.fn();
    render(<BadgeDefinitionRow badge={badge()} call={call} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith("/admin/badges/steward", { active: false }, "PUT");
  });

  it("offers no multipliers on a self badge, which carries no powers", () => {
    render(<BadgeDefinitionRow badge={badge({ kind: "self", multipliers: null })} call={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /multipliers/ })).toBeNull();
  });
});
