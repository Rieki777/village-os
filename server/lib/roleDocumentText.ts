/**
 * "BRING IN A DESCRIPTION OF YOUR ROLE": the words out of a member's own
 * document, read on the server and never kept (Rye, 2026-10-24).
 *
 *   extractRoleDocumentText({ bytes, filename })   a .docx, .pdf, .md or .txt file
 *   fetchGoogleDocText(link)                       a Google Doc shared as "anyone with the link"
 *
 * Both answer `{ ok: true, kind, text }` or `{ ok: false, status, error }`,
 * the error a sentence a member reads. Nothing here writes anywhere: the
 * bytes arrive in memory (multer's memoryStorage), the text goes back to the
 * route that asked, and both are dropped when the request ends. The route
 * hands the text to the one reader (shared/roleCardText.ts) or to the AI half.
 *
 * ── WHAT IS READ, AND HOW ──────────────────────────────────────────────────
 *
 * The kind is read from the BYTES, never from the name or the claimed type,
 * the rule the uploads door keeps (`sniffKind`, server/lib/uploads.ts):
 *
 *   PDF   `%PDF`. Read with unpdf (a serverless build of Mozilla's PDF.js,
 *         MIT, no dependencies of its own), on a worker thread of its own that
 *         imports it only when a PDF arrives, so boot pays nothing and a
 *         crafted file cannot hold the server. Lines are kept where the PDF
 *         ends them.
 *   DOCX  a zip holding `word/document.xml`. Read here with node:zlib and no
 *         library: one entry out of the zip, inflated with a cap on its size,
 *         then paragraphs and their text. A Word heading comes out as a `#`
 *         line and a list paragraph as a "- " line, so a role card typed in
 *         Word reads like one typed anywhere else.
 *   TEXT  UTF-8 (or UTF-16 with its mark) with no NUL byte: .md and .txt.
 *
 * An older .doc and anything else is refused by name with what to do.
 *
 * ── THE LIMITS ─────────────────────────────────────────────────────────────
 *
 *   ROLE_DOCUMENT_MAX_BYTES   5 MB a file (multer refuses past it first)
 *   ROLE_DOCUMENT_TEXT_MAX    60,000 characters of text, refused past it
 *   DOCX_XML_MAX_BYTES        20 MB of inflated document.xml, so a zip bomb stops early
 *   PDF_MAX_PAGES             40 pages, refused past it before any page is read
 *   PDF_PARSE_TIMEOUT_MS      10 seconds for the whole PDF read, then its worker is ended
 *   PDF_WORKER_HEAP_MB        256 MB of heap for the worker reading one PDF
 *   GOOGLE_DOC_TIMEOUT_MS     10 seconds for the whole fetch, redirects included
 *   GOOGLE_DOC_MAX_BYTES      1 MB of exported text
 *
 * ── THE GOOGLE DOC FETCH ───────────────────────────────────────────────────
 *
 * The link is never fetched as given. Its document id is read out of a
 * `https://docs.google.com/document/d/<id>/...` link, anything else is
 * refused, and the server fetches the plain-text export it builds itself:
 * `https://docs.google.com/document/d/<id>/export?format=txt`. Redirects are
 * followed by hand, at most three, and only to docs.google.com or a
 * googleusercontent.com host. A sign-in page, an HTML answer or a 401, 403 or
 * 404 means the document is not shared as "anyone with the link", and says so.
 */
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import zlib from "node:zlib";
import { sniffKind } from "./uploads";

export const ROLE_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ROLE_DOCUMENT_TEXT_MAX = 60_000;
export const DOCX_XML_MAX_BYTES = 20 * 1024 * 1024;
/**
 * A PDF is read on a worker thread of its own (`readPdf`), so a crafted one
 * cannot hold the server. The page cap bounds the work before it starts, the
 * timeout ends a read that runs long, and the worker's heap cap ends one that
 * swells.
 */
