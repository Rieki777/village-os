/**
 * THE HANDLE ON THE BREAK-GLASS (the glass round).
 *
 * 0098 gave fifteen powers a way for a village to take them, and gave the
 * operator an escape hatch for the day something has gone wrong. The hatch
 * worked and nothing in the product could reach it. A 409 came back saying
 * "send override with this request, or the x-capability-override header", and
 * every control in the browser answered that by showing the sentence in a red
 * toast, because no client file mentioned `requiresOverride` at all. So the
 * escape hatch existed for somebody holding a terminal, which is exactly the
 * shape of defect this whole round set out to close.
 *
 * ── WHY THIS WRAPS `window.fetch` AND NOT EVERY CALL SITE ─────────────────
 *
 * The 409 is a PROTOCOL, and this is the browser's half of it. There are more
 * than four hundred `fetch` calls in this client and no shared layer under
 * them; fifteen powers spread across the admin panel, the map, the forum, the
 * calendar, the library, the exchange and governance. Converting the call
 * sites would have reached whichever surfaces one lane had time for, and the
 * next power to cross would have arrived with no handle again. One wrapper
 * answers the refusal wherever it is met, including on surfaces nobody has
 * written yet.
 *
 * It also leaves the two static gates saying exactly what they said before.
 * `check-auth-fetch.mjs` reads call expressions whose callee is the bare
 * identifier `fetch`, and every one of them is untouched;
 * `check-admin-reach.mjs` reads argument zero of every call, and no argument
 * moves. Nothing here hides a door or a missing token from either.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 *
 * It never sends the hatch on its own. A refusal becomes a question, a person
 * answers it, and only then is one request replayed. It carries the hatch in
 * the HEADER and never in the body: the header works on every route, and one
 * route (`PUT /api/org/village/power`) validates the shape of what a village
 * says about itself, so an extra key in a JSON body is a thing it has to be
 * taught to ignore.
 *
 * ── THE ONE PLACE THIS TOUCHES A BODY, AND WHY ────────────────────────────
 *
 * The server's `error` is written for somebody holding a terminal. It names
 * the holder and then says to send the `x-capability-override` header, and
 * that sentence is the documented protocol: curl is still a real way in, the
 * 409 is still its answer, and `server/index.ts` keeps that string exactly as
 * it is.
 *
 * An operator who was ASKED and pressed "Leave it" is a different reader.
 * They declined a second ago, and every control in this client renders a
 * failed write by printing `error` in a toast, so the last thing they see is
 * a terminal instruction for the very thing they just turned down. A decline
 * is a fact the browser holds and the server never learns, so the browser is
 * the only side that can say it. `declinedRefusal` swaps that ONE string for
 * what actually happened and leaves the status, the flags and every other
 * field alone. A refusal nobody was asked about passes through untouched, and
 * so does one where the question itself failed to be put.
 */

/** The facts a 409 hands over, and the only ones a control may say. */
export interface BreakGlassAsk {
  capability: string;
  /**
   * The power's name from the registry.
   *
   * Falls back to the capability key, which is the same honest fallback
   * `capabilityLabel` makes on the server: a key with no title is a missing
   * row in the registry, and printing the key says so out loud instead of
   * inventing a name for a power.
   */
  title: string;
  /** The role that holds it, as the server named it. Null when it did not. */
  holder: string | null;
  /** What whoever holds it can do. Null when the server did not say. */
  consequence: string | null;
}

/**
 * Is this response the one refusal with a way through, FOR THIS PERSON?
 *
 * Pure, so it is testable without a browser, which is what every client test
 * in this repo is. Returns null for every other 409 in the product, and there
 * are several: an already-open ask, an escalation that needs confirming, a
 * ballot that closed while somebody was typing.
 *
 * `requiresOverride` says the village holds the power and only an override
 * would pass it. `overrideAvailable` says whether the server would accept one
 * from whoever is holding this screen (Rye, 2026-09-21: only a founder seated
 * as a steward with the veto). Both have to be true. A refusal with the first
 * and not the second passes through untouched, so the caller prints the
 * server's own sentence, which names the way through, and nobody is offered
 * a door that refuses them after they walk through it.
 */
export function readOverrideRefusal(status: number, body: unknown): BreakGlassAsk | null {
  if (status !== 409) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.requiresOverride !== true) return null;
  if (b.overrideAvailable !== true) return null;
  const capability = typeof b.capability === "string" ? b.capability : "";
  if (!capability) return null;
  const title = typeof b.title === "string" && b.title ? b.title : capability;
  return {
    capability,
    title,
    holder: typeof b.holder === "string" && b.holder ? b.holder : null,
    consequence: typeof b.consequence === "string" && b.consequence ? b.consequence : null,
  };
}

/**
 * WHAT THE OPERATOR READS BEFORE THEY DECIDE (R56).
 *
 * State what is true, then get out of the way. The record is a fact about
 * what happens next, never an argument for stopping: somebody with a good
 * reason should not feel told off, and somebody with a bad one should not be
 * able to say they did not know.
 *
 * Every sentence comes from what the server sent. A missing holder drops the
 * name and keeps the fact; a missing consequence drops the line entirely. The
 * one thing this file will not do is fill a gap with a guess.
 */
export interface BreakGlassCopy {
  heading: string;
  power: string;
  holder: string;
  record: string;
  confirm: string;
  dismiss: string;
}

