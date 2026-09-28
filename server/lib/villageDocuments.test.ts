/**
 * The notebook's read rule, the stored-file check, the search, and the
 * disclosure a model draft asks a yes to (plan 5.5). Pure: no database.
 */
import { afterEach, describe, expect, it } from "vitest";
import { wireAssistant } from "./assistant";
import { mayReadDocument, modelRoute, searchDocuments, standingOf, storedFileProblem, summaryOf } from "./villageDocuments";
import { DOCUMENT_WORDS } from "../../shared/villageDocuments";
import type { DocumentRow } from "../repos/villageDocuments";

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: 7,
  ownerId: "owner",
  ownerName: "Hazel Quinlan",
  title: "Notes",
  kind: "md",
  body: "## Water\n\nThe well rota runs on Mondays.",
  size: 40,
  fileName: null,
  shared: false,
  sharedAt: null,
  modelConsentTo: null,
  createdAt: "2026-09-28T00:00:00.000Z",
  ...over,
});

const none = new Map<number, number>();
const asked = new Map<number, number>([[7, 55]]);

describe("mayReadDocument, the one read rule", () => {
  it("lets its owner read it, always", () => {
    expect(mayReadDocument(doc(), { id: "owner", holdsStoryPen: false }, none)).toBe(true);
  });
  it("keeps a private document from every other member, the story pen included", () => {
    expect(mayReadDocument(doc(), { id: "other", holdsStoryPen: false }, none)).toBe(false);
    expect(mayReadDocument(doc(), { id: "pen", holdsStoryPen: true }, none)).toBe(false);
  });
  it("opens it to the story pen only while its owner's ask to share it is open", () => {
    expect(mayReadDocument(doc(), { id: "pen", holdsStoryPen: true }, asked)).toBe(true);
    expect(mayReadDocument(doc(), { id: "other", holdsStoryPen: false }, asked)).toBe(false);
  });
  it("opens a shared document to every member", () => {
    expect(mayReadDocument(doc({ shared: true }), { id: "other", holdsStoryPen: false }, none)).toBe(true);
  });
});

describe("standing and the list's summary", () => {
  it("says private, asked or shared, and names the owner by first name only once it is not private", () => {
    const first = (n: string) => n.split(" ")[0];
    expect(standingOf(doc(), none)).toBe("private");
    expect(summaryOf(doc(), "other", none, first).ownerName).toBeNull();
    expect(summaryOf(doc(), "pen", asked, first)).toMatchObject({ standing: "share-asked", ownerName: "Hazel", yours: false });
    expect(summaryOf(doc({ shared: true }), "owner", none, first)).toMatchObject({ standing: "shared", yours: true });
  });
});

describe("storedFileProblem", () => {
  it("takes a PDF by its header and a DOCX by its zip directory", () => {
    expect(storedFileProblem("pdf", Buffer.from("%PDF-1.7\n..."))).toBeNull();
    expect(storedFileProblem("docx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("xxword/document.xmlxx")]))).toBeNull();
  });
  it("refuses a file whose bytes are not what its name says", () => {
    expect(storedFileProblem("pdf", Buffer.from("<html>"))).toBe(DOCUMENT_WORDS.fileNotPdf);
    expect(storedFileProblem("docx", Buffer.from("%PDF-1.7"))).toBe(DOCUMENT_WORDS.fileNotDocx);
    // A zip that is not a Word document (an .xlsx, say) is refused too.
    expect(storedFileProblem("docx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("xl/workbook.xml")]))).toBe(DOCUMENT_WORDS.fileNotDocx);
  });
});

describe("searchDocuments", () => {
  it("ranks sections with the shelves' BM25 and points back at the document", () => {
    const hits = searchDocuments([doc(), doc({ id: 8, title: "Money", body: "## Dues\n\nTwenty a month." })], "well rota", 5);
    expect(hits.map((h) => [h.documentId, h.heading])).toEqual([[7, "Water"]]);
  });
  it("skips a document with no text, and finds nothing for a question of filler words", () => {
    expect(searchDocuments([doc({ body: null, kind: "pdf" })], "well", 5)).toEqual([]);
    expect(searchDocuments([doc()], "what should we do", 5)).toEqual([]);
  });
});

describe("modelRoute: where a model draft would send the text, and on whose key", () => {
  afterEach(() => wireAssistant({ villageKey: () => "", rateLimited: async () => false }));

  it("offers nothing when there is no key anywhere", () => {
    expect(modelRoute(null, {})).toEqual({ available: false, to: null, sentence: null });
  });
  it("names the member's own key and provider", () => {
    expect(modelRoute({ provider: "anthropic", key: "k" }, {}).to).toBe("Anthropic, with your own key");
    expect(modelRoute({ provider: "openai_compatible", key: "k", baseUrl: "https://models.example.test/v1" }, {}).to).toBe(
      "the model service at models.example.test, with your own key",
    );
  });
  it("names the village's own key, and a key the platform lends", () => {
    expect(modelRoute(null, { PLATFORM_ASSISTANT_KEY: "p" }).to).toBe("Anthropic, under a shared key the platform's operator lends this village");
    wireAssistant({ villageKey: () => "v", rateLimited: async () => false });
    const r = modelRoute(null, { PLATFORM_ASSISTANT_KEY: "p" });
    expect(r.to).toBe("Anthropic, under this village's own key");
    expect(r.sentence).toContain("Nothing is sent until you say yes");
  });
});
