import { describe, expect, it } from "vitest";
import { suggestionsFromReply } from "./roleDiscover";

describe("the guide's reply on the discover step", () => {
  const sent = new Set(["a", "b", "c", "d"]);
  it("keeps only role ids that were sent, once each, at most three", () => {
    const text = JSON.stringify({ suggestions: [{ roleId: "a", why: "x" }, { roleId: "a", why: "again" }, { roleId: "zz", why: "unknown" }, { roleId: "b", why: "y" }, { roleId: "c", why: "z" }, { roleId: "d", why: "w" }] });
    expect(suggestionsFromReply(text, sent).map((s) => s.roleId)).toEqual(["a", "b", "c"]);
  });
  it("removes dashes between words and clips long lines", () => {
    const [s] = suggestionsFromReply(JSON.stringify({ suggestions: [{ roleId: "a", why: `You grow food — and share it ${"x".repeat(400)}` }] }), sent);
    expect(s.why).not.toMatch(/[–—]/);
    expect(s.why.length).toBeLessThanOrEqual(200);
  });
  it("answers nothing for prose or a broken reply", () => {
    expect(suggestionsFromReply("I think the first one.", sent)).toEqual([]);
    expect(suggestionsFromReply("", sent)).toEqual([]);
  });
});
