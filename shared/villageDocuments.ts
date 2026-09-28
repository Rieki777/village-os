/**
 * A MEMBER'S OWN NOTEBOOK, as data both halves agree on (plan 5.5; Wave 4,
 * 2026-09-28).
 *
 * A member adds documents: text they paste, a `.md` or `.txt` file (read as
 * text, kept, and searched with the same BM25 the guide's shelves use), or a
 * PDF or DOCX (kept whole, never searched). Every document is PRIVATE when it
 * is added. "Share with the village" files a canvas suggestion, and the
 * village's pen adopting it is the only thing that shares a document.
 *
 * Isomorphic and pure, built like shared/governanceCanvas.ts, so the form and
 * the route refuse the same mistake in the same words.
 */

/** Text kinds: kept as text and searched. */
export const TEXT_DOCUMENT_KINDS = ["md", "txt", "paste"] as const;
/** Stored kinds: kept whole as bytes, never searched, never exported. */
export const STORED_DOCUMENT_KINDS = ["pdf", "docx"] as const;
export const DOCUMENT_KINDS = [...TEXT_DOCUMENT_KINDS, ...STORED_DOCUMENT_KINDS] as const;

export type TextDocumentKind = (typeof TEXT_DOCUMENT_KINDS)[number];
export type StoredDocumentKind = (typeof STORED_DOCUMENT_KINDS)[number];
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentKind(v: unknown): v is DocumentKind {
  return typeof v === "string" && (DOCUMENT_KINDS as readonly string[]).includes(v);
}

export function isTextKind(v: unknown): v is TextDocumentKind {
  return typeof v === "string" && (TEXT_DOCUMENT_KINDS as readonly string[]).includes(v);
}

export const KIND_LABELS: Record<DocumentKind, string> = {
  md: "Markdown",
  txt: "Plain text",
  paste: "Pasted text",
  pdf: "PDF",
  docx: "Word document",
};

/** A title, in characters. The column is varchar(200). */
export const DOCUMENT_TITLE_MAX = 200;

/**
 * The longest text document, in characters. A JSON body is capped at 1 MB on
 * this server, and 200,000 characters of four-byte text still fits under it.
 */
export const DOCUMENT_TEXT_MAX = 200_000;

/** The largest stored file. Inside the smallest `max_allowed_packet` a supported engine ships with. */
export const DOCUMENT_FILE_MAX_BYTES = 8 * 1024 * 1024;

/** How many documents one member may keep. A notebook, never a file server. */
export const DOCUMENTS_PER_MEMBER = 100;

/** The file names a picker offers, per kind. */
export const ACCEPTED_EXTENSIONS: Record<DocumentKind, string | null> = {
  md: ".md",
  txt: ".txt",
  paste: null,
  pdf: ".pdf",
  docx: ".docx",
};

/** The kind a file's name says it is, or null for one this notebook does not take. */
export function kindFromFileName(name: string): Exclude<DocumentKind, "paste"> | null {
  const lower = String(name ?? "").trim().toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

/** Every sentence a refusal or the page says about a document, in one place. */
export const DOCUMENT_WORDS = {
  private: "Only you can read a document you add here. It stays private until you share it and the village adopts it.",
  titleMissing: "Give the document a title.",
  titleTooLong: `Keep the title to ${DOCUMENT_TITLE_MAX} characters.`,
  kindUnknown: "A document is Markdown, plain text or pasted text, or a PDF or Word file.",
  textMissing: "There is no text in it. Paste some, or pick a file with words in it.",
  textTooLong: `Keep a text document to ${DOCUMENT_TEXT_MAX.toLocaleString("en-GB")} characters. Split a longer one in two.`,
  notText: "That file is not plain text. Add a PDF or Word file as a file, and Markdown or text as text.",
  fileTooBig: `A file can be up to ${DOCUMENT_FILE_MAX_BYTES / (1024 * 1024)} MB.`,
  fileNotPdf: "That file is not a PDF, whatever its name says.",
  fileNotDocx: "That file is not a Word document (.docx), whatever its name says.",
  tooMany: `You keep ${DOCUMENTS_PER_MEMBER} documents already. Delete one to add another.`,
  notFound: "There is no document by that number that you can read.",
  notYours: "Only the member who added a document can do that.",
  alreadyShared: "This document is already shared with the village.",
  shareOpen: "You asked to share this document already. The village's pen has not decided yet.",
  storedNoText: "A PDF or Word file is kept as it is and has no text here to draft from. Paste its words as a text document to draft from them.",
} as const;

/** A text document, validated and ready to store. */
export interface TextDocumentInput {
  title: string;
  kind: TextDocumentKind;
  body: string;
}

/** A title as it will be stored: one line, trimmed, format characters out. */
export function cleanTitle(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function titleProblem(title: string): string | null {
  if (!title) return DOCUMENT_WORDS.titleMissing;
  if (Array.from(title).length > DOCUMENT_TITLE_MAX) return DOCUMENT_WORDS.titleTooLong;
  return null;
}

/**
 * THE ONE VALIDATOR for a text document, for the route and for the form.
 *
 * A NUL character is the one sign of a binary file that reached the text
 * path (a PDF renamed `.txt`, say). Text with one in it is refused rather
 * than stored, because it would render as nothing useful and search as noise.
 */
export function parseTextDocument(body: unknown): { ok: true; doc: TextDocumentInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isTextKind(b.kind)) return { ok: false, error: DOCUMENT_WORDS.kindUnknown };
  const title = cleanTitle(b.title);
  const tp = titleProblem(title);
  if (tp) return { ok: false, error: tp };
  if (typeof b.body !== "string") return { ok: false, error: DOCUMENT_WORDS.textMissing };
  const text = b.body.normalize("NFC").replace(/\r\n?/g, "\n");
  if (text.includes("\u0000")) return { ok: false, error: DOCUMENT_WORDS.notText };
  if (!text.trim()) return { ok: false, error: DOCUMENT_WORDS.textMissing };
  if (text.length > DOCUMENT_TEXT_MAX) return { ok: false, error: DOCUMENT_WORDS.textTooLong };
  return { ok: true, doc: { title, kind: b.kind, body: text } };
}

/** Where a document stands, from the member's side of the screen. */
export type DocumentStanding = "private" | "share-asked" | "shared";

export const STANDING_WORDS: Record<DocumentStanding, string> = {
  private: "Private: only you can read it",
  "share-asked": "Waiting: you asked to share it, so whoever holds the village's story can read it to decide",
  shared: "Shared: every member of the village can read it",
};

/** One document as a list shows it. */
export interface DocumentSummary {
  id: number;
  title: string;
  kind: DocumentKind;
  standing: DocumentStanding;
  /** The owner's first name, on the shared list only. */
  ownerName: string | null;
  yours: boolean;
  /** Characters of text, on a text kind; bytes of file, on a stored kind. */
  size: number;
  createdAt: string;
  sharedAt: string | null;
}
