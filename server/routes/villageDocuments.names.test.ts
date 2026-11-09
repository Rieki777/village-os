/**
 * The filename a document download is offered under (`safeDownloadName`).
 *
 * The name comes from the uploader, so CodeQL's js/polynomial-redos flagged
 * the trim of leading and trailing dashes: `/^-+|-+$/` retries the trailing
 * alternative from every dash, which is quadratic in a long run of them. The
 * trim is now a linear scan; these cases pin that it reads the same and that a
 * hostile name returns at once.
 */
import { describe, expect, it } from "vitest";
import { safeDownloadName } from "./villageDocuments";

describe("safeDownloadName", () => {
  it("keeps letters, digits, dots, dashes and underscores, and trims the dashes at either end", () => {
    expect(safeDownloadName("Our plan (v2).pdf", "document.pdf")).toBe("Our-plan-v2-.pdf");
    expect(safeDownloadName("--notes--.md", "document.md")).toBe("notes--.md");
    expect(safeDownloadName("  ünïcode name  ", "document.md")).toBe("n-code-name");
    expect(safeDownloadName("a_b.c-d", "x")).toBe("a_b.c-d");
  });

  it("falls back on an empty, dot-only or all-dash name", () => {
    expect(safeDownloadName("", "document.pdf")).toBe("document.pdf");
    expect(safeDownloadName("..", "document.pdf")).toBe("document.pdf");
    expect(safeDownloadName(".", "document.pdf")).toBe("document.pdf");
    expect(safeDownloadName("-----", "document.pdf")).toBe("document.pdf");
    expect(safeDownloadName(null as unknown as string, "document.pdf")).toBe("document.pdf");
  });

  it("caps the name at 120 characters", () => {
    expect(safeDownloadName("a".repeat(300), "x")).toBe("a".repeat(120));
  });

  it("answers at once for a name made of a long run of dashes", () => {
    // A dash run between two letters is the shape that is slow: the old
    // pattern tried `-+$` from every dash and failed at the final letter, and
    // took 2.7 seconds on this input on a developer machine.
    const hostile = `a${"-".repeat(80_000)}a`;
    const started = performance.now();
    expect(safeDownloadName(hostile, "document.pdf")).toBe(`a${"-".repeat(119)}`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
