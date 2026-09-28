/**
 * The notebook panel's small pure helpers (plan 5.5 and 5.6).
 */
import { describe, expect, it } from "vitest";
import { combinedName, combinedPack, dayWords, exportStatusLine, refusal, sizeWords, NOTEBOOK_WORDS } from "./notebookCopy";

describe("exportStatusLine", () => {
  it("says there was no export, that something changed, or that nothing did", () => {
    expect(exportStatusLine(null)).toBe("You have not taken the canvas with you yet.");
    expect(exportStatusLine({ lastExportAt: null, changedSince: null })).toBe("You have not taken the canvas with you yet.");
    expect(exportStatusLine({ lastExportAt: "2026-09-20T10:00:00.000Z", changedSince: true })).toBe(
      "Something has changed since your last export on 20 September 2026. Export again to take the new version.",
    );
    expect(exportStatusLine({ lastExportAt: "2026-09-20T10:00:00.000Z", changedSince: false })).toBe("Nothing has changed since your last export on 20 September 2026.");
  });
});

describe("combinedPack", () => {
  it("puts the README first, keeps every file whole, and names the file by its date", () => {
    const one = combinedPack([
      { name: "canvas.md", content: "# canvas\n" },
      { name: "our-documents.md", content: "# docs\n" },
      { name: "README.md", content: "# readme\n" },
      { name: "resources.md", content: "# resources\n" },
    ]);
    expect(one.indexOf("# readme")).toBeLessThan(one.indexOf("# canvas"));
    expect(one.indexOf("# resources")).toBeLessThan(one.indexOf("# docs"));
    expect(one.split("\n---\n")).toHaveLength(4);
    expect(combinedName("2026-09-28T10:00:00.000Z")).toBe("canvas-pack-2026-09-28.md");
  });
});

describe("sizeWords and dayWords", () => {
  it("counts text in characters and files in KB or MB", () => {
    expect(sizeWords("paste", 1)).toBe("1 character");
    expect(sizeWords("md", 12345)).toBe("12,345 characters");
    expect(sizeWords("pdf", 300)).toBe("1 KB");
    expect(sizeWords("pdf", 3 * 1024 * 1024)).toBe("3.0 MB");
    expect(dayWords("2026-09-28T23:30:00.000Z")).toBe("28 September 2026");
    expect(dayWords(null)).toBe("");
  });
});

describe("refusal", () => {
  it("asks for a sign-in on a 401 and otherwise passes the server's own sentence on", () => {
    expect(refusal(401, "auth_required")).toBe(NOTEBOOK_WORDS.signIn);
    expect(refusal(403, "The canvas is for members.")).toBe("The canvas is for members.");
    expect(refusal(500, undefined)).toBe(NOTEBOOK_WORDS.failed);
  });
});
