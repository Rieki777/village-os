/**
 * The pure halves of the ballot words step (server/lib/ballotErasure.ts): which
 * name a title hands the sweep, and which spellings it looks for. The rows,
 * the doors' real words and the sweep itself are in erasure.leftovers.test.ts,
 * "round 2, 6: a ballot about the member".
 */
import { describe, expect, it } from "vitest";
import { forgetHandNoteIn, HAND_NOTE_WENT, nameInTitle, scrubBallotText, spellingsOf } from "./ballotErasure";
import { HAND_WROTE_NOTHING, handVoteReason, SEAT_VOTE_REASON_HEADING } from "../../shared/powerHands";

/** A seat vote's document as openSeatVote lays it out, around a reason. */
const seatDoc = (reason: string) =>
  ["# Treasurer: the village asks Wren to sit in it", "", "## The role", "", "Treasurer.", "", SEAT_VOTE_REASON_HEADING, "", reason, "", "## How long", "", "Until 2027-03-01.", "", "Asked by Ann on 2026-10-02.", ""].join("\n");
const hand = { userName: "Wren Halloway", powerLabel: "Keep the treasury", capability: "treasury.keep", submittedAt: "2026-10-01T09:00:00.000Z", note: "I keep the books\n\nby the mill" };

/*
 * Round 3, finding 11. The note a hand carried into the seat vote it opened,
 * and the full name on the line before it, read off the door's own wording.
 */
describe("forgetHandNoteIn", () => {
  it("takes the note and the author's name off the hand door's opening, and keeps the opener's own words", () => {
    const doc = seatDoc(handVoteReason(hand, "> Ann's own quote.\nShe keeps the float.", "Ann"));
    const out = forgetHandNoteIn(doc);
    expect(out).toBe(
      seatDoc(`A departed member raised a hand to keep the treasury on 2026-10-01.\n\n${HAND_NOTE_WENT}\n\n> Ann's own quote.\nShe keeps the float.\n\nAnn put that hand to the village.`),
    );
    expect(forgetHandNoteIn(out), "a second run writes the same text").toBe(out);
  });

  it("reads every shape the door writes: a power with no label, a hand with no note, a doc with CRLF endings", () => {
    const bare = seatDoc(handVoteReason({ ...hand, powerLabel: "", note: "" }, "", "Ann"));
    expect(forgetHandNoteIn(bare)).toBe(seatDoc(`A departed member raised a hand for the power treasury.keep on 2026-10-01.\n\n${HAND_WROTE_NOTHING}\n\nAnn put that hand to the village.`));
    const crlf = seatDoc(handVoteReason(hand, "", "Ann")).replace(/\n/g, "\r\n");
    expect(forgetHandNoteIn(crlf)).toBe(seatDoc(`A departed member raised a hand to keep the treasury on 2026-10-01.\n\n${HAND_NOTE_WENT}\n\nAnn put that hand to the village.`).replace(/\n/g, "\r\n"));
  });

  it("leaves a seat vote that no hand opened exactly as it was, quotes and all", () => {
    const typed = seatDoc("Wren has kept the books for a year.\n\nThey wrote:\n\n> a line somebody quoted");
    expect(forgetHandNoteIn(typed)).toBe(typed);
    expect(forgetHandNoteIn("# A ballot\n\nNo reason heading here.\n")).toBe("# A ballot\n\nNo reason heading here.\n");
  });
});

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
