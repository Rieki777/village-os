/**
 * A MEMBER'S NOTEBOOK: who may read a document, what a stored file really
 * is, how the text is searched, and where a model draft would send it
 * (plan 5.5; Wave 4, 2026-09-28).
 *
 * No SQL here: server/repos/villageDocuments.ts holds all of it.
 *
 * ── WHO READS WHAT ─────────────────────────────────────────────────────────
 *
 *   its owner                 always
 *   every member of the       once the village's pen has ADOPTED the owner's
 *   village                   "Share with the village" suggestion
 *   whoever holds the         while that suggestion is open, so the pen reads
 *   village's story           what it is being asked to share before it decides.
 *                             Before the handover the gate gives that pen to the
 *                             administrators too, so they read it in that window
 *   anybody else, an admin    never. Being an administrator opens no private
 *   included                  document that its owner has not asked to share
 *
 * ── SEARCH IS THE GUIDE'S OWN BM25 ─────────────────────────────────────────
 *
 * Text documents are cut into sections at their `##` and `###` headings and
 * ranked with `indexDoc` and `rank` from server/lib/knowledge.ts, the path the
 * guide's shelves use, so a notebook search and a shelf search agree on what a
 * match is. A PDF or Word file is kept as it is and never searched.
 */
import { indexDoc, rank, splitSections } from "./knowledge";
import { resolveKey, type MemberKey } from "./assistant";
import type { DocumentRow } from "../repos/villageDocuments";
import { DOCUMENT_WORDS, type DocumentStanding, type DocumentSummary, type StoredDocumentKind } from "../../shared/villageDocuments";

/** Who is asking, as the read rule needs them. */
export interface DocumentViewer {
  id: string;
  /** May this person adopt a "Share with the village" suggestion (the prose pen, `story.tell`)? */
  holdsStoryPen: boolean;
}

/** Where a document stands, from its owner's side. */
export function standingOf(doc: Pick<DocumentRow, "shared" | "id">, openShares: ReadonlyMap<number, number>): DocumentStanding {
  if (doc.shared) return "shared";
  return openShares.has(doc.id) ? "share-asked" : "private";
}

/** THE READ RULE, in one function the route and the tests both call. */
export function mayReadDocument(doc: Pick<DocumentRow, "id" | "ownerId" | "shared">, viewer: DocumentViewer, openShares: ReadonlyMap<number, number>): boolean {
  if (doc.ownerId === viewer.id) return true;
  if (doc.shared) return true;
  return viewer.holdsStoryPen && openShares.has(doc.id);
}

/** One document as a list shows it. The owner is named, by first name, only on a shared document. */
export function summaryOf(
  doc: DocumentRow,
  viewerId: string,
  openShares: ReadonlyMap<number, number>,
  firstName: (name: string) => string,
): DocumentSummary {
  const standing = standingOf(doc, openShares);
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    standing,
    ownerName: standing === "private" ? null : firstName(doc.ownerName ?? "") || null,
    yours: doc.ownerId === viewerId,
    size: doc.size,
    createdAt: doc.createdAt,
    sharedAt: doc.sharedAt,
  };
}

/* ── What a stored file really is ───────────────────────────────────────── */

/** The media type a stored kind is served as. */
export const STORED_MIME: Record<StoredDocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Is this file what its name says? A PDF opens with `%PDF-` inside its first
 * kilobyte. A DOCX is a zip (it opens with `PK` and 3, 4) whose directory
 * names `word/document.xml`, which a zip stores uncompressed, so it can be
 * found without unzipping anything. A renamed file of any other kind is
 * refused in words, and nothing is stored.
 */
export function storedFileProblem(kind: StoredDocumentKind, bytes: Buffer): string | null {
  if (kind === "pdf") {
    const head = bytes.subarray(0, 1024).toString("latin1");
    return head.includes("%PDF-") ? null : DOCUMENT_WORDS.fileNotPdf;
  }
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return zip && bytes.includes(Buffer.from("word/document.xml", "latin1")) ? null : DOCUMENT_WORDS.fileNotDocx;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/** One section of one document that matched a search. */
export interface DocumentHit {
  documentId: number;
  title: string;
  heading: string;
  /** The section's opening, for the list. The whole document opens by its id. */
  excerpt: string;
}

/** How long an excerpt is, in characters. */
export const EXCERPT_MAX = 400;

/**
 * Rank the sections of the documents handed in against a question. The
 * caller hands in only documents the asker may read
 * (`textDocumentsReadableBy`), so this never decides who reads what.
 */
export function searchDocuments(docs: readonly DocumentRow[], query: string, max = 5): DocumentHit[] {
  const indexed = [];
  for (const d of docs) {
    if (d.body === null) continue;
    for (const s of splitSections(d.body)) {
      const hit: DocumentHit = {
        documentId: d.id,
        title: d.title,
        heading: s.heading,
        excerpt: s.text.length > EXCERPT_MAX ? `${s.text.slice(0, EXCERPT_MAX).trimEnd()}...` : s.text,
      };
      // The title and heading are the section's identity, as on the shelves.
      indexed.push(indexDoc(hit, `${d.title} ${s.heading}\n${s.text}`, `${d.title} ${s.heading}`));
    }
  }
  return rank(indexed, String(query ?? ""), max);
}

/* ── Where a model draft would send the text ────────────────────────────── */

/** The one-line disclosure a member says yes to before their document's text goes to a model. */
export interface ModelRoute {
  /** A key is there to use. False means only the splitter drafts. */
  available: boolean;
  /** Where the text goes and on whose key, stored with the consent. Null when no key. */
  to: string | null;
  /** The sentence the page shows above the yes. Null when no key. */
  sentence: string | null;
}

/** The provider a key speaks to, in words. */
function providerWords(source: "member" | "village" | "platform", memberKey: MemberKey | null): string {
  if (source !== "member" || !memberKey || memberKey.provider === "anthropic") return "Anthropic";
  try {
    return `the model service at ${new URL(String(memberKey.baseUrl ?? "")).host}`;
  } catch {
    return "the model service your own key names";
  }
}

/**
 * Where a model draft would send this member's text, TODAY, and on whose key:
 * the member's own key, the village's own, or a key the platform operator
 * lends the village. Asked on every request, because the answer changes the
 * moment a key is added or taken away, and consent given to one of them is
 * not consent to another.
 */
export function modelRoute(memberKey: MemberKey | null, env: NodeJS.ProcessEnv = process.env): ModelRoute {
  const resolved = resolveKey(env, memberKey);
  if (!resolved) return { available: false, to: null, sentence: null };
  const provider = providerWords(resolved.source, memberKey);
  const whose =
    resolved.source === "member"
      ? "with your own key"
      : resolved.source === "village"
        ? "under this village's own key"
        : "under a shared key the platform's operator lends this village";
  const to = `${provider}, ${whose}`;
  return {
    available: true,
    to,
    sentence: `Drafting with a model sends this document's text to ${to}. Nothing is sent until you say yes, and the words-only draft sends nothing anywhere.`,
  };
}
