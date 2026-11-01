/**
 * A HOSTILE PDF MUST NOT BLOCK OTHER REQUESTS (the coordinator's GO on the
 * follow-up #606 named, 2026-10-31).
 *
 * #606 bounded a PDF read three ways (5 MB, 40 pages, 10 seconds), and said
 * what it could not do: the read ran on the request thread, so a crafted
 * file that made PDF.js spin held the event loop, and every other member's
 * request with it, for as long as it spun. A timer cannot fire on a thread
 * that never yields. The read now runs in a worker thread of its own
 * (`readPdf` in ./roleDocumentText.ts), with a memory cap, and the thread is
 * ended at the timeout.
 *
 * What is pinned:
 *
 *   - THE ONE THIS EXISTS FOR: a parser that never yields, and a local
 *     server answers a request while it spins; the read is abandoned at the
 *     timeout and its thread is ended, not left spinning.
 *   - A worker that dies, or a parser that throws, is a broken PDF, never an
 *     unhandled error.
 *   - The adversarial pass, on the real PDF.js: a compression bomb, a page
 *     tree that claims a million pages, and a cross-reference table that
 *     points everywhere wrong. Each answers within its bound, as a sentence,
 *     with the server answering meanwhile.
 *
 * The parser seam (`parser`, a module path) is how a suite puts a PDF.js
 * that misbehaves INSIDE the worker: a `vi.doMock` reaches only the test's
 * own thread, which is the point of the change.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DOCUMENT_WORDS } from "./roleDocumentText";
import { makeBombPdf, makeBrokenXrefPdf, makeClaimedPagesPdf, makePdf } from "../testkit/roleDocuments";

const SLOW = { ok: false, status: 422, error: DOCUMENT_WORDS.slowPdf };
const BROKEN = { ok: false, status: 422, error: DOCUMENT_WORDS.brokenPdf };

let dir = "";
let server: http.Server;
let base = "";

/** A PDF.js stand-in, written where the worker can import it. */
const parser = (name: string, body: string): string => {
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, body);
  return file;
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-parser-"));
  // Another member's request, as small as one can be.
  server = http.createServer((_req, res) => res.end("pong"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the test server did not report a port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Read a PDF while another request is made 100 ms in, and say when each
 * answered. `answeredAt` is null when the other request had not answered by
 * the time the read did.
 */
async function readWhileServing(read: () => Promise<unknown>) {
  const started = Date.now();
  let answeredAt: number | null = null;
  const other = new Promise<void>((resolve) => {
    setTimeout(async () => {
      const r = await fetch(`${base}/ping`); // module-review-ok: a test calling its own local server, never an outside host
      if ((await r.text()) === "pong") answeredAt = Date.now() - started;
      resolve();
    }, 100);
  });
  const result = await read();
  const readTook = Date.now() - started;
  const answeredBeforeRead = answeredAt !== null && answeredAt < readTook;
  await other;
  return { result, readTook, answeredAt, answeredBeforeRead };
}

describe("a PDF read runs on a thread of its own", () => {
  it("THE ONE THIS EXISTS FOR: a parser that never yields cannot hold other requests, and its thread is ended at the timeout", async () => {
    vi.resetModules();
    // On the request thread, as before this change, the same parser spins where the server runs: for 1.5 seconds here, then gives up.
    vi.doMock("unpdf", () => ({
      getDocumentProxy: () => {
        const end = Date.now() + 1500;
        while (Date.now() < end) {
          // spinning, as a crafted file can make PDF.js spin
        }
        throw new Error("gave up");
      },
    }));
    try {
      const fresh = await import("./roleDocumentText");
      // In the worker it spins for good, and only the timeout ends it.
      const spin = parser("spin", "export async function getDocumentProxy() { for (;;) {} }\n");
      const run = await readWhileServing(() => fresh.readPdf(makePdf(["Gate keeper"]), 600, { parser: spin }));
      expect(run.result).toEqual(SLOW);
      expect(run.answeredBeforeRead, `the other request answered at ${run.answeredAt} ms, the read at ${run.readTook} ms`).toBe(true);
      expect(run.answeredAt).toBeLessThan(400);
      expect(run.readTook).toBeLessThan(1400);
      // The spinning thread was ended, not left burning a core.
      await vi.waitFor(() => expect(fresh.pdfWorkersRunning()).toBe(0), { timeout: 2000 });
    } finally {
      vi.doUnmock("unpdf");
      vi.resetModules();
    }
  });

  it("a parser that never answers is abandoned at the timeout", async () => {
    const { readPdf } = await import("./roleDocumentText");
    const silent = parser("silent", "export function getDocumentProxy() { return new Promise(() => undefined); }\n");
    expect(await readPdf(makePdf(["Gate keeper"]), 300, { parser: silent })).toEqual(SLOW);
  });

  it("a worker that dies, or a parser that throws, is a broken PDF and never an unhandled error", async () => {
    const { readPdf, pdfWorkersRunning } = await import("./roleDocumentText");
    const dies = parser("dies", "process.exit(3);\nexport function getDocumentProxy() {}\n");
    const throws = parser("throws", "export async function getDocumentProxy() { throw new Error('not a pdf'); }\n");
    const missing = path.join(dir, "no-such-parser.mjs");
    for (const p of [dies, throws, missing]) expect(await readPdf(makePdf(["Gate keeper"]), 3000, { parser: p }), p).toEqual(BROKEN);
    await vi.waitFor(() => expect(pdfWorkersRunning()).toBe(0), { timeout: 2000 });
  });

  it("still reads a real PDF's words, on the real PDF.js", async () => {
    const { readPdf } = await import("./roleDocumentText");
    const r = await readPdf(makePdf(["Gate keeper", "Opens the gate at dawn"]));
    expect(r).toEqual({ ok: true, kind: "pdf", text: "Gate keeper\nOpens the gate at dawn" });
  });
});

describe("ADVERSARIAL: hostile PDFs on the real PDF.js, each answered within its bound while the server answers others", () => {
  it("a compression bomb: tens of kilobytes that inflate to 64 MB of text operators", async () => {
    const { readPdf, pdfWorkersRunning } = await import("./roleDocumentText");
    const bomb = makeBombPdf();
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const run = await readWhileServing(() => readPdf(bomb, 4000));
    // Whatever the thread made of it, the answer is a refusal in words, inside the bound.
    expect((run.result as any).ok).toBe(false);
    expect([DOCUMENT_WORDS.slowPdf, DOCUMENT_WORDS.brokenPdf, DOCUMENT_WORDS.tooLong]).toContain((run.result as any).error);
    expect(run.readTook).toBeLessThan(6000);
    expect(run.answeredBeforeRead, `the other request answered at ${run.answeredAt} ms, the read at ${run.readTook} ms`).toBe(true);
    await vi.waitFor(() => expect(pdfWorkersRunning()).toBe(0), { timeout: 3000 });
  }, 20_000);

  it("a page tree that claims a million pages costs a million of nothing: refused as too long, or read as the one page it has", async () => {
    const { readPdf } = await import("./roleDocumentText");
    const started = Date.now();
    const r = await readPdf(makeClaimedPagesPdf(1_000_000));
    // PDF.js counts the pages the tree really holds, so the claim alone buys no work; either answer is bounded.
    if (r.ok) expect(r.text).toBe("Gate keeper");
    else expect(r).toEqual({ ok: false, status: 413, error: DOCUMENT_WORDS.longPdf });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("a cross-reference table that points everywhere wrong is read anyway or refused as broken, never thrown", async () => {
    const { readPdf } = await import("./roleDocumentText");
    const r = await readPdf(makeBrokenXrefPdf(["Gate keeper"]), 5000);
    if (r.ok) expect(r.text).toContain("Gate keeper");
    else expect(r).toEqual(BROKEN);
  });
});
