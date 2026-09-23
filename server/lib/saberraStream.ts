/**
 * Reading what the outside service actually sends back.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 *
 * Their connector speaks MCP over HTTP and answers in SERVER-SENT EVENT
 * framing, so a reply is not a JSON body and `JSON.parse` on it throws. Their
 * founder believed we were reaching an older endpoint and asked us to point at
 * a plain-JSON one. Measured on 2026-09-23: a request offering only
 * `Accept: application/json` is answered
 *
 *   HTTP/1.1 406 Not Acceptable
 *   {"error":{"code":-32000,"message":"Not Acceptable: Client must accept both
 *    application/json and text/event-stream"}}
 *
 * so the framing is their server's requirement and there is no second endpoint
 * to reach for. Until they change that, every reply arrives framed and
 * something has to read it. This is that something.
 *
 * ── THE PART THAT WOULD HAVE BITTEN US ───────────────────────────────────
 *
 * Their stream carries `: keepalive` lines while a question is being answered,
 * and a slow question carries several. A line beginning with a colon is an SSE
 * COMMENT and carries no data. The naive reader splits on newlines and parses
 * anything after the first colon, which turns a keepalive into a parse failure
 * or, worse, into an empty message that reads as an empty answer. Both cases
 * are in the tests below, taken from real captured replies.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It does not interpret JSON-RPC, match ids to requests, or know what a tool
 * is. It turns a framed body into the messages it contains and reports what it
 * could not read. Anything that understands the CONTENT belongs behind the
 * boundary in `saberraRecords.ts`, and keeping this layer ignorant is what
 * stops a second reader of vendor data growing here.
 *
 * Pure: no pool, no clock, no network. The caller hands in the body it read.
 */

export interface StreamReading {
  /** Every `data:` payload that parsed, in arrival order. */
  messages: unknown[];
  /**
   * Payloads that did not parse as JSON, kept verbatim. Never silently
   * dropped: a vendor sending something unreadable is a thing to see, and an
   * empty `messages` with an empty `unparsed` means a genuinely empty stream.
   */
  unparsed: string[];
  /** Comment lines, which is mostly their keepalives. Counted, never parsed. */
  comments: number;
}

/**
 * One framed body, read into the messages it carries.
 *
 * Follows the event-stream rules that matter here: a line starting with `:` is
 * a comment, `data:` lines accumulate until a blank line dispatches the event,
 * multiple `data:` lines join with a newline, and one optional space after the
 * field colon is stripped. Other fields (`event:`, `id:`, `retry:`) are read
 * and ignored, because nothing here varies on them.
 */
export function readEventStream(body: string): StreamReading {
  const out: StreamReading = { messages: [], unparsed: [], comments: 0 };
  if (typeof body !== "string" || body === "") return out;

  let data: string[] = [];

  const dispatch = (): void => {
    if (data.length === 0) return;
    const payload = data.join("\n");
    data = [];
    // A dispatch carrying only blank data lines is not a message.
    if (payload.trim() === "") return;
    try {
      out.messages.push(JSON.parse(payload));
    } catch {
      out.unparsed.push(payload);
    }
  };

  // Split on either ending: the wire uses CRLF and a captured body often does
  // not, and a lone \r is legal in this format too.
  for (const raw of body.split(/\r\n|\r|\n/)) {
    if (raw === "") {
      dispatch();
      continue;
    }
    if (raw.startsWith(":")) {
      out.comments += 1;
      continue;
    }
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    // One leading space after the colon belongs to the framing, not the value.
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    // `event`, `id`, `retry` and anything unknown are read and ignored.
  }
  // A body that ends without a trailing blank line still carries its last event.
  dispatch();
  return out;
}
