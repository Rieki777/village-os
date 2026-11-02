/**
 * Call synthesis through the Message Batches API (K2).
 *
 * THE TRADE: every token in a batch costs half. What it costs instead is
 * time — results usually inside an hour, at most 24. That trade is only
 * honest when nobody is waiting, so it is made in exactly one direction:
 *
 *   ADMIN ROUTE  -> unchanged, synchronous, full price. A person clicked and
 *                   is watching a spinner. Latency is the product there.
 *   SCHEDULED    -> batched. Nothing is watching, so an hour costs nothing
 *                   and half the tokens are saved.
 *
 * THE ADDRESSING RULE: results come back in ANY order, and each one is keyed
 * by `custom_id`. `custom_id` is the recording id — an identity our own
 * record already owns. Nothing here reads a result by its position in the
 * stream; a position-keyed reader would eventually file one meeting's
 * decisions under another meeting's name and never say so.
 *
 * IDEMPOTENCY, two layers, on the payments.ts pattern:
 *   1. A CLAIM. The poll flips an item from `pending` with a conditional
 *      UPDATE and does the work only when affectedRows says it won. A
 *      re-poll of the same ended batch loses every claim and writes nothing.
 *   2. THE DATABASE. `call_syntheses.recording_id` is UNIQUE and NOT NULL, so
 *      one synthesis per recording is enforced by the schema and not by this
 *      file's carefulness. A duplicate insert raises ER_DUP_ENTRY, which is
 *      read here as "already written" rather than as a failure.
 *
 * BOUNDED RETRY: an errored, expired or canceled request is retried exactly
 * once. The second failure marks the item `failed` and leaves it for a
 * person. A timer that retries forever is a timer that spends forever.
 *
 * This file takes no server globals. The caller gathers the recordings and
 * the candidate roles; this file owns the network, the ledger and the writes.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { recordAssistantUsage } from "./assistantUsage";
import { synthesisSystemPrompt, synthesisUserContent } from "./callSynthesis";
import { transcriptFor } from "./recordings";
import type { TranscriptSegment } from "./recordings";
import { writeSynthesis } from "./synthesisWriter";

/** The same model and reply cap the synchronous route uses. Batching changes the price, never the ask. */
export const SYNTHESIS_MODEL = "claude-haiku-4-5-20251001";
export const SYNTHESIS_MAX_TOKENS = 2000;

/** One submission plus one retry. There is no third attempt. */
export const MAX_ATTEMPTS = 2;

/** Requests per batch. The API allows 100k; a village call schedule does not. */
export const MAX_BATCH_SIZE = 25;

export interface BatchRecordingInput {
  recordingId: string;
  title: string;
  segments: TranscriptSegment[];
  chapterMarks: { startMs: number }[];
  roleCandidates: { id: string; name: string; purpose: string }[];
}

export interface BatchOptions {
  apiKey: string;
  /** Honours ANTHROPIC_BASE_URL exactly as the synchronous path does, so the e2e stub can stand in. */
  baseUrl?: string;
  /** instanceIdentity().instanceId, for the usage rows. */
  villageId: string;
}

