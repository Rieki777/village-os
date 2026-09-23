// @vitest-environment jsdom
/**
 * THE SUBMISSIONS REFRESH BUTTON HAS A NAME.
 *
 * It is an icon and nothing else: no text, no aria-label, no title. A screen
 * reader announced it as "button" and nothing more, at every width. Found by
 * the signed-in sweep (F8) and held to WCAG 4.1.2, which asks that every
 * control a person can operate has a name they can hear.
 *
 * WHAT THIS FILE CANNOT TEST, said so nobody reads it as covering it. The same
 * finding had a second half: at 320px this header overflowed by 25px, because
 * the type filter sizes itself to its longest option and pushed the button off
 * the edge. jsdom lays nothing out, so no assertion here can measure that. It
 * was measured in a real 320px viewport before and after the change, and the
 * sweep pins it from then on.
 *
 * Found by role and name, never by the icon's class: the icon is what was
 * wrong, and asserting on it would pass for exactly the button this replaces.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SubmissionsTab } from "./Admin";

describe("the submissions header can be operated by somebody who cannot see the icon", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("names the refresh button in words the rest of the admin already uses", async () => {
    render(<SubmissionsTab password="secret" />);
    // "Look again" is the visible text on the admin's other refresh button,
    // so a person hears the same phrase for the same act on both.
    const button = await waitFor(() => screen.getByRole("button", { name: "Look again for new submissions" }));
    expect(button.getAttribute("type")).toBe("button");
  });

  it("names the type filter beside it, the same defect in the same row", async () => {
    // Not in the sweep's finding, and found by reading the row it named. A
    // select with no label is announced as its current value, "All types",
    // and never as what choosing one does.
    render(<SubmissionsTab password="secret" />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Form type" })).toBeTruthy());
  });

  it("asks the server again when pressed", async () => {
    render(<SubmissionsTab password="secret" />);
    const button = await waitFor(() => screen.getByRole("button", { name: "Look again for new submissions" }));
    const before = (fetch as any).mock.calls.length;
    button.click();
    await waitFor(() => expect((fetch as any).mock.calls.length).toBeGreaterThan(before));
    expect(String((fetch as any).mock.calls.at(-1)[0])).toContain("/admin/submissions");
  });
});
