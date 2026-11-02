/**
 * The batch path, against a request-aware stub of the Batches API.
 *
 * What is actually being pinned here is not "does it call the endpoint". It is
 * the three ways a batch reader silently corrupts a village's record:
 *
 *   1. ORDER. Results come back in any order. A reader that trusts position
 *      files one meeting's decisions under another meeting's name, and every
 *      row it writes looks perfectly well-formed. The stub deliberately
 *      returns the results REVERSED.
 *   2. REPETITION. A batch that ends is polled again after a crash, a restart,
 *      or simply the next tick before `ended_at` was stamped. A second write
 *      is a second synthesis for one recording.
 *   3. UNBOUNDED RETRY. An errored request that retries forever is a timer
 *      spending forever.
 *
 * Runs against a real scratch schema: the claim that makes (2) safe is a
 * conditional UPDATE, and a mocked pool would only prove I can write the mock
 * I already imagined.
 */
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testPool, provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { HOSTILE, expectSealed, fencedValue } from "../testkit/promptFence";
import {
  MAX_ATTEMPTS,
  enqueueSynthesis,
  pendingSynthesisRecordings,
  pollSynthesisBatches,
  type BatchRecordingInput,
} from "./synthesisBatch";

const configured = testDbConfigured();

/** What the stub should say next. The test drives it; the code under test never knows. */
interface StubState {
  processingStatus: string;
  /** custom_id -> the result envelope the results endpoint should emit. */
  results: Map<string, any>;
  createdBatches: string[];
  submitted: any[];
  resultsFetches: number;
}

