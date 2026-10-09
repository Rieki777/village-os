/**
 * "DRAFT IT FOR ME", POLISHED (the comms build spec 5.14). The recap composer's
 * draft is built from facts first (`draftForMe` in ./recaps.ts: the gathering,
 * the date, how many came, the host's notes). When the platform assistant is
 * configured and the host wrote notes, this asks it to turn those notes into a
 * few warm paragraphs that keep every fact and add none.
 *
 * IT NEVER SENDS (Rye's ruling of 2026-09-24). The answer goes back into the
 * host's own text box, and a person reads it and presses Send. Nothing here
 * stores the draft.
 *
 * THE EXISTING CALL PATH, REUSED. `callAssistant` (server/lib/assistant.ts)
 * holds the key order (a village's own key, then the platform's), the burst
 * guard, the per-mode day budget and the borrowed-key cap, so this adds none
 * of its own. The facts arrive prefetched, which turns the assistant's tools
 * off. The reply is read with `readReplyFields`, so a cut-off or unreadable
 * answer is no draft at all and the host gets the plain draft instead. Usage
 * is written to `assistant_usage` the way the journal's shaping writes it.
 *
 * WHAT IT CANNOT KNOW. The automation module's call syntheses carry no link to
 * a gathering (no event column on `call_syntheses`), so there is no synthesis
 * to fold in; the facts are the evening, the counts and the host's notes.
 */
import type { Pool } from "mysql2/promise";
import { voiceLint } from "../../../shared/comms/voiceLint";
import { assistantKeyOwner, callAssistant, DEFAULT_ASSISTANT_MODEL, readReplyFields, type AssistantRequest, type AssistantResult } from "../assistant";
import { recordAssistantUsage } from "../assistantUsage";
import { instanceIdentity } from "../identity";

/** The assistant's mode for this job: an organiser's tool, with its own day budget. */
export const RECAP_POLISH_MODE = "organize" as const;
/** The longest polished recap kept. Past it the plain draft is served. */
export const RECAP_POLISH_MAX = 4000;

export interface PolishDeps {
  getPool(): Pool;
  /** The call path. Absent: `callAssistant`. Tests pass their own. */
  call?(req: AssistantRequest): Promise<AssistantResult>;
  /** Whether any assistant key is set. Absent: `assistantKeyOwner`. */
  ready?(): boolean;
}

export interface PolishInput {
  /** The draft built from facts, whose opening line carries the title, date and count. */
  draft: string;
  /** What the host wrote. */
  notes: string;
  userId: string;
  clientIp: string;
}

const SYSTEM = [
  "You help the host of a village gathering write a short recap email to the people who came.",
  "You are given a plain draft built from facts and the host's own notes.",
  "Rewrite the notes into two to four short, warm paragraphs in plain words, written as the host.",
  "Keep the draft's opening line as it is, and keep every fact in the notes. Add no fact, name, number, date or promise that is not there.",
  "No headings, no lists unless the notes have one, no emoji, no dashes between clauses, under 250 words.",
  'Reply with JSON only: {"recap": "<the whole recap>"}.',
].join(" ");

/** True when an assistant key is set: the village's own, or the platform's. */
export const assistantReady = (): boolean => assistantKeyOwner() !== "none";

/** Em and en dashes become commas, which is what the house voice asks for. */
const undash = (s: string): string => s.replace(/\s*[–—]\s*/g, ", ");

async function noteUsage(pool: Pool, call: AssistantResult, userId: string): Promise<void> {
  const paid = call.ok
    ? { keySource: call.keySource, usage: call.usage, iterations: call.iterations, stopReason: call.stopReason }
    : call.spent;
  if (!paid) return;
  try {
    await recordAssistantUsage(pool, {
      villageId: instanceIdentity().instanceId,
      mode: RECAP_POLISH_MODE,
      model: DEFAULT_ASSISTANT_MODEL,
      keySource: paid.keySource,
      userId,
      usage: paid.usage,
      iterations: paid.iterations,
      stopReason: paid.stopReason,
      path: "prefetch",
    });
  } catch (e) {
    console.error("[comms] the recap polish's assistant usage was not recorded", e);
  }
}

/**
 * The host's draft with their notes polished, or null when there is nothing to
 * polish, no assistant, or no answer worth serving. Null always means "serve
 * the plain draft"; it is never an error the host sees.
 */
export async function polishRecap(deps: PolishDeps, input: PolishInput): Promise<string | null> {
  const notes = input.notes.trim();
  if (!notes) return null;
  if (!(deps.ready ?? assistantReady)()) return null;
  const call = await (deps.call ?? callAssistant)({
    mode: RECAP_POLISH_MODE,
    system: SYSTEM,
    messages: [{ role: "user", content: "Polish my recap." }],
    model: DEFAULT_ASSISTANT_MODEL,
    clientIp: input.clientIp,
    burstKey: `assist-recap:${input.userId}`,
    userId: input.userId,
    prefetch: [{ key: "recap.draft", data: { draft: input.draft, notes } }],
  });
  await noteUsage(deps.getPool(), call, input.userId);
  if (!call.ok) return null;
  const read = readReplyFields(call.text, ["recap"] as const, { stopReason: call.stopReason, proseField: "recap" });
  const recap = undash(String(read?.recap ?? "").trim());
  if (!recap || recap.length > RECAP_POLISH_MAX) return null;
  // A draft that still trips the house voice check is served plain instead:
  // the host should start from words the village would send.
  if (voiceLint(recap, "body").length > 0) return null;
  return recap;
}
