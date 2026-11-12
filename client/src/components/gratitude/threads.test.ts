/**
 * GRATITUDE THREADS AS RULES (Phase C, decision 4).
 *
 * The newest thanks first; a ring ordered by name and never by activity; one
 * thread per pair however many thanks passed; both ways as a fact about a
 * pair. Each rule is pinned here against the obvious wrong version of it.
 */
import { describe, expect, it } from "vitest";
import type { WallEntry, WallPerson } from "@shared/gratitudeVoices";
import { bothWays, newestFirst, pairKey, personKey, ringPeople, ringPlaces, sinceMoment, threadPath, webThreads } from "./threads";

const p = (name: string, handle: string | null = name.toLowerCase()): WallPerson => ({ name, handle, avatar: null });
const ana = p("Ana");
const bo = p("Bo");
const zoe = p("Zoe");
const yuri = p("Yuri");

let n = 0;
const e = (from: WallPerson, to: WallPerson, at: string, message = "thanks"): WallEntry => ({
  id: `e${++n}`,
  from,
  to,
  amount: 99,
  message,
  at,
});

describe("newestFirst", () => {
  it("puts the newest thanks first whatever order the server sent", () => {
    const rows = [e(ana, bo, "2026-11-01T10:00:00Z", "old"), e(bo, zoe, "2026-11-09T10:00:00Z", "new"), e(zoe, ana, "2026-11-05T10:00:00Z", "mid")];
    expect(newestFirst(rows).map((r) => r.message)).toEqual(["new", "mid", "old"]);
  });

  it("keeps the server's order for two thanks at the same moment, and sinks an unreadable date", () => {
    const rows = [e(ana, bo, "bad", "x"), e(ana, bo, "2026-11-02T00:00:00Z", "a"), e(bo, ana, "2026-11-02T00:00:00Z", "b")];
    expect(newestFirst(rows).map((r) => r.message)).toEqual(["a", "b", "x"]);
  });
});

describe("ringPeople", () => {
  it("orders faces by name, never by how many thanks a person has", () => {
    // Zoe is in every thanks; a ring by activity would put her first.
    const rows = [e(zoe, bo, "2026-11-02T00:00:00Z"), e(zoe, ana, "2026-11-03T00:00:00Z"), e(yuri, zoe, "2026-11-04T00:00:00Z"), e(zoe, yuri, "2026-11-05T00:00:00Z")];
    expect(ringPeople(rows).map((x) => x.name)).toEqual(["Ana", "Bo", "Yuri", "Zoe"]);
  });

  it("sets case and accents aside, and lists each person once", () => {
    const rows = [e(p("ána", "a2"), p("Bea"), "2026-11-02T00:00:00Z"), e(p("Bea"), p("Al"), "2026-11-02T00:00:00Z")];
    expect(ringPeople(rows).map((x) => x.name)).toEqual(["Al", "ána", "Bea"]);
  });
});

describe("webThreads", () => {
  it("draws one thread per pair however many thanks passed, and carries no count", () => {
    const rows = [e(ana, bo, "2026-11-05T00:00:00Z"), e(ana, bo, "2026-11-04T00:00:00Z"), e(ana, bo, "2026-11-03T00:00:00Z"), e(bo, zoe, "2026-11-02T00:00:00Z")];
    const threads = webThreads(rows);
    expect(threads).toHaveLength(2);
    for (const t of threads) expect(Object.keys(t).sort()).toEqual(["a", "b", "key", "mutual"]);
  });

  it("marks a pair who thanked each other both ways, and only that pair", () => {
    const rows = [e(ana, bo, "2026-11-05T00:00:00Z"), e(bo, ana, "2026-11-04T00:00:00Z"), e(bo, zoe, "2026-11-03T00:00:00Z")];
    const byKey = new Map(webThreads(rows).map((t) => [t.key, t.mutual]));
    expect(byKey.get(pairKey(ana, bo))).toBe(true);
    expect(byKey.get(pairKey(bo, zoe))).toBe(false);
    expect(bothWays(rows)).toEqual(new Set([pairKey(bo, ana)]));
  });

  it("leaves out a thanks a person sent to themselves", () => {
    expect(webThreads([e(ana, ana, "2026-11-05T00:00:00Z")])).toEqual([]);
  });
});

describe("pairKey and personKey", () => {
  it("is the same pair whichever way the thanks went", () => {
    expect(pairKey(ana, bo)).toBe(pairKey(bo, ana));
  });
  it("falls back to the recorded name for a deleted account", () => {
    expect(personKey(p("Gone", null))).toBe("name:gone");
    expect(personKey(p("Ana", "AnaH"))).toBe("@anah");
  });
});

describe("sinceMoment", () => {
  it("keeps this moon's thanks and nothing before it", () => {
    const rows = [e(ana, bo, "2026-11-05T00:00:00Z", "in"), e(ana, bo, "2026-10-20T00:00:00Z", "out")];
    expect(sinceMoment(rows, "2026-11-01T00:00:00Z").map((r) => r.message)).toEqual(["in"]);
  });
  it("draws nothing until the moon's start is known", () => {
    expect(sinceMoment([e(ana, bo, "2026-11-05T00:00:00Z")], null)).toEqual([]);
  });
});

describe("geometry", () => {
  it("places the first face at the top of the ring and goes clockwise", () => {
    const [a, b] = ringPlaces(4, 100, 100, 50);
    expect(a!.x).toBeCloseTo(100);
    expect(a!.y).toBeCloseTo(50);
    expect(b!.x).toBeCloseTo(150);
    expect(b!.y).toBeCloseTo(100);
  });
  it("bows a thread toward the centre", () => {
    expect(threadPath({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }, 0.5)).toBe("M0 0 Q50 50 100 0");
  });
});
