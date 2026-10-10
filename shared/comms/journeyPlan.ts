/**
 * THE JOURNEY PLANNER: which steps of one person's journey are due now, which
 * are waiting and why, which are skipped and why, and when to look again (the
 * comms build spec 5.6).
 *
 * PURE. No clock, no database, no dial: everything arrives in `PlanInput`, so
 * the tick, the "Walk someone through it" button and the tests all ask the same
 * function the same question and get the same answer. The tick
 * (server/lib/comms/journeys.ts) gathers the live facts, asks this, and posts
 * what it says is due.
 *
 * STATELESS, AND THAT IS WHAT MAKES A MOVED GATHERING RE-PLAN. Nothing about a
 * plan is stored except which steps were posted (the post office's ledger
 * holds `j:<journey>:<step>:<enrollment>` keys). Every tick plans from scratch
 * against the facts as they are now, so a gathering that moved, a vote that
 * locked or a person who paused is read fresh each time.
 *
 * ── ONE STEP, DECIDED IN THIS ORDER ────────────────────────────────────────
 *
 *   posted       the ledger holds its key. Never sent twice.
 *   turned_off   a facts provider asked for it to be left out
 *                (`facts.stepOverrides[key].skip`: a gathering with its
 *                reminders off).
 *   no_time      its anchor is unknown: an event step on a subject with no
 *                gathering time.
 *   before_enrollment
 *                its moment passed before the person enrolled, and the step's
 *                catch-up is `skip`. Somebody who says yes an hour before has
 *                just read the confirmation; "starting soon" a second later is
 *                noise.
 *   waiting      its moment has not come, or it has come but a daytime step is
 *                held for the reader's morning (`quietHours.ts`).
 *   too_late     more than `maxLateMinutes` past its moment. The rule that
 *                stops "in seven days" arriving a day before, and that keeps a
 *                journey switched back on from posting a backlog.
 *   audience     a `came` or `missed` step for somebody whose attendance says
 *                otherwise. Attendance nobody marked counts as came, the rule
 *                recaps follow (5.9): the words for people who came read right
 *                either way, and "you missed it" sent to somebody who was there
 *                does not.
 *   condition    one of its `skipIf` conditions holds. Skipping is final.
 *   waiting      a WAIT condition holds (`WAIT_CONDITIONS`): the step is held,
 *                not skipped, until the condition clears or the step is too
 *                late. `time_still_being_voted` is the one there is: a
 *                gathering's emails wait for its vote to lock.
 *   waiting      a condition could not be answered. An email whose rule could
 *                not be checked is held, never sent on a guess; the hold that
 *                matters is the investor path's words awaiting review.
 *   waiting      the person paused this kind of email (`facts.pausedUntil`).
 *   due          everything else whose moment has come.
 *
 * Then catch-up: a due step whose catch-up is `latest` gives way to any step
 * with a LATER moment that is due or already posted, so several overdue steps
 * send only the newest, and the newest email carries the freshest words.
 *
 * Lateness is measured from a step's own moment, never from its window, which
 * is why a daytime step's `maxLateMinutes` is longer than the widest night the
 * quiet hours can hold (shared/comms/defaults/journeys.ts).
 */
import type { ConditionKey, JourneyDefinition, JourneyStep } from "./contracts";
import { nextInWindow, windowZone } from "./quietHours";

const MINUTE = 60_000;

/**
 * Conditions that HOLD a step instead of skipping it. While one holds, the
 * step waits; once it clears, the step goes if it is still within its
 * lateness. A gathering's emails wait for its time vote (5.6).
 */
export const WAIT_CONDITIONS: ReadonlySet<ConditionKey> = new Set<ConditionKey>(["time_still_being_voted"]);

/** How soon a step held by a condition is looked at again. */
export const WAIT_RECHECK_MINUTES = 15;

/** A yes this close to the start skips the day-before reminder (5.6). */
export const SIGNED_UP_LATE_HOURS = 36;

/** When a gathering said nothing about its end, its end is taken to be this long after its start. */
export const ASSUMED_DURATION_MINUTES = 120;

/** True when the person said yes less than 36 hours before the gathering starts. */
export function signedUpLate(enrolledAt: Date, eventStart: Date | null | undefined): boolean {
  if (!(eventStart instanceof Date) || !Number.isFinite(eventStart.getTime())) return false;
  return enrolledAt.getTime() > eventStart.getTime() - SIGNED_UP_LATE_HOURS * 60 * MINUTE;
}

