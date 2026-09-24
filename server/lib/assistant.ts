/**
 * One assistant engine (S76).
 *
 * Five call sites each grew their own copy of the same eight steps: check for a
 * key, check the per-IP burst limit, check the global daily cap, validate the
 * message list, build a system prompt, POST to Anthropic, dig a JSON object out
 * of the reply, and map a failure onto a status code. They had already drifted
 * in their limits, their fallback sentences and their error shapes, and every
 * new mode copied whichever one was nearest.
 *
 * This file is that shared half. A mode is a row in a table plus a system
 * prompt, so adding one is a decision about what she may see, never ninety
 * lines of plumbing.
 *
 * Two things this fixes beyond the duplication:
 *
 * ONE POOL BECOMES SEVEN BUDGETS. Every path shared a single 600-per-day cap,
 * so a founder in a long setup session could starve the public proposal guide
 * for the rest of the day, and the person it failed for was a stranger trying
 * to offer the village something. Budgets are per mode and the public surface
 * keeps its own.
 *
 * THE BORROWED KEY (Rye, 2026-08-03). A village runs on its own Anthropic key.
 * Until it has one, a deployment MAY fall back to a platform key, and that
 * fallback is an env var set at provisioning, never an admin toggle: a screen
 * that lets a deployment start spending someone else's money is a screen that
 * eventually does. Borrowed usage carries its own smaller allowance so a demo
 * fork cannot spend a production village's headroom.
 */

import { fenceForPrompt, toolNameToKey } from "./villageReaders";
import { providerFor, type ProviderId, type ToolResult, type WireMessage } from "./assistantProviders";
import { guardedFetchJson } from "./toolcheck";

export type AssistantMode =
  | "proposal"
  | "concierge"
  | "member"
  | "launch"
  | "organize"
  | "studio"
  | "synthesize";

export interface ModeSpec {
  audience: "public" | "member" | "admin";
  /** Calls per day for THIS mode. The sum is the deployment's real ceiling. */
  dailyBudget: number;
  /** Reply cap. A mode that drafts needs more room than one that asks. */
  maxTokens: number;
  /** How many reader calls one turn may make before she must answer. */
  toolCalls: number;
}

/**
 * The public surface gets the largest budget on purpose: it is the one a
 * stranger meets, and the one whose failure costs the village something it
 * cannot see. Admin modes are used by a handful of named people who can be
 * told why they ran out.
 */
export const ASSISTANT_MODES: Record<AssistantMode, ModeSpec> = {
  proposal: { audience: "public", dailyBudget: 250, maxTokens: 800, toolCalls: 0 },
  concierge: { audience: "member", dailyBudget: 100, maxTokens: 400, toolCalls: 0 },
  member: { audience: "member", dailyBudget: 100, maxTokens: 700, toolCalls: 2 },
  launch: { audience: "admin", dailyBudget: 50, maxTokens: 700, toolCalls: 0 },
  organize: { audience: "admin", dailyBudget: 50, maxTokens: 800, toolCalls: 2 },
  studio: { audience: "admin", dailyBudget: 150, maxTokens: 1600, toolCalls: 4 },
  synthesize: { audience: "admin", dailyBudget: 25, maxTokens: 2000, toolCalls: 0 },
};

/** Conversation limits, shared so no mode can quietly widen them. */
export const MAX_TURNS = 40;
export const MAX_MESSAGE_CHARS = 4000;

/**
 * One place for the model id, which was pasted into five call sites and would
 * have drifted the first time anyone changed one of them. Per-mode overrides
 * belong in ASSISTANT_MODES when someone picks them against the current
 * lineup: drafting a role description from a brief and collecting proposal
 * fields are different jobs and should not be forced onto one tier forever.
 */
export const DEFAULT_ASSISTANT_MODEL = "claude-haiku-4-5-20251001";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * What one answer cost upstream.
 *
 * All four fields, never a subset. `inputTokens` is the UNCACHED remainder
 * only, so a caller that sums it alone under-reports the moment anyone turns
 * prompt caching on, and the under-report looks exactly like a saving.
 */
