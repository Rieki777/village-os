/**
 * Every tension becomes an agenda item, without a database: a tension's words
 * as an item, what sending one asks for, who may send one on, and the line a
 * card says about where it came from. The doors run against a real schema in
 * server/tensionAgenda.db.test.ts and server/roleTensions.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { LIBRARY_LIMITS, LIBRARY_REFUSALS, LIBRARY_SOURCE_LINE, TENSION_SEND_COPY, cleanTensionSend, maySendTension, tensionAsItem } from "./sessionLibrary";

describe("a tension's words as an agenda item", () => {
  it("keeps short words whole as the title, on one line", () => {
    expect(tensionAsItem("  The rota\\nleaves Sundays  ".replace("\\n", "\n"))).toEqual({ title: "The rota leaves Sundays", note: null });
  });

  it("cuts long words at a word for the title, and keeps every word in the note", () => {
    const words = "The water rota leaves Sundays to whoever notices, and the hose by the gate leaks on every one of those Sundays, so the beds by the gate stay wet all week.";
    const out = tensionAsItem(words);
    expect(out.title.length).toBeLessThanOrEqual(LIBRARY_LIMITS.title);
    expect(out.title.endsWith("...")).toBe(true);
    expect(words.startsWith(out.title.slice(0, -3))).toBe(true);
    expect(out.title.slice(0, -3).endsWith(" ")).toBe(false);
    expect(out.note).toBe(words);
  });
});

describe("what sending a room's tension asks for", () => {
  const LIVE = new Set(["garden"]);
  it("reads a session, an entry and a live circle, or none", () => {
    expect(cleanTensionSend({ sessionId: 3, entryId: 9, circleId: "garden" }, LIVE)).toEqual({ ok: true, value: { sessionId: 3, entryId: 9, circleId: "garden" } });
    expect(cleanTensionSend({ sessionId: 3, entryId: 9, circleId: null }, LIVE)).toEqual({ ok: true, value: { sessionId: 3, entryId: 9, circleId: null } });
    expect(cleanTensionSend({ sessionId: 3, entryId: 9, circleId: "moon" }, LIVE)).toEqual({ ok: false, error: LIBRARY_REFUSALS.circleGone });
    expect(cleanTensionSend({ sessionId: "x", entryId: 9 }, LIVE)).toEqual({ ok: false, error: LIBRARY_REFUSALS.tensionNotFound });
  });
});

describe("who may send a tension on", () => {
  const open = { open: true, facilitatorNo: 1, secretaryNo: 2 };
  const closed = { open: false, facilitatorNo: 1, secretaryNo: 2 };
  const as = (no: number | null, extra: Partial<{ admin: boolean; wasThere: boolean }> = {}) => ({ no, admin: false, wasThere: false, ...extra });

  it("is, in an open room, whoever named it, the hosts and admins", () => {
    expect(maySendTension({ authorNo: 5 }, open, as(5))).toBe(true);
    expect(maySendTension({ authorNo: 5 }, open, as(1))).toBe(true);
    expect(maySendTension({ authorNo: 5 }, open, as(2))).toBe(true);
    expect(maySendTension({ authorNo: 5 }, open, as(7, { wasThere: true }))).toBe(false);
    expect(maySendTension({ authorNo: 5 }, open, as(null, { admin: true }))).toBe(true);
  });

  it("is, from a closed session, anybody who was in it, and admins", () => {
    expect(maySendTension({ authorNo: 5 }, closed, as(7, { wasThere: true }))).toBe(true);
    expect(maySendTension({ authorNo: 5 }, closed, as(5))).toBe(false);
    expect(maySendTension({ authorNo: 5 }, closed, as(null))).toBe(false);
  });
});

describe("the words", () => {
  it("says where an item came from, and where a tension went", () => {
    expect(LIBRARY_SOURCE_LINE.role_tension("Water keeper")).toBe("From a tension raised with Water keeper");
    expect(LIBRARY_SOURCE_LINE.room_tension("Garden")).toBe("From a tension named in a session of the Garden circle");
    expect(LIBRARY_SOURCE_LINE.room_tension("")).toBe("From a tension named in a session");
    expect(TENSION_SEND_COPY.sent("Kitchen circle")).toBe("Sent to the Kitchen circle agenda items.");
    expect(TENSION_SEND_COPY.sent(null)).toBe("Sent to the agenda items for any circle.");
  });
});
