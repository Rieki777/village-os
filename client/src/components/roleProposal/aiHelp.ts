/**
 * "LET AI HELP ME WITH THIS", the one adapter (role proposals PR C).
 *
 * Rye, 2026-10-22: each step offers AI help guided through the village's
 * outside governance bridge (the `saberra` module: SaberraConfigPanel,
 * server/routes/saberra.ts). It only SUGGESTS wording. The member accepts each
 * suggestion, and the AI never saves or submits anything. The button is
 * hidden until the bridge is configured for the village.
 *
 * WHY THIS ANSWERS "not configured" TODAY. The bridge has five routes (status,
 * outbox, sync, runs, facts) and none of them guides a member's wording: the
 * sync PULLS records into the review queue and nothing calls the service on a
 * member's behalf. The asks for that went to the Operations role on
 * 2026-10-22 (the endpoint and its auth, what may be read, suggest-only,
 * retention and code names, a test setup). Until a guide route exists there
 * is nothing a button could call, and a button that does not work is never
 * drawn. So every step asks here, and here answers "not configured".
 *
 * TODO(role proposals, AI help): once the server has a guide route behind the
 * saberra module, answer `configured: true` when that route says the bridge is
 * set up for this village, and implement `suggest` against it. The steps need
 * no change: they draw the button exactly when this says configured.
 */

export type AiHelpStep = "words" | "season";

/** What a step sends: the step, and the words the member has written there so far. */
export interface AiHelpAsk {
  step: AiHelpStep;
  /** The field the member asked about, by its name on the role or the season. */
  field?: string;
  words: Record<string, string>;
}

/** One suggestion the member may accept, field by field. Never saved by the AI. */
export interface AiSuggestion {
  field: string;
  words: string;
}

export type AiHelpStatus =
  | { configured: false; reason: "not configured" }
  | { configured: true; suggest: (ask: AiHelpAsk) => Promise<AiSuggestion[]> };

export const NOT_CONFIGURED: AiHelpStatus = { configured: false, reason: "not configured" };

/** Whether AI help can be offered on a step, and how to ask it. */
export async function aiHelpStatus(_step: AiHelpStep): Promise<AiHelpStatus> {
  return NOT_CONFIGURED;
}