export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** One tool as the wire wants it. Readers take no arguments, so the schema is empty. */
export interface AssistantTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown> };
}

/**
 * The wire's message shape (`WireMessage`, in assistantProviders.ts) is NOT
 * `ChatMessage`. A tool turn carries content blocks, and `sanitizeMessages`
 * filters on `typeof m.content === "string"`, so feeding these back through the
 * validator would silently drop every one of them. Internal on purpose: the
 * loop builds it from sanitized ChatMessages and nothing outside constructs one.
 */

// ── Injected deps, so this file needs none of the server's globals ───────────

export interface AssistantDeps {
  /** The village's OWN key, from the secrets store. Empty when unset. */
  villageKey(): string;
  /** True when this bucket has already had `max` hits inside the window. */
  rateLimited(bucket: string, max: number, windowMs: number): Promise<boolean>;
  /** Injected for tests. Defaults to global fetch against the Anthropic endpoint. */
  fetchImpl?: typeof fetch;
  /**
   * The SSRF-guarded POST for a MEMBER-typed endpoint (round 4, lane L6). An
   * OpenAI-compatible base URL is a URL a member typed, so it is dialled the
   * way every other admin- or member-entered host is: range-checked, pinned
   * to the vetted address, redirects re-checked per hop, body capped. Defaults
   * to `guardedFetchJson`; injected for tests, which run no network.
   */
  guardedPostJson?(url: string, body: unknown, headers: Record<string, string>): Promise<any>;
}

let deps: AssistantDeps = {
  villageKey: () => "",
  rateLimited: async () => false,
};

export function wireAssistant(d: AssistantDeps): void {
  deps = d;
}

// ── The key ──────────────────────────────────────────────────────────────────

/**
 * `member` (round 4, lane L6): the person asking brought their own key. It is
 * resolved per request from `AssistantRequest.memberKey`, never from the deps,
 * because it belongs to one member and a module-level dep would make one
 * member's key everybody's.
 */
export type KeySource = "village" | "platform" | "member";

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

/** A member's own key, already decrypted by memberSecrets on its way here. */
export interface MemberKey {
  provider: ProviderId;
  key: string;
  baseUrl?: string | null;
  /** The member's own model name for an OpenAI-compatible endpoint. */
  model?: string | null;
}

/** How many calls a day one member's own key may make through this server. */
export const MEMBER_KEY_DAILY_CAP = 200;

/**
 * The village's own key always wins, with no admin action and no restart: the
 * moment a founder saves theirs, borrowing stops.
 *
 * The platform key is read from the environment at call time and is never
 * written to app_config, never returned by the secrets route (not even masked,
 * since it is not the village's secret to see), and never present in /health,
 * the platform handshake, or the launch checklist.
 */
export function resolveKey(env: NodeJS.ProcessEnv = process.env, memberKey?: MemberKey | null): ResolvedKey | null {
  // A member's own key wins over both. It is their money and their provider.
  const mine = (memberKey?.key ?? "").trim();
  if (mine) return { key: mine, source: "member" };
  const own = (deps.villageKey() ?? "").trim();
  if (own) return { key: own, source: "village" };
  const platform = (env.PLATFORM_ASSISTANT_KEY ?? "").trim();
  if (platform) return { key: platform, source: "platform" };
  return null;
}

/**
 * Borrowed usage has its own, smaller allowance.
 *
 * ABSENT and ZERO are different answers and must not be conflated: `Number("")`
 * is 0, so reading the unset variable as a number made "nobody configured an
 * allowance" mean "allow nothing", and borrowing would have looked broken with
 * no message explaining why. Absent means the default; an explicit 0 still
 * means zero, the way every other cap in this platform fails closed.
 */
