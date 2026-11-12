/**
 * M12 (go-live design pass): guidance longer than one line reads at body size.
 * NOTE is that style; HINT stays the one-line aside. Nothing in the shared
 * look is set under 14px except the eyebrow and the soft chip, which are
 * labels, never guidance.
 */
import { describe, expect, it } from "vitest";
import * as look from "./look";

describe("the shared type", () => {
  it("has a NOTE at body size for guidance", () => {
    expect(look.NOTE).toContain("text-base");
    expect(look.NOTE).toContain("text-muted-foreground");
    expect(look.NOTE).not.toMatch(/text-(xs|sm)\b/);
  });

  it("keeps every other text style at 14px or more, labels aside", () => {
    const labels = new Set(["EYEBROW", "CHIP_SOFT"]);
    for (const [name, cls] of Object.entries(look)) {
      if (typeof cls !== "string" || labels.has(name)) continue;
      expect(cls, name).not.toMatch(/(^|\s)text-xs\b|text-\[1[0-3]px\]/);
    }
  });
});
