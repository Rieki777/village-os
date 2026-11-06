import { describe, expect, it } from "vitest";
import { pageUrlForRecord } from "./feedback";

/**
 * The page a piece of feedback came from is stored, and relayed to the hub
 * (R051). The client sends `document.referrer`, and a referrer can be the
 * set-password page with its token still in the query string. The record
 * keeps where the page is, never what was in its address after it.
 */
describe("the page a piece of feedback came from", () => {
  it("keeps the origin and path, and drops the query and the fragment", () => {
    expect(pageUrlForRecord("https://willow.example/set-password?token=abc.def#top")).toBe("https://willow.example/set-password");
    expect(pageUrlForRecord("https://willow.example/quests/q-1")).toBe("https://willow.example/quests/q-1");
  });

  it("does the same for a path with no origin", () => {
    expect(pageUrlForRecord("/claim?token=abc")).toBe("/claim");
    expect(pageUrlForRecord("/forum#reply-3")).toBe("/forum");
  });

  it("stores nothing for nothing, and stays inside the column", () => {
    expect(pageUrlForRecord(undefined)).toBeNull();
    expect(pageUrlForRecord("")).toBeNull();
    expect(pageUrlForRecord(`https://willow.example/${"a".repeat(600)}`)?.length).toBe(500);
  });
});