export function platformDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PLATFORM_ASSISTANT_DAILY_CAP;
  if (raw === undefined || String(raw).trim() === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 100;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type Sanitized = { ok: true; messages: ChatMessage[] } | { ok: false; error: string };

/**
 * One validator for every mode. Roles other than user and assistant are
 * dropped, each message is capped, the conversation is bounded, and the last
 * message must be from the person: a request that ends on an assistant turn is
 * either a bug or someone trying to put words in her mouth.
 */
export function sanitizeMessages(incoming: unknown): Sanitized {
  if (!Array.isArray(incoming)) return { ok: false, error: "messages required" };
  if (incoming.length > MAX_TURNS) return { ok: false, error: "conversation too long" };
  const messages = incoming
    .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .map((m: any) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, MAX_MESSAGE_CHARS) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { ok: false, error: "last message must be from the user" };
  }
  return { ok: true, messages };
}

/**
 * Dig the JSON object out of a reply.
 *
 * Every mode instructs the model to answer with one JSON object and every mode
 * had its own brace-slicing copy. A model that wraps the object in prose, or
 * fences it, still has its answer read; a model that returns nothing usable
 * falls back to the caller's sentence instead of showing a member a stack.
 */
export function parseJsonReply<T = any>(text: string, fallback: T): T {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return fallback;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  try {
    return JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as T;
  } catch {
    return fallback;
  }
}

// ── The call ─────────────────────────────────────────────────────────────────

export interface AssistantRequest {
  mode: AssistantMode;
  system: string;
  messages: ChatMessage[];
  /** Per-call override. Defaults to the mode's cap. */
  maxTokens?: number;
  model: string;
  /** For the per-IP burst guard. */
  clientIp: string;
  /**
   * Who is asking, for the usage row. Null on the public surfaces.
   * `user_id` cannot be backfilled once rows exist, so it goes in from the
   * first row even though nothing enforces a per-user ceiling yet.
   */
  userId?: string | null;
  /**
   * The tools this VIEWER may call, already filtered by the reader catalog.
   * On the request and not on the deps: the reader ctx is per-viewer, and a
   * module-level dep would make one caller's catalog everybody's.
   */
  tools?: AssistantTool[];
  /** Runs one tool by its WIRE name and hands back the reader's own result. */
  runTool?(name: string): Promise<{ ok: true; key: string; data: unknown } | { ok: false; error: string }>;
  /**
   * Reader results the CALLER already read, for the question it already knows
   * they answer (Lane K1).
   *
   * The tool loop costs two POSTs to use a reader: one that comes back asking
   * for it, and one that reads the result. When the caller can tell which
   * reader a question wants before asking, the first POST buys nothing except
   * the model's agreement. Filling this skips it.
   *
   * Present and non-empty turns tools OFF for this request. That is the whole
   * point and it is not a suggestion to the model: a request that both carries
   * the data and offers the tools can still spend a round trip asking for what
   * it was already given. One POST, and `iterations` says 1 honestly.
   *
   * The data is fenced with `fenceForPrompt`, the same fence the loop puts
   * around a tool result, because it is the same member-written text arriving
   * by a shorter road. Audience gating is NOT relaxed here and is not this
   * file's job: the caller reads through `callReader`, which refuses a reader
   * the viewer may not see, exactly as it does for the loop.
   */
  prefetch?: { key: string; data: unknown }[];
  /**
   * The asker's own key (round 4, lane L6). Wins over the village and platform
   * keys, skips the mode's day bucket and the platform cap, and pays its own
   * `assistant-member-day:${userId}` allowance instead. The per-IP burst guard
   * still runs first: it is about a caller, not about whose money is spent.
   */
  memberKey?: MemberKey | null;
}

/**
 * What a REFUSED answer already cost (Lane Q).
 *
 * A tool loop that exhausts the day budget on its second iteration refuses
 * with 503 and no text, which is the honest end of that turn. The first
 * iteration still happened: real tokens were bought upstream and the reply is
 * in the wire history. The usage writer used to be reachable only through the
 * ok-guard at each call site, so that spend was recorded NOWHERE, and the only
 * measurement anyone has of what the assistant costs quietly under-counted
 * exactly the conversations that ran long enough to be expensive.
 *
 * Present only when at least one upstream call completed. A refusal before the
 * first POST (unknown mode, burst limit, no key, budget already spent at i=0)
 * carries nothing, because nothing was bought.
 */
