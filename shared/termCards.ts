/**
 * The words on a terms preset card.
 *
 * Plain label first, then the official word, then one line of what it means
 * and one example. Money is a proposal. The card never tells a member to
 * take pay, an allowance, or a bonus.
 */
import { GROUP_PLAIN, opsPartner } from "./roleProposalHonesty";
import { GROUP_LABELS, MONEY_GROUPS, type SettingsGroup } from "./seatSettings";
import { presetById, type SeatPreset, type WholeSeatPreset } from "./seatPresets";

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

/** One concrete example per platform preset, so every card reads the same way. */
const PRESET_EXAMPLES: Record<string, string> = {
  "platform:until-season-end": "Start on 1 January and hold the role until the season closes, then talk about the next one.",
  "platform:three-moons": "Seated at a new moon, you review the role together three moons later.",
  "platform:one-moon-trial": "Try the role for one moon. Either side can stop with short notice.",
  "platform:pay-month-work-moon": "Money comes each calendar month. Tasks are planned each moon.",
  "platform:all-moon": "Money and tasks both follow the moon.",
  "platform:weekly-sync-plus-core-call": "Monday 9:30 sync, Wednesday 16:00 core call.",
  "platform:fortnightly": "One gathering every other Tuesday.",
  "platform:async-first": "You post updates in writing and pick work up when it suits.",
  "platform:unpaid": "Nothing is paid or owed for the role.",
  "platform:honorary": "The village names the honour. Nothing is paid or owed.",
};

/** "Example: ..." for any preset: its own example, then its headline, then its label. */
export function presetExample(preset: Pick<SeatPreset, "id" | "label">, headline?: string | null): string {
  const own = PRESET_EXAMPLES[preset.id];
  const h = String(headline ?? "").trim();
  return `Example: ${own ?? (h && h.toLowerCase() !== preset.label.trim().toLowerCase() ? h : preset.label)}`;
}

export const SUGGESTED_TAG = "Suggested";
/** The tag on a card: Suggested where the platform has a clear opinion, never for money. */
export function presetTag(group: SettingsGroup, partner: string | null | undefined): string {
  return groupRecordsMoney(group) ? fillTogetherTag(partner) : SUGGESTED_TAG;
}
export function fillTogetherTag(partner: string | null | undefined): string {
  return `Fill together with ${opsPartner(partner)}`;
}

/** The official term, one example, and whether the preset records money. */
export function wholeCardCopy(whole: WholeSeatPreset): { official: string; example: string; rhythm: string } {
  const term = presetById(whole.picks.term);
  const rhythm = presetById(whole.picks.rhythm);
  const rhythmLine = `${GROUP_PLAIN.rhythm} (${GROUP_LABELS.rhythm.toLowerCase()}): ${rhythm?.label ?? ""}`.trim();
  const example = term ? presetExample(term) : `Example: ${whole.label}`;
  return { official: term?.label ?? "", example, rhythm: rhythmLine };
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

const NO_MONEY = new Set(["platform:unpaid", "platform:honorary", "platform:no-allowance", "platform:no-bonus"]);
/** A whole role is Suggested only when it records no money; otherwise its money is filled together. PURE. */
export function wholeCardTag(whole: WholeSeatPreset, partner: string | null | undefined): string {
  const money = [whole.picks.pay, whole.picks.allowance, whole.picks.bonus].some((id) => id && !NO_MONEY.has(id));
  return money ? fillTogetherTag(partner) : SUGGESTED_TAG;
}
