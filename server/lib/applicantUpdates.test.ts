import { describe, expect, it } from "vitest";
import { withoutStatusLink } from "./applicantUpdates";

describe("withoutStatusLink", () => {
  it("drops the status page link line and the blank lines before it", () => {
    expect(withoutStatusLink("Your proposal was read.\n\nYour status page link: https://x.test/s/1\n")).toBe("Your proposal was read.");
  });

  it("keeps the words after the link line", () => {
    expect(withoutStatusLink("One.\n\nYour status page link: https://x.test\nTwo.")).toBe("One.\nTwo.");
  });

  it("leaves text without the line alone", () => {
    expect(withoutStatusLink("  Plain words.\nMore.  ")).toBe("Plain words.\nMore.");
  });

  it("does not hang on a very long run of newlines", () => {
    const text = "a" + "\n".repeat(200_000) + "Your status page link" + "\n".repeat(200_000) + "z";
    const t0 = Date.now();
    const out = withoutStatusLink(text);
    expect(out.startsWith("a\n") && out.endsWith("z") && !out.includes("status page link")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
    const noMatch = "a" + "\n".repeat(200_000) + "Your status page lin";
    const t1 = Date.now();
    withoutStatusLink(noMatch);
    expect(Date.now() - t1).toBeLessThan(1000);
  });
});
