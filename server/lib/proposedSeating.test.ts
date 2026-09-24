/**
 * A proposed seating carries a reference and never a person. These cases are
 * the ways a producer would get that wrong, including the two that look most
 * reasonable from the outside.
 */
import { describe, expect, it } from "vitest";
import { newSubjectRef } from "./subjectRefs";
import { readProposedSeating, refusalSentence } from "./proposedSeating";

const ref = newSubjectRef();

describe("reading a proposed seating", () => {
  it("takes a seat and a reference, which is the whole allowed shape", () => {
    const r = readProposedSeating({ orgRoleId: "role-7", subjectRef: ref });
    expect(r).toEqual({ ok: true, seating: { orgRoleId: "role-7", subjectRef: ref } });
  });

  it("REFUSES A NAME, even beside a perfectly good reference", () => {
    // The tempting shape: a producer sends the reference AND the name, meaning
    // to be helpful. The name is the thing that must never arrive, and having
    // sent a valid reference too does not earn it passage.
    const r = readProposedSeating({ orgRoleId: "role-7", subjectRef: ref, displayName: "Kyleen" });
    expect(r).toEqual({ ok: false, refusal: { why: "named-a-person", key: "displayName" } });
  });

  it("refuses this village's own member id, because no outside system asserts one", () => {
    const r = readProposedSeating({ orgRoleId: "role-7", subjectRef: ref, userId: "u_123" });
    expect(r).toEqual({ ok: false, refusal: { why: "named-a-person", key: "userId" } });
  });

  it("refuses the snake-case spellings too, which is how the same mistake arrives twice", () => {
    for (const key of ["user_id", "display_name"]) {
      const r = readProposedSeating({ orgRoleId: "role-7", subjectRef: ref, [key]: "x" });
      expect(r).toEqual({ ok: false, refusal: { why: "named-a-person", key } });
    }
  });

  it("refuses an address or a bare name on the seating itself", () => {
    expect(readProposedSeating({ orgRoleId: "r", subjectRef: ref, email: "a@example.test" })).toEqual({
      ok: false,
      refusal: { why: "named-a-person", key: "email" },
    });
    expect(readProposedSeating({ orgRoleId: "r", subjectRef: ref, name: "Mika" })).toEqual({
      ok: false,
      refusal: { why: "named-a-person", key: "name" },
    });
  });

  it("CHECKS FOR A PERSON BEFORE IT CHECKS THE SHAPE", () => {
    // A record that names somebody AND is malformed is refused for naming
    // somebody. Reporting the shape problem would send a producer off to fix
    // the wrong thing and leave the name arriving on the next attempt.
    const r = readProposedSeating({ displayName: "Kyleen" });
    expect(r).toEqual({ ok: false, refusal: { why: "named-a-person", key: "displayName" } });
  });

  it("refuses a reference in a shape this village does not issue", () => {
    // A vendor's own identifier for a person is exactly the thing that must not
    // become a seating. It is theirs, it is stable, and it is not ours.
    const r = readProposedSeating({ orgRoleId: "role-7", subjectRef: "notion-page-3e30a88e" });
    expect(r).toEqual({ ok: false, refusal: { why: "malformed-subject-ref" } });
  });

  it("says when a seating names nobody, and when it names no seat", () => {
    expect(readProposedSeating({ orgRoleId: "role-7" })).toEqual({
      ok: false,
      refusal: { why: "no-subject-ref" },
    });
    expect(readProposedSeating({ subjectRef: ref })).toEqual({ ok: false, refusal: { why: "no-seat" } });
  });

  it("answers a refusal for every shape a producer can send, instead of throwing", () => {
    for (const bad of [null, undefined, 42, "text", [], true]) {
      expect(readProposedSeating(bad)).toEqual({ ok: false, refusal: { why: "no-seat" } });
    }
  });

  it("gives a steward a sentence for every refusal, naming the offending field", () => {
    expect(refusalSentence({ why: "named-a-person", key: "displayName" })).toContain("displayName");
    expect(refusalSentence({ why: "named-a-person", key: "displayName" })).toContain("never names one");
    expect(refusalSentence({ why: "no-subject-ref" })).toContain("by whom");
    expect(refusalSentence({ why: "no-seat" })).toContain("which seat");
    expect(refusalSentence({ why: "malformed-subject-ref" })).toContain("does not issue");
  });
});
