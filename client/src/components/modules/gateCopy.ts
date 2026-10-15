/**
 * One line per module saying what a visitor would be walking into.
 *
 * ── WHY THIS IS NOT `shared/modules.ts`'s `description` ───────────────────
 *
 * The registry already carries a sentence per module and this file is
 * deliberately not it. That one is founder-facing catalog copy for the Admin
 * Modules tab, and it reads like it: "Funds-bearing: read the legal card
 * before enabling", "Snapshot COLLECTION runs from the day this ships". A
 * person who has never signed in is owed a different sentence, and the
 * registry sentence would be the wrong one in front of them.
 *
 * The registry is also kept OUT of the client bundle on purpose (the Module
 * Library renders it server-side for exactly that reason), so importing it
 * here to reach one field would carry the whole catalog into main JS.
 *
 * ── WHAT A LINE MAY SAY (R56) ────────────────────────────────────────────
 *
 * State what is true, then get out of the way. A line names what is on the
 * other side and stops. It never says the surface is good, never says the
 * visitor is missing out, and never counts anything a village could feel
 * behind on (R55). "Gatherings with a time, a place, and a seat you can
 * take" is a description; "the heart of village life" is an argument.
 *
 * ── KEYED BY MODULE, OVERRIDDEN BY PAGE ──────────────────────────────────
 *
 * Several pages share one module id and are not the same surface: /places
 * and /village-map are both `map`, /propose and /decisions are both
 * `governance`. A module-level line would be false on one of each pair, so
 * `ModuleGate` takes a `behind` prop and those pages pass their own. The map
 * here is the default, never the only answer.
 *
 * `gateCopy.test.ts` walks every `<ModuleGate>` in the client and fails if a
 * caller has neither an entry here nor a `behind` of its own, so a new gated
 * page cannot quietly go back to saying nothing.
 */

/** Module id to the one line a signed-out reader gets. */
export const GATE_LINES: Record<string, string> = {
  badges: "The skills members declare here, and the badges their finished work has earned them.",
  commerce:
    "What this project charges for and what it accepts: application fees, donations, deposits and memberships.",
  crowdpool: "The funding ring, the shelf of what is still needed, and the ledger of who has arrived.",
  events: "Gatherings with a time, a place, and a seat you can take.",
  exchange: "Buying this village's own tokens.",
  feed: "The everyday stream: posts, gatherings, and the village's own milestones.",
  forum: "Village conversations by topic, and the proposals that come out of them.",
  governance:
    "Proposals on their way to a vote, the ballots running today, and the outcome of every one that has closed.",
  health: "This village's vital signs, cycle by cycle.",
  introductions: "What members say they are looking for, and the introductions waiting on a yes.",
  journal:
    "Your own morning and evening pages, a weekly pulse, call debriefs, and a kind road for feedback. Only you read what you write.",
  library: "The village's shared tools and goods, and what is on the shelf today.",
  map: "The living org chart: the circles, the roles that orbit them, and who holds each seat.",
  messaging: "Private conversations between members, one to one or in a named group.",
  network: "The needs and offers this village shares with the villages it listens to.",
  sessions:
    "A circle's calls, held live: who is arriving, the agenda, decisions by consent, and who holds each action, kept for those who were there.",
  stays: "Rooms on this land, what a night costs in stay credits, and how to book one.",
  tools: "One place to find the chat, the documents, and the governance space this village runs on.",
};

/**
 * Lines a PAGE owns because its module id covers more than one surface.
 * Exported so the test can accept a caller that passes one of these.
 */
export const PAGE_GATE_LINES = {
  places: "Every place on this land somebody has photographed, and the pictures they took of it.",
  propose: "The walk that takes a proposal from its first sentence to a ballot the village can vote on.",
} as const;

/** The line for a module, or null when there is nothing true to say. */
export function gateLine(moduleId?: string): string | null {
  if (!moduleId) return null;
  return GATE_LINES[moduleId] ?? null;
}

/**
 * "A, B and C" with no serial comma, the house list shape. Used for the
 * names of what a reader can still reach.
 */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
