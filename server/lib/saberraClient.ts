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
 * reply this does not understand comes back as `unreadable`, never as an empty
 * list. An empty list and a reply we could not parse look identical to a
 * caller, and one of them means the sync is broken.
 *
 * ── A FAILURE DESCRIBES THE REPLY'S SHAPE, NEVER ITS VALUES ──────────────
 *
 * A failure's `detail` travels into the sync's answer and onto the steward's
 * screen, and it is taken BEFORE `readVendorRecord` runs, so neither the allow
 * list nor the address net has seen it. It used to be the first 400 characters
 * of the raw reply. A verifier showed an unreadable role assignment reply
 * arriving on screen carrying `Assignment Title` and `Role Holder`, the two
 * fields the allow list drops on purpose because their values are people.
 * So an unreadable reply is described by its keys, its content blocks' types
 * and lengths, and whether their text parsed: enough to fix the reader, and
 * nothing a person wrote. A vendor's error message is clipped and dropped
 * whole when it carries an address, the rule every intake here holds.
 *
 * ── ASKING THE SERVICE WHAT IT TAKES ─────────────────────────────────────
 *
 * Their mail of 2026-09-28 says their founder "called list_records on
 * role_assignment", which is the service's own name for a kind this village
 * calls `roleAssignment`. The NAME OF THE ARGUMENT that kind travels under has
 * never been measured. So `listTools` reads the MCP `tools/list` answer, whose
 * `inputSchema` per tool is the service saying what it accepts, and
 * `saberraKinds.ts` decides what to ask from that. This file only fetches it
 * and reports a reply it cannot read, exactly as `callTool` does.
 *
 * ── WHY `fetchImpl` IS AN ARGUMENT ───────────────────────────────────────
 *
 * So every case below can be exercised without a token and without a network.
 * When the token arrives, one measurement against the live service is what
 * turns the payload half from a contract into a fact.
 */
import { readEventStream } from "./saberraStream";
import { carriesAnAddress } from "./saberraRecords";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl: FetchLike;
  /** Milliseconds for one call. Their slow answers arrive behind keepalives. */
  timeoutMs?: number;
}

/** Every way a call comes back with nothing, each one named. */
export type CallFailure = { ok: false; why: "no-session" | "refused" | "unreadable" | "vendor-error"; detail: string };

export type CallResult =
  | { ok: true; records: Record<string, unknown>[]; cursor: string | null }
  | CallFailure;

/** One tool as the service lists it. The schema is the service's, believed by nobody here. */
export interface ToolInfo {
  name: string;
  inputSchema: unknown;
}

export type ToolsResult = { ok: true; tools: ToolInfo[] } | CallFailure;

/** Pages of `tools/list` read before stopping. A service with more is a service listing something else. */
const MAX_TOOL_PAGES = 5;

/** The longest detail a failure carries. */
const DETAIL_MAX = 400;
/** Keys named when a reply is described. The rest are counted. */
const KEYS_NAMED = 12;
/** Content blocks described one by one. The rest are counted. */
const BLOCKS_NAMED = 5;
/**
 * A key named in a description: an identifier, never a label. `results` and
 * `nextCursor` are structure and say where the rows were. A key with a space,
 * an @ or any other punctuation (`Assignment Title`, a person's name, an
 * address) is counted and never named.
 */
const NAMEABLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$-]{0,39}$/;

function clip(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function keyList(o: Record<string, unknown>): string {
  const all = Object.keys(o);
  if (all.length === 0) return "none";
  const named = all.filter((k) => NAMEABLE_KEY.test(k)).slice(0, KEYS_NAMED);
  const rest = all.length - named.length;
  if (named.length === 0) return `${plural(rest, "key")}, none named`;
  return rest > 0 ? `${named.join(", ")}, and ${rest} more` : named.join(", ");
}

function shape(v: unknown): string {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "string") return `a string of ${plural(v.length, "character")}`;
  if (Array.isArray(v)) return `a list of ${plural(v.length, "item")}`;
  if (typeof v !== "object") return `a ${typeof v}`;
  return `an object with keys: ${keyList(v as Record<string, unknown>)}`;
}

function textShape(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "not JSON";
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return `JSON with keys: ${keyList(parsed as Record<string, unknown>)}`;
  }
  return `JSON, ${shape(parsed)}`;
}

function blockShape(block: unknown): string {
  if (!block || typeof block !== "object" || Array.isArray(block)) return shape(block);
  const b = block as Record<string, unknown>;
  const type = typeof b.type === "string" && NAMEABLE_KEY.test(b.type) ? b.type : "of no named type";
  if (typeof b.text !== "string") return `${type}, carrying no text`;
  return `${type}, ${plural(b.text.length, "character")}, ${textShape(b.text)}`;
}

