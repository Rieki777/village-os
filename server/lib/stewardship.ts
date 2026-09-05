/**
 * STEWARDSHIP: who may stop a carried decision, for how long they hold the
 * seat, and what a village looks like when nobody does.
 *
 * ── THE RULE, IN THE FOUNDER'S WORDS ───────────────────────────────────────
 *
 * 2026-09-03: "whenever a decision is approved it passes and executes (if it's
 * sending tokens) if it's changing the Game then it starts at the next new
 * moon or automatically if a steward doesn't block it, a steward is given 3
 * days minimum."
 *
 * 2026-09-03: "However if a steward votes down on a token payment proposal
 * than it fails automatically." And: "Yes stewards can also block payouts, and
 * yes to the veto override."
 *
 * 2026-09-03: "no any single steward has the ability to veto though we could
 * add a 'Steward Council' option that makes it a majority of them"
 *
 * 2026-08-31: "Yes a steward veto absolutely should carry a reason."
 *
 * 2026-08-31: "No terms should definitely end when they end not with a polite
 * warning! If they're not voted back in then they expire when they expire!"
 *
 * 2026-09-02: "Sure and it's perfectly fine to have no stewards and for the
 * game to have self/executing agreements."
 *
 * ── WHAT CHANGED, AND WHAT THE OLD MODEL SAID ──────────────────────────────
 *
 * This module first shipped as an APPROVAL gate: a passed proposal waited for
 * a steward, and nothing happened until one said yes. That model is withdrawn.
 * Nothing waits for a steward now. A carried decision lands at its own
 * landing instant whether or not anybody holds the seat, and the seat's one
 * power is to stop it inside the window before it lands. There is no hold, no
 * queue, and an empty seat is a village nobody can veto rather than a village
 * whose decisions are stuck.
 *
 * ── AN EMPTY SEAT IS NOT AN ERROR ──────────────────────────────────────────
 *
 * A village with no steward and self-executing agreements is the HEALTHY end
 * state, the one the training wheels come off into. `vacancyState` says so in
 * one sentence and never renders an empty seat as a warning or a queue.
 *
 * ── THE CONTRACT FOR THE CLOSE DISPATCHER ──────────────────────────────────
 *
 * This module owns the STEWARD half and nothing about closing or landing. The
 * dispatcher lane owns `SUBJECT_CLOSERS`, `lands_at`, and
 * `applyDueGovernance`, and calls in here:
 *
 *   stewardVetoStands(pool, ballotId)  ONE question, one answer: is this
 *                                      decision blocked right now? It reads
 *                                      the council setting, counts the seats
 *                                      and counts the vetoes, so the
 *                                      dispatcher never re-derives any of it.
 *   mayVeto(subjectType)               May a steward veto this kind of thing
 *                                      at all? The per-subject map.
 *   isVetoable(subject, elements)      The same question with both carve-outs
 *                                      applied, pure: a seat cannot veto its
 *                                      own removal, and cannot veto an edit
 *                                      to its own limits. Those two keep
 *                                      their timing and their window like any
 *                                      other Game change; what they lose is
 *                                      the veto and nothing else.
 *   subjectIsVetoable(pool, ballot)    The same rule for a caller with a pool,
 *                                      which resolves the one fact the pure
 *                                      form cannot: whether the seating is
 *                                      about a steward-capable role.
 *   stewardNoBlocks(input)             Does a seated steward's NO fail this
 *                                      ballot at the close? TOKEN SENDS ONLY,
 *                                      never a ballot the steward is the
 *                                      subject of, and the no carries a
 *                                      reason under the veto's own rule.
 *   setVetoWindowCheck(fn)             The dispatcher registers its window
 *                                      check here at boot. Until it does,
 *                                      `vetoWindowVerdict` answers that no
 *                                      window is known rather than pretending
 *                                      one is open or closed.
 *   recordVeto / recordNoObjection     Write the act.
 *   seatCatalystsAsStewards(...)       Called by the launch closer once the
 *                                      Birthing carries. SEE THE CACHE
 *                                      WARNING ON IT.
 *
 * ── WHY THE PERMISSION PLANE ───────────────────────────────────────────────
 *
 * Two planes shared only a word. `roles` and `role_holders` carry capabilities
 * and, until 0134, no term at all. `org_roles` and `org_role_assignments`
 * carry terms and no capabilities. A steward is a power, so the seat lives on
 * the plane that carries powers.
 *
 * A HOLDING LAPSES ON ITS TERM DATE AND ON NOTHING ELSE. The season is
 * recorded (`role_holders.season_id`) and read on the vacancy surface, and it
 * deliberately does not strip powers on its own: every permission role in
 * every existing village would silently disarm at the next season turn.
 *
 * THE TERM IS AN INSTANT FROM THE CLOCK, NEVER A SEASON. Seasons are an
 * ungoverned admin list; entries can be open-ended and their dates run out,
 * and the audit of 2026-09-03 found that a term hung on that list is a term
 * that never comes due. `termEndsAtFromCycles` computes the instant from the
 * lunar clock instead, and `seatCatalystsAsStewards` refuses to seat anybody
 * against an open-ended season rather than writing a term nothing will end.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { Criticality } from "../../shared/governanceEngine";
import type { Capability } from "../../shared/capabilities";
import { kindOfSet, kindOfSubject, type GovernanceKind } from "../../shared/governanceKinds";
import { cycleBoundsFor, cycleStartMs } from "../../shared/lunar";
import { moveCapabilityToVillage } from "./capabilityHolding";
import { boolVar, stringVar } from "./variables";

/**
 * The role slug is FROZEN and the display name is not.
 *
 * A slug is history's identity: `role_holders.role_id` rows, audit lines and
 * the ballots that seated people all point at this string, so renaming it
 * would orphan every one of them. The name a member reads is a column, and a
 * village that wants to call this seat something else changes the column.
 */
export const STEWARD_ROLE_ID = "steward";

/** What a fresh village calls the seat before it renames it. */
export const STEWARD_ROLE_NAME = "Steward";

/** The one power the seat carries. See shared/capabilities.ts for the key. */
export const STEWARD_VETO: Capability = "steward.veto";

/** Which subject kinds a steward MAY veto. Comma separated, `all` or `none`. */
export const STEWARD_SUBJECTS_KEY = "governance.steward_subjects";

/** When on, a veto needs a majority of the seated stewards, not any one. */
export const STEWARD_COUNCIL_KEY = "governance.steward_council";

/**
 * The older name for the second half of the veto map.
 *
 * The key is not in the variables registry: under the approval model it named
 * which subjects carried themselves with no steward in the loop, and once
 * every subject does that it said nothing the first list did not. It is named
 * here anyway because the ruling of 20.11 names it, because a fork's database
 * may still hold a row under it, and because a change set that carries the
 * string must be treated as an edit to the map whether or not this build
 * serves the setting.
 */
export const AUTO_EXECUTE_SUBJECTS_KEY = "governance.auto_execute_subjects";

/**
 * The two keys the dispatcher owns, named here so both lanes spell them the
 * same way. This module reads neither; it only refuses to let a ballot that
 * edits them be vetoed, because a seat that can veto the edit to its own
 * limits has no limits.
 */
export const VETO_HOURS_KEY = "governance.veto_hours";
export const HIGHEST_TIER_KEY = "governance.highest_tier";

/**
 * THE VETO MAP: the two settings that say what the seat may stop.
 *
 * 20.11 names these two by themselves. An edit to either is the village
 * deciding how far its own training wheels reach, and a seat that could stop
 * that edit would be setting its own limits.
 */
export const VETO_MAP_KEYS: readonly string[] = [STEWARD_SUBJECTS_KEY, AUTO_EXECUTE_SUBJECTS_KEY];

/**
 * The settings a steward may not veto a change to.
 *
 * The map, plus the two dials that price and shape the seat itself, plus the
 * tier at which the village overrides it. Every one of them is a limit ON the
 * seat, and a seat that can veto an edit to its own limits has none. All five
 * carry the constitutional criticality in `shared/gameVariables.ts`, so they
 * are the most expensive changes the village can make and the ones no steward
 * can reach.
 *
 * WHAT THIS NO LONGER MEANS, and it changed on 2026-09-03 (20.11). It used to
 * mean "executes at pass with no window at all". It now means only "no steward
 * may veto it". The timing choice and the veto window are unchanged: a change
 * set editing the map lands when any other Game change of the same timing
 * lands, the village sees the same countdown, and the only difference is that
 * the veto door is not there. Taking the window away as well as the veto put
 * an unstoppable act on the cheapest possible clock, which was the opposite of
 * what the carve-out was for.
 */
/**
 * WHICH SIZES OF DECISION THE SEAT MAY STOP (Rye, 2026-09-04).
 *
 * "for now as the default let's have constitutional able to be vetoed but let
 * it be a setting in admin for which of these 3 categories a steward can veto".
 *
 * The companion to `STEWARD_SUBJECTS_KEY`: that one names which KINDS are in
 * reach, this one names which SIZES, and a veto needs both. It is veto-locked
 * for the same reason every other limit on the seat is, which matters more here
 * than anywhere else: a seat that could veto a narrowing of its own reach would
 * be the only seat in the design that sets its own limits.
 */
