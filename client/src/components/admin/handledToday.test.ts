// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceHandled, localDayKey, noteHandled, readHandledCount, HANDLED_TODAY_KEY } from "./handledToday";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("handled today", () => {
  it("counts on this device and starts over at local midnight", () => {
    const today = new Date(2026, 10, 3, 23, 30);
    expect(readHandledCount(today)).toBe(0);
    expect(noteHandled(today)).toBe(1);
    expect(noteHandled(today)).toBe(2);
    expect(readHandledCount(today)).toBe(2);
    const tomorrow = new Date(2026, 10, 4, 0, 5);
    expect(localDayKey(tomorrow)).not.toBe(localDayKey(today));
    expect(readHandledCount(tomorrow)).toBe(0);
    expect(noteHandled(tomorrow)).toBe(1);
    expect(readHandledCount(today)).toBe(0);
  });

  it("ignores a broken stored value", () => {
    localStorage.setItem(HANDLED_TODAY_KEY, "nope");
    expect(readHandledCount(new Date())).toBe(0);
  });

  it("never calls the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    announceHandled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readHandledCount(new Date())).toBe(1);
  });
});