// ── What the planner is told ────────────────────────────────────────────────

/**
 * A change one facts provider asks for, by step key. `offsetMinutes` moves the
 * step; `skip` leaves it out. A gathering with its own reminder times, or with
 * reminders off, reaches the planner this way (the event email lane).
 */
export interface StepOverride {
  offsetMinutes?: number;
  skip?: boolean;
}

/** Whether the person came, read from the host's marks. Null: nobody marked it. */
export type Attendance = "came" | "missed";

/**
 * The live facts about one enrollment's world. Every field is optional, so a
 * journey that needs none of them (a path) plans with `{}`.
 */
export interface PlanFacts {
  /** The gathering occurrence's start, live, for `event_start` steps. */
  eventStart?: Date | null;
  /** Its end. Unknown: the start plus `ASSUMED_DURATION_MINUTES`. */
  eventEnd?: Date | null;
  /** For `came` and `missed` steps. */
  attendance?: Attendance | null;
  /**
   * The condition answers, by key: true holds, false does not, null or absent
   * could not be answered (the step waits).
   */
  conditions?: Partial<Record<ConditionKey, boolean | null>>;
  /** Per-step changes, by step key. */
  stepOverrides?: Record<string, StepOverride>;
  /**
   * Steps beyond the definition's own: a gathering's custom reminders. An
   * extra step whose key names a step the definition already has is ignored;
   * change a defined step with `stepOverrides`.
   */
  extraSteps?: JourneyStep[];
  /** The person paused this kind of email until then (5.3). */
  pausedUntil?: Date | null;
}

export interface PlanInput {
  definition: JourneyDefinition;
  enrolledAt: Date;
  now: Date;
  facts: PlanFacts;
  /** Step keys the ledger already holds for this enrollment. */
  posted: ReadonlySet<string> | readonly string[];
  /** The reader's IANA zone, when known. */
  readerZone?: string | null;
  /** The village's zone: the daytime window's fallback. */
  villageZone: string;
  /** `comms.quiet_start_hour` and `comms.quiet_end_hour`. */
  quietStartHour: number;
  quietEndHour: number;
}

// ── What the planner answers ────────────────────────────────────────────────

export type StepSkipReason = "turned_off" | "no_time" | "before_enrollment" | "too_late" | "audience" | "condition" | "superseded";
export type StepWaitReason = "not_yet" | "daytime" | "condition" | "unanswered" | "paused";
export type StepStatus = "posted" | "due" | "waiting" | "skipped";

export interface PlannedStep {
  key: string;
  /** The step as it is planned: a facts provider's override applied. */
  step: JourneyStep;
  /** True for a step that came from `facts.extraSteps`. */
  extra: boolean;
  /** The step's own moment: its anchor plus its offset. Null when the anchor is unknown. */
  at: Date | null;
  /** The moment it may be sent: `at`, or the start of the reader's window for a daytime step. */
  sendAfter: Date | null;
  status: StepStatus;
  /** Why it waits or why it was skipped. Absent for `posted` and `due`. */
  reason?: StepSkipReason | StepWaitReason;
  /** The condition behind a `condition` or `unanswered` reason. */
  condition?: ConditionKey;
}

export interface Plan {
  /** Every step, in the order its moment falls (unknown moments last). */
  steps: PlannedStep[];
  /** What to post now. */
  due: PlannedStep[];
  skipped: PlannedStep[];
  /** When to plan again. Null when nothing is waiting. */
  nextCheckAt: Date | null;
  /** Nothing waits: once the due steps are posted, the journey is over for this person. */
  finished: boolean;
  /** The zone a daytime step was held in. */
  zone: string;
}

// ── The plan ────────────────────────────────────────────────────────────────

const ms = (d: Date | null | undefined): number | null =>
  d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;

/** The definition's steps with every override applied, then the extra steps. */
export function effectiveSteps(
  definition: JourneyDefinition,
  facts: Pick<PlanFacts, "stepOverrides" | "extraSteps">,
): Array<{ step: JourneyStep; extra: boolean; off: boolean }> {
  const out: Array<{ step: JourneyStep; extra: boolean; off: boolean }> = [];
  const seen = new Set<string>();
  const apply = (s: JourneyStep, extra: boolean) => {
    const o = facts.stepOverrides?.[s.key];
    const offset = o && typeof o.offsetMinutes === "number" && Number.isFinite(o.offsetMinutes) ? Math.trunc(o.offsetMinutes) : s.offsetMinutes;
    out.push({ step: { ...s, offsetMinutes: offset, skipIf: [...(s.skipIf ?? [])] }, extra, off: o?.skip === true });
    seen.add(s.key);
  };
  for (const s of definition.steps) apply(s, false);
  for (const s of facts.extraSteps ?? []) {
    if (!s || typeof s.key !== "string" || !s.key || seen.has(s.key)) continue;
    apply(s, true);
  }
  return out;
}