export const STEWARD_VETO_TIERS_KEY = "governance.steward_veto_tiers";

export const VETO_LOCKED_KEYS: readonly string[] = [
  STEWARD_SUBJECTS_KEY,
  AUTO_EXECUTE_SUBJECTS_KEY,
  STEWARD_VETO_TIERS_KEY,
  STEWARD_COUNCIL_KEY,
  VETO_HOURS_KEY,
  HIGHEST_TIER_KEY,
];

/**
 * The tiers a steward may stop, read from the setting's raw text.
 *
 * FAIL CLOSED, in the direction that costs the village least. An unreadable or
 * empty value yields the EMPTY set, so a typo takes the seat's reach away and
 * never widens it: the cost of reading it wrong is a decision that lands with
 * nobody able to pause it, against a seat that could stop things the village
 * never put in its reach. Between those two, the village keeping its own
 * decisions is the safer failure, and it is the one the founder's framing asks
 * for.
 *
 * `all` is spelled out because `steward_subjects` already uses that word for
 * the same idea, and two reach settings that spell the same concept two
 * different ways is a trap for whoever writes the second one.
 */
export function stewardVetoTiersFrom(raw: unknown): ReadonlySet<Criticality> {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "all") return new Set(["routine", "structural", "constitutional"] as Criticality[]);
  const named = text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t === "routine" || t === "structural" || t === "constitutional");
  return new Set(named as Criticality[]);
}

/** Is a decision of this size inside the seat's reach at all? */
export function tierIsInStewardReach(tier: Criticality, raw: unknown): boolean {
  return stewardVetoTiersFrom(raw).has(tier);
}

/** True when changing this setting is outside every steward's reach. */
export function keyIsVetoLocked(key: string): boolean {
  return VETO_LOCKED_KEYS.includes(String(key));
}

/**
 * True for the two settings that ARE the map, which is a narrower question
 * than `keyIsVetoLocked` and a different one.
 *
 * Asked by anything that wants to know "is this the village editing what its
 * steward may stop", rather than "may a steward stop this". The dispatcher's
 * landing path asks this one.
 */
export function keyIsVetoMap(key: string): boolean {
  return VETO_MAP_KEYS.includes(String(key));
}

/**
 * The one subject that never reaches a steward, named once.
 *
 * An advisory vote is opened with no executor by design, so there is nothing
 * to stop and a veto on it would be an act about nothing.
 */
export const ADVISORY = "advisory";

/** The two subject types that seat and unseat, checked against the role. */
export const ROLE_SEAT_SUBJECTS: readonly string[] = ["role_seat", "role_unseat"];

/**
 * The role a seating ballot is about, read off its subject reference.
 *
 * `role_seat` and `role_unseat` freeze `subject_ref` as `userId@roleId`
 * (`parseSeatRef` in server/index.ts is the executor's half of the same
 * shape). A bare role id is accepted too, so a caller that already holds the
 * role does not have to invent a member to ask the question. Returns null on
 * anything else rather than guessing, because a guess here decides whether a
 * seat can stop its own removal.
 */
export function roleFromSeatRef(subjectRef: string | null | undefined): string | null {
  const ref = String(subjectRef ?? "").trim();
  if (!ref) return null;
  const at = ref.indexOf("@");
  if (at < 0) return ref;
  if (at === 0 || at === ref.length - 1) return null;
  return ref.slice(at + 1);
}

/** Every token that means "the whole list", so a village can type either. */
const ALL_TOKENS = new Set(["all", "*", "every"]);
const NONE_TOKENS = new Set(["none", "", "off"]);

function parseList(raw: string): { all: boolean; none: boolean; named: Set<string> } {
  const parts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return { all: false, none: true, named: new Set() };
  if (parts.some((p) => ALL_TOKENS.has(p))) return { all: true, none: false, named: new Set() };
  if (parts.every((p) => NONE_TOKENS.has(p))) return { all: false, none: true, named: new Set() };
  return { all: false, none: false, named: new Set(parts.filter((p) => !NONE_TOKENS.has(p))) };
}

/**
 * May a steward veto this kind of decision at all?
 *
 * The setting used to mean "which decisions WAIT for a steward". Nothing waits
 * any more, so it means the only thing left that a per-subject list can mean:
 * which kinds of decision the seat may stop. The default is every Game change,
 * which is what `all` says here, and a village narrows it as it grows into its
 * own agreements.
 *
 * `raw` is injectable so the rule can be tested without a loaded variable
 * cache. Callers pass nothing and get the village's setting.
 */
export function mayVeto(subjectType: string, raw: string = stringVar(STEWARD_SUBJECTS_KEY)): boolean {
  if (subjectType === ADVISORY) return false;
  const list = parseList(raw);
  if (list.none) return false;
  if (list.all) return true;
  return list.named.has(String(subjectType).toLowerCase());
}

/** The per-subject map, for the stewardship read. Order is the caller's. */
export function subjectMap(
  subjectTypes: readonly string[],
): Array<{ subjectType: string; mayVeto: boolean }> {
  return subjectTypes.map((s) => ({ subjectType: s, mayVeto: mayVeto(s) }));
}

/**
 * Does this village leave its stewards anything to veto at all?
 *
 * Asked of the SETTING rather than of a list of subject types. A village that
 * has never held a vote has no subject types to enumerate, and answering "the
 * seat can stop nothing" there would tell a brand-new village something about
 * itself that it has not decided.
 */
export function stewardMayVetoAnything(raw: string = stringVar(STEWARD_SUBJECTS_KEY)): boolean {
  const list = parseList(raw);
  return list.all || list.named.size > 0;
}

/**
 * The subject types this village has actually held a vote on, plus any the
 * setting names by hand.
 *
 * Derived from the ballots table rather than from a list typed here, because
 * which subject types EXECUTE is the close dispatcher's own table and a second
 * copy of it in this file would be the two-copies-of-one-rule trap.
 */
export async function subjectTypesSeen(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT DISTINCT subject_type FROM ballots");
  const seen = new Set(rows.map((r) => String(r.subject_type)));
  for (const named of Array.from(parseList(stringVar(STEWARD_SUBJECTS_KEY)).named)) seen.add(named);
  return Array.from(seen).sort();
}

// ── The two carve-outs: a seat cannot veto its own removal ──────────────────

export interface VetoableVerdict {
  vetoable: boolean;
  /** One sentence, fit to render, saying why not. Empty when vetoable. */
  why: string;
}

/** What `isVetoable` needs to know that it cannot read off the subject type. */
export interface VetoableContext {
  /**
   * True when this seating or unseating is about a role that carries
   * `steward.veto`. The caller resolves it, because the roles table is the
   * answer and this function is pure. `subjectIsVetoable` reads it for a
   * caller that holds a pool.
   */
  seatsStewardCapableRole?: boolean;
  /** The village's setting, injectable so the rule tests without a cache. */
  stewardSubjects?: string;
}

/**
 * MAY A STEWARD VETO THIS DECISION? The one predicate, pure, elements and all.
 *
 * Two carve-outs, and the audit of 2026-09-03 found both by asking one
 * question: what stops a steward vetoing the ballot that removes them? Nothing
 * did. The seat blocked its own unseating, blocked the edit that would exempt
 * it, and the term that was supposed to end it hung on a season list that
 * never turned. So:
 *
 *  1. `role_seat` and `role_unseat` on a role that carries `steward.veto`.
 *  2. A change set touching the veto map, the council switch, the window
 *     length or the override tier. Every one of those is a limit on the seat,
 *     and a seat that can stop an edit to its own limits has none.
 *
 * WHAT THE CARVE-OUT TAKES AND WHAT IT LEAVES, because the first build of it
 * took too much. It takes the VETO and nothing else. The timing choice, the
 * landing instant and the window all stand: one of these decisions waits
 * exactly as long as any other Game change of the same timing, the countdown
 * on the page is the same countdown, and a member reads the same instants. The
 * only difference is that no steward may stop it inside that window. Removing
 * the window as well put the one act nobody can stop onto the fastest clock
 * the platform has, which is the opposite of what a carve-out about
 * entrenchment is for.
 *
 * Anything else follows the per-subject setting.
 */
export function isVetoable(
  subjectType: string,
  elements: readonly { key?: unknown }[] = [],
  ctx: VetoableContext = {},
): VetoableVerdict {
  const raw = ctx.stewardSubjects ?? stringVar(STEWARD_SUBJECTS_KEY);
  if (!mayVeto(subjectType, raw)) {
    return {
      vetoable: false,
      why:
        subjectType === ADVISORY
          ? "An advisory vote changes nothing, so there is nothing to stop."
          : "This village does not put this kind of decision inside the veto window.",
    };
  }
  if (ROLE_SEAT_SUBJECTS.includes(subjectType) && ctx.seatsStewardCapableRole) {
    return {
      vetoable: false,
      why:
        "This decision seats or unseats the steward's own role. It waits out its window like any other Game change, " +
        "and no steward can stop it: a seat that could stop its own removal could never be removed.",
    };
  }
  const locked = elements.map((e) => String(e?.key ?? "")).filter((k) => keyIsVetoLocked(k));
  if (locked.length > 0) {
    return {
      vetoable: false,
      why:
        `This decision changes ${locked.join(", ")}, which is a limit on the seat itself. ` +
        "It waits out its window like any other Game change, and no steward can stop it, " +
        "because a seat that could stop an edit to its own limits would have none.",
    };
  }
  return { vetoable: true, why: "" };
}

