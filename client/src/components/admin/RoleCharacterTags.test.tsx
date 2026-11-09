// @vitest-environment jsdom
/**
 * Which characters a role suits, set in the admin org chart (role draft board,
 * 9 Nov). The cast is the village's own, read live; saving sends the whole
 * list, and an unchanged list sends nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import RoleCharacterTags, { forgetCastForTests } from "./RoleCharacterTags";

const CAST = [
  { key: "building", name: "The Builder" },
  { key: "catalyzing", name: "The Catalyst" },
  { key: "facilitating", name: "The Spaceholder" },
];

afterEach(() => {
  cleanup();
  forgetCastForTests();
  vi.unstubAllGlobals();
});

describe("RoleCharacterTags", () => {
  it("ticks the role's current characters and saves the new list to the role", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CAST), { status: 200 })));
    const call = vi.fn(async () => ({ success: true }));
    const saved = vi.fn();
    render(<RoleCharacterTags role={{ id: "lfs", name: "Lead Financial Steward", archetypes: ["building"] }} call={call} onSaved={saved} />);
    const builder = (await screen.findByLabelText("The Builder")) as HTMLInputElement;
    expect(builder.checked).toBe(true);
    const save = screen.getByRole("button", { name: "Save characters" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(builder);
    fireEvent.click(screen.getByLabelText("The Catalyst"));
    fireEvent.click(screen.getByLabelText("The Spaceholder"));
    fireEvent.click(save);
    await waitFor(() => expect(call).toHaveBeenCalledWith("/admin/org/roles/lfs", { archetypes: ["catalyzing", "facilitating"] }, "PUT"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  it("draws nothing until the cast is known", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<RoleCharacterTags role={{ id: "r", name: "R", archetypes: [] }} call={vi.fn()} onSaved={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
