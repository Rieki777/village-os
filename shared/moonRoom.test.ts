/**
 * The room never draws a number about a person's moon (spec section 9,
 * addendum A4). `moonRoomPanel` is the one place the room reads the
 * moon-review room door, so these cases hand it an answer carrying every
 * number the door could carry, the score among them, plus fields a careless
 * server might add, and check that none of it comes out.
 */
import { describe, expect, it } from "vitest";
import { moonRoomApi, moonRoomPanel } from "./moonRoom";
import type { RoomResponse } from "./moonRecap";

const loaded = (): RoomResponse =>
  ({
    moon: { cycleId: "2026-10", firstDay: "2026-10-10", lastDay: "2026-11-08", periodWords: "the October Moon", endOfMoonFriday: "2026-11-06", sendBy: "2026-11-09", fullMoon: "2026-10-25" },
    holder: { userId: "u-ana", name: "Ana Reyes" },
    recap: {
      roles: [
        {
          roleId: "r-garden",
          name: "Garden steward",
          items: [
            { text: "Planted the lower terrace", evidenceUrl: "https://example.test/photo" },
            { text: "Mended the hose", evidenceUrl: "javascript:alert(1)", amountMinor: 987654 },
          ],
          heldPrivately: 3,
          quiet: ["Compost accountability"],
        },
      ],
      seasonGoals: [{ id: "g1", words: "Feed the village from the land", count: 4 }],
      moonLoad: 7777,
    },
    ready: [{ userId: "u-ben", name: "Ben Ortiz" }],
    goals: {
      last: [
        { text: "Finish the terrace", status: "done", flagged: false },
        { text: "Draft the water plan", status: "carried", flagged: true },
      ],
      score: { numHalves: 25, den: 18, pct: 69 },
      reading: { band: "Steady", says: "The normal range" },
      next: [{ text: "Plant the upper terrace", doneWhen: "Beds are planted" }],
    },
    mine: { recapStatus: "draft", statusWords: "Draft", invoiceNeeded: true, amountMinor: 450000 },
    sentCount: 3,
    totalOwedMinor: 1234567,
  }) as unknown as RoomResponse;

describe("what the End of moon room draws", () => {
  it("names the door by the session", () => {
    expect(moonRoomApi(42)).toBe("/api/moon-review/rooms/42");
  });

  it("carries no amount, score, reading, load or private count, whatever the door sends", () => {
    const out = JSON.stringify(moonRoomPanel(loaded(), true));
    for (const n of ["987654", "450000", "1234567", "7777", "69", "25", "18"]) expect(out).not.toContain(n);
    for (const w of ["score", "reading", "Steady", "amount", "Minor", "heldPrivately", "moonLoad", "quiet", "Compost", "\"count\"", "pct"]) {
      expect(out).not.toContain(w);
    }
  });

  it("shows the holder's recap and goals in words once they chose Show my moon", () => {
    const p = moonRoomPanel(loaded(), true);
    expect(p.recap?.roles[0].name).toBe("Garden steward");
    expect(p.recap?.roles[0].items.map((i) => i.text)).toEqual(["Planted the lower terrace", "Mended the hose"]);
    expect(p.recap?.roles[0].items[0].proofUrl).toBe("https://example.test/photo");
    // Only an http or https link is ever a proof link.
    expect(p.recap?.roles[0].items[1].proofUrl).toBeNull();
    expect(p.recap?.seasonGoals).toEqual(["Feed the village from the land"]);
    expect(p.goals?.last).toEqual([
      { text: "Finish the terrace", mark: "Done", flagged: false },
      { text: "Draft the water plan", mark: "Carry", flagged: true },
    ]);
    expect(p.goals?.next).toEqual([{ text: "Plant the upper terrace", doneWhen: "Beds are planted" }]);
  });

  it("keeps the recap and goals off the screen while the holder speaks only", () => {
    const p = moonRoomPanel(loaded(), false);
    expect(p.recap).toBeNull();
    expect(p.goals).toBeNull();
    expect(p.holderName).toBe("Ana Reyes");
    expect(JSON.stringify(p)).not.toContain("terrace");
  });

  it("lists who is ready and nobody as not ready", () => {
    const p = moonRoomPanel(loaded(), false);
    expect(p.ready).toEqual(["Ben Ortiz"]);
    expect(Object.keys(p)).not.toContain("notReady");
  });

  it("gives this viewer only their own status words, a Send mine while unsent, and the room a count of people", () => {
    const p = moonRoomPanel(loaded(), false);
    expect(p.mine).toEqual({ statusWords: "Draft", send: true });
    expect(p.sentCount).toBe(3);
    expect(p.sendBy).toMatch(/^Send by Monday 9 November 2026\./);
    const sent = moonRoomPanel({ ...loaded(), mine: { recapStatus: "waiting", statusWords: "Waiting on approval", invoiceNeeded: false } }, false);
    expect(sent.mine).toEqual({ statusWords: "Waiting on approval", send: false });
  });

  it("reads an empty answer calmly", () => {
    const p = moonRoomPanel(null, true);
    expect(p).toMatchObject({ holderName: null, recap: null, goals: null, ready: [], mine: null, sentCount: 0, sendBy: "" });
  });
});
