/**
 * A FIRST GUESS AT A QUEST'S EFFORT, READ OFF ITS CARD (quest re-price Q3).
 *
 * The pricing desk opens with hours already in each row so the Treasurer
 * corrects a number, never types one from nothing (Rye, 2026-11-09: "the
 * Treasurer corrects the hour estimates first"). The guess is only a draft: a
 * row priced from it says "Confirm the hours first" until the Treasurer has
 * looked, and nothing is set from an unconfirmed guess.
 *
 * Reads a range in hours ("3-6 hrs", "4-6 hours", "(2-3 hrs)"), a single
 * figure ("5 hours"), a full day (8, from 6 to 9) or a half day (4, from 3 to
 * 5). Anything else is no guess, and the row asks for hours.
 */
export interface EffortGuess {
  hours: number;
  low: number;
  high: number;
}

const half = (n: number) => Math.round(n * 2) / 2;

export function effortGuess(duration: string | null | undefined): EffortGuess | null {
  const text = String(duration ?? "").toLowerCase();
  if (!text.trim()) return null;
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low > 0 && high >= low) return { hours: half((low + high) / 2), low, high };
  }
  const single = text.match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/);
  if (single && Number(single[1]) > 0) {
    const h = Number(single[1]);
    return { hours: h, low: h, high: h };
  }
  if (/\bfull day\b/.test(text)) return { hours: 8, low: 6, high: 9 };
  if (/\bhalf day\b/.test(text)) return { hours: 4, low: 3, high: 5 };
  return null;
}
