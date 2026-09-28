/**
 * The notebook's one validator, for the form and the route alike (plan 5.5).
 */
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TEXT_MAX,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_WORDS,
  cleanTitle,
  kindFromFileName,
  parseTextDocument,
} from "./villageDocuments";

describe("parseTextDocument", () => {
  it("takes pasted, Markdown and plain text, and normalises line endings", () => {
    for (const kind of ["paste", "md", "txt"] as const) {
      const r = parseTextDocument({ kind, title: " Our  notes\n", body: "a\r\nb\rc" });
      expect(r, kind).toEqual({ ok: true, doc: { kind, title: "Our notes", body: "a\nb\nc" } });
    }
  });

  it("refuses a stored kind on the text path, and anything that is not a kind", () => {
    for (const kind of ["pdf", "docx", "html", undefined]) {
      expect(parseTextDocument({ kind, title: "t", body: "b" })).toEqual({ ok: false, error: DOCUMENT_WORDS.kindUnknown });
    }
  });

  it("refuses a binary file that arrived as text", () => {
    expect(parseTextDocument({ kind: "txt", title: "t", body: "%PDF-1.4\u0000\u0001" })).toEqual({ ok: false, error: DOCUMENT_WORDS.notText });
  });

  it("refuses an empty body, a missing title and a title or body past its limit", () => {
    expect(parseTextDocument({ kind: "paste", title: "t", body: "   \n " })).toEqual({ ok: false, error: DOCUMENT_WORDS.textMissing });
    expect(parseTextDocument({ kind: "paste", title: "", body: "b" })).toEqual({ ok: false, error: DOCUMENT_WORDS.titleMissing });
    expect(parseTextDocument({ kind: "paste", title: "x".repeat(DOCUMENT_TITLE_MAX + 1), body: "b" })).toEqual({ ok: false, error: DOCUMENT_WORDS.titleTooLong });
    expect(parseTextDocument({ kind: "paste", title: "t", body: "x".repeat(DOCUMENT_TEXT_MAX + 1) })).toEqual({ ok: false, error: DOCUMENT_WORDS.textTooLong });
    expect(parseTextDocument({ kind: "paste", title: "t", body: "x".repeat(DOCUMENT_TEXT_MAX) }).ok).toBe(true);
  });
});

describe("kindFromFileName", () => {
  it("names the four file kinds the notebook takes, and nothing else", () => {
    expect(kindFromFileName("Notes.MD")).toBe("md");
    expect(kindFromFileName("notes.markdown")).toBe("md");
    expect(kindFromFileName("a.txt")).toBe("txt");
    expect(kindFromFileName("Statutes.pdf")).toBe("pdf");
    expect(kindFromFileName("minutes.docx")).toBe("docx");
    for (const n of ["minutes.doc", "photo.jpg", "page.html", "noext", ""]) expect(kindFromFileName(n), n).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("makes one line of it", () => {
    expect(cleanTitle("A\tsplit\r\ntitle  ")).toBe("A split title");
    expect(cleanTitle(undefined)).toBe("");
  });
});
