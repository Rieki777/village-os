// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionRows, glanceSentence, readLastGlance, rememberGlance, sinceLastVisit } from "./todayGlance";

beforeEach(() => localStorage.clear());

describe("today in one glance", () => {
  it("says what is waiting and what a connection needs", () => {
    const rows = connectionRows({ emailConfigured: true, stripeConfigured: false, cards: [{ module: "saberra", health: [{ verdict: "failing" }] }] });
    expect(rows.find((r) => r.id === "email")?.word).toBe("Working");
    expect(rows.find((r) => r.id === "payments")?.word).toBe("Needs you");
    expect(rows.find((r) => r.id === "sera")?.state).toBe("broken");
    expect(glanceSentence(3, rows)).toBe("3 requests, 1 connection is broken right now.");
    expect(glanceSentence(0, connectionRows({ emailConfigured: true, stripeConfigured: true, cards: [{ module: "events", health: [{ verdict: "quiet" }] }, { module: "saberra", health: [{ verdict: "quiet" }] }] }))).toBe("Nothing is waiting, and every connection is fine.");
  });

  it("keeps the last look on this device and never calls the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(sinceLastVisit(null, 2)).toBe("First look on this device.");
    rememberGlance(2, 0, new Date("2026-11-03T12:00:00"));
    const prev = readLastGlance();
    expect(prev?.requests).toBe(2);
    expect(sinceLastVisit(prev, 4)).toMatch(/2 more requests since/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
