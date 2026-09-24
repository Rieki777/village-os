/**
 * The signing a member can see: which row is theirs, and what the village has
 * done with it.
 *
 * Two of these defend a shape the type system cannot: the submissions table is
 * hand-written JSON on one column and a varchar on another, so a row can carry
 * a numeric id or a Date where the neighbouring row carries strings.
 */
import { describe, expect, it } from "vitest";
import { signingAnswer, signingOf, SIGNING_TYPE } from "./membershipSigning";

const row = (over: Record<string, unknown> = {}) => ({
  type: SIGNING_TYPE,
  status: "new",
  userId: "u1",
  submittedAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

describe("what the village has done with a signing", () => {
  it("says welcomed only for an accepted row", () => {
    expect(signingAnswer("accepted")).toBe("welcomed");
  });

  it("says left for a declined row, because a record that reads waiting forever is false", () => {
    expect(signingAnswer("declined")).toBe("left");
  });

  it("says waiting for every status the notice spine stays quiet about", () => {
    // `new`, `reviewing` and `in-conversation` are the pipeline's own filing,
    // and submissionNotices.ts gives the reason a member hears nothing for two
    // of them. None of the three is an answer.
    for (const s of ["new", "reviewing", "in-conversation"]) {
      expect(signingAnswer(s), s).toBe("waiting");
    }
  });

  it("says waiting for a status nobody has seen, instead of throwing on a profile", () => {
    for (const s of [undefined, null, "", 7, "archived"]) {
      expect(signingAnswer(s), JSON.stringify(s)).toBe("waiting");
    }
  });
});

describe("which signing is this member's", () => {
  it("is the row that names them", () => {
    expect(signingOf([row()], "u1")).toEqual({ at: "2026-08-30T10:00:00.000Z", answer: "waiting" });
  });

  it("is nobody else's", () => {
    expect(signingOf([row({ userId: "u2" })], "u1")).toBeNull();
  });

  it("is not a stranger's signing, which carries no account at all", () => {
    // The Love Letter still takes a signature from somebody with no account,
    // and that row has `userId` null. It belongs to no profile.
    expect(signingOf([row({ userId: null })], "u1")).toBeNull();
    expect(signingOf([row({ userId: null })], null)).toBeNull();
  });

  it("is not another form they sent", () => {
    expect(signingOf([row({ type: "work-with-us" }), row({ type: "visit-inquiry" })], "u1")).toBeNull();
  });

  it("matches an id stored as a number against one held as a string", () => {
    expect(signingOf([row({ userId: 7 })], "7")?.answer).toBe("waiting");
    expect(signingOf([row({ userId: "7" })], 7)?.answer).toBe("waiting");
  });

  it("is the newest when somebody refiled, whatever order the rows arrive in", () => {
    const old = row({ submittedAt: "2026-08-01T10:00:00.000Z", status: "declined" });
    const now = row({ submittedAt: "2026-09-01T10:00:00.000Z", status: "accepted" });
    expect(signingOf([now, old], "u1")).toEqual({ at: "2026-09-01T10:00:00.000Z", answer: "welcomed" });
    expect(signingOf([old, now], "u1")).toEqual({ at: "2026-09-01T10:00:00.000Z", answer: "welcomed" });
  });

  it("hands the client a string when the repo hands it a Date", () => {
    const d = new Date("2026-08-30T10:00:00.000Z");
    expect(signingOf([row({ submittedAt: d })], "u1")?.at).toBe("2026-08-30T10:00:00.000Z");
  });

  it("survives a row with no time and a row that is not an object", () => {
    expect(signingOf([row({ submittedAt: undefined })], "u1")).toEqual({ at: "", answer: "waiting" });
    expect(signingOf([null, undefined, "text", row()], "u1")?.answer).toBe("waiting");
  });

  it("is null for a member who never signed", () => {
    expect(signingOf([], "u1")).toBeNull();
  });
});
