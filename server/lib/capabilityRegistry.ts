/**
 * THE POWERS THIS VILLAGE HAS, AND WHERE EACH ONE LIVES (0098).
 *
 * `GET /api/admin/members/:id/capabilities` could already say who holds what,
 * for one member, to an admin. What nothing could say was the other half of
 * the question, and it is the half a village asks: what powers are there,
 * what does each one open, and who has this one? A permission system that can
 * answer "can Ana moderate?" and cannot answer "who moderates here?" is
 * legible to its operator and opaque to everyone it governs.
 *
 * ── WHAT IS DERIVED AND WHAT IS DECLARED, SAID PLAINLY ─────────────────────
 *
 * The SET of powers is derived: every key `TRANSFERABLE` marks as able to
 * move is named here, split between the ones with a surface behind them and
 * the ones nothing has wired yet. `capabilityRegistry.test.ts` fails if a key
 * appears in neither list, so a new transferable key cannot slip in unnamed.
 *
 * `POWERS` is the wider list of the two, and 0103 is when that started to
 * matter. It names every power a village MEETS, which includes one the map
 * refuses to move: `ballot.vote` is real, wired and read on every ballot, and
 * `shared/capabilities.ts` says at length why it stays where it is. Every
 * such key carries its own sentence in `WIRED_BUT_HELD_BACK` below, and the
 * test pins that list to exactly the entries here that cannot move.
 *
 * The SENTENCE a member reads is derived: it comes from
 * `CAPABILITY_CONSEQUENCE`, written on the explicit principle that these say
 * the consequence and never the key. Re-typing them here would be a second
 * copy to keep in step.
 *
 * The title, the surface and the route list are DECLARED, and that is a real
 * limit worth stating rather than dressing up. There is no mechanical way to
 * ask an Express app which routes a key gates: the check is a function call
 * inside a closure, often behind a named helper. What the test does instead
 * is assert every declared path exists verbatim in `server/index.ts`, so a
 * renamed or deleted route breaks this file loudly rather than leaving a
 * village reading a sentence about a door that is no longer there.
 */
import { CAPABILITY_CONSEQUENCE } from "../../shared/draftKinds";
import {
  ALL_CAPABILITIES,
  capabilityLabel,
  TRANSFERABLE,
  type Capability,
} from "../../shared/capabilities";

export interface PowerEntry {
  capability: Capability;
  /** What a member calls this in conversation, on its own, without a verb. */
  title: string;
  /** Where in the product this power is used, in the village's words. */
  surface: string;
  /** Paths that ask the gate for this key. Declared; see the header. */
  routes: readonly string[];
}

/**
 * One entry per transferable power that something actually gates on.
 *
 * Ordered by where a village meets them, NEVER by whether they are held.
 * Sorting by held and unheld draws a completion bar out of a list, and that
 * is the one thing this surface may not do: the order below is stable and
 * identical for a village holding nothing and a village holding all of them.
 */
