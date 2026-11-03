/**
 * The words on a terms preset card.
 *
 * Plain label first, then the official word, then one line of what it means
 * and one example. Money is a proposal. The card never tells a member to
 * take pay, an allowance, or a bonus.
 */
import { GROUP_PLAIN, opsPartner } from "./roleProposalHonesty";
import { GROUP_LABELS, MONEY_GROUPS, type SettingsGroup } from "./seatSettings";
import { presetById, type WholeSeatPreset } from "./seatPresets";

export const MONEY_PROMISE = "A proposal, not a promise.";
export const NOT_SURE_YET = "Not sure yet";

export const GLOSSARY_TITLE = "What does this mean?";

export const GLOSSARY: readonly { key: string; word: string; plain: string }[] = [
  { key: "clocks", word: "Clocks", plain: "When the role counts its time. A moon is the village's own month. A calendar month runs from January to December." },
  { key: "rhythm", word: "Rhythm", plain: "How often you meet. For example, once a week, or mostly in writing." },
  { key: "allowance", word: "Allowance", plain: "Money for costs, if the role has any. A proposal, not a promise." },
  { key: "scoreboard", word: "Scoreboard", plain: "How you and the village see the role going. It measures the work." },
  { key: "domain", word: "Domain", plain: "The part of the village this role looks after." },
];

/** True when copy tells a member to take pay, an allowance, or a bonus. */
export function recommendsPay(text: string): boolean {
  return /\b(suggest|recommend|you should take|we will pay you)\b/i.test(text) && /\b(pay|stipend|allowance|bonus|salary|wage)\b/i.test(text);
}

/** The official term, one example, and whether the preset records money. */
export function wholeCardCopy(whole: WholeSeatPreset): { official: string; example: string } {
  const term = presetById(whole.picks.term);
  const rhythm = presetById(whole.picks.rhythm);
  const example = `${GROUP_PLAIN.rhythm} (${GROUP_LABELS.rhythm.toLowerCase()}): ${rhythm?.label ?? ""}`.trim();
  return { official: term?.label ?? "", example };
}

export function unsureLine(partner: string | null | undefined): string {
  return `Leave these open. We'll fill them together with ${opsPartner(partner)}.`;
}

/** Plain phrase, then the official word in parentheses. */
export function plainTerm(group: SettingsGroup): string {
  return `${GROUP_PLAIN[group]} (${GROUP_LABELS[group].toLowerCase()})`;
}

export function groupRecordsMoney(group: SettingsGroup): boolean {
  return MONEY_GROUPS.includes(group);
}