/**
 * The same question for a caller that holds a pool and a ballot row.
 *
 * Resolves the one fact `isVetoable` cannot read for itself, which role the
 * seating is about, and hands the rest to the pure rule so there is one answer
 * and not two. `elements` is the change set when the caller has already loaded
 * it; a caller that has not passes nothing and gets the subject-level answer.
 */
export async function subjectIsVetoable(
  pool: Pool,
  ballot: { subjectType: string; subjectRef?: string | null },
  elements: readonly { key?: unknown }[] = [],
): Promise<VetoableVerdict> {
  let seatsStewardCapableRole = false;
  if (ROLE_SEAT_SUBJECTS.includes(ballot.subjectType)) {
    const roles = await rolesCarryingVeto(pool);
    const roleId = roleFromSeatRef(ballot.subjectRef);
    seatsStewardCapableRole = !!roleId && roles.has(roleId);
  }
  return isVetoable(ballot.subjectType, elements, { seatsStewardCapableRole });
}

// ── The window ──────────────────────────────────────────────────────────────

export type VetoWindowVerdict =
  | { open: true; known: true }
  /** No landing instant is recorded on this build, so the window is unknown. */
  | { open: true; known: false }
  | { open: false; known: true; error: string };

type WindowCheck = (pool: Pool, ballotId: string, now: Date) => Promise<VetoWindowVerdict>;

let windowCheck: WindowCheck | null = null;

/**
 * The dispatcher registers its window check here at boot.
 *
 * `lands_at` and `veto_closes_at` are the dispatcher's columns and its lane
 * writes them. Rather than this module reading a column that may not exist
 * yet, or holding a second copy of the rule that computes it, the dispatcher
 * hands its check in and both lanes keep one answer.
 *
 * UNREGISTERED IS ITS OWN ANSWER, and that is the point of `known`. Answering
 * "the window is open" when nothing has told us when it closes would let a
 * veto land after the decision did; answering "closed" would make the route
 * dead on a build where the dispatcher has not merged yet. So the verdict says
 * which of the two it is, the route lets the veto through, and the payload
 * carries `windowKnown: false` so a surface can be honest about it.
 */
export function setVetoWindowCheck(fn: WindowCheck | null): void {
  windowCheck = fn;
}

/** True when a dispatcher has registered a window check on this build. */
export function vetoWindowIsKnown(): boolean {
  return windowCheck !== null;
}

/** Ask whether the window on this ballot is still open. Never throws. */
export async function vetoWindowVerdict(
  pool: Pool,
  ballotId: string,
  now: Date = new Date(),
): Promise<VetoWindowVerdict> {
  if (!windowCheck) return { open: true, known: false };
  return windowCheck(pool, ballotId, now);
}

/**
 * The three moments a steward is told about an open window, as a pure
 * function of the two instants.
 *
 * The job that fires these is the dispatcher's, because it owns `lands_at`.
 * What belongs here is WHICH marks exist and what each one is called, so the
 * job and the notification blurbs cannot drift: at carry, at the half-way
 * point, and at two hours left.
 */
export type VetoWatchMark = "carried" | "halfway" | "two-hours-left";

export function vetoWatchMarksDue(
  window: { carriedAt: Date | string; landsAt: Date | string },
  now: Date = new Date(),
): VetoWatchMark[] {
  const from = window.carriedAt instanceof Date ? window.carriedAt : new Date(String(window.carriedAt));
  const to = window.landsAt instanceof Date ? window.landsAt : new Date(String(window.landsAt));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return [];
  const marks: VetoWatchMark[] = [];
  const t = now.getTime();
  if (t >= from.getTime()) marks.push("carried");
  if (t >= from.getTime() + (to.getTime() - from.getTime()) / 2) marks.push("halfway");
  if (t >= to.getTime() - 2 * 60 * 60 * 1000) marks.push("two-hours-left");
  return marks;
}

/**
 * THE THREE MARKS EACH TAKE THEIR OWN NOTIFICATION TYPE.
 *
 * They used to ride `governance`, which resolves to the governance email
 * preference, which defaults to DAILY. So the last warning before a Game
 * change landed arrived hours after it had landed. Three types, each pinned to
 * "immediate" in `emailCadenceFor`, is what makes the notice arrive while the
 * door is still open. `shared/notificationKinds.ts` holds what each one says.
 */
export const VETO_WATCH_NOTICE_TYPES: Readonly<Record<VetoWatchMark, string>> = {
  carried: "veto_window_opened",
  halfway: "veto_window_halfway",
  "two-hours-left": "veto_window_closing",
};

/** The notification type for one mark, so no caller spells it by hand. */
export function vetoWatchNoticeType(mark: VetoWatchMark): string {
  return VETO_WATCH_NOTICE_TYPES[mark];
}

/**
 * A NOTICE WHOSE MOMENT HAS PASSED IS NOT SENT.
 *
 * `vetoWatchMarksDue` answers which marks have come due, which is a question
 * about the clock. This answers which are still worth sending, which is a
 * question about the door: once the decision has landed, every one of these
 * notices is about a window that is shut. "Two hours to stop this" arriving
 * after it landed is worse than silence, because a steward reading it goes
 * looking for a door that is not there.
 */
export function vetoWatchMarksToSend(
  window: { carriedAt: Date | string; landsAt: Date | string },
  now: Date = new Date(),
): VetoWatchMark[] {
  const to = window.landsAt instanceof Date ? window.landsAt : new Date(String(window.landsAt));
  if (Number.isNaN(to.getTime()) || now.getTime() >= to.getTime()) return [];
  return vetoWatchMarksDue(window, now);
}

// ── The record ──────────────────────────────────────────────────────────────

export type StewardAct = "veto" | "no_objection";

export interface VetoRow {
  id: string;
  ballotId: string;
  act: StewardAct;
  decidedBy: string;
  /** Never null. Blank exactly when the reason has been redacted. */
  reason: string;
  redactedAt: string | null;
  redactedBy: string | null;
  decidedAt: string;
}

export type VetoResult =
  | { ok: true; row: VetoRow; fresh: boolean }
  | { ok: false; error: string; standing: VetoRow | null };

const VETO_COLS = "id, ballot_id, act, decided_by, reason, redacted_at, redacted_by, decided_at";

/** The cap the founder's record holds. Plain text, counted in characters. */
export const REASON_MAX = 2000;

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

function rowToVeto(r: RowDataPacket): VetoRow {
  return {
    id: String(r.id),
    ballotId: String(r.ballot_id),
    act: r.act as StewardAct,
    decidedBy: String(r.decided_by),
    reason: String(r.reason ?? ""),
    redactedAt: iso(r.redacted_at),
    redactedBy: r.redacted_by === null || r.redacted_by === undefined ? null : String(r.redacted_by),
    decidedAt: iso(r.decided_at) ?? "",
  };
}

/**
 * The reason a veto has to carry.
 *
 * The founder asked for the reason because a decision the village passed dying
 * without anybody being told why is the same family of defect as every other
 * one this codebase has removed. A whitespace-only string is the way that
 * requirement gets met without being met, so it is refused here rather than
 * stored and rendered as a blank line under somebody's name.
 *
 * 2000 characters, down from the 4000 the approval record allowed, because
 * this is public permanent free text about a named neighbour and a shorter
 * cap is the cheapest part of that being true.
 */
export function vetoReasonProblem(reason: unknown): string | null {
  const text = String(reason ?? "").trim();
  if (!text) {
    return "A veto carries a reason. Say what you saw, so the village can answer it.";
  }
  if (text.length > REASON_MAX) {
    return `That is longer than the record holds. ${REASON_MAX} characters maximum.`;
  }
  return null;
}

/** A no-objection's optional note, held to the same length. */
export function noObjectionReasonProblem(reason: unknown): string | null {
  const text = String(reason ?? "").trim();
  if (text.length > REASON_MAX) {
    return `That is longer than the record holds. ${REASON_MAX} characters maximum.`;
  }
  return null;
}

/**
 * ONE SENTENCE ABOVE THE INPUT, and it is not decoration.
 *
 * A veto reason is free text one member writes about another member's work on
 * a page the whole village reads and keeps. Somebody typing it deserves to
 * know that before they type it, and the redaction door deserves to be named
 * in the same breath so the promise is not "forever" when it is not.
 */
