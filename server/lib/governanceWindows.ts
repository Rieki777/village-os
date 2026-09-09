/**
 * GOVERNANCE WINDOWS: when a village will let a proposal be OPENED.
 *
 * ── THE RULING ─────────────────────────────────────────────────────────────
 *
 * 2026-09-03: "we can also block all proposals from not happening within
 * defined governance windows. Some can be 'always open' but some can have set
 * windows (like the last week of every month or last 2 weeks of every season
 * or whatever) but those two are the default choices we offer to guide."
 *
 * 2026-09-03, later: "governance 'Months' are lunar months starting and ending
 * with the moon as the default." So "the last week of every month" means the
 * last seven days of the ACTIVE clock's cycle, which is the moon until a
 * village votes for something else.
 *
 * ── THE WINDOW GATES THE OPENING ONLY ──────────────────────────────────────
 *
 * A window decides whether a ballot may be OPENED. It never closes one that is
 * already running, and it never touches a vote already cast. Two reasons, and
 * both of them are about a village being able to answer itself:
 *
 *  1. A ballot that vanished when the calendar turned would delete votes
 *     people had already cast, which is the one thing a decision engine may
 *     never do.
 *  2. The whole objection loop (a resubmission, a withdraw and rewrite, a veto
 *     override, a renewal of a trial) travels through the same publish path. A
 *     window that closed a running vote would leave a village unable to answer
 *     a steward for weeks.
 *
 * The second point is also why anything COMING BACK is let through outside its
 * window for `governance.window_grace_days`: the village has already been asked
 * once, and the window was never meant to be a gag.
 *
 * ── EVALUATED PER ELEMENT, THE STRICTEST APPLIES ───────────────────────────
 *
 * A change set is one proposal carrying up to twelve typed items, and the items
 * are priced per element already (`criticalityOfItems` takes the highest floor).
 * The window follows the same rule, for the same reason: without it a mode
 * switch rides into an open week under a brand rename's always-open window. So
 * the effective window is the INTERSECTION of every element's window, and the
 * refusal names which element narrowed it and when that element next opens.
 *
 * ── THE THREE CLOCKS THAT HAVE TO AGREE ────────────────────────────────────
 *
 * A window (days of a cycle or a season), a vote (`governance.vote_days`) and a
 * steward's window (`governance.veto_hours`) all measure the same calendar, and
 * a village can set them so that nothing can ever pass:
 *
 *  - a window no longer than the vote refuses every opening forever, so
 *    `windowShapeProblem` refuses the SETTING with the arithmetic in it;
 *  - an opening whose vote would close after the window shuts is refused at
 *    open, naming the close date and the window's end;
 *  - `veto_hours` longer than one cycle would put a steward's window past the
 *    boundary the change was timed to, so `vetoHoursProblem` refuses it and
 *    `cappedVetoHours` is the read a caller can trust whatever is stored.
 *
 * ── WHAT IS DELIBERATELY NOT WINDOWED ──────────────────────────────────────
 *
 * The Birthing and an advisory vote. A village cannot start before it has
 * started, and a vote that changes nothing needs no gate. Both are absent from
 * `WINDOW_KINDS`, and absence means always open, the same safe direction
 * `shared/ballotSubjects.ts` takes for a subject it has never heard of.
 */
import { LUNAR_CLOCK, type CycleClock } from "../../shared/cycleClock";
import { GOVERNANCE_MODE, MINT_RULE, SUBJECT_FOR_ITEM_KIND } from "../../shared/ballotSubjects";
import { governanceWindowSyntaxProblem } from "../../shared/gameVariables";
import { VETO_HOURS_FLOOR } from "../../shared/governanceKinds";
import { isMintRuleKey } from "../../shared/mintRuleKeys";
import { zonedTimeToUtc } from "../../shared/lunar";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { activeClock } from "./gratitude-cycles";
import { numberVar, stringVar } from "./variables";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ── The shapes ──────────────────────────────────────────────────────────────

export type WindowShape =
  | { kind: "always_open" }
  | { kind: "last_days_of_cycle"; days: number }
  | { kind: "last_days_of_season"; days: number }
  | { kind: "custom"; fromDay: number; toDay: number };

