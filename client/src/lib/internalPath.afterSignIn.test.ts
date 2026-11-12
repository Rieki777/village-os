import { describe, expect, it } from "vitest";
import { PROFILE_TODAY, afterSignIn } from "./internalPath";

describe("where a member lands after signing in", () => {
  it("is Profile Today, for everyone, with no `next`", () => {
    expect(PROFILE_TODAY).toBe("/profile");
    expect(afterSignIn(null)).toBe("/profile");
    expect(afterSignIn(undefined)).toBe("/profile");
  });
  it("goes back to the members-only page a sign-in started from, and never offsite", () => {
    expect(afterSignIn("/quests")).toBe("/quests");
    expect(afterSignIn("https://evil.example/")).toBe("/profile");
    expect(afterSignIn("//evil.example")).toBe("/profile");
  });
});
