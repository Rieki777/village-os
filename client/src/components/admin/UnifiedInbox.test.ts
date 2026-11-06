// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { inboxItem, inboxViewFrom, rememberInboxView } from "./UnifiedInbox";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/admin?tab=home");
});

describe("unified inbox", () => {
  it("suggests a next step and remembers the view", () => {
    expect(inboxItem("requests", "1", "Ada", "submissions").next).toBe("Open it and answer.");
    expect(inboxItem("sera", "2", "", "modules").title).toBe("Untitled");
    rememberInboxView("feedback");
    expect(window.location.search).toContain("inbox=feedback");
    expect(inboxViewFrom("")).toBe("feedback");
    expect(inboxViewFrom("?inbox=requests")).toBe("requests");
  });
});
