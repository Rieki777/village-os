// @vitest-environment jsdom
/**
 * Which roots a role grows from, set in the admin org chart through the roots
 * kit's RootPicker (role draft board 9 Nov, roots 11 Nov). The cast is the
 * village's own, read live; saving sends the whole list, an unchanged list
 * sends nothing, and a fourth root is refused before it is ever sent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import RoleCharacterTags, { forgetCastForTests } from "./RoleCharacterTags";

const CAST = [
  { key: "building", name: "The Builder" },
  { key: "catalyzing", name: "The Catalyst" },
  { key: "facilitating", name: "The Spaceholder" },
  { key: "architecting", name: "The Architect" },
];

afterEach(() => {
  cleanup();
  forgetCastForTests();
  vi.unstubAllGlobals();
});

describe("RoleCharacterTags", () => {
  it("ticks the role's current roots and saves the new list to the role", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CAST), { status: 200 })));
    const call = vi.fn(async () => ({ success: true }));
    const saved = vi.fn();
    render(<RoleCharacterTags role={{ id: "lfs", name: "Lead Financial Steward", archetypes: ["building"] }} call={call} onSaved={saved} />);
    const builder = (await screen.findByLabelText("Builder")) as HTMLInputElement;
    expect(builder.checked).toBe(true);
    const save = screen.getByRole("button", { name: "Save roots" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(builder);
    fireEvent.click(screen.getByLabelText("Catalyst"));
    fireEvent.click(screen.getByLabelText("Spaceholder"));
    fireEvent.click(save);
    await waitFor(() => expect(call).toHaveBeenCalledWith("/admin/org/roles/lfs", { archetypes: ["catalyzing", "facilitating"] }, "PUT"));
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  it("refuses a fourth root and never sends it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CAST), { status: 200 })));
    const call = vi.fn(async () => ({ success: true }));
    render(<RoleCharacterTags role={{ id: "r4", name: "R", archetypes: ["building", "catalyzing", "facilitating"] }} call={call} onSaved={vi.fn()} />);
    const fourth = (await screen.findByLabelText("Architect")) as HTMLInputElement;
    fireEvent.click(fourth);
    expect(fourth.checked).toBe(false);
    expect(screen.getByText("Up to 3 roots. Take one off first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save roots" }) as HTMLButtonElement).disabled).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("draws nothing until the cast is known", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<RoleCharacterTags role={{ id: "r", name: "R", archetypes: [] }} call={vi.fn()} onSaved={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