export interface AssistantSpend {
  /** Summed across the iterations that COMPLETED before the refusal. */
  usage: AssistantUsage;
  /** Upstream POSTs that completed. Always >= 1 when this is present. */
  iterations: number;
  keySource: KeySource;
  stopReason: string | null;
}

export type AssistantResult =
  | {
      ok: true;
      text: string;
      keySource: KeySource;
      /** Summed across every iteration, so one answer reports one cost. */
      usage: AssistantUsage;
      stopReason: string | null;
      /** Upstream POSTs behind this answer. */
      iterations: number;
      /** Reader keys actually called, in order, for the transparency line. */
      toolsUsed: string[];
    }
  | { ok: false; status: number; error: string; spent?: AssistantSpend };

/**
 * The endpoint and the reply shape live in `assistantProviders.ts` now (round
 * 4, lane L6): `anthropicUrl` still honours ANTHROPIC_BASE_URL exactly as it
 * did here, and the OpenAI-compatible adapter sits beside it.
 */

/**
 * The caller's system prompt with the reader results appended (Lane K1).
 *
 * The system prompt and not a message, for two reasons. The organize route
 * already fences its call syntheses into the system prompt, so this is the
 * road that exists. And the alternative breaks something: `sanitizeMessages`
 * guarantees the conversation ends on the person's own turn, and slipping a
 * data turn in before it either breaks that guarantee or edits words the
 * person wrote.
 *
 * The instruction sentence matters. Without it a model handed data it did not
 * ask for tends to acknowledge the data instead of answering from it.
 */
function withPrefetched(system: string, prefetched: { key: string; data: unknown }[]): string {
  return [
    system,
    "",
    "THE VILLAGE DATA FOR THIS QUESTION, read from the database before this message.",
    "You did not have to ask for it and there is nothing further to request. Answer from it.",
    ...prefetched.map((p) => fenceForPrompt(p.key, p.data)),
  ].join("\n");
}

/**
 * Every guard, then the call, then as many tool turns as the mode allows.
 *
 * The per-IP burst limit runs first and ONCE, because it is a guard about a
 * caller and not about spend: an admin surface where every founder shares one
 * office IP would otherwise throttle the village for its own use.
 *
 * The day budget and the borrowed-key ceiling moved INSIDE the loop, one of
 * each immediately before each POST. `overLimit` counts and inserts in the
 * same call, so leaving a copy outside would charge the bucket twice for one
 * answer. The consequence is deliberate and has to be said out loud: a
 * `dailyBudget` of 50 is 50 upstream calls, which is roughly 25 tool-using
 * conversations, and the number a single biller is billed against stays
 * honest.
 *
 * The iteration ceiling is a LOCAL INTEGER and not a bucket. `overLimit`
 * catches its own database errors and returns false, so a loop that asked the
 * rate limiter where to stop would be unbounded for as long as MySQL hiccups.
 */
