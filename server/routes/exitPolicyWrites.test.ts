/**
 * TWO WRITERS OF ONE DOCUMENT (W2-exit-policy-lost-update, W3b-exit-term-reverted).
 *
 * The `exit-policy` document has three writers: the Departures editor's
 * `PUT /api/admin/exit-policy`, the closing-policy door
 * `PUT /api/admin/exit-policy/closing`, and the canvas adopt door, which
 * calls the same `saveExitPolicy`. Each reads the cached document and puts it
 * back whole, and `dbDocument.put` sets its cache only after the INSERT
 * resolves, so two overlapping writes both started from the same copy and
 * the later one erased the other. And a Departures draft loaded before a
 * canvas adoption overwrote the adopted term when it was saved.
 *
 * The document here is in memory, with a put that resolves after a pause and
 * only then updates what `get()` returns: the same shape as dbDocument.
 */
import { describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { register as registerClosing } from "./closingPolicy";
import { saveExitPolicy, type ExitPolicySaveDeps } from "./exits";
import { DEFAULT_EXIT_POLICY, withPolicyDefaults } from "../lib/exitPolicy";
import { exitPolicyTermsVersion } from "../lib/exitPolicyWrites";

function slowDocument(initial: any) {
  let cache = structuredClone(initial);
  return {
    get: () => cache,
    put: async (doc: any) => {
      await new Promise((r) => setTimeout(r, 25));
      cache = structuredClone(doc);
    },
  };
}

const OWN_WORDS = "Whatever is left on closing day goes to the watershed trust our charter names, and the members present that day choose how.";

const startingPolicy = () => ({ ...structuredClone(DEFAULT_EXIT_POLICY), placeholder: true });

function saveDeps(repo: ReturnType<typeof slowDocument>): ExitPolicySaveDeps {
  return {
    isAdmin: async () => true,
    getPool: () => ({ query: async () => [[]] }) as any,
    loadRoles: () => [],
    circlesRepo: { all: () => [] } as any,
    exitPolicyRepo: repo as any,
    readExitPolicy: () => withPolicyDefaults(repo.get()),
    agreementStored: () => false,
    conflictEvolutionOn: () => false,
  };
}

const req = (headers: Record<string, string> = {}) =>
  ({ get: (name: string) => headers[name.toLowerCase()], headers }) as any;

const withNotice = (days: number) => {
  const p = startingPolicy();
  return { ...p, voluntary: { ...p.voluntary, noticePeriodDays: days } };
};

describe("the exit-policy document's writers", () => {
  it("a closing adoption and a terms save that overlap both land (W2-exit-policy-lost-update)", async () => {
    const repo = slowDocument(startingPolicy());
    const app = express();
    app.use(express.json());
    registerClosing(app, {
      isAdmin: async () => true,
      adminActor: () => ({ id: "u-admin" }) as any,
      getPool: () => ({ query: async () => [[]] }) as any,
      exitPolicy: repo,
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as any).port;
    try {
      const closing = fetch(`http://127.0.0.1:${port}/api/admin/exit-policy/closing`, { // module-review-ok: the test client dialling its own in-process server on localhost
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: "own-words", statement: OWN_WORDS, adopt: true }),
      });
      const terms = saveExitPolicy(saveDeps(repo), req(), withNotice(45));
      const [c, t] = await Promise.all([closing, terms]);
      expect(c.status, await c.clone().text()).toBe(200);
      expect(t.status, JSON.stringify(t.body)).toBe(200);
      expect(repo.get().closing?.policyId, "the adopted closing section survived the terms save").toBe("own-words");
      expect(repo.get().voluntary.noticePeriodDays, "the terms save survived the closing adoption").toBe(45);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("a Departures draft opened before a canvas adoption is refused, never saved over it (W3b-exit-term-reverted)", async () => {
    const repo = slowDocument(startingPolicy());
    const opened = exitPolicyTermsVersion(repo.get());
    // The canvas adopts 'Notice before leaving: 60 days', building its body from the document as it stands.
    const adopted = await saveExitPolicy(saveDeps(repo), req(), () => withNotice(60));
    expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
    // The founder who had Departures open saves the draft they loaded, which still says 14.
    const stale = await saveExitPolicy(saveDeps(repo), req({ "x-content-was": opened }), withNotice(14));
    expect(stale.status).toBe(409);
    expect(String(stale.body.message)).toMatch(/changed since/);
    expect(repo.get().voluntary.noticePeriodDays).toBe(60);
    // Reloaded, the same save goes through.
    const fresh = await saveExitPolicy(saveDeps(repo), req({ "x-content-was": exitPolicyTermsVersion(repo.get()) }), withNotice(14));
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
    expect(repo.get().voluntary.noticePeriodDays).toBe(14);
  });

  it("a canvas adoption overlapping a Departures save builds its body after that save, so neither is lost", async () => {
    const repo = slowDocument(startingPolicy());
    const departures = saveExitPolicy(saveDeps(repo), req(), { ...withNotice(21), involuntary: { ...startingPolicy().involuntary, process: "The deciding circle meets the member twice before anything is decided." } });
    const canvas = saveExitPolicy(saveDeps(repo), req(), () => {
      const now = repo.get();
      return { ...now, voluntary: { ...now.voluntary, noticePeriodDays: 60 } };
    });
    const [d, c] = await Promise.all([departures, canvas]);
    expect([d.status, c.status]).toEqual([200, 200]);
    expect(repo.get().voluntary.noticePeriodDays).toBe(60);
    expect(repo.get().involuntary.process).toBe("The deciding circle meets the member twice before anything is decided.");
  });

  it("a closing adoption does not make an open Departures draft stale: the terms' version leaves the closing section out", () => {
    const before = startingPolicy();
    const after = { ...before, closing: { policyId: "own-words", statement: OWN_WORDS, adoptedBy: "u", adoptedAt: "2026-11-01T00:00:00.000Z" } };
    expect(exitPolicyTermsVersion(after)).toBe(exitPolicyTermsVersion(before));
    expect(exitPolicyTermsVersion(withNotice(60))).not.toBe(exitPolicyTermsVersion(before));
  });
});
