// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionRows, glanceSentence, readLastGlance, rememberGlance, sinceLastVisit } from "./todayGlance";

beforeEach(() => localStorage.clear());

describe("today in one glance", () => {
  it("says what is waiting and what a connection needs", () => {
    const rows = connectionRows({ emailConfigured: true, stripeConfigured: false, cards: [{ module: "saberra", health: [{ verdict: "failing" }] }] });
    expect(rows.find((r) => r.id === "email")?.word).toBe("Needs you");
    expect(rows.find((r) => r.id === "email")?.detail).toBe("A key is saved. It has not been confirmed.");
    expect(rows.find((r) => r.id === "payments")?.word).toBe("Needs you");
    expect(rows.find((r) => r.id === "sera")?.state).toBe("broken");
    expect(glanceSentence(3, rows)).toBe("3 requests, 1 connection is broken right now.");
    expect(glanceSentence(0, connectionRows({}))).toBe("Every connection needs you.");
    expect(connectionRows({ cards: [{ module: "saberra" }] }).find((r) => r.id === "sera")?.word).toBe("Needs you");
    expect(connectionRows({ cards: [{ module: "saberra", health: [{ verdict: "never-confirmed" }] }] }).find((r) => r.id === "sera")?.word).toBe("Needs you");
    expect(connectionRows({ cards: [{ module: "saberra", health: [{ verdict: "working" }, { verdict: "stale" }] }] }).find((r) => r.id === "sera")?.state).toBe("needs");
    const fine = connectionRows({
      cards: [
        { module: "email", health: [{ verdict: "working" }] },
        { module: "payments", health: [{ verdict: "quiet" }] },
        { module: "events", health: [{ verdict: "quiet" }] },
        { module: "saberra", health: [{ verdict: "working" }] },
      ],
    });
    expect(fine.every((r) => r.state === "working")).toBe(true);
    expect(glanceSentence(0, fine)).toBe("Nothing is waiting, and every connection is fine.");
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
