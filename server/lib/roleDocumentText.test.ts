/**
 * The words out of a member's document (server/lib/roleDocumentText.ts):
 * each kind it reads, each it refuses, the caps, and the Google Doc fetch's
 * host allowlist, redirects, timeout and size cap. Every document is built
 * here, a real zip for the .docx and a real PDF, so no binary is committed.
 */
import zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_WORDS,
  docxXmlText,
  extractRoleDocumentText,
  fetchGoogleDocText,
  googleDocId,
  ROLE_DOCUMENT_MAX_BYTES,
  ROLE_DOCUMENT_TEXT_MAX,
  zipEntry,
} from "./roleDocumentText";

// ── Builders ────────────────────────────────────────────────────────────────

/** A zip of the given entries, deflated, with its central directory. */
export function makeZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const para = (text: string, opts: { style?: string; list?: boolean } = {}) =>
  `<w:p><w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ""}${opts.list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}</w:pPr>${text
    .split("|")
    .map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`)
    .join("")}</w:p>`;

/** A Word document whose body is these paragraphs. */
export function makeDocx(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr/></w:body></w:document>`;
  return makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": xml });
}

/** A one-page PDF, each line drawn on its own line in Helvetica. */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const CARD_LINES = ["Riverbend role card v1", "## Role title", "Orchard keeper", "### Purpose", "Keep the orchard bearing."];

// ── Files ───────────────────────────────────────────────────────────────────

describe("extracting a document's words", () => {
  it("reads a .docx: paragraphs a line, headings as # lines, list paragraphs as - lines, entities and breaks", async () => {
    const docx = makeDocx([
      para("Riverbend role card v1"),
      para("Role title", { style: "Heading2" }),
      para("Orchard keeper"),
      para("What I can decide on my own", { style: "Heading3" }),
      para("When to prune", { list: true }),
      para("Which trees &amp; |when", { list: true }),
      `<w:p><w:r><w:t>One</w:t><w:br/><w:t>two</w:t><w:tab/><w:t>three</w:t></w:r></w:p>`,
      `<w:p><w:del><w:r><w:delText>struck out</w:delText></w:r></w:del></w:p>`,
    ]);
    const r = await extractRoleDocumentText({ bytes: docx, filename: "my role.docx" });
    expect(r).toEqual({
      ok: true,
      kind: "docx",
      text: "Riverbend role card v1\n## Role title\nOrchard keeper\n### What I can decide on my own\n- When to prune\n- Which trees & when\nOne\ntwo\tthree",
    });
  });

  it("reads a .pdf, a line where the page ends one", async () => {
    const r = await extractRoleDocumentText({ bytes: makePdf(CARD_LINES), filename: "card.pdf" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("pdf");
    expect(r.text.split("\n").map((l) => l.trim())).toEqual(CARD_LINES);
  });

  it("reads .md and .txt as UTF-8, and UTF-16 with its mark", async () => {
    const md = await extractRoleDocumentText({ bytes: Buffer.from(`${CARD_LINES.join("\r\n")}\r\n`, "utf8"), filename: "card.md" });
    expect(md).toEqual({ ok: true, kind: "md", text: CARD_LINES.join("\n") });
    const txt = await extractRoleDocumentText({ bytes: Buffer.from("﻿Café keeper role", "utf8"), filename: "notes.txt" });
    expect(txt).toEqual({ ok: true, kind: "txt", text: "Café keeper role" });
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Gate keeper", "utf16le")]);
    expect(await extractRoleDocumentText({ bytes: le, filename: "x.txt" })).toEqual({ ok: true, kind: "txt", text: "Gate keeper" });
  });

  it("reads the bytes, never the name: a PDF called .txt is read as a PDF", async () => {
    const r = await extractRoleDocumentText({ bytes: makePdf(["Gate keeper"]), filename: "notes.txt" });
    expect(r.ok && r.kind).toBe("pdf");
  });

  it.each([
    ["an older Word file", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]), 415, DOCUMENT_WORDS.oldWord],
    ["a zip that is not a Word document", makeZip({ "readme.txt": "hello" }), 415, DOCUMENT_WORDS.notWord],
    ["a broken zip", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]), 422, DOCUMENT_WORDS.brokenWord],
    ["a picture", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), 415, DOCUMENT_WORDS.wrongKind],
    ["an empty file", Buffer.alloc(0), 422, DOCUMENT_WORDS.noText],
    ["a file of blank space", Buffer.from("   \n\n  "), 422, DOCUMENT_WORDS.noText],
    ["a broken PDF", Buffer.from("%PDF-1.7\nnot really a pdf"), 422, DOCUMENT_WORDS.brokenPdf],
  ])("refuses %s, saying what to do", async (_name, bytes, status, error) => {
    expect(await extractRoleDocumentText({ bytes, filename: "x" })).toEqual({ ok: false, status, error });
  });

  it("refuses a file over 5 MB, and text over 60,000 characters", async () => {
    expect(await extractRoleDocumentText({ bytes: Buffer.alloc(ROLE_DOCUMENT_MAX_BYTES + 1, 0x61), filename: "big.txt" })).toEqual({ ok: false, status: 413, error: DOCUMENT_WORDS.tooBig });
    expect(await extractRoleDocumentText({ bytes: Buffer.from("a".repeat(ROLE_DOCUMENT_TEXT_MAX + 1)), filename: "long.txt" })).toEqual({ ok: false, status: 413, error: DOCUMENT_WORDS.tooLong });
  });

  it("stops inflating a Word document past its cap", () => {
    const zip = makeZip({ "word/document.xml": "x".repeat(10_000) });
    expect(() => zipEntry(zip, "word/document.xml", 100)).toThrow();
    expect(zipEntry(zip, "word/document.xml", 20_000)!.length).toBe(10_000);
  });

  it("reads a paragraph with no runs as an empty line, and a self-closed paragraph too", () => {
    expect(docxXmlText("<w:p/><w:p><w:r><w:t>A</w:t></w:r></w:p>")).toBe("\nA");
  });
});

