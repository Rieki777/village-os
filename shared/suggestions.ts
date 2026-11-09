/**
 * SUGGEST-TO-EDIT: WHERE A SUGGESTION GOES (ROLE_POWERS_DESIGN.md §4.5).
 *
 * Rye, 2026-11-01: the admin panel is open to every member to see, and a
 * member needs the power behind a control to change it without a vote.
 * Without the power, the same form makes a SUGGESTION, which changes nothing
 * until somebody who may decide it does. Made GO on 2026-11-06.
 *
 * This file is the pure half: the routing rule, the per-power override, the
 * controls a suggestion may name, and the small checks every door asks. The
 * store is `assistant_drafts` (kind `admin_edit`, shared/draftKinds.ts), the
 * doors are server/routes/adminSuggestions.ts, and the lifecycle is
 * server/lib/adminSuggestions.ts.
 *
 * ── THE ROUTING RULE ───────────────────────────────────────────────────────
 *
 * The 2026-09-23 rule (who may act follows who holds the power), applied to
 * every admin control:
 *
 *   1. the village holds the power      -> a village ballot, because then the
 *                                          vote is the decision;
 *   2. a role holds it, live            -> the holders' review queue, counted
 *                                          the bridged way (`liveHoldersOf` in
 *                                          server/index.ts), so an admin who
 *                                          was never given the power is nobody;
 *   3. nobody holds it                  -> a village ballot, the 2026-09-14
 *                                          "no holder means a vote" rule.
 *
 * Two kinds of suggestion never go to holders, whatever else is true: one on
 * the steward's veto, and one on a control that passes powers to the village.
 * Both are always ballots.
 */
import type { Capability } from "./capabilities";

export type SuggestionRoute = "holders" | "ballot";

/**
 * THE PER-POWER OVERRIDE, a total Record so a new key is a type error until
 * somebody chooses. "holders" means the routing rule above decides; "ballot"
 * sends every suggestion on that power to a village vote even while a role
 * holds it.
 *
 * The village changes an entry through a dial that only holders of
 * `power.assign` may turn (§4.5). That dial is NOT built yet; it is the
 * follow-up named in the pull request. Until it lands, this table is the
 * platform default and nothing writes to it.
 */
export const SUGGESTION_ROUTE: Record<Capability, SuggestionRoute> = {
  "quest.consent": "holders",
  "forum.post": "holders",
  "forum.moderate": "holders",
  "proposal.open": "holders",
  "proposal.decide": "holders",
  "map.viewPeople": "holders",
  "terms.read": "holders",
  "map.contact": "holders",
  "map.edit": "holders",
  "map.publish": "holders",
  "map.photograph": "holders",
  "map.curatePhotos": "holders",
  "feed.announce": "holders",
  "stay.member_rate": "holders",
  "exchange.buy": "holders",
  "exchange.swap": "holders",
  "exchange.manage": "holders",
  "health.record": "holders",
  "message.send": "holders",
  "mechanics.propose": "holders",
  "event.rsvp": "holders",
  "event.manage": "holders",
  "org.declare": "holders",
  "ballot.vote": "holders",
  "member.vouch": "holders",
  "member.superVouch": "holders",
  "org.seat": "holders",
  "org.seatAgent": "holders",
  "org.decide": "holders",
  "intake.moderate": "holders",
  "library.keep": "holders",
  "story.tell": "holders",
  "dial.set": "holders",
  "quest.approve": "holders",
  "redemption.confirm": "holders",
  "cash.pay": "holders",
  // Batch 101 composes #961 with the valuation set's new key: the routing rule
  // decides, like cash.pay beside it.
  "role.pay": "holders",
  "module.switch": "holders",
  // The veto stays ballot-only (Rye, 2026-09-23). `routeSuggestion` enforces
  // it again, so a dial that one day writes this table cannot flip it.
  "steward.veto": "ballot",
  "comms.manage": "holders",
  "session.template": "holders",
  "companion.use": "holders",
  "moon.approve": "holders",
  "moon.approve_alone": "holders",
  "moon.approve_own": "holders",
  "power.assign": "holders",
  "operator.accounts": "holders",
  "operator.config": "holders",
  // No control behind this key may be named by a suggestion: a suggestion is
  // stored as a readable draft, and a secret is write-only.
  "operator.secrets": "holders",
  "operator.recover": "holders",
};