export const REASON_NOTICE =
  "This reason is public and permanent. The village reads it beside the decision, and it stays there. " +
  "The words can be redacted later; the veto, your name and its time stay on the record.";

/** Every act on a ballot, oldest first. */
export async function vetoesFor(pool: Pool, ballotId: string): Promise<VetoRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${VETO_COLS} FROM ballot_vetoes WHERE ballot_id = ? ORDER BY decided_at, id`,
    [ballotId],
  );
  return rows.map(rowToVeto);
}

/** One steward's act of one kind on one ballot, or null. */
export async function actFor(
  pool: Pool,
  ballotId: string,
  decidedBy: string,
  act: StewardAct,
): Promise<VetoRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${VETO_COLS} FROM ballot_vetoes WHERE ballot_id = ? AND decided_by = ? AND act = ?`,
    [ballotId, decidedBy, act],
  );
  return rows[0] ? rowToVeto(rows[0]) : null;
}

/**
 * Write one act, once per steward per ballot per kind.
 *
 * READ, THEN WRITE, AND REPORT WHICH HAPPENED. `affectedRows` was the obvious
 * way to answer "was this new" and it is not portable: `ON DUPLICATE KEY
 * UPDATE id = id` is a no-op update, and the two engines this platform runs on
 * disagree about whether that counts as zero rows or one. A steward being told
 * they had just vetoed something when the standing act was somebody else's is
 * not a rounding error, so the answer comes from the row instead.
 *
 * The read is not a lock and does not need to be: the unique key is
 * (ballot, steward, act), so two simultaneous taps still leave exactly one
 * row, and the loser reads the winner's row back.
 */