/** The guided shape for a cycle, the founder's "last week of every month". */
export const DEFAULT_CYCLE_WINDOW_DAYS = 7;
/** The guided shape for a season, the founder's "last 2 weeks of every season". */
export const DEFAULT_SEASON_WINDOW_DAYS = 14;
/** How long anything coming back may open outside its window. */
export const DEFAULT_GRACE_DAYS = 7;
/** The setting holding the grace. */
export const GRACE_DAYS_KEY = "governance.window_grace_days";

export const ALWAYS_OPEN: WindowShape = { kind: "always_open" };

/**
 * The two guided shapes plus the two ends of the range, with the copy a
 * village reads while choosing.
 *
 * These live here and not in the registry's `choices` because a village may
 * write a shape of its own ("or whatever", in his words), and a `choice`
 * variable can hold only what the platform typed. The setting is free text
 * validated by `windowShapeSyntaxProblem`; this list is what the Game
 * Mechanics section offers first.
 */
export const WINDOW_SHAPE_CHOICES: ReadonlyArray<{ value: string; label: string; hint?: string }> = [
  {
    value: "always_open",
    label: "Always open",
    hint: "Anyone can take this kind of proposal to the vote on any day of the cycle.",
  },
  {
    value: `last_days_of_cycle:${DEFAULT_CYCLE_WINDOW_DAYS}`,
    label: "The last week of every cycle",
    hint: "Proposals of this kind open in the last 7 days before the moon turns, so the village reads them together.",
  },
  {
    value: `last_days_of_season:${DEFAULT_SEASON_WINDOW_DAYS}`,
    label: "The last two weeks of every season",
    hint: "Proposals of this kind open in the last 14 days of the running season. A village with no season running cannot open one at all.",
  },
  {
    value: "custom:1-7",
    label: "A window you choose",
    hint: "Days of the cycle, counted from the moon. custom:1-7 opens the first week; custom:20-29 opens the last stretch.",
  },
];

/**
 * Read a stored shape. Null means the text is not a shape this build knows.
 *
 * The syntax is decided by `governanceWindowSyntaxProblem` in the registry, so
 * a value the registry accepts always parses here and a value it refuses never
 * does. Two regexes agreeing by inspection is how a grammar drifts.
 */
export function parseWindowShape(raw: unknown): WindowShape | null {
  const text = String(raw ?? "").trim();
  if (text === "") return ALWAYS_OPEN;
  if (governanceWindowSyntaxProblem(text)) return null;
  if (text === "always_open") return ALWAYS_OPEN;
  const last = /^last_days_of_(cycle|season):(\d{1,3})$/.exec(text);
  if (last) {
    const days = Number(last[2]);
    return last[1] === "cycle" ? { kind: "last_days_of_cycle", days } : { kind: "last_days_of_season", days };
  }
  const custom = /^custom:(\d{1,3})-(\d{1,3})$/.exec(text)!;
  return { kind: "custom", fromDay: Number(custom[1]), toDay: Number(custom[2]) };
}

/** How long a window of this shape lasts, in days. Always open has no length. */
export function windowLengthDays(shape: WindowShape): number | null {
  if (shape.kind === "always_open") return null;
  if (shape.kind === "custom") return shape.toDay - shape.fromDay + 1;
  return shape.days;
}

/** The shape in the words a member reads. */
export function formatWindowShape(shape: WindowShape): string {
  switch (shape.kind) {
    case "always_open":
      return "any day of the cycle";
    case "last_days_of_cycle":
      return `the last ${shape.days} days of every cycle`;
    case "last_days_of_season":
      return `the last ${shape.days} days of every season`;
    default:
      return `day ${shape.fromDay} to day ${shape.toDay} of every cycle`;
  }
}

/** The syntax check the variables registry runs before storing a shape. */
export function windowShapeSyntaxProblem(raw: string): string | null {
  return governanceWindowSyntaxProblem(raw);
}

// ── The kinds a village can window ──────────────────────────────────────────

export interface WindowKindDef {
  /** The Governance setting holding this kind's shape. */
  key: string;
  /** What a member calls this kind, used in every refusal. */
  label: string;
}

/**
 * One entry per proposal kind a village may put a window on. `changeset` is
 * the tray as a whole and also the window every ordinary change-set element
 * falls under; a minting rule and the vote mode carry their own, because they
 * are the two elements a village is most likely to want read together.
 */
