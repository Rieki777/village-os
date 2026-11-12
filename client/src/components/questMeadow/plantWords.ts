/**
 * What each plant says, in the reader's language. One place, so the meadow,
 * the card and the quest's own page never drift apart in what a bud means.
 * Every word here describes the work; none names or counts a person.
 */
import { useLingui } from "@lingui/react/macro";
import type { PlantState } from "@/lib/questMeadow";

export interface PlantWords {
  /** One or two words, for a legend or a chip. */
  short: string;
  /** The sentence a card or a screen reader gets. */
  long: string;
}

export function usePlantWords(): Record<PlantState, PlantWords> {
  const { t } = useLingui();
  return {
    seed: {
      short: t({ message: "Seed", context: "quest meadow: an open quest nobody carries yet" }),
      long: t({ message: "Seed: nobody carries it yet", context: "quest meadow: an open quest" }),
    },
    bud: {
      short: t({ message: "In bud", context: "quest meadow: a quest somebody carries now" }),
      long: t({ message: "In bud: someone carries it now", context: "quest meadow: a carried quest" }),
    },
    flower: {
      short: t({ message: "Flowered", context: "quest meadow: a quest done this moon" }),
      long: t({ message: "Flowered this moon", context: "quest meadow: a quest done this moon" }),
    },
  };
}
