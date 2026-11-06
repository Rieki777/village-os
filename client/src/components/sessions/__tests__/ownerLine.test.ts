import { describe, expect, it } from "vitest";
import { heldLine, ownerLine } from "../roomUi";
import { ROOM_COPY, SESSION_SOMEONE } from "@shared/sessions";

const entry = (over: Partial<Parameters<typeof heldLine>[0]> = {}) => ({
  ownerSeatId: null,
  ownerSeatName: null,
  ownerName: null,
  ownerUserId: null,
  ...over,
});

// Rye, 2026-10-30: the role comes first, and the first name of who sits there follows in parentheses.
describe("who holds an action", () => {
  it("names the seat and who sits there now", () => {
    expect(ownerLine(entry({ ownerSeatId: "s1", ownerSeatName: "Treasurer", ownerSeatHolders: ["Rick"] }))).toBe("Treasurer (Rick)");
    expect(heldLine(entry({ ownerSeatId: "s1", ownerSeatName: "Steward", ownerSeatHolders: ["Rye", "Jessica"] }))).toBe(`${ROOM_COPY.heldBy} Steward (Rye, Jessica)`);
  });

  it("names a vacant seat alone", () => {
    expect(ownerLine(entry({ ownerSeatId: "s1", ownerSeatName: "Treasurer", ownerSeatHolders: [] }))).toBe("Treasurer");
    expect(ownerLine(entry({ ownerSeatId: "s1", ownerSeatName: "Treasurer" }))).toBe("Treasurer");
  });

  it("names the person who took it for the seat, by first name", () => {
    expect(ownerLine(entry({ ownerSeatId: "s1", ownerSeatName: "Treasurer", ownerName: "Rick Moss", ownerUserId: 4, ownerSeatHolders: ["Ana"] }))).toBe("Treasurer (Rick)");
  });

  it("never prints the placeholder as a name", () => {
    expect(ownerLine(entry({ ownerSeatId: "s1", ownerSeatName: "Treasurer", ownerName: SESSION_SOMEONE, ownerUserId: 4 }))).toBe("Treasurer");
  });

  it("keeps a person-held action and an unheld one as they were", () => {
    expect(ownerLine(entry({ ownerName: "Rick Moss", ownerUserId: 4 }))).toBe("Rick Moss");
    expect(heldLine(entry())).toBe(ROOM_COPY.nobodyHolds);
  });
});
