import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_WORDS,
  PROPOSAL_LINKS_MAX,
  filesOf,
  linksOf,
  parseProposalLinks,
  proposalFileKind,
  safeFileName,
  safeHttpsUrl,
  sniffProposalFile,
} from "./proposalAttachments";

const bytes = (...b: number[]) => Uint8Array.from(b);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16);
const zipWith = (part: string) => Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...Array.from(new TextEncoder().encode(`....${part}....`))]);

describe("a proposal's links (Rye, 10 Nov 2026)", () => {
  it("keeps https links with a label, as the URL parser writes them", () => {
    const r = parseProposalLinks([{ label: " My  portfolio ", url: "https://work.example.org/me" }]);
    expect(r).toEqual({ ok: true, links: [{ label: "My portfolio", url: "https://work.example.org/me" }] });
  });

  it("drops blank rows and keeps none when none was sent", () => {
    expect(parseProposalLinks([{ label: "", url: "" }, { label: " ", url: " " }])).toEqual({ ok: true, links: [] });
    expect(parseProposalLinks(undefined)).toEqual({ ok: true, links: [] });
  });

  it("refuses anything that is not a plain https address", () => {
    for (const url of [
      "http://work.example.org",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://bank.example.org@evil.example.org/",
      "https://user:pass@work.example.org/",
      "https://localhost/",
      "https://work.example.org/a b",
      "work.example.org",
    ]) {
      expect(safeHttpsUrl(url), url).toBeNull();
      expect(parseProposalLinks([{ label: "x", url }])).toEqual({ ok: false, error: ATTACHMENT_WORDS.linkNotHttps });
    }
  });

  it("asks for a label, refuses a sixth link and the same link twice", () => {
    expect(parseProposalLinks([{ label: "", url: "https://a.example.org" }])).toEqual({ ok: false, error: ATTACHMENT_WORDS.linkNeedsLabel });
    const six = Array.from({ length: PROPOSAL_LINKS_MAX + 1 }, (_, i) => ({ label: `L${i}`, url: `https://a.example.org/${i}` }));
    expect(parseProposalLinks(six)).toEqual({ ok: false, error: ATTACHMENT_WORDS.tooManyLinks });
    expect(parseProposalLinks(six.slice(0, PROPOSAL_LINKS_MAX))).toMatchObject({ ok: true });
    expect(parseProposalLinks([{ label: "a", url: "https://a.example.org/" }, { label: "b", url: "https://A.example.org/" }])).toEqual({ ok: false, error: ATTACHMENT_WORDS.sameLinkTwice });
  });

  it("reads stored links back safely, dropping any that would not pass today", () => {
    expect(linksOf([{ label: "ok", url: "https://a.example.org/" }, { label: "bad", url: "javascript:x" }, "junk"])).toEqual([{ label: "ok", url: "https://a.example.org/" }]);
    expect(linksOf("nope")).toEqual([]);
  });
});

describe("a proposal's files are what their bytes say", () => {
  it("knows the four kinds by their first bytes", () => {
    expect(sniffProposalFile(PDF)).toBe("pdf");
    expect(sniffProposalFile(PNG)).toBe("png");
    expect(sniffProposalFile(JPG)).toBe("jpg");
    expect(sniffProposalFile(zipWith("word/document.xml"))).toBe("docx");
  });

  it("refuses any other zip, a script, and an empty file", () => {
    expect(sniffProposalFile(zipWith("xl/workbook.xml"))).toBeNull();
    expect(sniffProposalFile(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffProposalFile(new TextEncoder().encode("MZ\x90\x00"))).toBeNull();
    expect(sniffProposalFile(bytes())).toBeNull();
  });

  it("refuses a name whose extension disagrees with the bytes", () => {
    expect(proposalFileKind("cv.pdf", PDF)).toBe("pdf");
    expect(proposalFileKind("photo.JPEG", JPG)).toBe("jpg");
    expect(proposalFileKind("cv.pdf", PNG)).toBeNull();
    expect(proposalFileKind("page.html", PDF)).toBeNull();
    expect(proposalFileKind("cv", PDF)).toBeNull();
  });

  it("shows a name with no path and no markup characters", () => {
    expect(safeFileName("C:\\Users\\me\\My <CV>.pdf", "pdf")).toBe("My CV.pdf");
    expect(safeFileName("../../etc/passwd.png", "png")).toBe("passwd.png");
    expect(safeFileName("", "jpg")).toBe("file.jpg");
  });

  it("reads stored files back safely", () => {
    const good = { id: "pf-0123456789abcdef", kind: "pdf", name: "cv.pdf", size: 10, sha256: "a".repeat(64) };
    expect(filesOf([good, { ...good, id: "../x" }, { ...good, kind: "exe" }, { ...good, size: -1 }])).toEqual([good]);
  });
});
