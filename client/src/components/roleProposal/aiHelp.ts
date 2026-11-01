/**
 * "LET AI HELP ME WITH THIS", the one adapter (role proposals PR C, wired by
 * the role guide).
 *
 * Rye, 2026-10-22, then 2026-10-24: each step offers help from a guide, which
 * only SUGGESTS. The member accepts each suggestion, and the guide never saves
 * or submits anything. The guide is the member's choice, the village's own or
 * the outside governance service's agent (shared/guideChoice.ts), and the
 * button is drawn only when one of them can answer. A button that does not
 * work is never drawn.
 *
 * TWO DOORS IN:
 *
 *   aiHelpStatus(step)   whether a guide can answer, and under what name. The
 *                        steps' panel (AiHelpButton) and the "Bring in a
 *                        description of your role" upload both ask it.
 *   bringIn(text)        on a configured status: hand the panel on that step
 *                        the text extracted from the member's document. It is
 *                        held in the page for one turn and never stored. The
 *                        upload draws its own copy and paste fallback when the
 *                        status is not configured.
 */
import { fetchGuide } from "@/lib/guideApi";
import { guideNameAtSentenceStart } from "@shared/guideName";

export type AiHelpStep = "words" | "season";

export type AiHelpStatus =
  | { configured: false; reason: "not configured" }
  | {
      configured: true;
      /** The name of the guide answering now, as it opens a sentence ("The village guide will read it"). */
      guide: string;
      /** Hand the step's panel the text of the member's document. Never stored. */
      bringIn: (text: string) => void;
    };

export const NOT_CONFIGURED: AiHelpStatus = { configured: false, reason: "not configured" };

type Listener = (text: string) => void;
const listeners: Record<AiHelpStep, Set<Listener>> = { words: new Set(), season: new Set() };

/** The step's panel listens here for a document brought in. Returns the unsubscribe. */
export function onBroughtIn(step: AiHelpStep, listener: Listener): () => void {
  listeners[step].add(listener);
  return () => {
    listeners[step].delete(listener);
  };
}

/** Whether AI help can be offered on a step, and how to hand it a document. */
export async function aiHelpStatus(step: AiHelpStep): Promise<AiHelpStatus> {
  const g = await fetchGuide();
  const answering = g?.options?.find((o) => o.id === g.answering);
  if (!answering) return NOT_CONFIGURED;
  return {
    configured: true,
    guide: guideNameAtSentenceStart(answering.name),
    bringIn: (text: string) => {
      for (const l of Array.from(listeners[step])) l(text);
    },
  };
}