export const PDF_MAX_PAGES = 40;
export const PDF_PARSE_TIMEOUT_MS = 10_000;
export const GOOGLE_DOC_TIMEOUT_MS = 10_000;
export const GOOGLE_DOC_MAX_BYTES = 1024 * 1024;

/** The kinds a member may bring in, for the file picker and the words. */
export const ROLE_DOCUMENT_ACCEPT = ".docx,.pdf,.md,.txt";

export type RoleDocumentKind = "docx" | "pdf" | "md" | "txt" | "google-doc";

export type Extracted = { ok: true; kind: RoleDocumentKind; text: string } | { ok: false; status: number; error: string };

export const DOCUMENT_WORDS = {
  wrongKind: "Bring in a .docx, .pdf, .md or .txt file, paste the words, or share a Google Doc link.",
  oldWord: "That is an older Word file. Save it as .docx or as a PDF and bring it in again.",
  notWord: "That file is a zip, and not a Word document. Bring in a .docx, .pdf, .md or .txt file.",
  brokenWord: "That Word document could not be opened. Save it again, or as a PDF, and bring it in again.",
  brokenPdf: "That PDF could not be opened. Save it again, or paste its words.",
  lockedPdf: "That PDF is locked with a password. Bring in a copy without one, or paste its words.",
  longPdf: `That PDF has more than ${PDF_MAX_PAGES} pages. Bring in the part about your role, or paste its words.`,
  slowPdf: "That PDF took too long to read. Save it as .docx, or paste its words.",
  noText: "There are no words in that document to read. A scanned page is a picture: bring in the document it came from, or paste the words.",
  tooLong: `That holds more than ${ROLE_DOCUMENT_TEXT_MAX.toLocaleString("en-US")} characters. Bring in the part about your role.`,
  tooBig: `That file is over ${ROLE_DOCUMENT_MAX_BYTES / 1024 / 1024} MB. Bring in the part about your role, or paste its words.`,
  notGoogleDoc: "That is not a Google Doc link. Paste a link that starts with https://docs.google.com/document/d/",
  notShared: 'That Google Doc is shared with some people only. Set its sharing to "anyone with the link" in Google Docs, or download it and bring in the file.',
  noDoc: "There is no Google Doc at that link.",
  slow: "Google Docs took too long to answer. Try again in a moment, or download the document and bring in the file.",
  googleFailed: "Google Docs did not send the document. Try again in a moment, or download it and bring in the file.",
  docTooBig: `That Google Doc is over ${GOOGLE_DOC_MAX_BYTES / 1024 / 1024} MB of text. Bring in the part about your role.`,
} as const;

const fail = (status: number, error: string): Extracted => ({ ok: false, status, error });

/** Text as the reader wants it: one kind of line ending, no zero-width marks, no runs of blank lines. */
export function tidyText(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍⁠]/g, "")
    .replace(/ /g, " ")
    // A bullet drawn as a glyph (Word's PDFs draw it in the Symbol font, U+F0B7) is a "- " line.
    .replace(/^[ \t]*[•●▪◦⁃‣][ \t]*/gm, "- ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function finish(kind: RoleDocumentKind, raw: string): Extracted {
  const text = tidyText(raw);
  if (!text) return fail(422, DOCUMENT_WORDS.noText);
  if (text.length > ROLE_DOCUMENT_TEXT_MAX) return fail(413, DOCUMENT_WORDS.tooLong);
  return { ok: true, kind, text };
}

// ── Text ────────────────────────────────────────────────────────────────────

/** UTF-8, or UTF-16 with its byte-order mark; null when the bytes are not text. */
export function decodeText(bytes: Buffer): string | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2, 2 + ((bytes.length - 2) & ~1));
    const swapped = Buffer.from(body);
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ── DOCX ────────────────────────────────────────────────────────────────────

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;