// ── Google Docs ─────────────────────────────────────────────────────────────

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-";
const LINK = `https://docs.google.com/document/d/${ID}/edit?usp=sharing`;
const EXPORT = `https://docs.google.com/document/d/${ID}/export?format=txt`;

const reply = (status: number, body = "", headers: Record<string, string> = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers });

describe("a Google Doc link", () => {
  it.each([
    [LINK, ID],
    [`https://docs.google.com/document/d/${ID}`, ID],
    [`https://docs.google.com/document/u/1/d/${ID}/view`, ID],
    [`http://docs.google.com/document/d/${ID}/edit`, null],
    [`https://drive.google.com/file/d/${ID}/view`, null],
    [`https://docs.google.com.evil.example/document/d/${ID}/edit`, null],
    [`https://evil.example/https://docs.google.com/document/d/${ID}`, null],
    [`https://user:pw@docs.google.com/document/d/${ID}/edit`, null],
    [`https://docs.google.com:8443/document/d/${ID}/edit`, null],
    [`https://docs.google.com/spreadsheets/d/${ID}/edit`, null],
    [`https://docs.google.com/document/d/short/edit`, null],
    ["not a link at all", null],
  ])("%s reads as %s", (link, id) => {
    expect(googleDocId(link)).toBe(id);
  });

  it("fetches only the export it builds, and answers its words", async () => {
    const f = vi.fn(async () => reply(200, "﻿Riverbend role card v1\r\n## Role title\r\nGate keeper", { "content-type": "text/plain; charset=utf-8" }));
    expect(await fetchGoogleDocText(LINK, { fetch: f as any })).toEqual({ ok: true, kind: "google-doc", text: "Riverbend role card v1\n## Role title\nGate keeper" });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any[])[0]).toBe(EXPORT);
    expect((f.mock.calls[0] as any[])[1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to Google's own export host", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(307, "", { location: "https://doc-0s-1c-docs.googleusercontent.com/export/abc" }))
      .mockResolvedValueOnce(reply(200, "Gate keeper", { "content-type": "text/plain" }));
    expect(await fetchGoogleDocText(LINK, { fetch: f })).toEqual({ ok: true, kind: "google-doc", text: "Gate keeper" });
    expect(f.mock.calls[1][0]).toBe("https://doc-0s-1c-docs.googleusercontent.com/export/abc");
  });

  it.each([
    ["a sign-in redirect", [reply(302, "", { location: "https://accounts.google.com/ServiceLogin?continue=x" })], 403, DOCUMENT_WORDS.notShared],
    ["a redirect off Google", [reply(302, "", { location: "https://evil.example/steal" })], 403, DOCUMENT_WORDS.notShared],
    ["a redirect to plain http", [reply(302, "", { location: "http://docs.google.com/x" })], 403, DOCUMENT_WORDS.notShared],
    ["Google's sign-in page as HTML", [reply(200, "<html>Sign in</html>", { "content-type": "text/html" })], 403, DOCUMENT_WORDS.notShared],
    ["a 403", [reply(403)], 403, DOCUMENT_WORDS.notShared],
    ["a 404", [reply(404)], 404, DOCUMENT_WORDS.noDoc],
    ["a 500", [reply(500)], 502, DOCUMENT_WORDS.googleFailed],
  ])("refuses %s, and fetches nothing it was not built to", async (_name, answers, status, error) => {
    const f = vi.fn();
    for (const a of answers) f.mockResolvedValueOnce(a);
    expect(await fetchGoogleDocText(LINK, { fetch: f })).toEqual({ ok: false, status, error });
    expect(f).toHaveBeenCalledTimes(answers.length);
  });

  it("stops after three redirects", async () => {
    const f = vi.fn(async () => reply(302, "", { location: "https://docs.google.com/again" }));
    expect(await fetchGoogleDocText(LINK, { fetch: f as any })).toEqual({ ok: false, status: 502, error: DOCUMENT_WORDS.googleFailed });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("refuses any other link without fetching at all", async () => {
    const f = vi.fn();
    expect(await fetchGoogleDocText("https://example.org/my-role.txt", { fetch: f })).toEqual({ ok: false, status: 400, error: DOCUMENT_WORDS.notGoogleDoc });
    expect(f).not.toHaveBeenCalled();
  });

  it("gives up when Google is slow, within the timeout", async () => {
    const f = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    );
    const started = Date.now();
    expect(await fetchGoogleDocText(LINK, { fetch: f as any, timeoutMs: 50 })).toEqual({ ok: false, status: 504, error: DOCUMENT_WORDS.slow });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses a document over the size cap, by its length or while it streams", async () => {
    const declared = vi.fn(async () => reply(200, "x", { "content-type": "text/plain", "content-length": "5000" }));
    expect(await fetchGoogleDocText(LINK, { fetch: declared as any, maxBytes: 1000 })).toEqual({ ok: false, status: 413, error: DOCUMENT_WORDS.docTooBig });
    const streamed = vi.fn(async () => reply(200, "y".repeat(5000), { "content-type": "text/plain" }));
    expect(await fetchGoogleDocText(LINK, { fetch: streamed as any, maxBytes: 1000 })).toEqual({ ok: false, status: 413, error: DOCUMENT_WORDS.docTooBig });
  });
});