export const WINDOW_KINDS: Readonly<Record<string, WindowKindDef>> = {
  changeset: { key: "governance.window_changeset", label: "a change to the Game Mechanics" },
  mint_rule: { key: "governance.window_mint_rule", label: "a change to what the village mints" },
  governance_mode: { key: "governance.window_governance_mode", label: "a change to how votes are counted" },
  role_declare: { key: "governance.window_role_declare", label: "declaring a role" },
  role_seat: { key: "governance.window_role_seat", label: "seating a role" },
  role_unseat: { key: "governance.window_role_unseat", label: "taking a seat back" },
  power_transfer: { key: "governance.window_power_transfer", label: "moving a power to a role" },
  power_grant: { key: "governance.window_power_grant", label: "granting a power" },
  power_return: { key: "governance.window_power_return", label: "handing a power back" },
};

/** Every window setting key, for the registry test and the doc generator. */
export const WINDOW_KEYS: readonly string[] = Object.values(WINDOW_KINDS).map((k) => k.key);

/** Which windowed kind a ballot subject belongs to. Null means never windowed. */
export function kindForSubject(subjectType: string): string | null {
  const t = String(subjectType ?? "").trim().toLowerCase();
  if (t === "mechanics") return "changeset";
  if (t === MINT_RULE) return "mint_rule";
  if (t === GOVERNANCE_MODE) return "governance_mode";
  return WINDOW_KINDS[t] ? t : null;
}

/** Which windowed kind a change-set element belongs to. */
export function kindForItemKind(itemKind: string): string {
  const subject = SUBJECT_FOR_ITEM_KIND[String(itemKind ?? "").trim().toLowerCase() as never];
  return kindForSubject(String(subject ?? "mechanics")) ?? "changeset";
}

/** The element kinds of a stored change set, for the per-element evaluation. */
export function changeSetKinds(changeSet: unknown): string[] {
  if (!Array.isArray(changeSet)) return [];
  return changeSet.map((c) => {
    const kind = String((c as { kind?: unknown })?.kind ?? "").trim();
    if (kind) return kind;
    // The untyped `{ key, to }` shape every stored change set uses. A minting
    // key is a minting rule; everything else is a dial. Same rule as
    // `asChangeItem` in mechanics.ts, held to it by a test there.
    return isMintRuleKey(String((c as { key?: unknown })?.key ?? "")) ? "mint_rule" : "dial";
  });
}

// ── The season, read through a registered door ──────────────────────────────

/**
 * A season hands over on a civil DATE in the village's own zone, and a window
 * needs an instant. `endsOn` is exclusive, so the season runs until the first
 * moment of that date where the village lives.
 */
export function seasonEndInstant(endsOn: string | null | undefined, timezone: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endsOn ?? "").trim());
  if (!parts) return null;
  return zonedTimeToUtc(Number(parts[1]), Number(parts[2]), Number(parts[3]), 0, 0, timezone || "UTC");
}


export interface SeasonWindow {
  currentId: string | null;
  /** When the running season hands over. Null for an open-ended season. */
  endsAt: Date | null;
  configuredCount: number;
}

let seasonReader: (() => SeasonWindow) | null = null;

/**
 * Wired once at boot from `server/index.ts`, which owns the season document.
 * With no reader registered a season window refuses out loud, which is the
 * honest answer for a build that cannot see the calendar it is being asked
 * about.
 */
export function setSeasonWindowReader(read: () => SeasonWindow): void {
  seasonReader = read;
}

export function seasonWindowNow(): SeasonWindow | null {
  if (!seasonReader) return null;
  try {
    return seasonReader();
  } catch {
    return null;
  }
}

// ── The arithmetic ──────────────────────────────────────────────────────────

export interface WindowDeps {
  clock?: CycleClock;
  season?: SeasonWindow | null;
  shapeOf?: (key: string) => WindowShape;
  voteDays?: number;
  graceDays?: number;
}

export interface WindowVerdict {
  /** The setting that decided. Null when nothing windows this kind. */
  narrowedBy: string | null;
  /** What a member calls the element that decided. */
  label: string;
  shape: WindowShape;
  open: boolean;
  /** When the deciding window opens. Null when it is always open. */
  opensAt: Date | null;
  /** When it shuts. Null when it is always open. */
  closesAt: Date | null;
  /** Why no window could be computed at all, in words an operator can act on. */
  problem: string | null;
}