export interface RouteInput {
  /** The power behind the control. */
  capability: Capability;
  /** The village holds this power (`isVillageHeld`). */
  villageHolds: boolean;
  /** Who holds it live, the admin short-circuit excluded (`liveHoldersOf`). */
  liveHolders: readonly string[];
  /** The control hands powers to the village. Always a ballot. */
  passesPowers?: boolean;
}

/** Where a suggestion goes, right now. Pure; every door asks this. */
export function routeSuggestion(input: RouteInput, routes: Readonly<Record<Capability, SuggestionRoute>> = SUGGESTION_ROUTE): SuggestionRoute {
  if (input.passesPowers) return "ballot";
  if (input.capability === "steward.veto") return "ballot";
  if (input.villageHolds) return "ballot";
  if (input.liveHolders.length === 0) return "ballot";
  return routes[input.capability] === "ballot" ? "ballot" : "holders";
}

/**
 * THE CONTROLS A SUGGESTION MAY NAME. A control joins this list only once its
 * Accept is wired end to end through the same function its direct route
 * calls (server/lib/adminSuggestions.ts `registerAdminEditControl`), so a
 * suggestion can never be accepted into a door that does not exist.
 *
 * The first slice wires one: the paths and stages words
 * (`PUT /api/admin/village-paths`, server/routes/villagePaths.ts). It is the
 * simplest admin write with a power key: one document, one power
 * (`story.tell`), and an optimistic version check already on the route.
 */
export interface AdminEditControlSpec {
  /** The power the direct edit asks the gate for. */
  capability: Capability;
  /** What the control changes, in words. */
  label: string;
  /** The control hands powers to the village, so suggestions are always ballots. */
  passesPowers: boolean;
}

export const ADMIN_EDIT_CONTROLS = {
  village_paths: {
    capability: "story.tell",
    label: "the words for the village's paths and stages",
    passesPowers: false,
  },
  /*
   * THE CASH BUDGET (budgets spec R22). Every member may suggest a change to a
   * line, or a whole upload, with the same preview; it goes to the holders of
   * `role.pay` while a role holds it, and to a ballot when the village holds
   * it or nobody does. The Accept and the ballot closer both call
   * `importBudgetLines` (server/routes/budgets.ts registers it), the one write
   * path the direct routes use.
   */
  budget_lines: {
    capability: "role.pay",
    label: "the village's cash budget",
    passesPowers: false,
  },
} as const satisfies Record<string, AdminEditControlSpec>;

export type AdminEditControlId = keyof typeof ADMIN_EDIT_CONTROLS;

export function isAdminEditControl(id: unknown): id is AdminEditControlId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ADMIN_EDIT_CONTROLS, id);
}

/** After this many days unreviewed, the suggester may raise it to a ballot (§4.5). */
export const SUGGESTION_RAISE_AFTER_DAYS = 14;

/**
 * May the suggester raise it to a ballot now. After the wait, always. Before
 * it, only once nobody is left to review it (the route now reads "ballot"),
 * so a suggestion whose holders all left is never stuck for two weeks.
 */
export function mayRaiseToBallot(suggestedAt: Date, now: Date, routeNow: SuggestionRoute): boolean {
  if (routeNow === "ballot") return true;
  return now.getTime() - suggestedAt.getTime() >= SUGGESTION_RAISE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** The longest a decline's reason may be. One line, read by the suggester. */
export const DECLINE_REASON_MAX = 280;

/** Why a decline's reason will not do, or null. A holder may slow a change, and always says why. */
export function declineReasonProblem(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length < 3) return "Say in one line why you are declining it. The person who suggested it reads this.";
  if (/[\r\n]/.test(reason.trim())) return "Keep the reason to one line.";
  if (reason.trim().length > DECLINE_REASON_MAX) return `Keep the reason under ${DECLINE_REASON_MAX} characters.`;
  return null;
}

export interface DiffLine {
  /** Dotted path to the leaf, `ladder.title`. */
  path: string;
  from: unknown;
  to: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Every leaf that differs between two documents, with both values. A field
 * absent on one side reads as null there. Arrays compare whole. Used to show
 * a reviewer what moved under a stale suggestion, and what the suggestion
 * itself changes.
 */
export function suggestionDiff(from: unknown, to: unknown, prefix = ""): DiffLine[] {
  if (isPlainObject(from) || isPlainObject(to)) {
    const a = isPlainObject(from) ? from : {};
    const b = isPlainObject(to) ? to : {};
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
    return keys.flatMap((k) => suggestionDiff(a[k] ?? null, b[k] ?? null, prefix ? `${prefix}.${k}` : k));
  }
  if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return [];
  return [{ path: prefix, from: from ?? null, to: to ?? null }];
}
