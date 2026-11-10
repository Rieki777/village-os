/**
 * A ROLE'S TRACK, ONE LIST (guide v2, Rye 10 Nov 2026: every role is a
 * contract). The editor and the card read the same words; the card's older
 * "paid" and "local" still read; a contractor counts as paid; and a role with
 * no track reads as the village's default, which is village data.
 */
import { describe, expect, it } from "vitest";
import { PAID_TRACKS, TRACKS, TRACK_WORDS, readTrack, trackOf } from "./roleTracks";
import { ROLE_TRACKS, TRACK_WORDS as CARD_TRACK_WORDS, parseRoleParams, roleCardGate } from "./roleParams";
import { TRACKS as EDITOR_TRACKS, TRACK_WORDS as EDITOR_TRACK_WORDS } from "./roleParameters";

describe("one track list", () => {
  it("is the same list and words for the editor and the card", () => {
    expect(ROLE_TRACKS).toBe(TRACKS);
    expect(EDITOR_TRACKS).toBe(TRACKS);
    expect(CARD_TRACK_WORDS).toBe(TRACK_WORDS);
    expect(EDITOR_TRACK_WORDS).toBe(TRACK_WORDS);
  });

  it("reads its own words, the card's older ones and each label, and nothing else", () => {
    expect(readTrack("contractor")).toBe("contractor");
    expect(readTrack("paid")).toBe("contractor");
    expect(readTrack("local")).toBe("employee");
    expect(readTrack("Paid contractor")).toBe("contractor");
    expect(readTrack(" Volunteer ")).toBe("volunteer");
    expect(readTrack("job")).toBeNull();
    expect(readTrack("")).toBeNull();
    expect(readTrack(null)).toBeNull();
  });

  it("counts a contractor and an employee as paid", () => {
    expect(PAID_TRACKS).toEqual(["contractor", "employee"]);
  });

  it("gives a role with no track the village's default, and a role's own track always wins", () => {
    expect(trackOf(null, "contractor")).toBe("contractor");
    expect(trackOf("volunteer", "contractor")).toBe("volunteer");
    expect(trackOf(null, "")).toBeNull();
    expect(trackOf(null, "nonsense")).toBeNull();
  });
});

describe("the card reads the editor's words (the bug the two lists made)", () => {
  it("stores a track the editor wrote, and an older one as the one list's", () => {
    const fromEditor = parseRoleParams({ track: "contractor" });
    expect(fromEditor.ok && fromEditor.value.track).toBe("contractor");
    const older = parseRoleParams({ track: "paid" });
    expect(older.ok && older.value.track).toBe("contractor");
  });

  it("asks a contractor role for a pay range before its card is complete", () => {
    const base = { aim: "a", domain: "d", accountabilities: ["x"], timeCommitment: "20 a week", payKind: null, hasRange: false, hasTerm: true, villageGoals: ["g"], selectionCriteria: ["c"], conversations: [{ roleId: "r", minutes: 20, final: true }] } as any;
    const contractor = roleCardGate({ ...base, track: "contractor" });
    expect(contractor.complete).toBe(false);
    expect(roleCardGate({ ...base, track: "contractor", payKind: "range", hasRange: true }).complete).toBe(true);
    // Paid by its track alone: a contractor with a pay kind but no range stated is still not complete.
    expect(roleCardGate({ ...base, track: "contractor", payKind: "range", hasRange: false }).complete).toBe(false);
  });
});
