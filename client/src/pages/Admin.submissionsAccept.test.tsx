// @vitest-environment jsdom
/**
 * A YES TO A REQUEST TO JOIN SAYS WHAT IT DID NOT DO.
 *
 * Accepting a `membership-request` moves the row and nothing else: the person
 * who asked has no account, so the bell cannot reach them, and nothing makes
 * the invitation they now need. The desk used to answer "Status updated",
 * which reads as the job being done. It now names the next step, and only for
 * that form and that move: every other row keeps the words it had.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SubmissionsTab } from "./Admin";

const row = (type: string) => ({ id: "sub-1", type, status: "new", data: { name: "Jo Asker", email: "jo@example.test" }, submittedAt: "2026-10-14T20:50:00Z" });

/** The list answers with one row; the status move answers the way the route does for a stranger's form. */
function serve(type: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.method === "PUT" ? { success: true, rewarded: false, rewardRefused: null, notified: false, admitted: null } : [row(type)];
      return { ok: true, status: 200, json: async () => body };
    }),
  );
}

async function move(status: string) {
  render(<SubmissionsTab password="secret" />);
  fireEvent.click(await waitFor(() => screen.getByText("Jo Asker")));
  const select = await waitFor(() => screen.getByDisplayValue("New"));
  fireEvent.change(select, { target: { value: status } });
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  return String((toast.success as any).mock.calls.at(-1)[0]);
}

describe("moving a submission tells the desk what happened", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  describe("a request to join", () => {
    beforeEach(() => serve("membership-request"));

    it("accepted: says nobody was told and that an invitation is the next step", async () => {
      const said = await move("accepted");
      expect(said).toContain("nobody was told");
      expect(said).toContain("Invite somebody");
    });

    it("moved anywhere else: keeps the plain words", async () => {
      expect(await move("reviewing")).toBe("Status updated");
    });
  });

  it("another form, accepted: keeps the plain words", async () => {
    serve("visit-inquiry");
    expect(await move("accepted")).toBe("Status updated");
  });
});
