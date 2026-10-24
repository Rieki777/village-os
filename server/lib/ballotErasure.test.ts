/**
 * The pure halves of the ballot words step (server/lib/ballotErasure.ts): which
 * name a title hands the sweep, and which spellings it looks for. The rows,
 * the doors' real words and the sweep itself are in erasure.leftovers.test.ts,
 * "round 2, 6: a ballot about the member".
 */
import { describe, expect, it } from "vitest";
import { nameInTitle, scrubBallotText, spellingsOf } from "./ballotErasure";

describe("nameInTitle", () => {
  it("reads the name each door wrote", () => {
    expect(nameInTitle("role_unseat", "Steward: the village asks to take the role back from Wren")).toBe("Wren");
    expect(nameInTitle("role_seat", "Treasurer: the village asks Wren to sit in it")).toBe("Wren");
    expect(nameInTitle("advisory", "Treasurer: the village asks Wren to sit in it")).toBeNull();
  });

  /*
   * Round 3, the guard from finding 0's fix. The doors title a ballot about a
   * tombstone with its first name, "A", and a member with no name "Someone".
   */
  it("hands back no name where the title names a tombstone or nobody", () => {
    for (const who of ["A", "a departed member", "A departed member", "Someone"]) {
      expect(nameInTitle("role_unseat", `Steward: the village asks to take the role back from ${who}`), who).toBeNull();
      expect(nameInTitle("role_seat", `Treasurer: the village asks ${who} to sit in it`), who).toBeNull();
    }
  });

  it("never lets those words in as a spelling by another road either", () => {
    expect(spellingsOf(["Wren Halloway", "A", "Someone", "A departed member", null, "Wren"])).toEqual(["Wren Halloway", "Wren"]);
    expect(scrubBallotText("A cleanup vote. A role held by nobody.", spellingsOf(["A"]))).toBe("A cleanup vote. A role held by nobody.");
  });
});