function anchorMs(step: JourneyStep, input: PlanInput): number | null {
  switch (step.anchor) {
    case "enrolled":
      return ms(input.enrolledAt);
    case "event_start":
      return ms(input.facts.eventStart);
    case "event_end": {
      const end = ms(input.facts.eventEnd);
      if (end !== null) return end;
      const start = ms(input.facts.eventStart);
      return start === null ? null : start + ASSUMED_DURATION_MINUTES * MINUTE;
    }
    default:
      return null;
  }
}

function audienceFits(step: JourneyStep, attendance: Attendance | null | undefined): boolean {
  if (step.audience === "came") return attendance !== "missed";
  if (step.audience === "missed") return attendance === "missed";
  return true;
}

/** Plan one person's journey at one moment. */
export function planJourney(input: PlanInput): Plan {
  const now = input.now.getTime();
  const enrolled = input.enrolledAt.getTime();
  const posted = new Set<string>(Array.from(input.posted as Iterable<string>));
  const zone = windowZone(input.readerZone, input.villageZone);
  const paused = ms(input.facts.pausedUntil);

  const planned = effectiveSteps(input.definition, input.facts).map(({ step, extra, off }): PlannedStep => {
    const anchor = anchorMs(step, input);
    const at = anchor === null ? null : anchor + step.offsetMinutes * MINUTE;
    const sendAfter =
      at === null ? null : step.window === "daytime" ? nextInWindow(new Date(at), zone, input.quietStartHour, input.quietEndHour).getTime() : at;
    const timed = {
      key: step.key,
      step,
      extra,
      at: at === null ? null : new Date(at),
      sendAfter: sendAfter === null ? null : new Date(sendAfter),
    };

    if (posted.has(step.key)) return { ...timed, status: "posted" };
    if (off) return { ...timed, status: "skipped", reason: "turned_off" };
    if (at === null || sendAfter === null) return { ...timed, status: "skipped", reason: "no_time" };
    if (at < enrolled && step.catchUp === "skip") return { ...timed, status: "skipped", reason: "before_enrollment" };
    if (sendAfter > now) return { ...timed, status: "waiting", reason: at <= now ? "daytime" : "not_yet" };
    if (now - at > Math.max(0, step.maxLateMinutes) * MINUTE) return { ...timed, status: "skipped", reason: "too_late" };
    if (!audienceFits(step, input.facts.attendance)) return { ...timed, status: "skipped", reason: "audience" };

    let hold: ConditionKey | null = null;
    let unanswered: ConditionKey | null = null;
    for (const key of step.skipIf) {
      const answer = input.facts.conditions?.[key];
      if (answer === true && !WAIT_CONDITIONS.has(key)) return { ...timed, status: "skipped", reason: "condition", condition: key };
      if (answer === true) hold = hold ?? key;
      else if (answer !== false) unanswered = unanswered ?? key;
    }
    if (hold) return { ...timed, status: "waiting", reason: "condition", condition: hold };
    if (unanswered) return { ...timed, status: "waiting", reason: "unanswered", condition: unanswered };
    if (paused !== null && paused > now) return { ...timed, status: "waiting", reason: "paused" };
    return { ...timed, status: "due" };
  });

  // Catch-up: a due `latest` step gives way to a later step that is due or posted.
  const sent = planned.filter((p) => (p.status === "due" || p.status === "posted") && p.at !== null);
  const steps: PlannedStep[] = planned.map((p) => {
    if (p.status !== "due" || p.step.catchUp !== "latest" || p.at === null) return p;
    const at = p.at.getTime();
    const newer = sent.some((o) => o.key !== p.key && o.at !== null && o.at.getTime() > at);
    return newer ? { ...p, status: "skipped", reason: "superseded" } : p;
  });

  // The earliest moment anything waiting could change.
  let next = Number.POSITIVE_INFINITY;
  for (const p of steps) {
    if (p.status !== "waiting") continue;
    const t =
      (p.reason === "not_yet" || p.reason === "daytime") && p.sendAfter
        ? p.sendAfter.getTime()
        : p.reason === "paused" && paused !== null
          ? paused
          : now + WAIT_RECHECK_MINUTES * MINUTE;
    next = Math.min(next, t);
  }

  const order = (p: PlannedStep) => (p.at === null ? Number.POSITIVE_INFINITY : p.at.getTime());
  const sorted = steps
    .map((p, i) => ({ p, i }))
    .sort((a, b) => order(a.p) - order(b.p) || a.i - b.i)
    .map((x) => x.p);
  return {
    steps: sorted,
    due: sorted.filter((p) => p.status === "due"),
    skipped: sorted.filter((p) => p.status === "skipped"),
    nextCheckAt: Number.isFinite(next) ? new Date(next) : null,
    finished: !sorted.some((p) => p.status === "waiting"),
    zone,
  };
}