export async function callAssistant(req: AssistantRequest): Promise<AssistantResult> {
  const spec = ASSISTANT_MODES[req.mode];
  if (!spec) return { ok: false, status: 400, error: `unknown assistant mode: ${String(req.mode)}` };

  if (await deps.rateLimited(`assist:${req.clientIp}`, 30, 60 * 60 * 1000)) {
    return { ok: false, status: 429, error: "Slow down a moment, then keep going." };
  }

  const resolved = resolveKey(process.env, req.memberKey);
  if (!resolved) return { ok: false, status: 503, error: "assistant-unavailable" };
  // Which wire to speak. Only a member's key can name a provider; the village
  // and platform keys are Anthropic keys and always were.
  const providerId: ProviderId = resolved.source === "member" ? (req.memberKey?.provider ?? "anthropic") : "anthropic";
  const provider = providerFor(providerId);
  const baseUrl = resolved.source === "member" ? req.memberKey?.baseUrl ?? null : null;
  // A member's own OpenAI-compatible endpoint needs the member's own model
  // name; the platform's Anthropic model id means nothing to it.
  const model = resolved.source === "member" && providerId === "openai_compatible"
    ? String(req.memberKey?.model ?? "").trim() || req.model
    : req.model;

  // LANE K1: prefetched data replaces the tools rather than joining them. A
  // request carrying both can still spend a POST asking for what it holds.
  const prefetched = req.prefetch ?? [];
  const useTools = prefetched.length === 0 && Boolean(req.tools?.length) && spec.toolCalls > 0;
  const system = prefetched.length > 0 ? withPrefetched(req.system, prefetched) : req.system;
  const wire: WireMessage[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
  const usage: AssistantUsage = {
    inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
  };
  // The loop pushes a key when it CALLS a reader. A prefetched key was read
  // before this function ran, so it is seeded here and the transparency line
  // shows the same thing on both roads.
  const toolsUsed: string[] = prefetched.map((p) => p.key);
  let iterations = 0;
  let stopReason: string | null = null;
  let text = "";

  const doFetch = deps.fetchImpl ?? fetch;

  // LANE Q: what a refusal from here on has already bought. Spreads to nothing
  // before the first completed POST, so every existing refusal shape is byte
  // for byte what it was.
  const spent = (): { spent?: AssistantSpend } =>
    iterations > 0 ? { spent: { usage, iterations, keySource: resolved.source, stopReason } } : {};

  for (let i = 0; i <= spec.toolCalls; i++) {
    const today = new Date().toISOString().slice(0, 10);
    if (resolved.source === "member") {
      // LANE L6: a member's own key spends the member's own money, so it
      // neither charges the mode's day bucket nor meets the platform cap. It
      // has its own allowance because this server is still the one making
      // the calls, and a runaway loop is a runaway loop whoever is billed.
      if (await deps.rateLimited(`assistant-member-day:${req.userId ?? "anon"}:${today}`, MEMBER_KEY_DAILY_CAP, 24 * 60 * 60 * 1000)) {
        return { ok: false, status: 503, error: "assistant-unavailable", ...spent() };
      }
    } else {
      if (await deps.rateLimited(`assistant-day:${req.mode}:${today}`, spec.dailyBudget, 24 * 60 * 60 * 1000)) {
        // Mid-loop this is not a partial answer, it is no answer: the last reply
        // was a tool request and carries no text. Refusing is the honest end.
        // Serving what we have would hand a caller their own fallback sentence
        // at HTTP 200 with nothing in the log.
        if (i > 0) console.warn(`[assistant:${req.mode}] day budget ran out mid-loop after ${iterations} call(s)`);
        return { ok: false, status: 503, error: "assistant-unavailable", ...spent() };
      }
      // A borrowed key spends someone else's allowance, so it carries a second,
      // smaller ceiling on top of the mode's own.
      if (resolved.source === "platform") {
        const cap = platformDailyCap();
        if (cap === 0 || (await deps.rateLimited(`assistant-platform-day:${today}`, cap, 24 * 60 * 60 * 1000))) {
          return { ok: false, status: 503, error: "assistant-unavailable", ...spent() };
        }
      }
    }

    const request = provider.request({
      key: resolved.key,
      baseUrl,
      model,
      maxTokens: req.maxTokens ?? spec.maxTokens,
      system,
      messages: wire,
      tools: useTools ? req.tools : undefined,
      toolChoice: useTools ? (i === spec.toolCalls ? "none" : "auto") : undefined,
    });

    let data: any;
    try {
      if (providerId === "openai_compatible") {
        // A member-typed host goes through the pinned, range-checked dialer,
        // never bare fetch: bare fetch follows redirects into private ranges.
        const post = deps.guardedPostJson
          ?? ((url: string, body: unknown, headers: Record<string, string>) =>
            guardedFetchJson(url, 60_000, { method: "POST", body, headers }));
        data = await post(request.url, request.body, request.headers);
      } else {
        const r = await doFetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(request.body),
        });
        if (!r.ok) {
          // The key never reaches a log line, whoever it belongs to.
          console.error(`[assistant:${req.mode}] ${provider.id} error`, r.status, (await r.text()).slice(0, 300));
          return { ok: false, status: 502, error: "assistant-error", ...spent() };
        }
        data = await r.json();
      }
    } catch (err) {
      // The guarded dialer throws its refusal or the upstream status as the
      // message; neither carries the key or the body.
      console.error(`[assistant:${req.mode}] ${provider.id}`, String((err as any)?.message ?? err).slice(0, 200));
      return { ok: false, status: 502, error: "assistant-error", ...spent() };
    }

    iterations += 1;
    const reply = provider.parse(data);
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    usage.cacheCreationInputTokens += reply.usage.cacheCreationInputTokens;
    usage.cacheReadInputTokens += reply.usage.cacheReadInputTokens;
    stopReason = reply.stopReason;
    text = reply.text;

    if (stopReason !== "tool_use" || !useTools || !req.runTool) break;
    if (reply.calls.length === 0) break;

    // The assistant turn goes back RAW, in the provider's own shape, so the
    // tool ids survive and the next request does not 400 on results that
    // answer nothing.
    wire.push(reply.assistantTurn);
    const results: ToolResult[] = [];
    for (const call of reply.calls) {
      const key = toolNameToKey(call.name);
      toolsUsed.push(key);
      try {
        const out = await req.runTool(call.name);
        // `callReader` applies capTokens and NOT the fence, so fencing here is
        // the loop's job. Every reader result is member-written text heading
        // into a prompt, which is the widest injection surface there is.
        results.push(out.ok
          ? { id: call.id, content: fenceForPrompt(out.key, out.data) }
          : { id: call.id, content: out.error, isError: true });
      } catch (err) {
        console.error(`[assistant:${req.mode}] reader ${key} threw`, err);
        results.push({ id: call.id, content: `${key} could not be read`, isError: true });
      }
    }
    wire.push(...provider.toolResults(results));
  }

  if (stopReason === "tool_use") {
    // The loop ended still wanting a tool, so `text` is empty and the caller's
    // parseJsonReply is about to serve its own fallback sentence at HTTP 200.
    // Nothing else would say so.
    console.warn(`[assistant:${req.mode}] loop ended on tool_use after ${iterations} call(s), reply is empty`);
  }
  return { ok: true, text, keySource: resolved.source, usage, stopReason, iterations, toolsUsed };
}

