/**
 * The words for answering a request to join (sheet A5), with nothing in the
 * way. The route test (server/routes/joinAnswers.test.ts) proves the doors.
 */
import { describe, expect, it } from "vitest";
import { acceptLetter, declineLetter, greetingName, JOIN_ANSWER_WORDS, joinInviteId } from "./joinAnswers";

describe("the letters a person reads", () => {
  it("the yes names the village, carries the link on a line of its own, and says how long it lasts", () => {
    const l = acceptLetter({ firstName: "Rowan", village: "Oak Hollow", link: "https://oak.example/register?invite=abc", days: 14 });
    expect(l.subject).toBe("Yes, come and join Oak Hollow");
    expect(l.text.split("\n")).toEqual([
      "Hi Rowan,",
      "",
      "Oak Hollow said yes to your request to join.",
      "",
      "Here is your invitation. Open it to make your account:",
      "https://oak.example/register?invite=abc",
      "",
      "It works once and lasts 14 days.",
      "",
    ]);
  });

  it("the no is short and kind, and promises nothing", () => {
    const l = declineLetter({ firstName: "Sol", village: "Oak Hollow" });
    expect(l.subject).toBe("Your request to join Oak Hollow");
    expect(l.text).toBe("Hi Sol,\n\nThank you for asking to join Oak Hollow. We can't say yes this time.\n\nWe're glad you found us, and we wish you well.\n");
  });

  it("greets by first name only, and plainly when the request gave none worth using", () => {
    expect(greetingName("  Rowan   Field ")).toBe("Rowan");
    for (const none of ["", "   ", null, undefined, "rowan@example.test", "x".repeat(41)]) expect(greetingName(none)).toBeNull();
    expect(acceptLetter({ firstName: null, village: "V", link: "L", days: 14 }).text.startsWith("Hi,\n")).toBe(true);
    expect(declineLetter({ firstName: null, village: "V" }).text.startsWith("Hi,\n")).toBe(true);
  });
});

describe("what the desk reads", () => {
  it("every answer that sends nothing says why and what to do instead", () => {
    expect(JOIN_ANSWER_WORDS.acceptedNotEmailed("not_set_up")).toBe("Accepted. Email is not set up yet, so nothing went out. Copy their invitation below and send it to them yourself.");
    expect(JOIN_ANSWER_WORDS.acceptedNotEmailed("bad_address")).toContain("does not look like an email address");
    expect(JOIN_ANSWER_WORDS.acceptedNotEmailed("no_address")).toContain("has no email address");
    expect(JOIN_ANSWER_WORDS.acceptedNotEmailed("failed")).toContain("did not go through");
    for (const why of ["not_set_up", "bad_address", "no_address", "failed"] as const) {
      expect(JOIN_ANSWER_WORDS.acceptedNotEmailed(why)).toContain("send it to them yourself");
    }
    expect(JOIN_ANSWER_WORDS.acceptedEmailed("rowan@example.test", 14)).toBe("Accepted. The invitation went to rowan@example.test. It works once and lasts 14 days.");
  });

  it("names the invitation after the request, inside the id column", () => {
    expect(joinInviteId("1730000000000-ab12c")).toBe("inv-join-1730000000000-ab12c");
    expect(joinInviteId("x".repeat(200))).toHaveLength(64);
  });
});