function resolved(deps?: WindowDeps) {
  return {
    clock: deps?.clock ?? activeClock(),
    season: deps?.season !== undefined ? deps.season : seasonWindowNow(),
    shapeOf: deps?.shapeOf ?? ((key: string) => parseWindowShape(stringVar(key)) ?? ALWAYS_OPEN),
    voteDays: deps?.voteDays ?? Math.max(1, numberVar("governance.vote_days")),
    graceDays: deps?.graceDays ?? Math.max(0, numberVar(GRACE_DAYS_KEY)),
  };
}

const ALWAYS: Omit<WindowVerdict, "narrowedBy" | "label"> = {
  shape: ALWAYS_OPEN,
  open: true,
  opensAt: null,
  closesAt: null,
  problem: null,
};

const NO_SEASON =
  "no season is defined, ask an operator to add one in the Game Mechanics section before this kind can open";

/** The window a cycle-shaped rule draws inside one cycle's bounds. */
function spanInCycle(shape: WindowShape, startsAt: Date, endsAt: Date): { opensAt: Date; closesAt: Date } {
  if (shape.kind === "custom") {
    const opensAt = new Date(startsAt.getTime() + (shape.fromDay - 1) * DAY_MS);
    const closesAt = new Date(Math.min(startsAt.getTime() + shape.toDay * DAY_MS, endsAt.getTime()));
    return { opensAt, closesAt };
  }
  const days = shape.kind === "last_days_of_cycle" ? shape.days : 0;
  return { opensAt: new Date(endsAt.getTime() - days * DAY_MS), closesAt: endsAt };
}

/**
 * The window this kind is in at `at`, or the next one. `open` says which.
 *
 * Exported for the surfaces lane's cards: a door that reads "opens in 6 days"
 * and is inert beats a refusal after fifteen minutes of typing.
 */
export function nextWindowFor(kind: string, at: Date, deps?: WindowDeps): WindowVerdict {
  const def = WINDOW_KINDS[kind];
  if (!def) return { ...ALWAYS, narrowedBy: null, label: "" };
  const r = resolved(deps);
  const shape = r.shapeOf(def.key);
  const base = { narrowedBy: def.key, label: def.label, shape };
  if (shape.kind === "always_open") return { ...base, ...ALWAYS, shape };

  if (shape.kind === "last_days_of_season") {
    const season = r.season;
    if (!season || !season.currentId || !season.endsAt) {
      return { ...base, open: false, opensAt: null, closesAt: null, problem: NO_SEASON };
    }
    const closesAt = season.endsAt;
    const opensAt = new Date(closesAt.getTime() - shape.days * DAY_MS);
    const open = at.getTime() >= opensAt.getTime() && at.getTime() < closesAt.getTime();
    if (!open && at.getTime() >= closesAt.getTime()) {
      return { ...base, open: false, opensAt: null, closesAt: null, problem: NO_SEASON };
    }
    return { ...base, open, opensAt, closesAt, problem: null };
  }

  const here = r.clock.boundsFor(at);
  const first = spanInCycle(shape, here.startsAt, here.endsAt);
  if (at.getTime() < first.closesAt.getTime()) {
    const open = at.getTime() >= first.opensAt.getTime();
    return { ...base, open, opensAt: first.opensAt, closesAt: first.closesAt, problem: null };
  }
  const next = r.clock.boundsFor(new Date(here.endsAt.getTime() + 1000));
  const after = spanInCycle(shape, next.startsAt, next.endsAt);
  return { ...base, open: false, opensAt: after.opensAt, closesAt: after.closesAt, problem: null };
}

/**
 * The window a whole proposal has to fit through: every element's window
 * intersected, with the element that narrowed it named.
 *
 * `elements` are change-set item kinds. `alsoKinds` are the windowed kinds the
 * proposal carries in its own right, which for a change set is always the
 * `changeset` umbrella and for a ceremony is its subject.
 */
export function windowFor(
  elements: readonly string[],
  at: Date,
  deps?: WindowDeps,
  alsoKinds: readonly string[] = [],
): WindowVerdict {
  const kinds = new Set<string>(alsoKinds.filter(Boolean));
  for (const item of elements) kinds.add(kindForItemKind(item));
  const verdicts = Array.from(kinds).map((k) => nextWindowFor(k, at, deps)).filter((v) => v.narrowedBy);
  if (verdicts.length === 0) return { ...ALWAYS, narrowedBy: null, label: "" };

  const blocked = verdicts.filter((v) => !v.open);
  if (blocked.length > 0) {
    /*
     * The obstacle is the element that opens LAST, because that is the one the
     * proposer actually has to wait for. A shape that cannot be computed at
     * all (a season window with no season) outranks a date, since an operator
     * has to act before any date exists.
     */
    const unknown = blocked.find((v) => v.problem);
    if (unknown) return unknown;
    return blocked.reduce((a, b) => ((b.opensAt?.getTime() ?? 0) > (a.opensAt?.getTime() ?? 0) ? b : a));
  }
  const timed = verdicts.filter((v) => v.closesAt);
  if (timed.length === 0) return verdicts[0];
  return timed.reduce((a, b) => (b.closesAt!.getTime() < a.closesAt!.getTime() ? b : a));
}

