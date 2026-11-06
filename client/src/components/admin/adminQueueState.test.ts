// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handledOnThisDevice, loadSubmissionRows, plainLoadProblem } from "./adminQueueState";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("submission list words", () => {
  it("turns a code into a sentence and keeps a real sentence", () => {
    expect(plainLoadProblem(401, { error: "auth_required" })).toMatch(/sign in again/);
    expect(plainLoadProblem(500, { message: "The forms box is locked." })).toBe("The forms box is locked.");
    expect(plainLoadProblem(0, null)).toMatch(/connection/);
  });

  it("says the list failed in plain words and keeps the rows on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "nope" }) } as Response);
    const failed = await loadSubmissionRows("tok", "all");
    expect(failed.rows).toEqual([]);
    expect(failed.problem).toMatch(/did not load/);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("/api/admin/submissions");

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: "s1" }] } as Response);
    const ok = await loadSubmissionRows("tok", "visit");
    expect(ok.problem).toBeNull();
    expect(ok.rows).toEqual([{ id: "s1" }]);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("type=visit");
  });

  it("reads today's handled count from this device only", () => {
    const now = new Date(2026, 10, 3, 21, 0);
    expect(handledOnThisDevice(now)).toBe(0);
    localStorage.setItem("admin.handledToday", JSON.stringify({ day: "2026-11-03", count: 2 }));
    expect(handledOnThisDevice(now)).toBe(2);
    expect(handledOnThisDevice(new Date(2026, 10, 4, 0, 1))).toBe(0);
  });
});