// ── Walking somebody through it ─────────────────────────────────────────────

/** What one step does for one person, from now until the journey ends. */
export interface WalkEntry {
  key: string;
  step: JourneyStep;
  extra: boolean;
  at: Date | null;
  sendAfter: Date | null;
  /**
   *   sent      posted before this walk began (`alreadySent`), or posted by it
   *   skipped   never sent, with the reason
   *   pending   still waiting when the walk stopped: held by something the
   *             walk cannot see change (a vote that never locks, a condition
   *             nobody can answer)
   */
  outcome: "sent" | "skipped" | "pending";
  /** When the walk posts it: the planner's own moment, which the tick reaches within one run of its job. */
  sendsAt: Date | null;
  alreadySent: boolean;
  reason?: StepSkipReason | StepWaitReason;
  condition?: ConditionKey;
}

/**
 * Run the planner forward from `input.now`, posting each step the moment it is
 * due, until nothing waits: what the tick will do for this person if nothing
 * about their world changes. The same function the tick calls, at each moment
 * it would call it, which is what makes the walk and the sending agree.
 */
export function walkJourney(input: PlanInput, opts: { maxRounds?: number } = {}): { entries: WalkEntry[]; zone: string } {
  const already = new Set<string>(Array.from(input.posted as Iterable<string>));
  const posted = new Set<string>(already);
  const decided = new Map<string, WalkEntry>();
  let now = input.now.getTime();
  let zone = windowZone(input.readerZone, input.villageZone);
  let last: Plan | null = null;
  const rounds = Math.max(1, Math.min(500, opts.maxRounds ?? 200));
  for (let round = 0; round < rounds; round++) {
    const plan = planJourney({ ...input, now: new Date(now), posted });
    last = plan;
    zone = plan.zone;
    for (const p of plan.steps) {
      if (decided.has(p.key)) continue;
      const entry = { key: p.key, step: p.step, extra: p.extra, at: p.at, sendAfter: p.sendAfter };
      if (p.status === "posted" && already.has(p.key)) {
        decided.set(p.key, { ...entry, outcome: "sent", sendsAt: null, alreadySent: true });
      } else if (p.status === "due") {
        decided.set(p.key, { ...entry, outcome: "sent", sendsAt: new Date(now), alreadySent: false });
        posted.add(p.key);
      } else if (p.status === "skipped") {
        decided.set(p.key, { ...entry, outcome: "skipped", sendsAt: null, alreadySent: false, reason: p.reason, condition: p.condition });
      }
    }
    if (plan.finished || plan.nextCheckAt === null) break;
    now = Math.max(plan.nextCheckAt.getTime(), now + 1);
  }
  const entries: WalkEntry[] = [];
  for (const p of last?.steps ?? []) {
    const seen = decided.get(p.key);
    entries.push(
      seen ?? {
        key: p.key,
        step: p.step,
        extra: p.extra,
        at: p.at,
        sendAfter: p.sendAfter,
        outcome: "pending",
        sendsAt: null,
        alreadySent: false,
        reason: p.reason,
        condition: p.condition,
      },
    );
  }
  const when = (e: WalkEntry) => (e.sendsAt ?? e.sendAfter ?? e.at)?.getTime() ?? Number.POSITIVE_INFINITY;
  return { entries: entries.map((e, i) => ({ e, i })).sort((a, b) => when(a.e) - when(b.e) || a.i - b.i).map((x) => x.e), zone };
}