async function record(
  pool: Pool,
  act: StewardAct,
  input: { ballotId: string; decidedBy: string; reason: string },
): Promise<VetoResult> {
  const reason = String(input.reason ?? "").trim();
  const problem = act === "veto" ? vetoReasonProblem(reason) : noObjectionReasonProblem(reason);
  if (problem) {
    return { ok: false, error: problem, standing: await actFor(pool, input.ballotId, input.decidedBy, act) };
  }
  const before = await actFor(pool, input.ballotId, input.decidedBy, act);
  if (!before) {
    await pool.query(
      "INSERT INTO ballot_vetoes (id, ballot_id, act, decided_by, reason) VALUES (?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE id = id",
      [`bv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, input.ballotId, act, input.decidedBy, reason],
    );
  }
  const row = await actFor(pool, input.ballotId, input.decidedBy, act);
  if (!row) {
    return { ok: false, error: "The act could not be read back after it was written.", standing: null };
  }
  return { ok: true, row, fresh: !before };
}

/** Stop a carried decision, with a reason. The reason is required. */
export function recordVeto(
  pool: Pool,
  input: { ballotId: string; decidedBy: string; reason: string },
): Promise<VetoResult> {
  return record(pool, "veto", input);
}

/**
 * Say early that nothing is wrong. A courtesy, and it CLOSES NOTHING.
 *
 * The decision still lands at its landing instant and not one minute sooner,
 * and the steward who records this may still veto inside the window if they
 * see something later. Both acts stay on the record.
 */
export function recordNoObjection(
  pool: Pool,
  input: { ballotId: string; decidedBy: string; reason?: string },
): Promise<VetoResult> {
  return record(pool, "no_objection", { ...input, reason: input.reason ?? "" });
}

export type RedactionResult =
  | { ok: true; row: VetoRow; alreadyRedacted: boolean }
  | { ok: false; error: string };

/**
 * WHERE THIS LANE'S FREE TEXT LIVES, so a redaction can reach all of it.
 *
 * A veto reason is written once and stored three times, and the first build of
 * the redaction knew about one of them:
 *
 *  - `ballot_vetoes.reason`      the act itself, one row per steward
 *  - `ballots.veto_reason`       the copy the landing gate and the dashboard
 *                                read, stamped when the veto stops a landing
 *  - `mechanics_proposals.veto_reason`  the copy that goes back to the
 *                                proposer with the proposal
 *
 * A fourth column holds the same words on a different table and is NOT this
 * lane's to write: `ballot_votes.reason`, where a steward's blocking no is
 * typed. It is copied into the two `veto_reason` columns at the close, so
 * redacting the act reaches the copies; the vote row itself is the ballots
 * lane's own sweep.
 *
 * Blanking one and leaving two would be a promise kept on one page and broken
 * on the next, so every writer here names all three.
 */
export const VETO_TEXT_COLUMNS: readonly string[] = [
  "ballot_vetoes.reason",
  "ballots.veto_reason",
  "mechanics_proposals.veto_reason",
];

/** Blank the mirrored copies of one steward's veto reason on one ballot. */
async function blankVetoMirrors(pool: Pool, ballotId: string, stewardId: string): Promise<void> {
  await pool.query("UPDATE ballots SET veto_reason = '' WHERE id = ? AND vetoed_by = ?", [ballotId, stewardId]);
  await pool.query(
    "UPDATE mechanics_proposals SET veto_reason = '' WHERE vetoed_by = ? AND id IN " +
      "(SELECT subject_ref FROM ballots WHERE id = ?)",
    [stewardId, ballotId],
  );
}

/**
 * Blank the words, keep the act.
 *
 * The whole point of the split. A deleted row would say the decision was never
 * stopped, which is a lie about the village's own history. A blanked reason
 * says the decision was stopped, by this person, at this time, and the words
 * are gone. Idempotent: redacting twice reports the first redaction rather
 * than moving its timestamp.
 *
 * IT REACHES EVERY COPY. The words are stamped onto the ballot and onto the
 * proposal as well as onto the act, and the version of this that blanked only
 * the act left them rendering unchanged on the decision page and in the
 * proposer's own copy. See `VETO_TEXT_COLUMNS`.
 */
export async function redactVetoReason(
  pool: Pool,
  vetoId: string,
  redactedBy: string,
): Promise<RedactionResult> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${VETO_COLS} FROM ballot_vetoes WHERE id = ?`, [vetoId]);
  if (!rows[0]) return { ok: false, error: "No such act." };
  const before = rowToVeto(rows[0]);
  if (before.redactedAt) return { ok: true, row: before, alreadyRedacted: true };
  await pool.query(
    "UPDATE ballot_vetoes SET reason = '', redacted_at = CURRENT_TIMESTAMP, redacted_by = ? WHERE id = ? AND redacted_at IS NULL",
    [redactedBy, vetoId],
  );
  await blankVetoMirrors(pool, before.ballotId, before.decidedBy);
  const [after] = await pool.query<RowDataPacket[]>(`SELECT ${VETO_COLS} FROM ballot_vetoes WHERE id = ?`, [vetoId]);
  if (!after[0]) return { ok: false, error: "The act could not be read back after it was redacted." };
  return { ok: true, row: rowToVeto(after[0]), alreadyRedacted: false };
}

/**
 * The right-to-be-forgotten path for this module's own free text.
 *
 * `anonymizeMember` is an exhaustive local sweep and it knew nothing about
 * governance tables, so a departed member's name survived inside somebody
 * else's veto sentence on a public page. This is the sweep for this module:
 * the acts a departing member WROTE keep their shape and lose their words,
 * because the village's record of what was stopped is the village's, and the
 * words are the member's.
 *
 * IT SWEEPS EVERY COLUMN IN `VETO_TEXT_COLUMNS`, and the version that swept
 * only `ballot_vetoes` left the same sentence rendering on the decision page
 * and in the proposer's copy of the proposal. The counts are reported per
 * table so a caller can tell "nothing to blank" from "the sweep did not run"
 * on each of them separately.
 */
export async function forgetStewardActs(
  pool: Pool,
  userId: string,
): Promise<{ redacted: number; ballots: number; proposals: number }> {
  const [res] = await pool.query(
    "UPDATE ballot_vetoes SET reason = '', redacted_at = CURRENT_TIMESTAMP, redacted_by = ? " +
      "WHERE decided_by = ? AND redacted_at IS NULL",
    [userId, userId],
  );
  const [onBallots] = await pool.query(
    "UPDATE ballots SET veto_reason = '' WHERE vetoed_by = ? AND veto_reason IS NOT NULL AND veto_reason <> ''",
    [userId],
  );
  const [onProposals] = await pool.query(
    "UPDATE mechanics_proposals SET veto_reason = '' WHERE vetoed_by = ? AND veto_reason IS NOT NULL AND veto_reason <> ''",
    [userId],
  );
  const rows = (r: unknown): number => Number((r as { affectedRows?: number }).affectedRows ?? 0);
  return { redacted: rows(res), ballots: rows(onBallots), proposals: rows(onProposals) };
}

// ── The seat ────────────────────────────────────────────────────────────────

export interface StewardHolding {
  /** The role_holders row id. */
  id: string;
  roleId: string;
  roleName: string;
  userId: string;
  /** ISO, or null for a holding with no term. */
  termEndsAt: string | null;
  seasonId: string | null;
  grantedAt: string;
  lapsed: boolean;
}

/**
 * Has this holding run out?
 *
 * Pure, derived on every read, writes nothing. A null term never lapses, which
 * is why 0134 could add the column to every existing village without taking a
 * single power away.
 */
export function holdingHasLapsed(
  h: { termEndsAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!h.termEndsAt) return false;
  const ends = h.termEndsAt instanceof Date ? h.termEndsAt : new Date(String(h.termEndsAt));
  if (Number.isNaN(ends.getTime())) return false;
  return ends.getTime() <= now.getTime();
}

/**
 * A term's end, as an instant, computed from the cycle clock.
 *
 * THE ONE NAMED HELPER, and everything that stamps a term goes through it.
 * The clock lane owns `CycleClock` and will own `termEndAfter`; until that
 * merges, this reads `shared/lunar.ts` directly and is the single place that
 * has to change when it does.
 *
 * Cycles rather than days because a village's rhythm is the moon by default
 * and a term expressed in days drifts off the boundary a member is watching.
 * The instant returned is the START of the cycle `cycles` ahead, which is a
 * new moon under the lunar clock: the seat ends when a cycle turns, which is
 * when everything else in this Game turns.
 */
export function termEndsAtFromCycles(cycles: number, from: Date = new Date()): Date {
  const n = Math.max(1, Math.floor(Number(cycles) || 1));
  const here = cycleBoundsFor(from);
  /*
   * CEILED, and the millisecond matters. `cycleStartMs` answers in fractional
   * milliseconds and `new Date()` truncates, so the obvious
   * `cycleBoundsByNumber(k + n).startsAt` lands a fraction of a millisecond
   * BEFORE the boundary it names. Read back through `cycleBoundsFor` that
   * instant belongs to the previous cycle, so a term written that way ends one
   * whole lunation before the moon a member was told to expect.
   */
  return new Date(Math.ceil(cycleStartMs(here.cycleNumber + n)));
}

/** How many cycles a fresh steward seat runs for before the village re-seats. */
export const DEFAULT_TERM_CYCLES = 3;

/**
 * Every role that carries the veto, read from the roles table.
 *
 * Read in JS rather than through a JSON predicate in SQL, because the two
 * engines this runs on spell JSON containment differently and the roles table
 * is a handful of rows. The seat is not always the role named `steward`: a
 * village may grant the power to a role it named itself, and every guard here
 * has to see that role or it would leave the real seat unprotected.
 */
export async function rolesCarryingVeto(pool: Pool): Promise<Map<string, string>> {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id, name, capabilities FROM roles");
  const out = new Map<string, string>();
  for (const r of rows) {
    if (roleCapabilityList(r.capabilities).includes(STEWARD_VETO)) out.set(String(r.id), String(r.name ?? r.id));
  }
  return out;
}

/**
 * A role's capabilities as a list of strings, however the driver hands them
 * over. MySQL returns a JSON column as a parsed value on one driver version
 * and as a string on another, and a role whose capabilities failed to parse
 * must read as EMPTY rather than as a throw: a boot that dies on one malformed
 * row takes the whole village down over a permission list.
 */
export function roleCapabilityList(raw: unknown): string[] {
  let caps: unknown = raw;
  if (typeof caps === "string") {
    try {
      caps = JSON.parse(caps);
    } catch {
      caps = [];
    }
  }
  return Array.isArray(caps) ? caps.map(String) : [];
}

/**
 * Who holds the seat right now, lapsed holdings included and marked.
 *
 * Lapsed rows are RETURNED rather than filtered, because the vacancy surface
 * has to be able to say "Wren held this until the 3rd" instead of showing an
 * empty list that reads as though nobody ever did.
 */
export async function stewardsSeated(pool: Pool, now: Date = new Date()): Promise<StewardHolding[]> {
  const roles = await rolesCarryingVeto(pool);
  if (roles.size === 0) return [];
  const ids = Array.from(roles.keys());
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, role_id, user_id, granted_at, term_ends_at, season_id FROM role_holders " +
      `WHERE role_id IN (${ids.map(() => "?").join(",")}) ORDER BY granted_at, id`,
    ids,
  );
  return rows.map((r) => ({
    id: String(r.id),
    roleId: String(r.role_id),
    roleName: roles.get(String(r.role_id)) ?? String(r.role_id),
    userId: String(r.user_id),
    termEndsAt: iso(r.term_ends_at),
    seasonId: r.season_id === null || r.season_id === undefined ? null : String(r.season_id),
    grantedAt: iso(r.granted_at) ?? "",
    lapsed: holdingHasLapsed({ termEndsAt: r.term_ends_at as Date | null }, now),
  }));
}

// ── Does a veto stand? ──────────────────────────────────────────────────────

export interface VetoStanding {
  /** True when this decision is blocked right now. */
  stands: boolean;
  /** Vetoes counted, by people who hold a steward-capable seat. */
  vetoes: number;
  /** How many vetoes it takes here. One, or a majority under a council. */
  needed: number;
  /** Seats filled and unlapsed right now. */
  seated: number;
  /** True when the village runs a Steward Council. */
  council: boolean;
  /** The user ids whose vetoes were counted, in the order they were cast. */
  by: string[];
  /** The rows behind the count, so a surface can name and quote them. */
  rows: VetoRow[];
  /** One plain sentence, fit to render. */
  sentence: string;
}

/**
 * THE ONE FUNCTION THE DISPATCHER ASKS. Is this decision blocked?
 *
 * The founder: "no any single steward has the ability to veto though we could
 * add a 'Steward Council' option that makes it a majority of them". So the
 * arity is a setting, off by default, and both readings live here rather than
 * in the dispatcher, the surfaces and the document separately.
 *
 * WHOSE VETO COUNTS. A veto is written by a route that has already asked the
 * gate whether its author may veto, so entitlement was proved at the moment of
 * the act. What is re-checked at read time is only that the author still
 * appears on a steward-capable seat, lapsed or not: a term running out ends
 * the powers going forward, and it does not un-say something the person said
 * while they held them. A veto by somebody who was never on the seat is not
 * counted, which is the case that matters if a row is ever written by hand.
 *
 * WITH A COUNCIL AND NO SEATS FILLED, `needed` floors at one. Dividing an
 * empty council by two would make the majority zero, and a threshold of zero
 * would mark every decision blocked with nobody having blocked anything.
 */
export async function stewardVetoStands(
  pool: Pool,
  ballotId: string,
  now: Date = new Date(),
): Promise<VetoStanding> {
  const holdings = await stewardsSeated(pool, now);
  const everHeld = new Set(holdings.map((h) => h.userId));
  const seated = holdings.filter((h) => !h.lapsed).length;
  const council = boolVar(STEWARD_COUNCIL_KEY);
  const needed = council ? Math.max(1, Math.floor(seated / 2) + 1) : 1;
  const rows = (await vetoesFor(pool, ballotId)).filter((r) => r.act === "veto" && everHeld.has(r.decidedBy));
  const stands = rows.length >= needed;

  let sentence: string;
  if (stands && council) {
    sentence = `${rows.length} of ${seated} seated steward${seated === 1 ? "" : "s"} stopped this, which is the majority a council needs.`;
  } else if (stands) {
    sentence = "A steward stopped this, and said why.";
  } else if (rows.length > 0) {
    sentence = `${rows.length} steward${rows.length === 1 ? "" : "s"} objected, and a council here needs ${needed}. This still lands.`;
  } else {
    sentence = "No steward has stopped this.";
  }

  return { stands, vetoes: rows.length, needed, seated, council, by: rows.map((r) => r.decidedBy), rows, sentence };
}

// ── A steward's no, on a token send ─────────────────────────────────────────

/**
 * Is this steward the person the decision is ABOUT?
 *
 * `role_seat` and `role_unseat` freeze `subject_ref` as `userId@roleId`, and a
 * few subjects carry a bare user id. Both shapes are matched, and nothing else
 * is guessed: a guess here decides whether a seat can fail the ballot that
 * removes it, which is exactly the hole the wider reading of 19D left open.
 */
export function stewardIsSubjectOf(
  ballot: { subjectRef?: string | null },
  userId: string,
): boolean {
  const ref = String(ballot.subjectRef ?? "").trim();
  const who = String(userId ?? "").trim();
  if (!ref || !who) return false;
  return ref === who || ref.startsWith(`${who}@`);
}

export interface StewardNoInput {
  ballot: { subjectType: string; subjectRef?: string | null; itemKinds?: readonly string[] };
  /** Every vote cast, with the reason the voter wrote, if any. */
  votes: readonly { userId: string; choice: string; reason?: string | null }[];
  /** The seats filled and unlapsed at the close. */
  seated: readonly { userId: string }[];
  /** True when the village runs a Steward Council. */
  council: boolean;
}

export interface StewardNoVerdict {
  /** True when the ballot fails at the close because a steward said no. */
  blocks: boolean;
  /** What kind of decision this is, as the classification table reads it. */
  kind: GovernanceKind;
  /** The stewards whose no was counted, in the order they voted. */
  stewardIds: string[];
  /** Their reasons, joined. Empty exactly when nothing blocks. */
  reason: string;
  /** How many counted noes it takes here. One, or a majority under a council. */
  needed: number;
  /** Seats filled and unlapsed when it was counted. */
  seated: number;
  /**
   * Stewards who voted no and were NOT counted, with the reason each was
   * left out. Their vote still weighs in the tally like anyone's; what it
   * does not do is fail the ballot on its own.
   */
  uncounted: Array<{ userId: string; because: string }>;
  /** One plain sentence, fit to render. */
  sentence: string;
}

/**
 * A SEATED STEWARD'S NO FAILS A TOKEN SEND, AND NOTHING ELSE.
 *
 * The founder: "However if a steward votes down on a token payment proposal
 * than it fails automatically." The Phase 1b build widened that to every
 * ballot, and the second audit named what the wider reading costs: one seat
 * holding a silent, unappealable kill switch over the whole village, the
 * ballot that would remove them included. So four narrowings, and each one is
 * a rule rather than a taste:
 *
 *  1. TOKEN SENDS ONLY. A Game change already has a window and a veto with a
 *     reason on the record; it does not need a second, quieter door.
 *  2. NEVER A BALLOT THE STEWARD IS THE SUBJECT OF. The seat cannot fail its
 *     own removal by voting, any more than it can veto it.
 *  3. THE NO CARRIES A REASON, held to the veto's own rule. A payout dying
 *     without the village being told why is the defect the reason requirement
 *     exists to close, and choices are hidden by default, so without this the
 *     block is invisible as well as silent.
 *  4. IT IS EVALUATED AT THE CLOSE, never the moment the vote is cast. A rule
 *     that fires on the cast cannot compose with the council majority or with
 *     "a ballot passes when its window ends".
 *
 * THE STEWARD'S OWN WEIGHT COUNTS IN THE TALLY LIKE ANYBODY'S. Nothing here
 * removes a vote. The block sits on top of an outcome the engine already
 * computed, so a ballot that failed on the numbers failed on the numbers.
 *
 * Pure, and every fact it needs is passed in: the caller reads the votes, the
 * seats and the setting, and this decides. The row is written as a veto by the
 * caller, so the override at the highest set tier and the dashboard's blocked
 * payouts both reach it.
 */
export function stewardNoBlocks(input: StewardNoInput): StewardNoVerdict {
  const kind: GovernanceKind = input.ballot.itemKinds
    ? kindOfSet(input.ballot.itemKinds)
    : kindOfSubject(input.ballot.subjectType);
  const seated = input.seated.length;
  const needed = input.council ? Math.max(1, Math.floor(seated / 2) + 1) : 1;
  const empty = (sentence: string): StewardNoVerdict => ({
    blocks: false,
    kind,
    stewardIds: [],
    reason: "",
    needed,
    seated,
    uncounted: [],
    sentence,
  });

  if (kind !== "token_send") {
    return empty(
      "A steward's no does not fail a Game change. It waits out its window, and a steward who wants it stopped vetoes it there.",
    );
  }
  if (seated === 0) return empty("No steward holds the seat, so nobody here can fail a payment.");

  const seats = new Set(input.seated.map((h) => h.userId));
  const counted: string[] = [];
  const reasons: string[] = [];
  const uncounted: Array<{ userId: string; because: string }> = [];
  for (const v of input.votes) {
    if (v.choice !== "no" || !seats.has(v.userId)) continue;
    if (stewardIsSubjectOf(input.ballot, v.userId)) {
      uncounted.push({
        userId: v.userId,
        because: "This decision is about them, so their no weighs in the tally and stops nothing on its own.",
      });
      continue;
    }
    const problem = vetoReasonProblem(v.reason);
    if (problem) {
      uncounted.push({
        userId: v.userId,
        because: "They gave no reason, and a steward's block carries one the way a veto does.",
      });
      continue;
    }
    counted.push(v.userId);
    reasons.push(String(v.reason).trim());
  }

  if (counted.length === 0) {
    return {
      ...empty(
        uncounted.length > 0
          ? "A steward voted against this one and it does not fail on that vote alone. The reason is beside their name."
          : "No steward voted against this one.",
      ),
      uncounted,
    };
  }
  if (counted.length < needed) {
    return {
      ...empty(
        `${counted.length} of ${seated} seated stewards voted against this one, and a council here needs ${needed}. It closes on the numbers.`,
      ),
      uncounted,
    };
  }
  return {
    blocks: true,
    kind,
    stewardIds: counted,
    reason: reasons.join(" / "),
    needed,
    seated,
    uncounted,
    sentence:
      counted.length === 1
        ? "A steward voted against this payment, so it does not carry, and they said why."
        : `${counted.length} of ${seated} seated stewards voted against this payment, which is the majority a council needs.`,
  };
}

/** Does this member hold a seat that can stop a carried decision, right now? */
export async function holdsStewardSeat(pool: Pool, userId: string, now: Date = new Date()): Promise<boolean> {
  const holdings = await stewardsSeated(pool, now);
  return holdings.some((h) => !h.lapsed && h.userId === userId);
}

/**
 * THE "OFF" PREFERENCE IS REFUSED WHILE SOMEBODY HOLDS THE SEAT.
 *
 * The three window notices are pinned to "immediate" in `emailCadenceFor`, and
 * a pin nobody may switch off is only half the rule: the other half is that a
 * seated steward cannot quietly turn governance mail off and then miss the one
 * warning anybody gets before a carried decision lands. So the preference
 * route asks this before it writes.
 *
 * It queries only when the write actually wants silence, so an ordinary
 * preference save costs nothing. Returns the sentence to refuse with, or null
 * to carry on, and the sentence names the door: a seat is handed back through
 * a `role_unseat` ballot, and then the preference is theirs again.
 */
export async function stewardMailRefusal(
  pool: Pool,
  userId: string,
  incoming: unknown,
): Promise<string | null> {
  const n = (incoming ?? {}) as Record<string, unknown>;
  if (n.emailsOff !== true && n.governanceEmail !== "off") return null;
  if (!(await holdsStewardSeat(pool, userId))) return null;
  return (
    "You hold a seat that can stop a decision the village has already carried, and the notice that your window " +
    "is open is the only warning anybody gets. Governance mail stays on while you hold that seat. A role_unseat " +
    "ballot hands it back, and then this is yours to turn off."
  );
}

export interface VacancyState {
  /** True when at least one unlapsed holding carries the veto. */
  seated: boolean;
  /** Every holding on the seat, lapsed ones marked, in the order they began. */
  holdings: StewardHolding[];
  /** Holdings whose term ran out, so the surface can name who it was. */
  lapsed: StewardHolding[];
  /** True when the village still leaves its stewards something to stop. */
  stillAsked: boolean;
  /** True when the village runs a Steward Council. */
  council: boolean;
  /**
   * A village with no steward and self-executing agreements is HEALTHY. True
   * means this empty seat is a choice the village made, not a gap.
   */
  healthy: boolean;
  /** One plain sentence, fit to render on its own. Never a warning. */
  sentence: string;
}

/**
 * Who holds the seat, and what to say when nobody does.
 *
 * NOTHING WAITS. The old sentence for an empty seat was "proposals wait",
 * which was true under the approval model and is a lie under this one. A
 * village with no steward has nobody who can veto, and its decisions land at
 * their landing time exactly as they would with the seat filled. That is the
 * sentence, and it is not a warning.
 */
export async function vacancyState(pool: Pool, now: Date = new Date()): Promise<VacancyState> {
  const holdings = await stewardsSeated(pool, now);
  const live = holdings.filter((h) => !h.lapsed);
  const lapsed = holdings.filter((h) => h.lapsed);
  const stillAsked = stewardMayVetoAnything();
  const council = boolVar(STEWARD_COUNCIL_KEY);
  const seated = live.length > 0;

  let sentence: string;
  if (seated && live.length === 1) {
    sentence = "One steward holds the seat, and can stop a decision inside its window.";
  } else if (seated && council) {
    sentence = `${live.length} stewards hold the seat, and a majority of them can stop a decision inside its window.`;
  } else if (seated) {
    sentence = `${live.length} stewards hold the seat, and any one of them can stop a decision inside its window.`;
  } else if (stillAsked) {
    sentence = "No steward holds the seat; Game changes land at their landing time.";
  } else {
    sentence =
      "No steward holds the seat, and nothing here can be stopped by one. This village's agreements carry themselves.";
  }

  return { seated, holdings, lapsed, stillAsked, council, healthy: !seated, sentence };
}

// ── Seating the catalysts at the Birthing ───────────────────────────────────

export interface SeasonTurn {
  /** The season running when the seating is made, or null. */
  currentSeasonId: string | null;
  /** True when the running season has no end date at all. */
  openEnded?: boolean;
  /** How many cycles the term runs. Defaults to DEFAULT_TERM_CYCLES. */
  termCycles?: number;
  /** The instant the term is measured from. Defaults to now. */
  now?: Date;
}

export interface SeatingReport {
  /** True when the run completed. False means the caller could not tell. */
  ok: boolean;
  /** The role was created by this call rather than found. */
  roleCreated: boolean;
  /** The veto was added to the role by this call. */
  capabilityGranted: boolean;
  /**
   * The veto was handed to the village by this call, so an administrator now
   * meets the break-glass door on it instead of walking through.
   */
  holdingMoved: boolean;
  /** User ids seated by this call. Empty means nothing to do, not a failure. */
  seated: string[];
  /** User ids that already held the seat, so this call left them alone. */
  alreadySeated: string[];
  /** The term written on every new seating, as an ISO instant. */
  termEndsAt: string | null;
  /** Present only when ok is false. */
  error?: string;
}

/**
 * Seat every catalyst as a steward, once, with a term that really ends.
 *
 * Called by the launch closer after the Birthing carries. The founder's rule:
 * the catalysts INHERIT the seat rather than standing for it, and then have to
 * be voted back in, which is what makes relinquishment automatic rather than
 * an act of virtue. Nobody has to decide they are ready to give up power; they
 * have to be re-granted it.
 *
 * THE TERM IS COMPUTED FROM THE CLOCK, NOT FROM THE SEASON. The audit of
 * 2026-09-03 traced the old path: the term was "the next season turn", seasons
 * are an ungoverned admin list, both shipped entries end on one date, and a
 * founding season is documented as open-ended. A term hung on that list never
 * comes due, and the term is the only backstop on a seat that can veto.
 *
 * AND IT REFUSES AN OPEN-ENDED SEASON outright, rather than seating anybody
 * against a calendar that will not turn. A village whose season has no end has
 * not decided its own rhythm yet, and seating a steward there writes a mandate
 * whose end nobody agreed to. The refusal is the loud version of the thing the
 * old code did quietly.
 *
 * EVERY WRITE IS IDEMPOTENT. The role is found or created, the capability is a
 * set union, and the seating is `INSERT ... ON DUPLICATE KEY UPDATE` against
 * the `(role_id, user_id)` unique key from 0002. Calling this twice seats
 * nobody twice, which matters because a close can be retried and because the
 * launch closer runs outside a transaction.
 *
 * THE CALLER MUST RELOAD THE ROLE CACHES. `roles` and `role_holders` are
 * served from an in-process cache built at boot (`rolesRepo`,
 * `roleHoldersRepo` in server/index.ts), and this writes SQL underneath it. A
 * caller that does not call `rolesRepo.load()` and `roleHoldersRepo.load()`
 * after a report with `roleCreated` or a non-empty `seated` will serve the old
 * answer until the process restarts, and the capability gate reads that cache.
 */
export async function seatCatalystsAsStewards(
  pool: Pool,
  launchBallotId: string,
  turn: SeasonTurn = { currentSeasonId: null },
): Promise<SeatingReport> {
  const now = turn.now ?? new Date();
  const termDate = termEndsAtFromCycles(turn.termCycles ?? DEFAULT_TERM_CYCLES, now);
  const base: SeatingReport = {
    ok: true,
    roleCreated: false,
    capabilityGranted: false,
    holdingMoved: false,
    seated: [],
    alreadySeated: [],
    termEndsAt: termDate.toISOString(),
  };

  if (turn.openEnded) {
    return {
      ...base,
      ok: false,
      termEndsAt: null,
      error:
        "This village's season has no end date, so a steward's term would have nothing to end it. " +
        "Give the season an end, or start the next one, and seat the stewards after that.",
    };
  }

  // 1. Find or create the role. A village that already renamed it keeps its
  //    name: only the slug is looked up, and the name column is never
  //    overwritten by this call.
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id, name, capabilities FROM roles WHERE id = ?",
    [STEWARD_ROLE_ID],
  );
  if (!existing[0]) {
    await pool.query(
      "INSERT INTO roles (id, name, description, capabilities, sort_order) VALUES (?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE id = id",
      [
        STEWARD_ROLE_ID,
        STEWARD_ROLE_NAME,
        "Can stop a decision the village has already carried, inside the window before it lands, and has to say why. Training wheels: a village that no longer needs the seat lets it stand empty, and its decisions land the same way.",
        JSON.stringify([STEWARD_VETO]),
        0,
      ],
    );
    base.roleCreated = true;
    base.capabilityGranted = true;
  } else {
    const list = roleCapabilityList(existing[0].capabilities);
    if (!list.includes(STEWARD_VETO)) {
      await pool.query("UPDATE roles SET capabilities = ? WHERE id = ?", [
        JSON.stringify([...list, STEWARD_VETO]),
        STEWARD_ROLE_ID,
      ]);
      base.capabilityGranted = true;
    }
  }

  /*
   * 2. HAND THE VETO TO THE VILLAGE, and this is the step whose absence made
   *    the whole seat decorative.
   *
   *    `capability_holding` is what turns an admin's silent yes into a
   *    break-glass with a public record: `isVillageHeld` reads that table, and
   *    a capability the table does not name lets any administrator through the
   *    gate as an ordinary admin, with nothing anywhere saying they reached
   *    past anybody. So a village could seat a steward, grant them the veto,
   *    and every admin account would still be able to stop a decision without
   *    the village ever hearing about it. Granting the role the power and
   *    moving the holding are two acts by design (see capabilityHolding.ts),
   *    and for THIS key they have to happen together, because the point of the
   *    seat is that it holds the village's last word.
   *
   *    Idempotent on the capability, and it refuses rather than throws, so a
   *    retried close moves nothing twice and a refusal is reported instead of
   *    aborting a launch that has already carried.
   */
  const moved = await moveCapabilityToVillage(pool, {
    capability: STEWARD_VETO,
    holderRoleId: STEWARD_ROLE_ID,
    movedByBallotId: launchBallotId,
    note: "The village's own last word on a decision it carried.",
  });
  base.holdingMoved = moved.ok;
  if (!moved.ok) base.error = moved.error;

  // 3. Every catalyst. The stored role value is `founder`; the word a player
  //    reads is Catalyst, and this query is not a surface a player reads.
  const [catalysts] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM users WHERE role = 'founder' ORDER BY id",
  );
  const [held] = await pool.query<RowDataPacket[]>(
    "SELECT user_id FROM role_holders WHERE role_id = ?",
    [STEWARD_ROLE_ID],
  );
  const already = new Set(held.map((r) => String(r.user_id)));

  for (const c of catalysts) {
    const userId = String(c.id);
    if (already.has(userId)) {
      base.alreadySeated.push(userId);
      continue;
    }
    /*
     * BOUND AS A Date, NEVER AS THE ISO STRING. MySQL refuses
     * `2026-12-01T00:00:00.000Z` for a `timestamp` column outright, so passing
     * a string through made every seating throw, inside a launch closer that
     * runs with no transaction around it.
     *
     * The ballot is the grantor, the same way a role_seat ballot is. A holding
     * whose granted_by is a ballot id reads back as "the village put them
     * here" rather than as an administrator's hand.
     */
    await pool.query(
      "INSERT INTO role_holders (id, role_id, user_id, granted_by, term_ends_at, season_id) VALUES (?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE role_id = role_id",
      [
        `rh-steward-${userId}`.slice(0, 64),
        STEWARD_ROLE_ID,
        userId,
        launchBallotId,
        termDate,
        turn.currentSeasonId,
      ],
    );
    await recordTermStarted(pool, {
      roleId: STEWARD_ROLE_ID,
      userId,
      termEndsAt: termDate,
      seasonId: turn.currentSeasonId,
      startedAt: now,
    });
    base.seated.push(userId);
  }

  return base;
}