/**
 * One entry out of a zip, inflated, or null when the zip has no such entry.
 * Throws on a zip that cannot be read. Reads the central directory, so a
 * file written with data descriptors (sizes after the data) reads the same.
 */
export function zipEntry(zip: Buffer, name: string, maxBytes: number): Buffer | null {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
    if (zip.readUInt32LE(i) === ZIP_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("no end of central directory");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== ZIP_CENTRAL) throw new Error("bad central directory");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (entry !== name) continue;
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== ZIP_LOCAL) throw new Error("bad local header");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) {
      if (data.length > maxBytes) throw new Error("entry too large");
      return Buffer.from(data);
    }
    if (method !== 8) throw new Error(`compression method ${method}`);
    return zlib.inflateRawSync(data, { maxOutputLength: maxBytes });
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

/**
 * The words of a Word document's body, a paragraph a line. A heading style
 * becomes `#` marks by its level, a numbered or bulleted paragraph a "- "
 * line, a tab a tab and a line break a new line.
 */
export function docxXmlText(xml: string): string {
  const body = xml.replace(/<w:(?:del|instrText|delText)\b[^>]*>[\s\S]*?<\/w:(?:del|instrText|delText)>/g, "");
  const out: string[] = [];
  for (const m of Array.from(body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g))) {
    const p = m[1] ?? "";
    let line = "";
    for (const t of Array.from(p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g))) {
      if (t[1] !== undefined) line += unescapeXml(t[1]);
      else if (t[0].startsWith("<w:tab")) line += "\t";
      else line += "\n";
    }
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p)?.[1] ?? "";
    const level = /^heading\s*([1-6])$/i.exec(style)?.[1] ?? (/^title$/i.test(style) ? "1" : null);
    if (level && line.trim()) line = `${"#".repeat(Number(level))} ${line.trim()}`;
    // A list by its own numbering, or by a list style ("List Bullet", "List Paragraph"), which carries the numbering itself.
    else if ((/<w:numPr\b/.test(p) || /^list/i.test(style)) && line.trim()) line = `- ${line.trim()}`;
    out.push(line);
  }
  return out.join("\n");
}

