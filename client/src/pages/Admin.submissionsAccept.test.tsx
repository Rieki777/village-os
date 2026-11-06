// @vitest-environment jsdom
/**
 * A YES TO A REQUEST TO JOIN SAYS WHAT IT DID.
 *
 * Accepting a `membership-request` used to move the row and nothing else, and
 * the desk said so. Since sheet A5 the yes goes to its own door, which emails
 * the invitation to the address the person typed and answers where it went
 * (server/routes/joinAnswers.ts); the desk shows that sentence. A request from
 * somebody signed in names their account: no invitation, and they are told.
 * Every other row, and every other move, keeps the words it had.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SubmissionsTab } from "./Admin";
import { JOIN_ANSWER_WORDS } from "@shared/joinAnswers";

const row = (type: string) => ({ id: "sub-1", type, status: "new", data: { name: "Jo Asker", email: "jo@example.test" }, submittedAt: "2026-10-14T20:50:00Z" });

/**
 * The list answers with one row; the status move answers the way the route does
 * for a stranger's form, or, with `fromAccount`, for a row naming the account
 * that sent it, whose submitter the bell reaches. A yes or a no to a request to
 * join goes to its own door (server/routes/joinAnswers.ts, sheet A5), which
 * answers in its own words; `calls` records where each move went.
 */
let calls: string[] = [];
const JOIN_ANSWER = "Accepted. The invitation went to jo@example.test. It works once and lasts 14 days.";

function serve(type: string, fromAccount = false) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") calls.push(`${init.method} ${url}`);
      const join = String(url).includes("/admin/join-requests/");
      const body = join
        ? { success: true, emailed: !fromAccount, link: fromAccount ? null : "https://village.example.test/register?invite=abc", message: fromAccount ? JOIN_ANSWER_WORDS.acceptedAccount : JOIN_ANSWER }
        : init?.method === "PUT"
          ? { success: true, rewarded: false, rewardRefused: null, notified: fromAccount, admitted: null }
          : [row(type)];
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
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  describe("a request to join", () => {
    beforeEach(() => serve("membership-request"));

    it("accepted: goes to the door that emails the invitation, and says where it went (sheet A5)", async () => {
      const said = await move("accepted");
      expect(calls).toEqual(["POST /api/admin/join-requests/sub-1/accept"]);
      expect(said).toBe(JOIN_ANSWER);
    });

    it("moved anywhere else: keeps the plain words", async () => {
      expect(await move("reviewing")).toBe("Status updated");
    });
  });

  /*
   * A request sent while signed in names the account (RequestMembership.tsx now
   * sends the token), so the bell reaches them. Accepting it still admits
   * nobody, and "Status updated. The person who sent it has been told." would
   * leave a steward believing they had let somebody in.
   */
  describe("a request to join from somebody signed in", () => {
    beforeEach(() => serve("membership-request", true));

    it("accepted: says they were told, and that their account needed no invitation", async () => {
      const said = await move("accepted");
      expect(calls).toEqual(["POST /api/admin/join-requests/sub-1/accept"]);
      expect(said).toBe(JOIN_ANSWER_WORDS.acceptedAccount);
      expect(said).toContain("they have been told");
    });

    it("moved anywhere else: says they were told, as every row naming an account does", async () => {
      expect(await move("reviewing")).toBe("Status updated. The person who sent it has been told.");
    });
  });

  it("another form, accepted: keeps the plain words", async () => {
    serve("visit-inquiry");
    expect(await move("accepted")).toBe("Status updated");
  });
});
