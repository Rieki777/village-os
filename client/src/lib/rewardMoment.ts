/**
 * The words of a reward moment (0294), kept apart from the drawing so a test
 * can read them without a DOM.
 *
 * Every line names what came in and what it was for, in the shapes Rye gave
 * on 2026-10-30: "40 Amora tokens and 5 Voice for Seed bank shelves", and
 * "Your cash for Rebuild the water tank was paid". The amount of cash is shown
 * beside the sentence, never inside it, so the sentence reads the same in
 * every currency.
 */
import type { RewardLine, RewardMomentView } from "@shared/rewardMoment";
import { formatTokenAmount } from "@/lib/tokenAmount";

/** "a", "a and b", "a, b and c". */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** One line of the moment as a sentence, without its full stop. */
export function rewardSentence(line: RewardLine): string {
  if (line.kind === "cash_paid") return `Your cash for ${line.work} was paid`;
  const amounts = line.tokens.map((t) => `${formatTokenAmount(t.units, t.decimals)} ${t.name}`);
  return `${joinAnd(amounts)} for ${line.work}`;
}

/** The headline: the one thing that landed, or how many did. */
export function rewardHeadline(view: RewardMomentView): string {
  if (view.lines.length === 1) return `${rewardSentence(view.lines[0])}.`;
  return `${view.lines.length} things landed for you.`;
}

/** What a screen reader hears, the same news the drawing carries. */
export function rewardAnnouncement(view: RewardMomentView): string {
  return view.lines.map((l) => `${rewardSentence(l)}.`).join(" ");
}