function readDocx(bytes: Buffer): Extracted {
  let xml: Buffer | null;
  try {
    xml = zipEntry(bytes, "word/document.xml", DOCX_XML_MAX_BYTES);
  } catch {
    return fail(422, DOCUMENT_WORDS.brokenWord);
  }
  if (!xml) return fail(415, DOCUMENT_WORDS.notWord);
  return finish("docx", docxXmlText(xml.toString("utf8")));
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/**
 * A PDF IS READ ON A THREAD OF ITS OWN (the follow-up #606 named, 2026-10-31).
 *
 * PDF.js runs in a worker thread, one per read, so a crafted file that makes
 * it spin burns that thread and never the one every other request is served
 * on. #606's timeout could only abandon a read that YIELDED: a timer cannot
 * fire on a thread that never does, so until this a spinning parse held the
 * whole server for as long as it spun. Now the timer runs on the server's
 * thread, untouched, and at `PDF_PARSE_TIMEOUT_MS` the worker is ENDED, not
 * left spinning on a core.
 *
 *   memory   the worker's heap is capped (`PDF_WORKER_HEAP_MB`), so a
 *            compression bomb that inflates past it ends the worker, never
 *            the server; that reads as a broken PDF
 *   death    a worker that exits, throws or runs out of memory answers a
 *            broken PDF, once; the first answer wins and the rest are ignored
 *   words    the page cap and the text cap are applied inside the worker, as
 *            they were on the request thread
 *
 * The worker's code is the string below, evaluated, so the server bundle
 * needs no second entry point and nothing outside it to ship: it imports
 * unpdf from the path the server itself resolves (`unpdfPath`). `parser`
 * replaces that path, which is how a suite puts a PDF.js that misbehaves
 * inside the worker.
 */
export const PDF_WORKER_HEAP_MB = 256;

/** Runs inside the worker: read the words, post one answer. Plain JavaScript, evaluated. */
const PDF_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");
const send = (m) => parentPort.postMessage(m);
(async () => {
  let mod;
  try {
    mod = await import(pathToFileURL(workerData.parser).href);
  } catch {
    return send({ kind: "broken" });
  }
  const getDocumentProxy = mod.getDocumentProxy || (mod.default && mod.default.getDocumentProxy);
  if (typeof getDocumentProxy !== "function") return send({ kind: "broken" });
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(workerData.bytes), { verbosity: 0, useSystemFonts: false, disableFontFace: true });
  } catch (e) {
    return send({ kind: /password/i.test(String(e && e.name) + String(e && e.message)) ? "locked" : "broken" });
  }
  try {
    if (pdf.numPages > workerData.maxPages) return send({ kind: "long" });
    const pages = [];
    let total = 0;
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (typeof item.str === "string") text += item.str;
        if (item.hasEOL) text += "\\n";
      }
      pages.push(text);
      total += text.length;
      if (total > workerData.textCap) break;
    }
    send({ kind: "text", text: pages.join("\\n\\n") });
  } catch {
    send({ kind: "broken" });
  }
})();
`;

let resolvedUnpdf: string | null = null;

/** Where unpdf lives, resolved from this module, as the worker cannot resolve a bare name the way the server does. */
function unpdfPath(): string {
  if (!resolvedUnpdf) resolvedUnpdf = createRequire(import.meta.url).resolve("unpdf");
  return resolvedUnpdf;
}

let running = 0;

/** How many PDF workers are alive right now. For the tests that prove an abandoned one is ended. */
export function pdfWorkersRunning(): number {
  return running;
}

type WorkerAnswer = { kind: "text"; text: string } | { kind: "long" | "locked" | "broken" };

function answerOf(m: WorkerAnswer | null | undefined): Extracted {
  if (m && m.kind === "text" && typeof m.text === "string") return finish("pdf", m.text);
  if (m && m.kind === "long") return fail(413, DOCUMENT_WORDS.longPdf);
  if (m && m.kind === "locked") return fail(422, DOCUMENT_WORDS.lockedPdf);
  return fail(422, DOCUMENT_WORDS.brokenPdf);
}

/** A PDF's words, read on a worker thread and abandoned past the timeout. Exported for its tests; members reach it through extractRoleDocumentText. */
export async function readPdf(bytes: Buffer, timeoutMs = PDF_PARSE_TIMEOUT_MS, opts: { parser?: string } = {}): Promise<Extracted> {
  let parser: string;
  try {
    parser = opts.parser ?? unpdfPath();
  } catch {
    return fail(422, DOCUMENT_WORDS.brokenPdf);
  }
  let worker: Worker;
  try {
    worker = new Worker(PDF_WORKER_SOURCE, {
      eval: true,
      workerData: { bytes, parser, maxPages: PDF_MAX_PAGES, textCap: ROLE_DOCUMENT_TEXT_MAX * 2 },
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
  } catch {
    return fail(422, DOCUMENT_WORDS.brokenPdf);
  }
  running += 1;
  worker.once("exit", () => {
    running -= 1;
  });
  return new Promise<Extracted>((resolve) => {
    let done = false;
    const answer = (r: Extracted) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
      // Ended whatever it was doing: an answer that came back needs nothing more, and one that did not is spinning.
      void worker.terminate().catch(() => undefined);
    };
    const timer = setTimeout(() => answer(fail(422, DOCUMENT_WORDS.slowPdf)), timeoutMs);
    worker.once("message", (m: WorkerAnswer) => answer(answerOf(m)));
    // Out of memory, a throw, or an exit before an answer: a broken PDF, said once.
    worker.once("error", () => answer(fail(422, DOCUMENT_WORDS.brokenPdf)));
    worker.once("exit", () => answer(fail(422, DOCUMENT_WORDS.brokenPdf)));
  });
}

// ── The door ────────────────────────────────────────────────────────────────

/**
 * THE WORDS OUT OF A MEMBER'S FILE. Read from the bytes; the name only tells
 * .md from .txt. Never writes anything.
 */
export async function extractRoleDocumentText(file: { bytes: Buffer; filename?: string | null }): Promise<Extracted> {
  const bytes = file.bytes;
  if (!bytes || !bytes.length) return fail(422, DOCUMENT_WORDS.noText);
  if (bytes.length > ROLE_DOCUMENT_MAX_BYTES) return fail(413, DOCUMENT_WORDS.tooBig);
  if (sniffKind(bytes) === "pdf") return readPdf(bytes);
  if (bytes.readUInt32LE(0) === ZIP_LOCAL) return readDocx(bytes);
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0xd0cf11e0) return fail(415, DOCUMENT_WORDS.oldWord);
  const text = decodeText(bytes);
  if (text === null) return fail(415, DOCUMENT_WORDS.wrongKind);
  return finish(/\.md$|\.markdown$/i.test(String(file.filename ?? "")) ? "md" : "txt", text);
}

/** The document id in a Google Doc link, or null for any other link. */
export function googleDocId(link: string): string | null {
  let u: URL;
  try {
    u = new URL(String(link ?? "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const m = /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,128})(?:\/|$)/.exec(u.pathname);
  return m && m[1] !== "e" ? m[1] : null;
}

/** The hosts a Google Doc export may redirect to. */
export function isGoogleExportHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "docs.google.com" || h.endsWith(".googleusercontent.com");
}

export interface GoogleDocOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * THE WORDS OF A GOOGLE DOC shared as "anyone with the link": its plain-text
 * export, fetched by the server from a URL it builds itself, within the time
 * and size caps, following redirects only to Google's own hosts.
 */
export async function fetchGoogleDocText(link: string, opts: GoogleDocOptions = {}): Promise<Extracted> {
  const id = googleDocId(link);
  if (!id) return fail(400, DOCUMENT_WORDS.notGoogleDoc);
  const doFetch = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? GOOGLE_DOC_MAX_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? GOOGLE_DOC_TIMEOUT_MS);
  try {
    let url = `https://docs.google.com/document/d/${id}/export?format=txt`;
    for (let hop = 0; hop <= 3; hop += 1) {
      const res = await doFetch(url, { redirect: "manual", signal: ctrl.signal, headers: { Accept: "text/plain" } });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next || hop === 3) return fail(502, DOCUMENT_WORDS.googleFailed);
        const to = new URL(next, url);
        if (to.protocol !== "https:" || !isGoogleExportHost(to.hostname)) return fail(403, DOCUMENT_WORDS.notShared);
        url = to.toString();
        continue;
      }
      if (res.status === 401 || res.status === 403) return fail(403, DOCUMENT_WORDS.notShared);
      if (res.status === 404) return fail(404, DOCUMENT_WORDS.noDoc);
      if (!res.ok) return fail(502, DOCUMENT_WORDS.googleFailed);
      // An HTML answer is Google's sign-in page: the document is private.
      if (!/^text\/plain\b/i.test(res.headers.get("content-type") ?? "")) return fail(403, DOCUMENT_WORDS.notShared);
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) return fail(413, DOCUMENT_WORDS.docTooBig);
      const chunks: Buffer[] = [];
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return fail(413, DOCUMENT_WORDS.docTooBig);
          }
          chunks.push(Buffer.from(value));
        }
      }
      return finish("google-doc", Buffer.concat(chunks).toString("utf8"));
    }
    return fail(502, DOCUMENT_WORDS.googleFailed);
  } catch (e: any) {
    if (ctrl.signal.aborted || e?.name === "AbortError") return fail(504, DOCUMENT_WORDS.slow);
    return fail(502, DOCUMENT_WORDS.googleFailed);
  } finally {
    clearTimeout(timer);
  }
}
