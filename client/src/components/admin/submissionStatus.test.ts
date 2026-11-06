/**
 * A yes or a no to a request to join, from the admin's queue (sheet A5): the
 * row's Accept and Decline go to the doors that email the person
 * (server/routes/joinAnswers.ts), and when nothing went out the invitation
 * link stays on screen with a copy button until the admin closes it. Never a
 * silent success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { JOIN_ANSWER_WORDS } from "@shared/joinAnswers";
import { putSubmissionStatus } from "./submissionStatus";

const LINK = "https://village.example.test/register?invite=abc";
let calls: Array<{ url: string; method: string }> = [];

const answerWith = (status: number, body: unknown) => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: String(init?.method ?? "GET") });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
};

beforeEach(() => {
  toast.success.mockReset();
  toast.warning.mockReset();
  toast.error.mockReset();
});

describe("answering a request to join from the queue", () => {
  it("Accept goes to the door that emails the invitation, never the plain status change", async () => {
    answerWith(200, { success: true, emailed: true, emailedTo: "rowan@example.test", link: LINK, message: "Accepted. The invitation went to rowan@example.test." });
    expect(await putSubmissionStatus("pw", "sub-1", "accepted", "membership-request")).toBe(true);
    expect(calls).toEqual([{ url: "/api/admin/join-requests/sub-1/accept", method: "POST" }]);
    expect(toast.success).toHaveBeenCalledWith("Accepted. The invitation went to rowan@example.test.", expect.objectContaining({ description: LINK }));
  });

  it("NEVER A SILENT SUCCESS: nothing went out, so the link stays on screen until closed, with a copy button", async () => {
    const message = JOIN_ANSWER_WORDS.acceptedNotEmailed("not_set_up");
    answerWith(200, { success: true, emailed: false, emailedTo: null, link: LINK, message });
    expect(await putSubmissionStatus("pw", "sub-2", "accepted", "membership-request")).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [said, opts] = toast.warning.mock.calls[0];
    expect(said).toBe(message);
    expect(opts).toMatchObject({ description: LINK, duration: Infinity, closeButton: true, action: { label: JOIN_ANSWER_WORDS.copyLink } });
  });

  it("Decline goes to the door that sends the kind no", async () => {
    answerWith(200, { success: true, emailed: true, emailedTo: "sol@example.test", withdrawn: false, message: "Declined. A kind no went to sol@example.test." });
    expect(await putSubmissionStatus("pw", "sub-3", "declined", "membership-request")).toBe(true);
    expect(calls).toEqual([{ url: "/api/admin/join-requests/sub-3/decline", method: "POST" }]);
    expect(toast.success).toHaveBeenCalledWith("Declined. A kind no went to sol@example.test.");
  });

  it("a refusal says the server's sentence and moves nothing", async () => {
    answerWith(409, { error: JOIN_ANSWER_WORDS.alreadyAccepted });
    expect(await putSubmissionStatus("pw", "sub-4", "accepted", "membership-request")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(JOIN_ANSWER_WORDS.alreadyAccepted);
  });

  it("every other move on a request to join, and every other form, still uses the status change", async () => {
    answerWith(200, { success: true });
    await putSubmissionStatus("pw", "sub-5", "reviewing", "membership-request");
    await putSubmissionStatus("pw", "sub-6", "accepted", "work-with-us");
    expect(calls).toEqual([
      { url: "/api/admin/submissions/sub-5/status", method: "PUT" },
      { url: "/api/admin/submissions/sub-6/status", method: "PUT" },
    ]);
  });
});