// ── The per-term history (0139) ─────────────────────────────────────────────

export interface TermRow {
  id: string;
  roleId: string;
  userId: string;
  termStartedAt: string;
  termEndsAt: string | null;
  seasonId: string | null;
  endedAt: string | null;
  endedBy: string | null;
}

/**
 * Write one term into the history.
 *
 * `role_holders` carries UNIQUE (role_id, user_id), so it can hold the CURRENT
 * term and no other. Seat somebody, let the term lapse, seat them again next
 * season, and the second seating overwrites the first with nothing left to
 * read. This table is where the first one survives.
 *
 * Idempotent on the OPEN term: a retried close finds the term it already
 * opened for this seat and writes nothing rather than growing a second row for
 * one mandate.
 */
export async function recordTermStarted(
  pool: Pool,
  input: {
    roleId: string;
    userId: string;
    termEndsAt: Date | null;
    seasonId: string | null;
    startedAt?: Date;
  },
): Promise<{ id: string; fresh: boolean }> {
  const open = await openTermFor(pool, input.roleId, input.userId);
  if (open) return { id: open.id, fresh: false };
  const id = `rht-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    "INSERT INTO role_holder_terms (id, role_id, user_id, term_started_at, term_ends_at, season_id) VALUES (?,?,?,?,?,?)",
    [id, input.roleId, input.userId, input.startedAt ?? new Date(), input.termEndsAt, input.seasonId],
  );
  return { id, fresh: true };
}

const TERM_COLS = "id, role_id, user_id, term_started_at, term_ends_at, season_id, ended_at, ended_by";

function rowToTerm(r: RowDataPacket): TermRow {
  return {
    id: String(r.id),
    roleId: String(r.role_id),
    userId: String(r.user_id),
    termStartedAt: iso(r.term_started_at) ?? "",
    termEndsAt: iso(r.term_ends_at),
    seasonId: r.season_id === null || r.season_id === undefined ? null : String(r.season_id),
    endedAt: iso(r.ended_at),
    endedBy: r.ended_by === null || r.ended_by === undefined ? null : String(r.ended_by),
  };
}

/** The term on this seat that has not been closed, or null. */
export async function openTermFor(pool: Pool, roleId: string, userId: string): Promise<TermRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${TERM_COLS} FROM role_holder_terms WHERE role_id = ? AND user_id = ? AND ended_at IS NULL ` +
      "ORDER BY term_started_at DESC, id DESC",
    [roleId, userId],
  );
  return rows[0] ? rowToTerm(rows[0]) : null;
}