function succeeded(text: string, model = "claude-haiku-4-5-20251001") {
  return {
    type: "succeeded",
    message: {
      model,
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 3100, output_tokens: 420, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

const reply = (overview: string, quote: string) =>
  JSON.stringify({
    overview,
    chapters: [{ title: "Opening", startMs: 0 }],
    decisions: ["Adopted, with an exception for harvest week"],
    tasks: [{ description: "Post the quiet-hours notice", quote, timestampMs: 0, roleId: null }],
  });

describe.skipIf(!configured)("call synthesis through the batch API", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let stub: Server;
  let baseUrl = "";
  let state: StubState;

  const opts = () => ({ apiKey: "test-key", baseUrl, villageId: "vil-batch-test" });

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = testPool(db, { connectionLimit: 4 });

    stub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const url = req.url ?? "";
        const send = (body: unknown, contentType = "application/json") => {
          res.writeHead(200, { "Content-Type": contentType });
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        };
        if (req.method === "POST" && url === "/v1/messages/batches") {
          let parsed: any = {};
          try { parsed = JSON.parse(raw); } catch { /* recorded as {} */ }
          state.submitted.push(parsed);
          const id = `msgbatch_${state.createdBatches.length + 1}`;
          state.createdBatches.push(id);
          return send({ id, type: "message_batch", processing_status: state.processingStatus });
        }
        const results = /^\/v1\/messages\/batches\/([^/]+)\/results$/.exec(url);
        if (req.method === "GET" && results) {
          state.resultsFetches += 1;
          // REVERSED on purpose: nothing downstream may depend on the order
          // these arrive in, and a position-keyed reader passes only if the
          // order happens to match.
          const lines = [...state.results.entries()]
            .reverse()
            .map(([custom_id, result]) => JSON.stringify({ custom_id, result }));
          return send(lines.join("\n"), "application/x-ndjson");
        }
        const one = /^\/v1\/messages\/batches\/([^/]+)$/.exec(url);
        if (req.method === "GET" && one) {
          const counts = { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 };
          for (const r of state.results.values()) {
            const t = String(r?.type ?? "");
            if (t === "succeeded") counts.succeeded += 1;
            else if (t === "errored") counts.errored += 1;
            else if (t === "expired") counts.expired += 1;
            else if (t === "canceled") counts.canceled += 1;
          }
          return send({ id: one[1], processing_status: state.processingStatus, request_counts: counts });
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `stub has no route for ${req.method} ${url}` }));
      });
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => stub?.close(() => r()));
    await pool?.end();
    await db?.drop();
  });

  beforeEach(async () => {
    state = { processingStatus: "in_progress", results: new Map(), createdBatches: [], submitted: [], resultsFetches: 0 };
    await pool.query("DELETE FROM synthesis_batch_items");
    await pool.query("DELETE FROM synthesis_batches");
    await pool.query("DELETE FROM call_tasks");
    await pool.query("DELETE FROM call_syntheses");
    await pool.query("DELETE FROM transcripts");
    await pool.query("DELETE FROM recordings");
    await pool.query("DELETE FROM assistant_usage");
  });

  /** A transcribed recording with an untimestamped transcript: the whole text is the evidence window. */
  async function addRecording(id: string, title: string, body: string, isExample = 0) {
    await pool.query(
      "INSERT INTO recordings (id, source, external_id, title, url, status, is_example) VALUES (?,?,?,?,?,?,?)",
      [id, "manual", `ext-${id}`, title, null, "transcribed", isExample],
    );
    await pool.query(
      "INSERT INTO transcripts (recording_id, body, segments, source) VALUES (?,?,?,?)",
      [id, body, JSON.stringify([{ startMs: 0, endMs: 0, text: body }]), "manual"],
    );
  }

  const input = (id: string, title: string, body: string): BatchRecordingInput => ({
    recordingId: id,
    title,
    segments: [{ startMs: 0, endMs: 0, text: body }],
    chapterMarks: [{ startMs: 0 }],
    roleCandidates: [{ id: "role-steward", name: "Steward", purpose: "keeps the land" }],
  });

  const BODY_A = "We agreed to adopt quiet hours from nine at night, with an exception during harvest week.";
  const BODY_B = "The workshop roof needs replacing before the rains, and Sam offered to price the materials.";

  it("submits one request per recording, addressed by the recording id", async () => {
    await addRecording("rec-a", "Weekly call, first", BODY_A);
    await addRecording("rec-b", "Weekly call, second", BODY_B);

    const pending = await pendingSynthesisRecordings(pool);
    expect(pending.map((p) => p.id).sort()).toEqual(["rec-a", "rec-b"]);

    const r = await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A), input("rec-b", "B", BODY_B)], opts());
    expect(r.requested).toBe(2);
    expect(r.batchId).toBe("msgbatch_1");

    const submitted = state.submitted[0];
    expect(submitted.requests.map((q: any) => q.custom_id).sort()).toEqual(["rec-a", "rec-b"]);
    // The ask is unchanged by batching: same model, same reply cap.
    expect(submitted.requests[0].params.model).toBe("claude-haiku-4-5-20251001");
    expect(submitted.requests[0].params.max_tokens).toBe(2000);

    const [items] = await pool.query<any[]>("SELECT * FROM synthesis_batch_items ORDER BY custom_id");
    expect(items).toHaveLength(2);
    expect(items.every((i: any) => i.status === "pending" && i.attempt === 1)).toBe(true);
  });

  it("sends a hostile meeting to the Batches API with its transcript and role candidates sealed in fences", async () => {
    await addRecording("rec-hostile", HOSTILE, HOSTILE);
    const rec: BatchRecordingInput = {
      ...input("rec-hostile", HOSTILE, HOSTILE),
      roleCandidates: [{ id: "role-steward", name: HOSTILE, purpose: HOSTILE }],
    };
    expect((await enqueueSynthesis(pool, [rec], opts())).requested).toBe(1);

    const params = state.submitted[0].requests[0].params;
    expectSealed(params.system, ["call.role_candidates"]);
    expect(fencedValue(params.system, "call.role_candidates")).toEqual(rec.roleCandidates);
    expectSealed(params.messages[0].content, ["call.transcript"]);
    expect(fencedValue(params.messages[0].content, "call.transcript")).toEqual({
      title: HOSTILE,
      chapterMarks: [{ startMs: 0 }],
      segments: [{ startMs: 0, text: HOSTILE }],
    });
  });

  it("never touches a standing example, however long it has had a transcript", async () => {
    await addRecording("rec-example", "Sample call", BODY_A, 1);
    expect(await pendingSynthesisRecordings(pool)).toHaveLength(0);
  });

  it("writes nothing while the batch is still in progress", async () => {
    await addRecording("rec-a", "A", BODY_A);
    await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A)], opts());

    const p = await pollSynthesisBatches(pool, opts());
    expect(p.polled).toBe(1);
    expect(p.ended).toBe(0);
    expect(p.written).toBe(0);
    expect(state.resultsFetches).toBe(0);
    const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM call_syntheses");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("matches shuffled results by custom_id and writes each recording exactly once", async () => {
    await addRecording("rec-a", "A", BODY_A);
    await addRecording("rec-b", "B", BODY_B);
    await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A), input("rec-b", "B", BODY_B)], opts());

    state.processingStatus = "ended";
    state.results.set("rec-a", succeeded(reply("Quiet hours, agreed", "quiet hours from nine at night")));
    state.results.set("rec-b", succeeded(reply("The roof, and who prices it", "Sam offered to price the materials")));

    const p = await pollSynthesisBatches(pool, opts());
    expect(p.ended).toBe(1);
    expect(p.written).toBe(2);

    // THE ADDRESSING PROOF: the stub emitted rec-b first. Each overview must
    // still be on its own recording.
    const [synths] = await pool.query<any[]>("SELECT recording_id, ai_body FROM call_syntheses ORDER BY recording_id");
    expect(synths).toHaveLength(2);
    expect(synths[0].recording_id).toBe("rec-a");
    expect(synths[0].ai_body).toContain("Quiet hours");
    expect(synths[1].recording_id).toBe("rec-b");
    expect(synths[1].ai_body).toContain("roof");

    // The evidence rule still runs on this path: the quote is in the tape, so
    // the task survives.
    const [tasks] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM call_tasks");
    expect(Number(tasks[0].n)).toBe(2);

    // Both recordings moved on, and one usage row exists per result.
    const [recs] = await pool.query<any[]>("SELECT status FROM recordings ORDER BY id");
    expect(recs.map((r: any) => r.status)).toEqual(["synthesized", "synthesized"]);
    const [usage] = await pool.query<any[]>("SELECT mode, model, input_tokens, output_tokens, user_id, path FROM assistant_usage");
    expect(usage).toHaveLength(2);
    expect(usage[0].mode).toBe("synthesize");
    // REAL token counts, not halved. The discount is a billing fact and the
    // `batch` flag is what lets the rollup apply it; halving here would put a
    // price into a column that holds token facts.
    expect(Number(usage[0].input_tokens)).toBe(3100);
    expect(Number(usage[0].output_tokens)).toBe(420);
    expect(usage.every((u: any) => u.path === "batch")).toBe(true);
    // A timer has no actor and does not borrow one.
    expect(usage[0].user_id).toBeNull();
  });

  it("a re-poll of an ended batch writes nothing a second time", async () => {
    await addRecording("rec-a", "A", BODY_A);
    await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A)], opts());
    state.processingStatus = "ended";
    state.results.set("rec-a", succeeded(reply("Quiet hours, agreed", "quiet hours from nine at night")));

    await pollSynthesisBatches(pool, opts());
    // Re-open the batch the way a crash between the results read and the
    // `ended_at` stamp would leave it, then poll again.
    await pool.query("UPDATE synthesis_batches SET ended_at = NULL");
    const second = await pollSynthesisBatches(pool, opts());

    expect(second.written).toBe(0);
    const [synths] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM call_syntheses");
    expect(Number(synths[0].n)).toBe(1);
    const [tasks] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM call_tasks");
    expect(Number(tasks[0].n)).toBe(1);
    const [usage] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM assistant_usage");
    expect(Number(usage[0].n)).toBe(1);
  });

  it("retries an errored request exactly once, then marks it failed and stops", async () => {
    await addRecording("rec-a", "A", BODY_A);

    // Attempt 1: errored.
    await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A)], opts());
    state.processingStatus = "ended";
    state.results.set("rec-a", { type: "errored", error: { type: "invalid_request_error", message: "nope" } });
    const first = await pollSynthesisBatches(pool, opts());
    expect(first.errored).toBe(1);

    // The selection query offers it again, exactly once.
    const retryable = await pendingSynthesisRecordings(pool);
    expect(retryable.map((r) => r.id)).toEqual(["rec-a"]);

    state.processingStatus = "in_progress";
    const second = await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A)], opts());
    expect(second.requested).toBe(1);
    const [items] = await pool.query<any[]>("SELECT attempt FROM synthesis_batch_items ORDER BY attempt");
    expect(items.map((i: any) => Number(i.attempt))).toEqual([1, MAX_ATTEMPTS]);

    // Attempt 2 errors too: terminal.
    state.processingStatus = "ended";
    await pollSynthesisBatches(pool, opts());
    const [after] = await pool.query<any[]>("SELECT status FROM synthesis_batch_items WHERE attempt = ?", [MAX_ATTEMPTS]);
    expect(after[0].status).toBe("failed");

    // And nothing offers it a third time, from either end.
    expect(await pendingSynthesisRecordings(pool)).toHaveLength(0);
    const third = await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A)], opts());
    expect(third.batchId).toBeNull();
    expect(third.requested).toBe(0);
  });

  it("keeps an expired request and an unusable reply apart from a success", async () => {
    await addRecording("rec-a", "A", BODY_A);
    await addRecording("rec-b", "B", BODY_B);
    await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A), input("rec-b", "B", BODY_B)], opts());

    state.processingStatus = "ended";
    state.results.set("rec-a", { type: "expired" });
    state.results.set("rec-b", succeeded("this is not JSON at all"));

    const p = await pollSynthesisBatches(pool, opts());
    expect(p.expired).toBe(1);
    expect(p.unusable).toBe(1);
    expect(p.written).toBe(0);

    // The unusable reply still cost tokens, and the row says so.
    const [usage] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM assistant_usage");
    expect(Number(usage[0].n)).toBe(1);
    const [synths] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM call_syntheses");
    expect(Number(synths[0].n)).toBe(0);
  });

  it("ignores a result addressed to a request it never submitted", async () => {
    await addRecording("rec-a", "A", BODY_A);
    await enqueueSynthesis(pool, [input("rec-a", "A", BODY_A)], opts());
    state.processingStatus = "ended";
    state.results.set("rec-a", succeeded(reply("Quiet hours, agreed", "quiet hours from nine at night")));
    state.results.set("rec-ghost", succeeded(reply("A meeting that never happened", "quiet hours from nine at night")));

    const p = await pollSynthesisBatches(pool, opts());
    expect(p.written).toBe(1);
    const [synths] = await pool.query<any[]>("SELECT recording_id FROM call_syntheses");
    expect(synths.map((s: any) => s.recording_id)).toEqual(["rec-a"]);
  });

  it("runs enqueue and poll twice over one fixture and leaves one synthesis per recording", async () => {
    await addRecording("rec-a", "A", BODY_A);
    await addRecording("rec-b", "B", BODY_B);

    for (let round = 0; round < 2; round++) {
      const pending = await pendingSynthesisRecordings(pool);
      const inputs = pending.map((p) => input(p.id, p.title, p.id === "rec-a" ? BODY_A : BODY_B));
      state.processingStatus = "in_progress";
      await enqueueSynthesis(pool, inputs, opts());
      state.processingStatus = "ended";
      state.results.set("rec-a", succeeded(reply("Quiet hours, agreed", "quiet hours from nine at night")));
      state.results.set("rec-b", succeeded(reply("The roof, and who prices it", "Sam offered to price the materials")));
      await pollSynthesisBatches(pool, opts());
    }

    const [synths] = await pool.query<any[]>("SELECT recording_id, COUNT(*) AS n FROM call_syntheses GROUP BY recording_id");
    expect(synths).toHaveLength(2);
    for (const s of synths) expect(Number(s.n)).toBe(1);
    // One usage row per RESULT, and the second round had no results to read
    // because the second round had nothing left to submit.
    const [usage] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM assistant_usage");
    expect(Number(usage[0].n)).toBe(2);
  });
});
