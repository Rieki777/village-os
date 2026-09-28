/**
 * The notebook panel's network, sentences and small pure helpers (plan 5.5
 * and 5.6). The components under client/src/components/notebook/ speak
 * through this file, so a sentence a test asserts lives in one place.
 *
 * Every read and write goes to server/routes/villageDocuments.ts; the shapes
 * are in docs/canvas-api.md.
 */
import { authToken } from "@/lib/gameApi";
import type { DocumentDraft } from "@shared/documentDraft";
import type { DocumentStanding, DocumentSummary } from "@shared/villageDocuments";

export interface NotebookList {
  mine: DocumentSummary[];
  shared: DocumentSummary[];
  toDecide: Array<DocumentSummary & { proposalId: number | null }>;
  privateNote: string;
}

export interface OpenDocument {
  document: DocumentSummary;
  body: string | null;
  fileName: string | null;
  shareProposalId: number | null;
  model: { available: boolean; sentence: string | null; consented: boolean } | null;
  purposeWritten: boolean;
}

export interface DraftAnswer {
  mode: "words" | "model";
  read: boolean;
  draft: DocumentDraft;
  draftId: string | null;
  purposeWritten: boolean;
}

export interface PackFile {
  name: string;
  content: string;
}

export interface ExportStatus {
  lastExportAt: string | null;
  changedSince: boolean | null;
}

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number | null; error: string; data?: any };

const authHeader = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** One call, answered as data or as the server's own sentence. Never throws. */
export async function call<T>(method: string, url: string, body?: unknown | FormData): Promise<Answer<T>> {
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const r = await fetch(url, {
      method,
      headers: isForm || body === undefined ? authHeader() : { ...authHeader(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: refusal(r.status, data?.error), data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: null, error: NOTEBOOK_WORDS.unreachable };
  }
}

/** A refusal in the words the page shows. */
export function refusal(status: number | null, error: unknown): string {
  if (status === 401 || error === "auth_required") return NOTEBOOK_WORDS.signIn;
  if (typeof error === "string" && error.trim()) return error;
  return NOTEBOOK_WORDS.failed;
}

export const NOTEBOOK_WORDS = {
  heading: "Your notebook",
  intro:
    "Keep the documents your group works from beside the canvas: paste text, or add a Markdown, text, PDF or Word file. Text you add here can be searched and drafted from; a PDF or Word file is kept as it is.",
  signIn: "Sign in to open your notebook.",
  failed: "That did not work. Try again in a moment.",
  unreachable: "That did not reach the server. Check the connection and try again.",
  empty: "Nothing in your notebook yet.",
  sharedHeading: "Shared with the village",
  sharedEmpty: "The village has not shared any documents yet.",
  decideHeading: "Waiting for your decision",
  decideIntro:
    "Their owners asked to share these with the village. You hold the village's story, so you can read them now. Adopt or decline each one on the canvas, in the Adopt frame of the block its owner named.",
  shareIntro:
    "Sharing puts this document in the village's notebook, where every member can read it, and in the canvas pack a member can take with them. Your ask goes to whoever holds the village's story, who adopts or declines it. While they decide, every member sees its title and your note on the block, and only they read the text.",
  draftIntro:
    "The words-only draft cuts the document at its headings and puts each part on the canvas block whose words it uses. It sends nothing anywhere. Nothing is filed until you choose what to file.",
  exportHeading: "Take the canvas with you",
  exportIntro:
    "Four Markdown files: the canvas with the village's confirmed answers members can read and every reading, the resources picked, the documents the village shared, and your own private documents. They save to this device. Nothing kept to the administrators is in them, and neither are people, legal matters, land or red lines, nor who recorded each reading.",
  geminiWarning:
    "Uploading these files to a Gemini notebook sends everything in them to Google. Your private documents are in our-documents.md: take them out first if they should stay with you.",
} as const;

/** How a document stands, as the list says it. */
export const STANDING_SHORT: Record<DocumentStanding, string> = {
  private: "Private",
  "share-asked": "Asked to share",
  shared: "Shared",
};

/** A size a person reads: characters for text, kilobytes or megabytes for a file. */
export function sizeWords(kind: DocumentSummary["kind"], size: number): string {
  if (kind === "md" || kind === "txt" || kind === "paste") {
    return `${size.toLocaleString("en-GB")} ${size === 1 ? "character" : "characters"}`;
  }
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** A date as the lists print it: 28 September 2026. */
export function dayWords(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** What the export panel says about the last export. */
export function exportStatusLine(s: ExportStatus | null): string {
  if (!s || !s.lastExportAt) return "You have not taken the canvas with you yet.";
  const when = dayWords(s.lastExportAt);
  if (s.changedSince === true) return `Something has changed since your last export on ${when}. Export again to take the new version.`;
  if (s.changedSince === false) return `Nothing has changed since your last export on ${when}.`;
  return `Your last export was on ${when}.`;
}

/**
 * The four files as ONE Markdown file, for a notebook that takes a single
 * source: the README first, then each file under a rule, each keeping its own
 * heading.
 */
export function combinedPack(files: readonly PackFile[]): string {
  const order = ["README.md", "canvas.md", "resources.md", "our-documents.md"];
  const sorted = [...files].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return sorted.map((f) => `<!-- ${f.name} -->\n\n${f.content.trim()}\n`).join("\n---\n\n");
}

/** The combined file's name, dated, with no characters a file system refuses. */
export function combinedName(exportedAt: string): string {
  return `canvas-pack-${String(exportedAt).slice(0, 10) || "export"}.md`;
}

/**
 * Hand a text file to the browser to save. The blob is revoked straight after
 * the click, the way every other download here does (GoLivePackagePanel).
 */
export function saveText(name: string, content: string, type = "text/markdown;charset=utf-8"): void {
  saveBlob(name, new Blob([content], { type }));
}

export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** A stored file, fetched with the member's own token (an `<a href>` cannot send one), then saved. */
export async function downloadStored(id: number, name: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/documents/${id}/file`, { headers: authHeader() });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return refusal(r.status, d?.error);
    }
    saveBlob(name, await r.blob());
    return null;
  } catch {
    return NOTEBOOK_WORDS.unreachable;
  }
}
