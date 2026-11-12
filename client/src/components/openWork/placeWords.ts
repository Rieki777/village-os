/** Where a quest happens, in the reader's language (shared/questThreads.ts). */
import { useLingui } from "@lingui/react/macro";
import type { QuestPlace } from "@shared/questThreads";

export function usePlaceWords(): Record<QuestPlace, string> {
  const { t } = useLingui();
  return {
    land: t({ message: "On the land", context: "open work: where a quest happens" }),
    remote: t({ message: "Remote", context: "open work: where a quest happens" }),
    both: t({ message: "On the land or remote", context: "open work: where a quest happens" }),
  };
}