export const POWERS: readonly PowerEntry[] = [
  {
    capability: "intake.moderate",
    title: "The village's queues",
    surface: "Submissions, forum reports, and reported messages",
    routes: [
      "/api/admin/submissions/:id/status",
      "/api/admin/forum/reports/:id",
      "/api/admin/messages/reports/:id",
    ],
  },
  {
    capability: "forum.moderate",
    title: "The forum",
    surface: "Hiding a post and acting on what the community reports",
    routes: ["/api/forum/threads/:id/moderate"],
  },
  {
    capability: "library.keep",
    title: "The shared library",
    surface: "What comes into the library, what goes out on loan, what comes back",
    routes: [
      "/api/admin/library/items/:id/approve",
      "/api/admin/library/items/:id",
      "/api/admin/library/loans/:id/pickup",
      "/api/admin/library/loans/:id/settle",
      "/api/admin/library/adjust",
    ],
  },
  {
    capability: "story.tell",
    title: "What the village says about itself",
    surface: "Page content, the questions and answers, and the milestones",
    routes: [
      "/api/admin/content/:section",
      "/api/admin/faqs/:pathway",
      "/api/admin/faqs/:pathway/:id",
      "/api/admin/milestones",
      "/api/admin/milestones/:id",
    ],
  },
  {
    capability: "org.seat",
    title: "The village's seats",
    surface: "Seating somebody in a seat, and taking them out of it",
    routes: ["/api/admin/org/roles/:id/holders", "/api/admin/org/seatings/:id"],
  },
  {
    capability: "org.seatAgent",
    title: "The village's software seats",
    surface: "Seating a software agent in a seat, and taking it out of it",
    routes: ["/api/admin/org/roles/:id/holders"],
  },
  {
    capability: "org.declare",
    title: "The village's own shape",
    surface: "Declaring the circles, the seats, and how each one decides",
    /*
     * CORRECTED IN 0103. This entry named `/api/admin/org/drafts/:id/publish`
     * and `/api/circles`, and neither one asks this key: the first is behind
     * a plain `isAdmin` and the second is a public read with no gate at all.
     * The rot test only asks whether a declared path still EXISTS, which both
     * of these did, so a village was reading a sentence about its own shape
     * beside two doors that answer to something else entirely.
     *
     * These five are the routes that actually run `mayDeclare`.
     */
    routes: [
      "/api/org/village/power",
      "/api/org/circles/:id/decides",
      "/api/admin/resources/rules",
      "/api/admin/resources/sources",
      "/api/admin/resources/budgets",
    ],
  },
  {
    capability: "dial.set",
    title: "The village's dials",
    surface: "The game's own numbers, within the ring the village governs",
    routes: ["/api/admin/variables/:key"],
  },
  {
    capability: "event.manage",
    title: "The calendar",
    surface: "Putting a gathering on the calendar, editing it, calling it off",
    routes: ["/api/admin/events", "/api/admin/events/:id"],
  },
  {
    capability: "exchange.manage",
    title: "The market",
    surface: "Listing tokens, posting prices, stocking the treasury",
    routes: ["/api/admin/exchange/tokens/:slug/halt", "/api/admin/exchange/tokens/:slug/resume"],
  },
  {
    capability: "health.record",
    title: "The land's own measurements",
    surface: "Logging what has been counted: trees, water, hectares",
    routes: ["/api/admin/health/regen"],
  },
  {
    capability: "quest.approve",
    title: "What the board asks for, and what it pays",
    surface: "The review queue, where a proposed quest becomes a real one",
    routes: ["/api/review/quests/:id/accept", "/api/review/quests/:id/reject"],
  },
  {
    capability: "redemption.confirm",
    title: "Redemptions",
    surface: "Agreeing that a member was paid off the platform, and destroying what they redeemed",
    routes: ["/api/redemptions/:id/confirm", "/api/redemptions/:id/refuse"],
  },
  {
    capability: "quest.consent",
    title: "Releasing value on finished work",
    surface: "Consenting to somebody else's finished quest",
    routes: ["/api/admin/quest-claims/:id/consent", "/api/events/:id/checkin"],
  },
  {
    capability: "map.publish",
    title: "The living map",
    surface: "Putting a drafted map in front of every visitor",
    routes: [
      "/api/map/publish",
      "/api/map/revisions/:version/restore",
      "/api/housing/availability/:structureKey",
      "/api/housing/reservations/:id/status",
    ],
  },
  {
    capability: "map.curatePhotos",
    title: "The map's photographs",
    surface: "Taking a photograph down, and working the queue of reports",
    routes: [
      "/api/places/reports/:id",
      "/api/places/photo/:id/hide",
      "/api/places/photo/:id/restore",
      "/api/places/photo/:id",
      "/api/places/:key/hero",
    ],
  },
  {
    capability: "feed.announce",
    title: "Announcements",
    surface: "Posting something the whole village sees on its feed",
    routes: ["/api/forum/threads"],
  },
  {
    capability: "proposal.decide",
    title: "Closing a decision",
    surface: "Recording the outcome of a decision and closing it",
    routes: [
      "/api/governance/ballots/:id/close",
      "/api/governance/ballots/:id/withdraw",
      "/api/governance/ballots/:id/objections/:objectionId/rule",
      "/api/forum/threads/:id/decide",
      "/api/admin/roles/:id/holders",
    ],
  },
  {
    capability: "ballot.vote",
    title: "The vote itself",
    surface: "Who is on the roll when this village holds a ballot",
    routes: ["/api/governance/ballots/:id/vote", "/api/governance/standing"],
  },
];

