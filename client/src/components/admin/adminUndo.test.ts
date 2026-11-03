// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelUndo, holdUndo, pendingUndoLabel, undoWaitMs } from "./adminUndo";
import { isSnoozed, nextWeek, snoozeUntil, tomorrow } from "./adminSnooze";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cancelUndo();
  vi.useRealTimers();
});

describe("undo and snooze", () => {
  it("waits 10 seconds and Undo stops the action", () => {
    const work = vi.fn();
    holdUndo("Removing this request.", work);
    expect(pendingUndoLabel()).toMatch(/Removing/);
    vi.advanceTimersByTime(undoWaitMs() - 1);
    expect(work).not.toHaveBeenCalled();
    cancelUndo();
    vi.advanceTimersByTime(5);
    expect(work).not.toHaveBeenCalled();
  });

  it("runs the action when the wait ends", () => {
    const work = vi.fn();
    holdUndo("Marking this done.", work);
    vi.advanceTimersByTime(undoWaitMs());
    expect(work).toHaveBeenCalledOnce();
    expect(pendingUndoLabel()).toBeNull();
  });

  it("hides a request until tomorrow without telling anyone", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const now = new Date(2026, 10, 3, 21, 0);
    snoozeUntil("s1", tomorrow(now));
    expect(isSnoozed("s1", now)).toBe(true);
    expect(isSnoozed("s1", nextWeek(now))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