/** Every term this seat has ever held, oldest first. */
export async function termHistoryFor(pool: Pool, roleId: string, userId: string): Promise<TermRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${TERM_COLS} FROM role_holder_terms WHERE role_id = ? AND user_id = ? ORDER BY term_started_at, id`,
    [roleId, userId],
  );
  return rows.map(rowToTerm);
}

/**
 * Close the open term on a seat.
 *
 * `endedBy` is the ballot id or user id that ended it, or null when the date
 * ended it and nobody did. That is the distinction a village reads a year
 * later: a term that reached its end is not the same fact as a term somebody
 * cut short, and the two must never render alike.
 */
export async function recordTermEnded(
  pool: Pool,
  input: { roleId: string; userId: string; endedAt?: Date; endedBy?: string | null },
): Promise<{ ended: boolean }> {
  const open = await openTermFor(pool, input.roleId, input.userId);
  if (!open) return { ended: false };
  await pool.query("UPDATE role_holder_terms SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL", [
    input.endedAt ?? new Date(),
    input.endedBy ?? null,
    open.id,
  ]);
  return { ended: true };
}

// ── The daily watch ─────────────────────────────────────────────────────────

export interface ExpiringHolding {
  id: string;
  roleId: string;
  roleName: string;
  userId: string;
  termEndsAt: string;
  /** Negative once the term has passed. */
  daysLeft: number;
  ended: boolean;
}

/**
 * Permission-plane holdings whose term has run out or is about to.
 *
 * The sibling of `expiringSeatings` in server/lib/orgChart.ts, which asks the
 * same question of the org chart. Two planes, two queries, on purpose: they
 * hold different rows and only one of them carries powers.
 */
export async function expiringHoldings(
  pool: Pool,
  withinDays = 14,
  now: Date = new Date(),
): Promise<ExpiringHolding[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT h.id, h.role_id, h.user_id, h.term_ends_at, r.name AS role_name FROM role_holders h " +
      "LEFT JOIN roles r ON r.id = h.role_id " +
      "WHERE h.term_ends_at IS NOT NULL AND h.term_ends_at <= ? ORDER BY h.term_ends_at, h.id",
    [new Date(now.getTime() + withinDays * 86400000)],
  );
  return rows.map((r) => {
    const ends = r.term_ends_at instanceof Date ? r.term_ends_at : new Date(String(r.term_ends_at));
    return {
      id: String(r.id),
      roleId: String(r.role_id),
      roleName: String(r.role_name ?? r.role_id),
      userId: String(r.user_id),
      termEndsAt: ends.toISOString(),
      daysLeft: Math.ceil((ends.getTime() - now.getTime()) / 86400000),
      ended: ends.getTime() <= now.getTime(),
    };
  });
}

/** What the job needs, handed in, so this stays a function of its inputs. */
export interface TermWatchDeps {
  pool: Pool;
  notify(input: {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
    dedupeKey: string;
  }): Promise<{ fresh: boolean }>;
  notifyAdmins(type: string, title: string, dedupeKey: string, link?: string): Promise<void>;
  /** Org-chart seatings ending soon, already computed by the caller. */
  seatings: Array<{ id: string; holderKind: string; userId: string | null; roleName: string; daysLeft: number | null; lapsed?: boolean }>;
  /**
   * The season payload, or undefined when the caller could not read one.
   * `undefined` and `{ current: null }` are DIFFERENT ANSWERS and the report
   * keeps them apart: one is "no season is running", which is loud, and the
   * other is "this sweep could not tell", which is louder.
   */
  season?: { current: unknown | null; openEnded?: boolean };
  now?: Date;
}

export interface TermWatchReport {
  /** Holders told, across both planes. */
  holdersTold: number;
  /** Holdings whose term has already ended. */
  lapsed: number;
  /** True when a season is running. False is the loud condition. */
  seasonRunning: boolean;
  /** False when the caller handed no season at all, so nothing could be read. */
  seasonKnown: boolean;
  /** One sentence about the calendar, always printable. */
  seasonSentence: string;
  /** False only when a sweep could not run. Distinguishes none from unknown. */
  ok: boolean;
}

/**
 * The daily term watch, both planes, plus the loud calendar.
 *
 * NOTHING QUEUES ANY MORE, so the old loud condition is gone: there is no such
 * thing as a decision waiting for a steward. What is loud instead is the
 * CALENDAR, and the audit of 2026-09-03 is why. The term is the only backstop
 * on a seat that can veto a decision the village carried, and the terms this
 * village writes are computed from the moon while the seasons are an admin
 * list that can simply run out. A village with no season running is a village
 * whose own rhythm has stopped, and the seat's mandate is measured against it,
 * so an admin hears about it every day until somebody starts the next one.
 *
 * "No season is running" and "this sweep could not read the calendar" are
 * different sentences, and both are said out loud.
 */
export async function runTermWatch(deps: TermWatchDeps): Promise<TermWatchReport> {
  const now = deps.now ?? new Date();
  const seasonKnown = deps.season !== undefined;
  const seasonRunning = seasonKnown ? !!deps.season?.current : false;
  const report: TermWatchReport = {
    holdersTold: 0,
    lapsed: 0,
    seasonRunning,
    seasonKnown,
    seasonSentence: !seasonKnown
      ? "the calendar could not be read on this sweep, so no term can be measured against it"
      : !seasonRunning
        ? "no season is running, so nothing turns and every term is measured against a calendar that has stopped"
        : deps.season?.openEnded
          ? "the running season has no end date, so no new steward can be seated against it"
          : "a season is running",
    ok: true,
  };

  // Plane one: org-chart seatings. This plane carries no capabilities, so its
  // copy stays about the mandate and says so rather than making a claim about
  // powers that would be false one plane over.
  for (const a of deps.seatings) {
    if (a.holderKind !== "member" || !a.userId) continue;
    const ended = !!a.lapsed;
    const r = await deps.notify({
      userId: a.userId,
      type: "term_expiring",
      title: ended
        ? `Your term on ${a.roleName} has ended`
        : `Your term on ${a.roleName} ends in ${a.daysLeft} day(s)`,
      body: ended
        ? "The agreement to keep holding this seat unasked has run out. This seat carries no permissions of its own, so nothing has been switched off, and it is the moment to say whether you want to carry on."
        : "This is the nudge to say whether you want to carry on, while there is still time to arrange it.",
      link: "/roles",
      dedupeKey: `${ended ? "term-ended" : "term-soon"}:${a.id}`,
    });
    if (r.fresh) report.holdersTold += 1;
  }

  // Plane two: permission holdings. Here a term really does end the powers,
  // so the copy says it plainly. The founder: "If they're not voted back in
  // then they expire when they expire!"
  for (const h of await expiringHoldings(deps.pool, 14, now)) {
    if (h.ended) report.lapsed += 1;
    const r = await deps.notify({
      userId: h.userId,
      type: "term_expiring",
      title: h.ended
        ? `Your term as ${h.roleName} has ended`
        : `Your term as ${h.roleName} ends in ${h.daysLeft} day(s)`,
      body: h.ended
        ? "The seat has ended, and the powers that came with it have ended with it. Nothing was taken from you by anybody; the term simply reached its date. The village seats you again if it wants you to carry on."
        : "When the date arrives the seat ends, and the powers that came with it end too. Nothing renews on its own.",
      link: "/roles",
      dedupeKey: `${h.ended ? "perm-term-ended" : "perm-term-soon"}:${h.id}`,
    });
    if (r.fresh) report.holdersTold += 1;
  }

  /*
   * THE LOUD CALENDAR. Keyed on the day, so an admin hears it once a day and
   * not once a sweep, and it keeps arriving until somebody fixes the calendar
   * rather than arriving once and being forgotten.
   */
  if (!seasonRunning) {
    await deps.notifyAdmins(
      "season",
      seasonKnown
        ? "No season is running, and every term is measured against the calendar"
        : "The calendar could not be read, and every term is measured against it",
      `season-stopped:${now.toISOString().slice(0, 10)}`,
      "/admin?tab=seasons",
    );
  }

  return report;
}