// ── The refusals ────────────────────────────────────────────────────────────

/** UTC to the minute, which is the instant every governance surface renders. */
function stamp(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const SUPERSEDE_RELATIONS = ["renews", "overrides", "replaces"] as const;
export type SupersedeRelation = (typeof SUPERSEDE_RELATIONS)[number];

/** Refuse a relation this build does not know. Absent is fine and common. */
export function relationProblem(raw: unknown): string | null {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "") return null;
  if ((SUPERSEDE_RELATIONS as readonly string[]).includes(text)) return null;
  return `A proposal coming back names how it relates to the one before it: ${SUPERSEDE_RELATIONS.join(", ")}.`;
}

/**
 * When the decision this proposal comes back from closed, or null.
 *
 * The grace is measured from the CLOSE of the original ballot, so it starts
 * when the village finished being asked. A proposal whose original never
 * reached a ballot falls back to the instant it was vetoed, and a proposal
 * pointing at nothing gets null, which means no grace and the ordinary window.
 */
export async function comingBackFrom(pool: Pool, proposalId: string): Promise<Date | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT b.closes_at AS closes_at, o.vetoed_at AS vetoed_at FROM mechanics_proposals p " +
      "LEFT JOIN mechanics_proposals o ON o.id = p.supersedes_proposal_id " +
      "LEFT JOIN ballots b ON b.id = o.ballot_id WHERE p.id = ?",
    [proposalId],
  );
  const row = rows[0];
  const at = row?.closes_at ?? row?.vetoed_at ?? null;
  return at ? new Date(at) : null;
}

export interface OpeningRequest {
  subjectType: string;
  /** Change-set item kinds, when the proposal carries a change set. */
  elements?: readonly string[];
  /** How long the ballot would stay open. */
  durationDays: number;
  at: Date;
  /** The close instant of the proposal this one comes back from. */
  comingBackFrom?: Date | null;
  /** renews, overrides or replaces, when the caller knows it. */
  relation?: string | null;
}

/**
 * Why this proposal cannot be opened right now, or null.
 *
 * Called from `openBallot`, so every door into a village-wide vote passes the
 * same gate and a route added later cannot forget it.
 */
export function openingRefusal(req: OpeningRequest, deps?: WindowDeps): string | null {
  const badRelation = relationProblem(req.relation);
  if (badRelation) return badRelation;

  const r = resolved(deps);
  const subjectKind = kindForSubject(req.subjectType);
  const elements = req.elements ?? [];
  if (!subjectKind && elements.length === 0) return null;

  const verdict = windowFor(elements, req.at, deps, subjectKind ? [subjectKind] : []);
  if (!verdict.narrowedBy) return null;
  if (verdict.shape.kind === "always_open" && verdict.open && !verdict.closesAt) return null;

  /*
   * ANYTHING COMING BACK OPENS OUTSIDE ITS WINDOW, for a stated grace.
   *
   * The village has already been asked once, and holding a resubmission, a
   * veto override or a renewal to the next window would leave a single
   * steward's veto unanswerable for weeks.
   */
  const back = req.comingBackFrom ?? null;
  if (back && req.at.getTime() <= back.getTime() + r.graceDays * DAY_MS) return null;

  if (verdict.problem) {
    return `${capitalise(verdict.label)} opens in ${formatWindowShape(verdict.shape)}, and ${verdict.problem}.`;
  }

  const length = windowLengthDays(verdict.shape);
  if (length !== null && length <= r.voteDays) {
    return (
      `${capitalise(verdict.label)} opens in ${formatWindowShape(verdict.shape)}, and a ballot stays open for ` +
      `${r.voteDays} days, so no vote of this kind could open and close inside the window. ` +
      `Widen the window to more than ${r.voteDays} days, or shorten how long a ballot stays open.`
    );
  }

  if (!verdict.open) {
    const opensAt = verdict.opensAt ? stamp(verdict.opensAt) : "a date nobody can compute yet";
    const graced = back
      ? ` This one comes back from a decision that closed on ${stamp(back)}, and the ${r.graceDays} days it had to come back in have passed.`
      : "";
    return (
      `${capitalise(verdict.label)} opens in ${formatWindowShape(verdict.shape)}. The next window opens ${opensAt}.` +
      `${graced} Your edits stay in the tray until then.`
    );
  }

  if (verdict.closesAt) {
    const voteCloses = new Date(req.at.getTime() + Math.max(1, req.durationDays) * DAY_MS);
    if (voteCloses.getTime() > verdict.closesAt.getTime()) {
      return (
        `This vote would run ${req.durationDays} days and close on ${stamp(voteCloses)}, after the window for ` +
        `${verdict.label} shuts on ${stamp(verdict.closesAt)}. Open it earlier in the window, or shorten how long a ballot stays open.`
      );
    }
  }
  return null;
}

