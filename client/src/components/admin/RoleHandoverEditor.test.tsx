// @vitest-environment jsdom
/**
 * The editor beside the aim and domain: three inputs, the parser's sentence
 * under a bad one, and Save goes through a one-change `update_seat` draft.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RoleHandoverEditor from "./RoleHandoverEditor";
import { ROLE_HANDOVER_WORDS as W } from "@shared/roleHandover";

const role = { id: "water", name: "Water Steward", bringMe: ["A reading"], notMine: null, runbook: null };

function setup() {
  const calls: Array<{ path: string; body: any; method?: string }> = [];
  const call = vi.fn(async (path: string, body?: any, method?: string) => {
    calls.push({ path, body, method });
    if (path === "/admin/org/drafts") return { id: "d1" };
    if (path.endsWith("/preview")) return { lines: [{ blocked: null }] };
    return { success: true };
  });
  const onSaved = vi.fn();
  render(<RoleHandoverEditor role={role} call={call} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: /Bring me, not mine to hold and runbook/ }));
  return { calls, onSaved };
}

describe("RoleHandoverEditor", () => {
  it("says how many of the three are written, and opens to three labelled inputs", () => {
    setup();
    expect(screen.getByText("1 of 3 written")).toBeTruthy();
    expect((screen.getByLabelText(W.bringMe) as HTMLTextAreaElement).value).toBe("A reading");
    expect(screen.getByLabelText(W.notMine)).toBeTruthy();
    expect(screen.getByLabelText(W.runbook)).toBeTruthy();
  });

  it("shows the parser's sentence under a bad runbook and holds the save", () => {
    setup();
    fireEvent.change(screen.getByLabelText(W.runbook), { target: { value: "http://example.org" } });
    expect(screen.getByRole("alert").textContent).toBe(W.httpsOnly);
    expect(screen.getByRole("button", { name: "Save through a draft" })).toBeDisabled();
  });

  it("saves through a one-change update_seat draft, then publishes it", async () => {
    const { calls, onSaved } = setup();
    fireEvent.change(screen.getByLabelText(W.notMine), { target: { value: "Bookkeeping\nThe kitchen rota" } });
    fireEvent.change(screen.getByLabelText(W.runbook), { target: { value: "https://example.org/water" } });
    fireEvent.click(screen.getByRole("button", { name: "Save through a draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.map((c) => c.path)).toEqual([
      "/admin/org/drafts",
      "/admin/org/drafts/d1/changes",
      "/admin/org/drafts/d1/preview",
      "/admin/org/drafts/d1/publish",
    ]);
    expect(calls[1].body).toEqual({
      op: "update_seat",
      orgRoleId: "water",
      payload: { bringMe: ["A reading"], notMine: ["Bookkeeping", "The kitchen rota"], runbook: "https://example.org/water" },
    });
  });
});