function endpoint(opts: BatchOptions): string {
  return (opts.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
}

function headers(opts: BatchOptions): Record<string, string> {
  return {
    "x-api-key": opts.apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

/** The user turn, from the same builder the synchronous route uses. */
function userContent(rec: BatchRecordingInput): string {
  return synthesisUserContent({ title: rec.title, chapterMarks: rec.chapterMarks, segments: rec.segments });
}

// ── Selection ────────────────────────────────────────────────────────────────

export interface PendingRecording {
  id: string;
  title: string;
}

/**
 * Recordings a batch may take: transcribed, not an example, never synthesized,
 * not already in flight, and not out of attempts.
 *
 * `is_example = 0` is not a nicety. The automation module seeds a standing
 * example recording, and a timer that synthesized it would spend real tokens
 * writing a draft nobody asked for onto a row the village is told is a sample.
 */
export async function pendingSynthesisRecordings(pool: Pool, limit = MAX_BATCH_SIZE): Promise<PendingRecording[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT r.id, r.title FROM recordings r " +
      "JOIN transcripts t ON t.recording_id = r.id " +
      "LEFT JOIN call_syntheses s ON s.recording_id = r.id " +
      "WHERE r.status = 'transcribed' AND r.is_example = 0 AND s.id IS NULL " +
      "AND CHAR_LENGTH(TRIM(t.body)) >= 40 " +
      "AND NOT EXISTS (SELECT 1 FROM synthesis_batch_items i WHERE i.recording_id = r.id " +
      "AND i.status IN ('pending', 'written', 'failed')) " +
      "AND (SELECT COUNT(*) FROM synthesis_batch_items i2 WHERE i2.recording_id = r.id) < ? " +
      "ORDER BY r.created_at ASC LIMIT ?",
    [MAX_ATTEMPTS, Math.max(1, Math.min(limit, MAX_BATCH_SIZE))],
  );
  return rows.map((r) => ({ id: String(r.id), title: String(r.title) }));
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

export interface EnqueueResult {
  batchId: string | null;
  requested: number;
  reason?: string;
}

/**
 * Submit one batch: one request per pending recording, `custom_id` = the
 * recording id. Records the batch and its items before returning, so a crash
 * between the POST and the next tick still finds the batch to poll.
 */
export async function enqueueSynthesis(
  pool: Pool,
  recordings: BatchRecordingInput[],
  opts: BatchOptions,
): Promise<EnqueueResult> {
  if (!recordings.length) return { batchId: null, requested: 0 };

  // How many times each of these has been through a batch already. The bound
  // lives here, in the one place that can submit, so no caller can spend past it.
  const attempts = new Map<string, number>();
  const ids = recordings.map((r) => r.recordingId);
  const [prior] = await pool.query<RowDataPacket[]>(
    `SELECT recording_id, COUNT(*) AS n FROM synthesis_batch_items WHERE recording_id IN (${ids.map(() => "?").join(",")}) GROUP BY recording_id`,
    ids,
  );
  for (const p of prior) attempts.set(String(p.recording_id), Number(p.n));

  const eligible = recordings.filter((r) => (attempts.get(r.recordingId) ?? 0) < MAX_ATTEMPTS).slice(0, MAX_BATCH_SIZE);
  if (!eligible.length) return { batchId: null, requested: 0, reason: "all out of attempts" };

  const body = {
    requests: eligible.map((rec) => ({
      custom_id: rec.recordingId,
      params: {
        model: SYNTHESIS_MODEL,
        max_tokens: SYNTHESIS_MAX_TOKENS,
        system: synthesisSystemPrompt(rec.roleCandidates),
        messages: [{ role: "user", content: userContent(rec) }],
      },
    })),
  };

  const resp = await fetch(`${endpoint(opts)}/v1/messages/batches`, {
    method: "POST",
    headers: headers(opts),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    console.error("[synthesis-batch] create failed", resp.status, detail);
    return { batchId: null, requested: 0, reason: `create failed (${resp.status})` };
  }
  const data: any = await resp.json().catch(() => null);
  const batchId = String(data?.id ?? "");
  if (!batchId) {
    console.error("[synthesis-batch] create returned no id");
    return { batchId: null, requested: 0, reason: "create returned no id" };
  }

  await pool.query(
    "INSERT INTO synthesis_batches (batch_id, status, request_count) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE status = VALUES(status)",
    [batchId.slice(0, 64), String(data?.processing_status ?? "in_progress").slice(0, 24), eligible.length],
  );
  for (const rec of eligible) {
    await pool.query(
      "INSERT IGNORE INTO synthesis_batch_items " +
        "(batch_id, custom_id, recording_id, status, attempt, role_candidate_ids, chapter_marks) VALUES (?,?,?,?,?,?,?)",
      [
        batchId.slice(0, 64),
        rec.recordingId.slice(0, 64),
        rec.recordingId.slice(0, 64),
        "pending",
        (attempts.get(rec.recordingId) ?? 0) + 1,
        JSON.stringify(rec.roleCandidates.map((c) => c.id)),
        JSON.stringify(rec.chapterMarks),
      ],
    );
  }
  return { batchId, requested: eligible.length };
}

// ── Poll ─────────────────────────────────────────────────────────────────────

export interface PollResult {
  polled: number;
  ended: number;
  written: number;
  unusable: number;
  errored: number;
  expired: number;
  canceled: number;
}

function jsonColumn(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fetch every open batch's status and, when one has ended, read its results
 * and write each succeeded reply exactly once.
 *
 * `ended_at` is stamped only AFTER the results are processed. A crash halfway
 * through leaves the batch open, the next tick reads it again, and the
 * per-item claim makes the second pass write only what the first did not.
 */
export async function pollSynthesisBatches(pool: Pool, opts: BatchOptions): Promise<PollResult> {
  const out: PollResult = { polled: 0, ended: 0, written: 0, unusable: 0, errored: 0, expired: 0, canceled: 0 };
  const [open] = await pool.query<RowDataPacket[]>(
    "SELECT batch_id FROM synthesis_batches WHERE ended_at IS NULL ORDER BY created_at ASC LIMIT 20",
  );
  for (const row of open) {
    const batchId = String(row.batch_id);
    out.polled += 1;
    let status: any;
    try {
      const resp = await fetch(`${endpoint(opts)}/v1/messages/batches/${encodeURIComponent(batchId)}`, {
        headers: headers(opts),
      });
      if (!resp.ok) {
        const detail = (await resp.text().catch(() => "")).slice(0, 300);
        await pool.query(
          "UPDATE synthesis_batches SET last_polled_at = NOW(), last_error = ? WHERE batch_id = ?",
          [`status ${resp.status}: ${detail}`, batchId],
        );
        continue;
      }
      status = await resp.json();
    } catch (e: any) {
      await pool.query("UPDATE synthesis_batches SET last_polled_at = NOW(), last_error = ? WHERE batch_id = ?", [
        String(e?.message ?? e).slice(0, 500),
        batchId,
      ]);
      continue;
    }

    const counts = status?.request_counts ?? {};
    await pool.query(
      "UPDATE synthesis_batches SET status = ?, succeeded = ?, errored = ?, expired = ?, canceled = ?, " +
        "last_polled_at = NOW(), last_error = NULL WHERE batch_id = ?",
      [
        String(status?.processing_status ?? "in_progress").slice(0, 24),
        Number(counts.succeeded ?? 0),
        Number(counts.errored ?? 0),
        Number(counts.expired ?? 0),
        Number(counts.canceled ?? 0),
        batchId,
      ],
    );
    if (String(status?.processing_status ?? "") !== "ended") continue;
    out.ended += 1;

    let lines: string[];
    try {
      const resp = await fetch(`${endpoint(opts)}/v1/messages/batches/${encodeURIComponent(batchId)}/results`, {
        headers: headers(opts),
      });
      if (!resp.ok) {
        await pool.query("UPDATE synthesis_batches SET last_error = ? WHERE batch_id = ?", [
          `results ${resp.status}`,
          batchId,
        ]);
        continue;
      }
      lines = (await resp.text()).split("\n").map((l) => l.trim()).filter(Boolean);
    } catch (e: any) {
      await pool.query("UPDATE synthesis_batches SET last_error = ? WHERE batch_id = ?", [
        String(e?.message ?? e).slice(0, 500),
        batchId,
      ]);
      continue;
    }

    for (const line of lines) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        console.error("[synthesis-batch] unreadable result line in", batchId);
        continue;
      }
      await handleResult(pool, batchId, entry, opts, out);
    }
    // Only now: every result in this batch has been claimed or skipped.
    await pool.query("UPDATE synthesis_batches SET ended_at = NOW() WHERE batch_id = ? AND ended_at IS NULL", [batchId]);
  }
  return out;
}

/** One result, addressed by custom_id and never by position. */
async function handleResult(
  pool: Pool,
  batchId: string,
  entry: any,
  opts: BatchOptions,
  out: PollResult,
): Promise<void> {
  const customId = String(entry?.custom_id ?? "");
  if (!customId) return;
  const [items] = await pool.query<RowDataPacket[]>(
    "SELECT recording_id, attempt, role_candidate_ids, chapter_marks FROM synthesis_batch_items WHERE batch_id = ? AND custom_id = ?",
    [batchId, customId],
  );
  const item = items[0];
  if (!item) {
    // A reply addressed to a request we have no record of. Never guessed at.
    console.error("[synthesis-batch] result for unknown custom_id", customId, "in", batchId);
    return;
  }
  const type = String(entry?.result?.type ?? "");
  const recordingId = String(item.recording_id);
  const attempt = Number(item.attempt ?? 1);

  if (type !== "succeeded") {
    // Out of attempts becomes `failed`, which the selection query never picks
    // up again. Anything else keeps its own name and is retried once.
    const next = attempt >= MAX_ATTEMPTS ? "failed" : type || "errored";
    const [r]: any = await pool.query(
      "UPDATE synthesis_batch_items SET status = ?, result_json = ? WHERE batch_id = ? AND custom_id = ? AND status = 'pending'",
      [next, JSON.stringify(entry?.result ?? {}), batchId, customId],
    );
    if (r.affectedRows) {
      if (type === "expired") out.expired += 1;
      else if (type === "canceled") out.canceled += 1;
      else out.errored += 1;
      console.error(`[synthesis-batch] ${recordingId} ${type || "errored"} (attempt ${attempt}) -> ${next}`);
    }
    return;
  }

  // THE CLAIM. Everything below runs at most once per (batch_id, custom_id).
  const [claim]: any = await pool.query(
    "UPDATE synthesis_batch_items SET status = 'written', result_json = ? WHERE batch_id = ? AND custom_id = ? AND status = 'pending'",
    [JSON.stringify(entry?.result ?? {}), batchId, customId],
  );
  if (!claim.affectedRows) return; // a previous poll already handled this reply

  const message = entry?.result?.message ?? {};
  // The usage row is written before the parse, exactly as the synchronous path
  // does it: the tokens were spent whether or not the answer turns out to be
  // usable JSON.
  //
  // `path: 'batch'` is what makes the saving countable. The token counts here
  // are REAL and unhalved, because halving them would put a price into a column
  // that holds token facts and quietly break every other question those numbers
  // answer. The 50% is a billing fact, and the rollup applies it to the rows
  // this flag marks.
  await recordAssistantUsage(pool, {
    villageId: opts.villageId,
    mode: "synthesize",
    model: String(message?.model ?? SYNTHESIS_MODEL),
    // Always the village's own: the batch path resolves the admin-typed key or
    // ANTHROPIC_API_KEY and never reaches the borrowed platform key.
    keySource: "village",
    // Nobody is signed in. A timer has no actor and does not borrow one.
    userId: null,
    usage: {
      inputTokens: Number(message?.usage?.input_tokens ?? 0),
      outputTokens: Number(message?.usage?.output_tokens ?? 0),
      cacheCreationInputTokens: Number(message?.usage?.cache_creation_input_tokens ?? 0),
      cacheReadInputTokens: Number(message?.usage?.cache_read_input_tokens ?? 0),
    },
    iterations: 1,
    stopReason: message?.stop_reason ?? null,
    path: "batch",
  });

  const transcript = await transcriptFor(pool, recordingId);
  if (!transcript) {
    console.error("[synthesis-batch] transcript vanished for", recordingId);
    return;
  }
  try {
    const result = await writeSynthesis(pool, {
      recordingId,
      replyText: String(message?.content?.[0]?.text ?? ""),
      segments: transcript.segments,
      candidateRoleIds: new Set(jsonColumn(item.role_candidate_ids).map((c) => String(c))),
      chapterMarks: jsonColumn(item.chapter_marks) as { startMs: number }[],
      model: String(message?.model ?? SYNTHESIS_MODEL),
    });
    if (result.ok) {
      out.written += 1;
      console.log(`[synthesis-batch] ${recordingId}: ${result.kept} task(s) kept, ${result.dropped} dropped`);
    } else {
      out.unusable += 1;
      console.error("[synthesis-batch] unusable JSON for", recordingId);
    }
  } catch (e: any) {
    // ER_DUP_ENTRY means the recording already carries a synthesis, which is
    // the schema keeping its own promise. Anything else goes back to `errored`
    // so the bounded retry can have the second attempt it is owed.
    if (e?.code === "ER_DUP_ENTRY") {
      console.log("[synthesis-batch]", recordingId, "already had a synthesis; nothing written");
      return;
    }
    console.error("[synthesis-batch] write failed for", recordingId, e);
    await pool.query(
      "UPDATE synthesis_batch_items SET status = ? WHERE batch_id = ? AND custom_id = ?",
      [attempt >= MAX_ATTEMPTS ? "failed" : "errored", batchId, customId],
    );
    out.errored += 1;
  }
}