function capitalise(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

// ── The settings that price each other ──────────────────────────────────────

/**
 * Refuse a window shape a vote could never fit inside, at the moment it is SET.
 *
 * Called from `validateChangeSet`, so the governed path refuses it before the
 * village votes on a value that would close a whole kind of proposal forever.
 * `voteDays` comes from the caller because this file must not decide what the
 * village's vote window is while the same proposal may be moving it.
 */
export function windowShapeProblem(key: string, raw: string, voteDays: number): string | null {
  if (!WINDOW_KEYS.includes(key)) return null;
  const shape = parseWindowShape(raw);
  if (!shape) return windowShapeSyntaxProblem(raw);
  const length = windowLengthDays(shape);
  if (length === null) return null;
  const days = Math.max(1, Math.trunc(voteDays) || 1);
  if (length > days) return null;
  return (
    `A window of ${length} days leaves no room for a ballot that stays open for ${days} days, so no proposal ` +
    `of this kind could ever open. Set a window of more than ${days} days, or lower how long a ballot stays open first.`
  );
}

/**
 * THE ONE CALL THE CHANGE-SET VALIDATOR MAKES, for every setting whose value
 * has to agree with another clock.
 *
 * Two rules today: a window shape has to be longer than the vote, and a
 * steward's window cannot outrun a cycle. Both are refused when the value is
 * SET, so a village never votes itself into a door that cannot open or a
 * countdown that outlives the landing it is counting to.
 */
export function windowSettingProblem(
  key: string,
  raw: string,
  voteDays: number,
  at: Date = new Date(),
  clock?: CycleClock,
): string | null {
  if (key === "governance.veto_hours") return vetoHoursProblem(raw, at, clock ?? activeClock());
  return windowShapeProblem(key, raw, voteDays);
}

/** How many whole hours the cycle containing `at` runs for. */
export function cycleHoursAt(at: Date, clock: CycleClock = LUNAR_CLOCK): number {
  const b = clock.boundsFor(at);
  return Math.floor((b.endsAt.getTime() - b.startsAt.getTime()) / HOUR_MS);
}

/**
 * A steward's window, floored at 72 hours and capped at one cycle.
 *
 * The cap is 20.11's, and the reason is the landing arithmetic: a window
 * longer than a cycle pushes `veto_closes_at` past the boundary the change was
 * timed to, so a Game change chosen for the new moon would land a moon late
 * and the countdown on the page would disagree with the row.
 */
export function cappedVetoHours(configured: unknown, at: Date, clock: CycleClock = LUNAR_CLOCK): number {
  const n = Number(configured);
  const floored = Number.isFinite(n) ? Math.max(VETO_HOURS_FLOOR, Math.floor(n)) : VETO_HOURS_FLOOR;
  return Math.min(floored, cycleHoursAt(at, clock));
}

/** Why a stored `veto_hours` is too long, or null. */
export function vetoHoursProblem(configured: unknown, at: Date, clock: CycleClock = LUNAR_CLOCK): string | null {
  const n = Number(configured);
  if (!Number.isFinite(n)) return null;
  const cycleHours = cycleHoursAt(at, clock);
  if (Math.floor(n) <= cycleHours) return null;
  return (
    `A steward's window cannot run longer than one cycle. This village's cycle is ${cycleHours} hours, ` +
    `so ${Math.floor(n)} is refused. The window is capped at ${cycleHours} hours whatever is stored.`
  );
}
