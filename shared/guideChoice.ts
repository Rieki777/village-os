/**
 * WHO A MEMBER TALKS TO: the village's own guide, or the outside governance
 * service's agent.
 *
 * Rye, 2026-10-24: "we should have users be able to choose Maia or Sera for
 * who they're talking to. This way we can compare their answers and users are
 * always in control of who's getting their data." Maia is the name this
 * village gave its own guide; Sera is the agent of the `saberra` module. So the
 * platform knows two guides by what they are, never by those names:
 *
 *   village   the village's own assistant, under the name the village gave it
 *   saberra   the agent the outside governance service speaks through
 *
 * THE CHOICE IS THE MEMBER'S, AND IT IS KEPT. One choice per member, stored in
 * their preferences and read on every guide surface. A member who never chose
 * is answered by the outside agent when it is reachable, because the founder
 * ruled that it replaces the village guide on organisational questions, and by
 * the village guide otherwise.
 *
 * THE PAGE ALWAYS SAYS WHO IS ANSWERING. A choice that cannot be honoured
 * right now falls back to the other guide and says so in one sentence, so a
 * member is never answered by one guide while believing it was the other.
 * When neither is reachable nothing answers, and a page draws no button.
 *
 * THE VILLAGE GUIDE'S NAME comes from shared/guideName.ts: the name the
 * village typed, or "the village guide" while it has none. Mid-sentence it
 * stays as it is; wherever it opens a sentence it is raised to a capital.
 *
 * Pure: no clock, no pool.
 */
import { guideNameAtSentenceStart as atStart } from "./guideName";

export const GUIDE_IDS = ["village", "saberra"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

/** One guide as a page shows it. */
export interface GuideOption {
  id: GuideId;
  /** The name the guide answers under: the village's name for its own, the vendor's for its agent. */
  name: string;
  /** False while the village has not named its own guide, so a page does not repeat "the village guide". */
  named: boolean;
  /** Whether it can answer right now. */
  available: boolean;
}

/** Everything a guide surface needs, in one answer. */
export interface GuideState {
  /** What the member chose, or null when they never chose. */
  choice: GuideId | null;
  options: GuideOption[];
  /** Who answers now, or null when nobody can. */
  answering: GuideId | null;
  /** A sentence when the answer comes from a guide the member did not choose, else null. */
  note: string | null;
  /** Both guides can answer, so the page offers the choice. */
  canChoose: boolean;
}

export const GUIDE_WORDS = {
  heading: "Who you're talking to",
  answering: (name: string) => `${atStart(name)} is answering.`,
  fellBack: (chosen: string, other: string) => `${atStart(chosen)} can't answer right now, so ${other} is answering.`,
  village: (name: string) => `${atStart(name)} is this village's own guide.`,
  saberra: (name: string) =>
    `${atStart(name)} works through the village's outside memory service. What you ask goes to it under your role titles, and it may keep the conversation.`,
  switchTo: (name: string) => `Talk to ${name}`,
  saved: "Saved. Every guide here now answers as your choice.",
} as const;

/** A stored value read back as a guide, or null for anything else. PURE. */
export function parseGuideId(v: unknown): GuideId | null {
  return typeof v === "string" && (GUIDE_IDS as readonly string[]).includes(v) ? (v as GuideId) : null;
}

/**
 * Who answers, given the member's choice and what is reachable. PURE.
 *
 * The chosen guide when it can answer. Otherwise the other one, with a
 * sentence saying so when the member had chosen. With no choice, the outside
 * agent first, then the village guide.
 */
export function resolveGuide(choice: GuideId | null, options: readonly GuideOption[]): GuideState {
  const byId = new Map(options.map((o) => [o.id, o]));
  const can = (id: GuideId) => byId.get(id)?.available === true;
  const canChoose = can("village") && can("saberra");
  const order: GuideId[] = choice ? [choice, choice === "village" ? "saberra" : "village"] : ["saberra", "village"];
  const answering = order.find(can) ?? null;
  let note: string | null = null;
  if (choice && answering && answering !== choice) {
    note = GUIDE_WORDS.fellBack(byId.get(choice)?.name ?? choice, byId.get(answering)?.name ?? answering);
  }
  return { choice, options: [...options], answering, note, canChoose };
}
