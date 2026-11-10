/**
 * SERA AS A GUIDE, ONE ROAD FOR EVERY SURFACE (Rye, 2026-11-09: "Ensuring
 * she's on at every point where we have a conversational agent to help the
 * player/user").
 *
 * The org memory service gives this village one call that answers as its
 * agent: `ask_sera`, a question in, prose out. The moon recap's draft and the
 * Admin helper used it first; this file is the shared half, so a guide route
 * only has to say "this member chose Sera" and the assistant engine
 * (`callAssistant` with `sera`, server/lib/assistant.ts) does the rest: the
 * same burst guard and day budget, the route's own instructions and prefetched
 * data in the question, and the answer back as text the route already parses.
 *
 * WHAT THE ROAD CANNOT DO: take our tools. So a route's readers run BEFORE the
 * call (its `prefetch`), and a mode that loops over tools answers from what was
 * read for it. Nothing about a member crosses unless the route put it in its own
 * prompt or prefetch; the routes decide that, and say so where they do.
 *
 * WHO ANSWERS (`saberraGuideReach`, server/lib/saberraGuide.ts) now has no
 * fourth gap: with the module open to members, its key usable and its https
 * address saved, Sera can answer.
 */
import { effectiveLifecycle } from "./modules";
import { preflight } from "./saberraSync";
import { callToolJson, listTools, openSession, type ClientOptions } from "./saberraClient";
import { ASK_TOOL, answerText, questionArgs } from "./moonRecapSera";
import type { SeraAsk } from "./seraGuideQuestion";
export { seraGuideQuestion, SERA_QUESTION_MAX, type SeraAsk } from "./seraGuideQuestion";


/** How long one guide answer may take. */
export const SERA_GUIDE_TIMEOUT_MS = 60_000;

/** An ask function when the village's Sera connection can answer, or null. */
export function seraGuideAsk(): SeraAsk | null {
  if (effectiveLifecycle("saberra") === "off") return null;
  const pre = preflight();
  if (!pre.ok) return null;
  return makeSeraAsk(pre.client);
}

/** The call itself: open a session, find `ask_sera`, ask once, with no person attached. */
export function makeSeraAsk(client: ClientOptions, timeoutMs = SERA_GUIDE_TIMEOUT_MS): SeraAsk {
  return async (question) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const c: ClientOptions = {
      ...client,
      timeoutMs,
      signal: deadline,
      fetchImpl: (url, init) => client.fetchImpl(url, { ...init, signal: init.signal ?? deadline }),
    };
    try {
      const session = await openSession(c);
      if (!session) return { ok: false };
      const tools = await listTools(c, session);
      if (!tools.ok) return { ok: false };
      const ask = tools.tools.find((t) => t.name === ASK_TOOL);
      if (!ask) return { ok: false };
      const args = questionArgs(ask, question, "");
      for (const k of Object.keys(args)) if (args[k] === "") delete args[k];
      const answer = await callToolJson(c, session, ASK_TOOL, args);
      if (!answer.ok) return { ok: false };
      const text = seraReplyText(answer.value).trim();
      return text ? { ok: true, text } : { ok: false };
    } catch {
      return { ok: false };
    }
  };
}

/**
 * The answer as text the route can parse. Every guide asks for a JSON object,
 * and the client parses a JSON answer into an object before it reaches us
 * (`callToolJson`), so an answer shaped exactly as asked carries none of the
 * text fields `answerText` looks for and would read as empty. A plain object
 * goes back as JSON; anything else is read as words.
 */
export function seraReplyText(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const words = answerText(value);
    if (words) return words;
    return JSON.stringify(value);
  }
  return answerText(value);
}
