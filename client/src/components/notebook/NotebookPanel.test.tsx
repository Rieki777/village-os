// @vitest-environment jsdom
/**
 * THE NOTEBOOK PANEL, RENDERED (plan 5.5 and 5.6).
 *
 * The routes are proved in server/routes/villageDocuments.test.ts. This file
 * proves what a member sees and what the buttons hand over: the private note
 * above the form, how each document stands, the disclosure that must be
 * ticked before a model sees anything, and an export that saves exactly the
 * files the server built, one by one or as one file.
 *
 * `fetch` is a stand-in keyed by method and path, and the download is caught
 * at `URL.createObjectURL`, as GoLivePackagePanel.test.tsx does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotebookPanel from "./NotebookPanel";
import { DOCUMENT_WORDS, STANDING_WORDS } from "@shared/villageDocuments";

vi.mock("@/lib/gameApi", () => ({ authToken: () => "tok" }));

type Route = (body: any) => { status: number; body: unknown };
let routes: Record<string, Route> = {};
let sent: Array<{ method: string; url: string; body: any }> = [];
let saved: Array<{ name: string; text: string }> = [];
let lastName = "";

const summary = (over: Record<string, unknown>) => ({
  id: 1, title: "Well rota", kind: "paste", standing: "private", ownerName: null, yours: true, size: 42,
  createdAt: "2026-09-28T00:00:00.000Z", sharedAt: null, ...over,
});

const FILES = [
  { name: "README.md", content: "# Take the canvas with you\n" },
  { name: "canvas.md", content: "# canvas\n" },
  { name: "resources.md", content: "# resources\n" },
  { name: "our-documents.md", content: "# docs\n" },
];

beforeEach(() => {
  sent = [];
  saved = [];
  routes = {
    "GET /api/documents": () => ({
      status: 200,
      body: {
        mine: [summary({}), summary({ id: 2, title: "Decisions", standing: "share-asked" })],
        shared: [summary({ id: 3, title: "Agreements", standing: "shared", yours: false, ownerName: "Bram" })],
        toDecide: [],
        privateNote: DOCUMENT_WORDS.private,
      },
    }),
    "GET /api/canvas/exports/latest": () => ({ status: 200, body: { lastExportAt: "2026-09-20T10:00:00.000Z", changedSince: true } }),
    "POST /api/canvas/exports": () => ({ status: 200, body: { files: FILES, exportedAt: "2026-09-28T10:00:00.000Z", hash: "h" } }),
    "GET /api/documents/1": () => ({
      status: 200,
      body: {
        document: summary({}),
        body: "## Water\nMondays.",
        fileName: null,
        shareProposalId: null,
        model: { available: true, sentence: "Drafting with a model sends this document's text to Anthropic, under this village's own key.", consented: false },
        purposeWritten: false,
      },
    }),
    "POST /api/documents/1/draft": (body) =>
      body.mode === "model" && !body.consent
        ? { status: 409, body: { error: "Say yes to where the text goes first.", needsConsent: true, disclosure: "Drafting with a model sends this document's text to Anthropic, under this village's own key." } }
        : { status: 200, body: { mode: body.mode, read: true, draftId: body.mode === "model" ? "d1" : null, purposeWritten: false, draft: { items: [{ blockId: "power", sectionId: "decisions", body: "We decide by consent.", why: "Placed here because the heading matches." }], gaps: [], noSection: ["conflict"] } } },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      sent.push({ method, url, body });
      const route = routes[`${method} ${url}`];
      const answer = route ? route(body) : { status: 404, body: { error: "not in this test" } };
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
    }),
  );
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((b: Blob) => {
      void b.text().then((text) => saved.push({ name: lastName, text }));
      return "blob:stub";
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    lastName = this.download;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the notebook", () => {
  it("says above the form that a document is private, and how each one stands", async () => {
    render(<NotebookPanel />);
    expect(await screen.findByTestId("notebook-private-note")).toHaveTextContent(DOCUMENT_WORDS.private);
    expect(await screen.findByText("Well rota")).toBeTruthy();
    expect(screen.getByText("Private").getAttribute("title")).toBe(STANDING_WORDS.private);
    expect(screen.getByText("Asked to share").getAttribute("title")).toBe(STANDING_WORDS["share-asked"]);
    expect(screen.getByText(/from Bram/)).toBeTruthy();
  });

  it("sends nothing to a model until the member ticks the disclosure", async () => {
    const user = userEvent.setup();
    render(<NotebookPanel />);
    await user.click(await screen.findByRole("button", { name: "Open Well rota" }));
    const doc = await screen.findByTestId("notebook-document");
    await user.click(within(doc).getByText("Draft canvas words from this document"));
    const modelButton = within(doc).getByRole("button", { name: "Draft with a model" });
    expect(modelButton).toBeDisabled();
    expect(within(doc).getByTestId("notebook-model-disclosure")).toHaveTextContent("Anthropic, under this village's own key");
    expect(sent.filter((s) => s.url.endsWith("/draft"))).toEqual([]);
    await user.click(within(doc).getByRole("checkbox", { name: /Yes, send this document's text/ }));
    await user.click(modelButton);
    await within(doc).findByTestId("notebook-draft");
    expect(sent.find((s) => s.url === "/api/documents/1/draft")?.body).toEqual({ mode: "model", consent: true });
  });
});

describe("take the canvas with you", () => {
  it("says something changed since the last export", async () => {
    render(<NotebookPanel />);
    expect(await screen.findByTestId("notebook-export-status")).toHaveTextContent("Something has changed since your last export on 20 September 2026.");
  });

  it("saves each file exactly as the server built it, and all four as one file", async () => {
    const user = userEvent.setup();
    render(<NotebookPanel />);
    await user.click(await screen.findByRole("button", { name: "Build the pack" }));
    const files = await screen.findByTestId("notebook-export-files");
    expect(screen.getByTestId("notebook-export-status")).toHaveTextContent("Nothing has changed since your last export on 28 September 2026.");
    for (const f of FILES) await user.click(within(files).getByRole("button", { name: `Save ${f.name}` }));
    await user.click(within(files).getByRole("button", { name: "Save all four as one file" }));
    await waitFor(() => expect(saved).toHaveLength(5));
    for (const f of FILES) expect(saved.find((s) => s.name === f.name)?.text).toBe(f.content);
    const one = saved.find((s) => s.name === "canvas-pack-2026-09-28.md")?.text ?? "";
    for (const f of FILES) expect(one).toContain(f.content.trim());
    expect(one.indexOf("# Take the canvas with you")).toBeLessThan(one.indexOf("# canvas"));
  });

  it("warns before anything is built that a Gemini upload sends the content to Google", async () => {
    render(<NotebookPanel />);
    expect(await screen.findByText(/sends everything in them to Google/)).toBeTruthy();
  });
});