/**
 * TRANSFERABLE KEYS NOTHING GATES ON YET, each with the reason it is here.
 *
 * This list is the honest half of an inverse index. A power with no route
 * behind it is a promise, and putting one on a village's page next to powers
 * that work would be advertising a door that opens onto nothing. So they are
 * named here, out of the member's way, where a builder finds them.
 *
 * A line comes out when the route lands. Nothing joins this list quietly:
 * `capabilityRegistry.test.ts` requires every transferable key to be in
 * exactly one of the two lists.
 */
export const NOT_YET_WIRED: Readonly<Record<string, string>> = {
  "member.vouch":
    "Declared in the round 5 capability set and gated by nothing: grep finds the key in " +
    "shared/capabilities.ts and in no route, helper or query in server/**. The membrane's " +
    "vouching step has not been built, so there is no power here to hand anybody yet.",
};

/**
 * WIRED, REAL, AND STILL UNABLE TO MOVE, with the reason a member reads.
 *
 * The two ceremony routes refused any non-transferable key with one sentence:
 * "It names something a member does for themselves, or plumbing the
 * deployment has to keep reachable." That sentence is TRUE of every key it
 * used to meet, and after 0103 it is false of the one key left in this
 * position. A village asking for `ballot.vote` would have been told it was a
 * personal act, which is the flattest kind of lie a product tells: a fallback
 * sentence answering a question nobody asked it.
 *
 * So the reason lives here, beside the power it is about, and the route reads
 * it. `capabilityRegistry.test.ts` pins the keys of this map to exactly the
 * POWERS entries `TRANSFERABLE` refuses, so a key that crosses later takes
 * its line out of here on the same day.
 */
export const WIRED_BUT_HELD_BACK: Readonly<Record<string, string>> = {
  "ballot.vote":
    "Who votes here is a rule of the game, so it moves the way a rule moves. Nothing in the " +
    "product refuses anybody on this key: the roll is built by running the gate over every " +
    "member when a ballot opens, and the ballot itself reads the roll it froze. There is no " +
    "door for an administrator to be turned away from, so handing it over would record a " +
    "promise the code could not keep. Open a rule change on the rung that decides who is on " +
    "the roll, and the whole roll decides it.",
};

/**
 * The registry as a member reads it, with a holder attached to each power.
 *
 * `holders` maps a capability to who has it. A power missing from that map is
 * one the scaffolding is still carrying, and it stays in the SAME list in the
 * SAME position: held and unheld are one list, because splitting them into
 * two sections is how a list becomes a scoreboard.
 */
export interface PowerHolder {
  roleId: string;
  roleName: string | null;
  movedAt: string;
  /** True when a ballot moved it, false when an admin handed it over. */
  byBallot: boolean;
}

export function powersForReading(
  holders: ReadonlyMap<string, PowerHolder>,
): Array<{
  capability: Capability;
  title: string;
  surface: string;
  consequence: string;
  label: string;
  heldBy: PowerHolder | null;
}> {
  return POWERS.map((p) => ({
    capability: p.capability,
    title: p.title,
    surface: p.surface,
    consequence: CAPABILITY_CONSEQUENCE[p.capability],
    label: capabilityLabel(p.capability),
    heldBy: holders.get(p.capability) ?? null,
  }));
}

/** Every transferable key that neither list names. Empty is the invariant. */
export function undescribedPowers(): Capability[] {
  const named = new Set<string>([
    ...POWERS.map((p) => p.capability as string),
    ...Object.keys(NOT_YET_WIRED),
  ]);
  return ALL_CAPABILITIES.filter((c) => TRANSFERABLE[c] === true && !named.has(c));
}
