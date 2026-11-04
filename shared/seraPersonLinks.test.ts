import { describe, expect, it } from "vitest";
import { LINK_WORDS, ownerTail, seraOwnerIdProblem } from "./seraPersonLinks";

describe("the Sera owner id a steward pastes", () => {
  it("takes an id shaped like the library's own", () => {
    expect(seraOwnerIdProblem("36c0a88e-f36a-8170-8a66-e86fd178c6b2")).toBeNull();
    expect(seraOwnerIdProblem("  36c0a88e-f36a-8170-8a66-e86fd178c6b2  ")).toBeNull();
  });

  it("refuses an empty paste and a paste that is not an id", () => {
    expect(seraOwnerIdProblem("")).toBe(LINK_WORDS.idMissing);
    expect(seraOwnerIdProblem(undefined)).toBe(LINK_WORDS.idMissing);
    expect(seraOwnerIdProblem("Jane Doe")).toBe(LINK_WORDS.idShape);
    expect(seraOwnerIdProblem("https://example.com/x")).toBe(LINK_WORDS.idShape);
    expect(seraOwnerIdProblem("abc")).toBe(LINK_WORDS.idShape);
  });

  it("shows only the last six characters of a linked id", () => {
    expect(ownerTail("36c0a88e-f36a-8170-8a66-e86fd178c6b2")).toBe("78c6b2");
  });
});
