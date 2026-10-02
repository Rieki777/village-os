/**
 * Calling the outside service, over the transport it actually speaks.
 *
 * ── WHAT IS MEASURED AND WHAT IS NOT ─────────────────────────────────────
 *
 * MEASURED, against their live service: the transport. It is MCP over HTTP,
 * the reply comes back in server-sent event framing, a session id arrives on
 * the `mcp-session-id` response header of `initialize`, and a request offering
 * only `Accept: application/json` is answered `406 Not Acceptable` because
 * their server requires a client that accepts both. `saberraStream.ts` reads
 * the framing and survives the keepalive comments a slow answer arrives behind.
 *
 * NOT MEASURED: the shape of what `list_records` returns. Their founder shipped
 * it and described it as real typed JSON, paginated on last-edited time with a
 * cursor, capped at a hundred a page, with person-relation fields dropped
 * entirely. No token has been issued to us yet, so not one call has been made.
 *
 * That gap decides how this file is written. Everything about the transport is
 * asserted. Everything about the payload is READ DEFENSIVELY AND REPORTED: a
 * reply this does not understand comes back as `unreadable` with the raw text,
 * never as an empty list. An empty list and a reply we could not parse look
 * identical to a caller, and one of them means the sync is broken.
 *
 * ── WHY `fetchImpl` IS AN ARGUMENT ───────────────────────────────────────
 *
 * So every case below can be exercised without a token and without a network.
 * When the token arrives, one measurement against the live service is what
 * turns the payload half from a contract into a fact.
 */
import { readEventStream } from "./saberraStream";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl: FetchLike;
  /** Milliseconds for one call. Their slow answers arrive behind keepalives. */
  timeoutMs?: number;
}

export type CallResult =
  | { ok: true; records: Record<string, unknown>[]; cursor: string | null }
  | { ok: false; why: "no-session" | "refused" | "unreadable" | "vendor-error"; detail: string };

/** Both types, always. Their server answers 406 to a client that offers one. */
function headers(token: string, sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  return h;
}

/**
 * Open a session. The id comes back on a RESPONSE HEADER rather than in the
 * body, which is easy to miss and is why this is its own step.
 */
export async function openSession(o: ClientOptions): Promise<string | null> {
  // try/catch and a status check, for the reason `callTool` has both: a DNS
  // failure or a refused connection here used to reject into the express
  // default handler as an unnamed 500, against this module's own promise that
  // every refusal is named. An audit found it before a vendor did.
  let res: Response;
  try {
    res = await o.fetchImpl(o.baseUrl, {
      method: "POST",
      headers: headers(o.token),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "village-os", version: "1.0.0" },
        },
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const id = res.headers?.get?.("mcp-session-id") ?? null;
  return id && id.trim() !== "" ? id : null;
}

/**
 * One tool call, read as far as it can honestly be read.
 *
 * The layers are peeled one at a time and each failure is named, because
 * "the sync returned nothing" is the report that wastes an afternoon.
 */
export async function callTool(
  o: ClientOptions,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  let res: Response;
  try {
    res = await o.fetchImpl(o.baseUrl, {
      method: "POST",
      headers: headers(o.token, sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
    });
  } catch (e) {
    return { ok: false, why: "refused", detail: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) {
    return { ok: false, why: "refused", detail: `the service answered ${res.status}` };
  }

  const body = await res.text();
  const stream = readEventStream(body);
  if (stream.messages.length === 0) {
    const detail = stream.unparsed.length > 0 ? stream.unparsed.join(" ").slice(0, 400) : "the reply carried no message";
    return { ok: false, why: "unreadable", detail };
  }

  const msg = stream.messages[0] as Record<string, unknown>;
  if (msg.error) {
    const err = msg.error as Record<string, unknown>;
    return { ok: false, why: "vendor-error", detail: String(err.message ?? "the service reported an error") };
  }

  const payload = readRecords(msg.result);
  if (payload === null) {
    return { ok: false, why: "unreadable", detail: JSON.stringify(msg.result ?? msg).slice(0, 400) };
  }
  return { ok: true, ...payload };
}

/**
 * Find records in a reply, accepting the shapes an MCP tool plausibly answers
 * in, and answering null for anything else.
 *
 * Null is the important return. A reply this does not understand must not look
 * like a village with no circles.
 */
function readRecords(result: unknown): { records: Record<string, unknown>[]; cursor: string | null } | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  // Structured content, which is what a typed read should answer with.
  const direct = asRecordList(r.records ?? r.items ?? r.data);
  if (direct) return { records: direct, cursor: asCursor(r.cursor ?? r.nextCursor) };

  // A text content block carrying JSON, which is how an MCP tool commonly
  // answers when it has no structured channel.
  const content = r.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "text" || typeof b.text !== "string") continue;
      try {
        const parsed: unknown = JSON.parse(b.text);
        if (Array.isArray(parsed)) {
          const list = asRecordList(parsed);
          if (list) return { records: list, cursor: null };
        } else if (parsed && typeof parsed === "object") {
          const p = parsed as Record<string, unknown>;
          const list = asRecordList(p.records ?? p.items ?? p.data);
          if (list) return { records: list, cursor: asCursor(p.cursor ?? p.nextCursor) };
        }
      } catch {
        // Prose, which is what their older read tools answer with. It is not a
        // typed read and must never be treated as one.
        return null;
      }
    }
  }
  return null;
}

function asRecordList(v: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(v)) return null;
  const out: Record<string, unknown>[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    out.push(item as Record<string, unknown>);
  }
  return out;
}

function asCursor(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
