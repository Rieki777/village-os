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
  journalOnlySera: (sera: string) =>
    `${atStart(sera)} can keep you company in your journal once you choose to talk to ${sera}. Your journal words only go to ${sera} when you do.`,
  journalVillageOnly: (village: string, sera: string) =>
    `Your journal stays in the village. ${atStart(village)} answers here, and your journal words never go to ${sera}.`,
  journalResting: (sera: string) =>
    `Your journal stays in the village, so ${sera} does not answer here. The journal's guide rests until the village connects its own key.`,
  journalAsked: (village: string, sera: string) =>
    `In your journal, ${village} answers until you choose ${sera} yourself. Your journal words only go to ${sera} when you do.`,
} as const;

/**
 * MAY THE JOURNAL GO TO SERA AT ALL? OFF (the coordinator's ruling (c),
 * 2026-11-09, pending Rye). Nothing in `ask_sera` lets this village ask the
 * service not to keep what it is sent, and the journal promises "Only you read
 * what you write here", so until that can be guaranteed the journal stays
 * village-only: the village guide answers it, and no journal words reach Sera.
 * Turned on, `journalGuide` below applies the rule already agreed (ruling (a)):
 * Sera only for a member who chose her, undone in one tap. Its opt-in copy must
 * then also say that Sera's side is asked not to store the text.
 */
export const JOURNAL_ON_SERA = false;

/**
 * THE JOURNAL ASKS FIRST (2026-11-09; the coordinator's ruling (a)). A member who never chose is answered by
 * the outside agent elsewhere (the founder's ruling above), but the journal
 * promises "Only you read what you write here", so its words go to the outside
 * agent only once the member has chosen it themselves. Until then the village
 * guide answers there, and the page says so. PURE; the journal route and the
 * journal's panel both read it, so what the page says and who answers agree.
 */
export function journalGuide(state: GuideState, onSera: boolean = JOURNAL_ON_SERA): GuideState {
  const village = state.options.find((o) => o.id === "village");
  const sera = state.options.find((o) => o.id === "saberra");
  if (!onSera) {
    // Village-only: nothing to choose here, and the page says why when Sera is about.
    const seraName = sera?.name ?? "the outside agent";
    const seraAbout = !!sera?.available || state.choice === "saberra";
    if (!village?.available) return { ...state, answering: null, canChoose: false, note: seraAbout ? GUIDE_WORDS.journalResting(seraName) : null };
    return { ...state, answering: "village", canChoose: false, note: seraAbout ? GUIDE_WORDS.journalVillageOnly(village.name, seraName) : null };
  }
  if (state.choice === "saberra" || state.answering !== "saberra") return state;
  // Only the outside agent could answer: nothing answers the journal until the member chooses it.
  if (!village?.available) return { ...state, answering: null, note: GUIDE_WORDS.journalOnlySera(sera?.name ?? "the outside agent") };
  return { ...state, answering: "village", note: GUIDE_WORDS.journalAsked(village.name, sera?.name ?? "the outside agent") };
}

/** A stored value read back as a guide, or null for anything else. PURE. */
export function parseGuideId(v: unknown): GuideId | null {
  return typeof v === "string" && (GUIDE_IDS as readonly string[]).includes(v) ? (v as GuideId) : null;
}

/**
 * The guide a member's PERSONAL companion speaks through (Rye, 2026-11-06: it
 * follows the member's own chosen guide, never the village's). PURE.
 *
 * The member's choice, kept even while that guide cannot answer, since the
 * companion's page says when the other one answers for it. With no choice, the
 * rule every guide surface follows (resolveGuide): the outside agent when it
 * can answer, the village guide otherwise.
 */
export function companionGuideOf(stored: unknown, outsideCanAnswer: boolean): GuideId {
  return parseGuideId(stored) ?? (outsideCanAnswer ? "saberra" : "village");
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