/**
 * A reply this could not read, described by its SHAPE and never by its values.
 * The header's "A FAILURE DESCRIBES THE REPLY'S SHAPE" says why.
 */
export function describeReply(message: Record<string, unknown>): string {
  const [where, v] = message.result !== undefined ? ["the result", message.result] : ["the message", message];
  const parts = [`${where} was ${shape(v)}`];
  const content = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>).content : undefined;
  if (Array.isArray(content)) {
    content.slice(0, BLOCKS_NAMED).forEach((block, i) => parts.push(`content block ${i + 1} is ${blockShape(block)}`));
    if (content.length > BLOCKS_NAMED) parts.push(`${content.length - BLOCKS_NAMED} more blocks`);
  }
  return clip(parts.join("; "));
}

/**
 * The service's own words for a refusal, clipped, and withheld whole when they
 * carry an address. Withheld whole, never cleaned: the platform's intake rule.
 */
function vendorWords(message: unknown): string {
  if (typeof message !== "string" || message.trim() === "") return "the service reported an error";
  if (carriesAnAddress(message)) return "the service's message carried an email address, so it is not repeated here";
  return clip(message.trim());
}

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
 * One JSON-RPC request inside a session, read down to its first message.
 *
 * The layers are peeled one at a time and each failure is named, because
 * "the sync returned nothing" is the report that wastes an afternoon. What the
 * message MEANS is the caller's business.
 */
async function request(
  o: ClientOptions,
  sessionId: string,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; message: Record<string, unknown> } | CallFailure> {
  let res: Response;
  try {
    res = await o.fetchImpl(o.baseUrl, {
      method: "POST",
      headers: headers(o.token, sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  } catch (e) {
    return { ok: false, why: "refused", detail: clip(e instanceof Error ? e.message : String(e)) };
  }
  if (!res.ok) {
    return { ok: false, why: "refused", detail: `the service answered ${res.status}` };
  }

  const body = await res.text();
  const stream = readEventStream(body);
  if (stream.messages.length === 0) {
    const n = stream.unparsed.length;
    const chars = stream.unparsed.reduce((sum, p) => sum + p.length, 0);
    const detail =
      n > 0
        ? `the reply carried ${plural(n, "payload")} that ${n === 1 ? "was" : "were"} not JSON, ${plural(chars, "character")} in all`
        : "the reply carried no message";
    return { ok: false, why: "unreadable", detail };
  }

  const first = stream.messages[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return { ok: false, why: "unreadable", detail: `the first message was ${shape(first)}` };
  }
  const msg = first as Record<string, unknown>;
  if (msg.error) {
    const err = typeof msg.error === "object" ? (msg.error as Record<string, unknown>) : {};
    return { ok: false, why: "vendor-error", detail: vendorWords(err.message) };
  }
  return { ok: true, message: msg };
}

/** One tool call, read as far as it can honestly be read. */
export async function callTool(
  o: ClientOptions,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<CallResult> {
  const answer = await request(o, sessionId, 2, "tools/call", { name: tool, arguments: args });
  if (!answer.ok) return answer;
  const msg = answer.message;
  const payload = readRecords(msg.result);
  if (payload === null) {
    return { ok: false, why: "unreadable", detail: describeReply(msg) };
  }
  return { ok: true, ...payload };
}

/**
 * The tools the service offers, each with the input schema it declares.
 *
 * A reply this cannot read is `unreadable`, never an empty list, for the reason
 * the whole file gives: "the service offers nothing" and "we could not read
 * what it offers" would otherwise be the same answer.
 */
export async function listTools(o: ClientOptions, sessionId: string): Promise<ToolsResult> {
  const tools: ToolInfo[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const answer = await request(o, sessionId, 3, "tools/list", cursor ? { cursor } : {});
    if (!answer.ok) return answer;
    const page = readTools(answer.message.result);
    if (page === null) {
      return { ok: false, why: "unreadable", detail: describeReply(answer.message) };
    }
    tools.push(...page.tools);
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < MAX_TOOL_PAGES);
  return { ok: true, tools };
}

/** A `tools/list` result, or null when it is not one. A tool with no name is skipped. */
function readTools(result: unknown): { tools: ToolInfo[]; cursor: string | null } | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.tools)) return null;
  const tools: ToolInfo[] = [];
  for (const item of r.tools) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.name !== "string" || t.name.trim() === "") continue;
    tools.push({ name: t.name, inputSchema: t.inputSchema ?? null });
  }
  return { tools, cursor: asCursor(r.nextCursor ?? r.cursor) };
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