/** Whether this deployment is currently spending the platform's key. */
export function borrowingPlatformKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveKey(env)?.source === "platform";
}

/**
 * WHOSE KEY THE GUIDE WOULD SPEND, in three answers rather than two.
 *
 * The launch checklist asked `borrowingPlatformKey()` and treated a false as
 * "this village has its own". A deployment with NO key at all is not
 * borrowing either, so nothing configured read as good news: the checklist
 * said "The guide runs on this village's own key" two lines below
 * `assistant-key` correctly reporting that there is no key. A readiness list
 * exists to tell a founder the truth about their deployment before they go
 * live, so a false green on it is worse than a missing row.
 *
 * It is three states because the question has three answers, and the boolean
 * could only ever name two of them.
 */
export function assistantKeyOwner(env: NodeJS.ProcessEnv = process.env): "own" | "platform" | "none" {
  const source = resolveKey(env)?.source;
  if (source === "platform") return "platform";
  return source ? "own" : "none";
}

/**
 * The launch checklist's own words for each of those three, kept beside the
 * function that decides which one applies rather than in server/index.ts. The
 * borrowed and own sentences are unchanged; only the third is new.
 */
export function assistantOwnKeyReadiness(env: NodeJS.ProcessEnv = process.env): { state: "ok" | "missing"; detail: string } {
  const owner = assistantKeyOwner(env);
  if (owner === "platform") return { state: "missing", detail: "Running on the platform's key. Add your own before handoff so nobody else's rotation can switch the guide off" };
  if (owner === "own") return { state: "ok", detail: "The guide runs on this village's own key" };
  return { state: "missing", detail: "No key at all, so there is nothing to move onto your own. Connect the guide first, or leave it off deliberately" };
}
