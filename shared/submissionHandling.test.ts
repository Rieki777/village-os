// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planSubmissionHandling, seraTaskIdFrom } from "./submissionHandling";

const body = (over: Record<string, unknown> = {}) => ({
  action: "remove",
  feedbackId: "fb-abcdef12",
  reason: "already_done",
  note: "email me at a@b.co",
  ...over,
});

describe("submission handling plan", () => {
  it("reads a Sera task id from the request", () => {
    expect(seraTaskIdFrom({ seraTaskId: "task-9" })).toBe("task-9");
    expect(seraTaskIdFrom({ name: "Ada" })).toBeNull();
    expect(seraTaskIdFrom({ externalId: "bad id" })).toBeNull();
  });

  it("requires a reason to remove, and strips an email from the note", () => {
    const missing = planSubmissionHandling({ action: "remove", feedbackId: "fb-abcdef12" }, { share: true, submissionId: "s1", data: {}, ownerId: "own" });
    expect(missing.ok).toBe(false);
    const planned = planSubmissionHandling(body(), { share: true, submissionId: "s1", data: { seraTaskId: "task-9" }, ownerId: "own" });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.note).toContain("[email removed]");
    expect(planned.plan.note).not.toContain("a@b.co");
    expect(planned.plan.toldSera).toBe(true);
    expect(planned.plan.feedbackPayload?.task_id).toBe("task-9");
    expect(planned.plan.eventText).not.toContain("a@b.co");
  });

  it("keeps the reason here and does not tell Sera when the switch is off or the request is not Sera's", () => {
    const off = planSubmissionHandling(body(), { share: false, submissionId: "s1", data: { seraTaskId: "task-9" }, ownerId: "own" });
    expect(off.ok && off.plan.toldSera).toBe(false);
    expect(off.ok && off.plan.feedbackPayload).toBeNull();
    const local = planSubmissionHandling(body(), { share: true, submissionId: "s1", data: { name: "Ada" }, ownerId: "own" });
    expect(local.ok && local.plan.toldSera).toBe(false);
    const noOwner = planSubmissionHandling(body(), { share: true, submissionId: "s1", data: { seraTaskId: "task-9" }, ownerId: null });
    expect(noOwner.ok && noOwner.plan.toldSera).toBe(false);
  });

  it("asks who a redirect is for, and does not need a reason to mark done", () => {
    const who = planSubmissionHandling(
      { action: "redirect", feedbackId: "fb-abcdef12", reason: "better_for_someone_else" },
      { share: true, submissionId: "s1", data: {}, ownerId: null },
    );
    expect(who.ok).toBe(false);
    const handed = planSubmissionHandling(
      { action: "redirect", feedbackId: "fb-abcdef12", reason: "better_for_someone_else", toUserId: "user-2" },
      { share: true, submissionId: "s1", data: { seraTaskId: "task-9" }, ownerId: "own" },
    );
    expect(handed.ok && handed.plan.toUserId).toBe("user-2");
    const done = planSubmissionHandling(
      { action: "done", feedbackId: "fb-abcdef12" },
      { share: true, submissionId: "s1", data: {}, ownerId: null },
    );
    expect(done.ok && done.plan.action).toBe("done");
  });
});
