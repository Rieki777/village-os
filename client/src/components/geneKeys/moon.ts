/**
 * A CONTEMPLATION EACH MOON (Rye, 2026-10-23: "REALLY GOOD!").
 *
 * Gene Keys are practised through contemplation, so once a moon (new moon to
 * new moon, the village's own lunar clock in shared/lunar.ts) a member is
 * offered one prompt on the key of their Life's Work. They write where it
 * showed up, and say where they met it from: its Shadow, its Gift, or beyond
 * both, its Siddhi. Over a season those marks make a ladder.
 *
 * IT IS A JOURNAL ENTRY, nothing new on the server: practice `free`, two
 * answers under keys this file owns, kept PRIVATE because a member's shadow is
 * theirs. So it lives, exports and is erased with the rest of their Journal.
 *
 * NO GENE KEYS TEXT IS REPRODUCED HERE. The key's own shadow, gift and siddhi
 * words are Richard Rudd's; the card names the key and sends the member to
 * genekeys.com, until a content pack is agreed with him.
 */
import { cycleBoundsByNumber, cycleBoundsFor } from "@shared/lunar";
import type { JournalAnswer, JournalEntry, JournalEntryInput } from "@shared/journal";
import type { GeneKeysView } from "@shared/geneKeys";

export const FREQUENCIES = [
  { id: "shadow", label: "Shadow", hint: "where it caught me" },
  { id: "gift", label: "Gift", hint: "where it flowed" },
  { id: "siddhi", label: "Siddhi", hint: "beyond both, for a moment" },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]["id"];

/** The answer key that marks an entry as this moon's contemplation, with the moon's cycle number. */
export const MOON_KEY_PREFIX = "gene-keys:moon:";
export const FREQUENCY_KEY = "gene-keys:frequency";
/** A season of moons: the ladder shows at most this many. */
export const LADDER_MOONS = 13;

export function moonNow(now: Date = new Date()): number {
  return cycleBoundsFor(now).cycleNumber;
}

/** "21 Oct", the new moon a cycle began on, in the reader's own calendar. */
export function moonLabel(cycle: number): string {
  return cycleBoundsByNumber(cycle).startsAt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function promptFor(view: GeneKeysView): string {
  const lw = view.spheres.find((s) => s.sphere === "lifesWork");
  return `This moon, sit with Gene Key ${lw?.gate ?? ""}, the key of your Life's Work. Where did it show up in you?`;
}

export const FREQUENCY_PROMPT = "Where did you meet it from?";

/** The Journal entry one contemplation saves. */
export function contemplationEntry(
  view: GeneKeysView,
  input: { clientId: string; cycle: number; text: string; frequency: Frequency; now?: Date },
): JournalEntryInput {
  const now = input.now ?? new Date();
  const f = FREQUENCIES.find((x) => x.id === input.frequency)!;
  const answers: JournalAnswer[] = [
    { questionKey: `${MOON_KEY_PREFIX}${input.cycle}`, prompt: promptFor(view), text: input.text.trim() },
    { questionKey: FREQUENCY_KEY, prompt: FREQUENCY_PROMPT, text: f.label },
  ];
  return {
    clientId: input.clientId,
    practice: "free",
    depth: "light",
    answers,
    writtenAt: now.toISOString(),
    localHour: now.getHours(),
    privacy: "private",
  };
}

export interface Rung {
  cycle: number;
  frequency: Frequency;
}

/**
 * The ladder out of a member's free entries: the latest contemplation per moon,
 * the most recent LADDER_MOONS moons, oldest first.
 */
export function ladderFrom(entries: readonly JournalEntry[]): Rung[] {
  const byMoon = new Map<number, { at: string; frequency: Frequency }>();
  for (const e of entries) {
    const moon = e.answers.find((a) => a.questionKey.startsWith(MOON_KEY_PREFIX));
    const freq = e.answers.find((a) => a.questionKey === FREQUENCY_KEY);
    if (!moon || !freq) continue;
    const cycle = Number(moon.questionKey.slice(MOON_KEY_PREFIX.length));
    const f = FREQUENCIES.find((x) => x.label === freq.text);
    if (!Number.isInteger(cycle) || !f) continue;
    const had = byMoon.get(cycle);
    if (!had || had.at < e.writtenAt) byMoon.set(cycle, { at: e.writtenAt, frequency: f.id });
  }
  return Array.from(byMoon.entries())
    .map(([cycle, v]) => ({ cycle, frequency: v.frequency }))
    .sort((a, b) => a.cycle - b.cycle)
    .slice(-LADDER_MOONS);
}
