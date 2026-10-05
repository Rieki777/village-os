/**
 * Every value here was chosen because a check someone would write by eye lets
 * it through. The tab case is the reason the helper exists: the URL parser
 * drops the tab, and "/<tab>/evil.example" becomes https://evil.example/.
 */
import { describe, expect, it } from "vitest";
import { internalPath } from "./internalPath";

describe("internalPath", () => {
  it.each([
    ["/profile", "/profile"],
    ["/admin?tab=modules&module=saberra", "/admin?tab=modules&module=saberra"],
    ["/forum/thread-1#reply-3", "/forum/thread-1#reply-3"],
    ["/", "/"],
  ])("keeps the internal path %s", (raw, kept) => {
    expect(internalPath(raw)).toBe(kept);
  });

  it.each([
    ["/\t/evil.example", "a tab the parser drops"],
    ["/\n/evil.example", "a newline the parser drops"],
    ["/\r\n/evil.example", "a carriage return"],
    ["/\u0000/evil.example", "a NUL"],
    ["//evil.example", "protocol-relative"],
    ["/\\evil.example", "a backslash the parser reads as a slash"],
    ["/.\\/evil.example", "a backslash after a dot segment"],
    ["https://evil.example/", "an absolute URL"],
    ["javascript:alert(1)", "a script URL"],
    ["evil.example", "a bare host"],
    ["", "nothing"],
  ])("refuses %j (%s)", (raw) => {
    expect(internalPath(raw)).toBeNull();
  });

  it("refuses a dot segment that parses into a path beginning //", () => {
    // Inside a full URL this is the same site, but returned on its own it
    // would be protocol-relative, so it is refused.
    expect(internalPath("/.//evil.example")).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(internalPath(null)).toBeNull();
    expect(internalPath(undefined)).toBeNull();
    expect(internalPath(42)).toBeNull();
  });

  it("returns the parsed form, so what is navigated to is what was checked", () => {
    expect(internalPath("/a/../profile")).toBe("/profile");
  });
});