export function breakGlassCopy(ask: BreakGlassAsk): BreakGlassCopy {
  return {
    heading: "This village holds this one",
    power: ask.consequence
      ? `${ask.title}. Whoever holds it can ${ask.consequence}.`
      : `${ask.title}.`,
    holder: ask.holder
      ? `${ask.holder} looks after it now, and you are not seated there.`
      : "The village looks after it now, and you are not seated where it lives.",
    // The tense is the one the server keeps. A reach that fails validation
    // writes nothing the village reads, so promising a line for pressing the
    // button would be a promise the record does not make.
    record:
      "If the act goes through, the village's own feed carries a line naming you and this power, " +
      "and whoever holds it is told.",
    confirm: "Act anyway",
    dismiss: "Leave it",
  };
}

/**
 * WHAT A CONTROL PRINTS AFTER A DECLINE.
 *
 * Short, past tense, and carrying no instruction. The operator made a choice
 * a second ago and this confirms it, so there is nothing here to do next. The
 * holder is named when the server named one and dropped when it did not,
 * which is the rule every other sentence in this file follows.
 *
 * "The act did not go through" is the tense `breakGlassCopy` already set, and
 * it is true of every route that reaches this point: the 409 is written by
 * `guardCapability` before the handler runs, so the refusal is the whole
 * story and nothing was half done.
 */
export function declinedMessage(ask: BreakGlassAsk): string {
  return ask.holder
    ? `Left it with ${ask.holder}. The act did not go through.`
    : "Left it with the village. The act did not go through.";
}

/**
 * The refusal as the person who declined it should read it.
 *
 * Everything the server sent survives except `error`: the status, the flags,
 * the capability and the three facts the dialog was built from. A caller that
 * keys on `res.status`, or reads `requiresOverride`, or falls back to its own
 * sentence when the body has none, behaves exactly as it did before.
 *
 * Two headers come off, both for the same reason: they described a body that
 * no longer exists. `content-length` is the obvious one. `content-encoding`
 * is the one worth writing down, because `server/index.ts` mounts
 * `compression`, so a 409 large enough to be worth gzipping arrives carrying
 * it. A constructed Response never decodes its own body, so leaving it would
 * not break a caller today; it would sit there as a header saying "gzip" over
 * plain JSON, waiting for the first person who believes it.
 *
 * Pure and separate from the wrapper so it is testable without a browser,
 * which is what every client test in this repo is.
 */
export function declinedRefusal(res: Response, body: unknown, ask: BreakGlassAsk): Response {
  const fields =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ ...fields, error: declinedMessage(ask) }), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** Answered by whoever is holding the screen. True means replay it. */
export type BreakGlassAsker = (ask: BreakGlassAsk) => Promise<boolean>;

/** The header the server reads. One spelling, in one place. */
export const OVERRIDE_HEADER = "x-capability-override";

/** Marks the one replay so the wrapper never answers its own request. */
const REPLAY = "__breakGlassReplay";

/**
 * Build the replay's options: everything the caller sent, plus the hatch.
 *
 * A `Request` carries its own headers and `init` may carry none, so the
 * merge starts from whichever the browser would have used and never from an
 * empty list. Dropping a caller's `Authorization` here would turn a 409 into
 * a 401 and read as the hatch being broken.
 */
function replayOptions(input: RequestInfo | URL, init: RequestInit | undefined): RequestInit {
  const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(source as HeadersInit | undefined);
  headers.set(OVERRIDE_HEADER, "true");
  return { ...(init ?? {}), headers, [REPLAY]: true } as RequestInit;
}

/**
 * A body that has already been read cannot be sent twice.
 *
 * A string, a `FormData`, a `Blob` and a `URLSearchParams` all survive a
 * replay. A stream does not, and offering a handle that throws instead of
 * acting would be worse than offering none, so the refusal is left to speak
 * for itself. Nothing in this client sends a stream today; the check is here
 * so the day one does, it fails visibly in one place.
 */
function replayable(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  const body = init?.body;
  if (body && typeof (body as ReadableStream).getReader === "function") return false;
  if (input instanceof Request && input.bodyUsed) return false;
  return true;
}

/**
 * Wrap `window.fetch` so a village-held refusal becomes a question.
 *
 * Returns the uninstall, and the uninstall only restores what it replaced, so
 * a hot reload that installs twice cannot leave a stack of wrappers behind.
 */
export function installBreakGlass(asker: BreakGlassAsker): () => void {
  const original = window.fetch.bind(window);
  const patched = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init && (init as Record<string, unknown>)[REPLAY]) return original(input, init);
    // A `Request` gives its body away to the first call, so the copy has to
    // be taken before that call and not after it.
    const spare = input instanceof Request && replayable(input, init) ? input.clone() : input;
    const res = await original(input, init);
    if (res.status !== 409) return res;
    let body: unknown;
    try {
      body = await res.clone().json();
    } catch {
      return res;
    }
    const ask = readOverrideRefusal(res.status, body);
    if (!ask) return res;
    if (!replayable(input, init)) return res;
    // Whether the question was ANSWERED, which is a different fact from
    // whether it was answered yes. An asker that throws leaves nobody holding
    // a decision, and a refusal nobody decided about is still the server's to
    // explain, so only a real decline gets the client's sentence.
    let answered = false;
    let go = false;
    try {
      go = await asker(ask);
      answered = true;
    } catch {
      go = false;
    }
    if (!go) return answered ? declinedRefusal(res, body, ask) : res;
    try {
      return await original(spare, replayOptions(input, init));
    } catch {
      // The replay failed to leave the browser at all. The refusal is still
      // the truest thing anybody has, so the caller gets it and its own error
      // handling runs the way it would have.
      return res;
    }
  };
  window.fetch = patched as typeof window.fetch;
  return () => {
    if (window.fetch === (patched as typeof window.fetch)) window.fetch = original;
  };
}
