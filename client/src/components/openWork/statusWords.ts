/**
 * What each status mark says, in the reader's language. One place, so the
 * board, a card and a quest's own page never drift apart in what a sprout
 * means. Every word here describes the work; none names or counts a person.
 */
import { useLingui } from "@lingui/react/macro";
import type { QuestStatus } from "@/lib/questStatus";

export function useStatusWords(): Record<QuestStatus, string> {
  const { t } = useLingui();
  return {
    seed: t({ message: "Open: nobody carries it yet", context: "open work board: status mark, an open quest" }),
    sprout: t({ message: "Underway: someone carries it", context: "open work board: status mark, a carried quest" }),
    flower: t({ message: "Done this moon", context: "open work board: status mark, a quest done this moon" }),
  };
}
