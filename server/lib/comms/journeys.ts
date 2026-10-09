/**
 * PEOPLE ON JOURNEYS: enroll, stop, touch, and the tick that sends their
 * emails (the comms build spec 5.6).
 *
 * ── THE TICK ────────────────────────────────────────────────────────────────
 *
 * Every five minutes (`comms-journeys`, registered in
 * server/routes/commsJourneys.ts) and on the admin "run now":
 *
 *   1. Nothing at all while the comms module is off (5.16).
 *   2. Read the active enrollments whose next look is due, oldest first,
 *      bounded.
 *   3. For each: the journey's standing. A journey turned OFF posts nothing
 *      and looks again in an hour; turning it on asks for a look at once, and
 *      the planner's catch-up decides what is still worth sending.
 *   4. The steps this person walks: the version they started on
 *      (./journeyDefinitions.ts).
 *   5. The live facts, from every facts provider registered for the journey's
 *      kind, then the condition and stop answers (./conditions.ts).
 *   6. A stop rule that holds ends the enrollment, with the rule as the reason.
 *   7. The planner (shared/comms/journeyPlan.ts) says what is due; each due
 *      step is rendered with the words' values from every vars builder
 *      (./journeyRegistry.ts) and posted under `j:<journey>:<step>:<enrollment>`.
 *   8. The next look is written, or the enrollment finishes.
 *
 * TWICE IS ONCE. The ledger key is the dedupe: a step posted by one tick is a
 * `duplicate` to the next, and the planner reads which keys the ledger holds
 * before it plans, so two ticks at once, or one run twice, post each step once.
 *
 * ONE PERSON'S FAULT IS NOT THE TICK'S. Anything that throws for one
 * enrollment is logged with its id (never its address) and that enrollment is
 * looked at again in fifteen minutes; the rest of the tick carries on.
 *
 * Every write is a repository call (server/repos/commsJourneys.ts). Nothing
 * here touches SQL.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { STOP_KEYS, type ConditionKey, type JourneyDefinition, type JourneyStep, type StopKey } from "../../../shared/comms/contracts";
import { defaultJourney } from "../../../shared/comms/defaults/journeys";
import { templateLabel } from "../../../shared/comms/defaults/templates";
import {
  effectiveSteps,
  planJourney,
  signedUpLate,
  walkJourney,
  type Attendance,
  type PlanInput,
  type StepSkipReason,
  type StepWaitReason,
} from "../../../shared/comms/journeyPlan";
import { reasonLabel, timingLabel } from "../../../shared/comms/journeySteps";
import type { PermissionKind } from "../../../shared/comms/kinds";
import { gatheringWhen, sampleValues, type MergeValues } from "../../../shared/comms/mergeFields";
import { PAUSABLE_KINDS } from "../../../shared/comms/preferences";
import type { ModuleLifecycle } from "../../../shared/modules";
import { contactById } from "../../repos/commsContacts";
import {
  dueEnrollments,
  enrollmentById,
  enrollmentFor,
  finishEnrollment,
  insertEnrollment,
  postedLedgerKeys,
  setNextCheck,
  stopEnrollmentById,
  stopEnrollments,
  touchEnrollments,
  villageJourneyVersion,
  type EnrollmentRow,
} from "../../repos/commsJourneys";
import { numberVar } from "../variables";
import { answerConditions, type PermissionView } from "./conditions";
import { definitionForEnrollment, journeyStatus, type DefinitionDeps, type JourneyStatus } from "./journeyDefinitions";
import "./journeyFacts";
import {
  buildStepContent,
  factsProvidersFor,
  mergeFacts,
  type ContactView,
  type EnrollmentView,
  type GatheredFacts,
  type JourneyContext,
} from "./journeyRegistry";
import { ledgerKey, post, type PostOfficeDeps } from "./postOffice";
import { loadEmailVillage, renderTemplate, type EmailVillage } from "./render";

/*
 * THE EXTENSION POINTS, re-exported so a lane can import everything it plugs
 * into from the engine's own file. The registries live in ./journeyRegistry.ts
 * (facts providers by journey kind, vars builders by kind and merge group) and
 * ./conditions.ts (one answer per skip-if and stop key); the planner's
 * `facts.stepOverrides` and `facts.extraSteps` are in
 * shared/comms/journeyPlan.ts.
 */
export {
  registerFactsProvider,
  registerVarsBuilder,
  type EventFacts,
  type FactsProvider,
  type GatheredFacts,
  type JourneyContext,
  type StepContent,
  type VarsBuilder,
  type VarsContext,
} from "./journeyRegistry";
export { registerCondition, type ConditionAnswer, type ConditionContext } from "./conditions";
export type { PlanFacts, StepOverride } from "../../../shared/comms/journeyPlan";

export interface JourneyDeps {
  getPool(): Pool;
}

const newEnrollmentId = (): string => `enr_${crypto.randomBytes(12).toString("hex")}`;

/** A caller's bug, said in words. */
function need(ok: boolean, what: string): void {
  if (!ok) throw new RangeError(`journeys: ${what}`);
}

/**
 * Put a person on a journey for one subject.
 *
 * The version recorded is the village's own when it holds one and the
 * platform default's otherwise, and the person keeps it when the journey is
 * edited later. `anchorAt` dates the enrollment, for a person who joined
 * before the trigger reached here; it defaults to now.
 *
 * Calling it twice for the same person, journey and subject is one
 * enrollment, and the second call says it created nothing.
 */
export async function enroll(
  deps: JourneyDeps,
  input: { journeyKey: string; contactId: string; subjectRef: string; facts?: Record<string, unknown>; anchorAt?: Date },
): Promise<{ enrollmentId: string; created: boolean }> {
  need(typeof input.journeyKey === "string" && input.journeyKey.length > 0 && input.journeyKey.length <= 100, "a journey key is 1 to 100 characters");
  need(typeof input.contactId === "string" && input.contactId.length > 0 && input.contactId.length <= 64, "a contact id is 1 to 64 characters");
  need(typeof input.subjectRef === "string" && input.subjectRef.length > 0 && input.subjectRef.length <= 191, "a subject is 1 to 191 characters");
  const pool = deps.getPool();
  const version = (await villageJourneyVersion(pool, input.journeyKey)) ?? defaultJourney(input.journeyKey)?.version ?? 1;
  const anchor = input.anchorAt instanceof Date && Number.isFinite(input.anchorAt.getTime())
    ? Math.floor(input.anchorAt.getTime() / 1000)
    : null;
  return insertEnrollment(pool, {
    id: newEnrollmentId(),
    journeyKey: input.journeyKey,
    journeyVersion: version,
    contactId: input.contactId,
    subjectRef: input.subjectRef,
    facts: input.facts ?? null,
    enrolledAt: anchor,
  });
}

/**
 * Stop every active enrollment matching ALL the given conditions, and say how
 * many. A subject matches exactly or as a prefix that ends where an id does,
 * so `{ subjectRef: "event:ev-1" }` stops every evening of one gathering.
 * With no condition at all it stops nothing.
 */
export async function stop(
  deps: JourneyDeps,
  where: { journeyKey?: string; contactId?: string; subjectRef?: string },
  reason: string,
): Promise<number> {
  need(typeof reason === "string" && reason.length > 0, "a stop needs a reason");
  return stopEnrollments(deps.getPool(), where, reason);
}

/**
 * Ask the next tick to re-plan every active enrollment on a subject, because
 * something about it moved. `touch("event:<id>")` runs on every change to a
 * gathering, so a moved time re-plans its reminders.
 */
export async function touch(deps: JourneyDeps, subjectRefPrefix: string): Promise<number> {
  return touchEnrollments(deps.getPool(), subjectRefPrefix);
}


// ── The tick's dependencies ─────────────────────────────────────────────────

export interface TickDeps extends JourneyDeps, DefinitionDeps {
  /** The post office every step is posted through. */
  postOffice: PostOfficeDeps;
  /** The comms module's lifecycle. Absent: `off`, how every module ships, so nothing is sent. */
  lifecycle?(): ModuleLifecycle;
  /** The village's IANA zone. Absent: UTC. */
  villageZone?(): string;
  /** `comms.quiet_start_hour` and `comms.quiet_end_hour`. Absent: the game variables. */
  quietHours?(): { start: number; end: number };
  /**
   * A person's answer about one kind of email, through the people lane's
   * `answerFor`. Handed in, because server/lib/comms/permissions.ts imports
   * this file. Absent: the `unsubscribed` stop cannot be answered and a pause
   * is not seen (the post office still refuses a paused kind).
   */
  permission?(contactId: string, kind: PermissionKind): Promise<PermissionView | null>;
  /** The clock. Absent: now, and the due query compares in SQL. Tests pass one. */
  now?(): Date;
}

/** What one run did. A type, so it reads as the counts the "run now" route answers. */
export type TickSummary = {
  checked: number;
  posted: number;
  stopped: number;
  finished: number;
  waiting: number;
  failed: number;
};

/** The job's name and how often it runs. */
export const JOURNEYS_JOB = "comms-journeys";
export const JOURNEYS_EVERY_MS = 5 * 60_000;

/** At most this many enrollments in one run; the rest are next. */
export const DEFAULT_TICK_LIMIT = 200;

/** A journey that is off is looked at again this often, in case it was turned on some other way. */
const OFF_RECHECK_MINUTES = 60;

/** An enrollment whose look failed is tried again this soon. */
const FAULT_RECHECK_MINUTES = 15;

/**
 * Far past any real next look: what `runEnrollment` compares with, so the one
 * enrollment it names is read whatever its next look says. Inside the range a
 * TIMESTAMP column can hold.
 */
const FAR_FUTURE_EPOCH = 2_147_000_000;

const MINUTE = 60_000;
const seconds = (d: Date): number => Math.floor(d.getTime() / 1000);
const nowOf = (deps: Pick<TickDeps, "now">): Date => (deps.now ? deps.now() : new Date());

/** The ledger key a step is posted under, before the post office's hashing. */
export function stepKeyOf(journeyKey: string, stepKey: string, enrollmentId: string): string {
  return `j:${journeyKey}:${stepKey}:${enrollmentId}`;
}

function quietHoursOf(deps: TickDeps): { start: number; end: number } {
  if (deps.quietHours) return deps.quietHours();
  try {
    return { start: numberVar("comms.quiet_start_hour"), end: numberVar("comms.quiet_end_hour") };
  } catch {
    return { start: 8, end: 20 };
  }
}

const viewOf = (row: EnrollmentRow): EnrollmentView => ({
  id: row.id,
  journeyKey: row.journeyKey,
  journeyVersion: row.journeyVersion,
  contactId: row.contactId,
  subjectRef: row.subjectRef,
  enrolledAt: new Date(row.enrolledAt * 1000),
  stored: row.facts,
});

async function contactViewOf(pool: Pool, contactId: string): Promise<ContactView | null> {
  const c = await contactById(pool, contactId);
  return c ? { id: c.id, email: c.email, name: c.name, userId: c.userId, timezone: c.timezone } : null;
}

// ── Gathering what is true ──────────────────────────────────────────────────

/** Stops checked first, because they say most about why the rest no longer matters. */
const STOP_PRIORITY: StopKey[] = ["gathering_removed", "gathering_cancelled"];

interface Gathered {
  facts: GatheredFacts;
  /** The stop rule that holds, or null. */
  stop: StopKey | null;
}

/**
 * The live facts about one enrollment: every facts provider for the journey's
 * kind, then the condition answers for every skip rule its steps carry, the
 * stop answers, and the person's pause. The tick and the walk-through both
 * gather through here, so they read the same world.
 */
async function gather(deps: TickDeps, ctx: JourneyContext): Promise<Gathered> {
  let facts: GatheredFacts = {};
  for (const provide of factsProvidersFor(ctx.definition.kind)) facts = mergeFacts(facts, await provide(ctx));
  const contactId = ctx.contact?.id ?? null;
  const ask = deps.permission;
  const permission = ask && contactId ? (kind: PermissionKind) => ask(contactId, kind) : undefined;
  const condCtx = { ...ctx, facts, permission };
  const skipKeys = Array.from(new Set(effectiveSteps(ctx.definition, facts).flatMap((s) => s.step.skipIf)));
  const answered = await answerConditions(skipKeys, condCtx);
  facts = { ...facts, conditions: { ...answered, ...(facts.conditions ?? {}) } };

  const stops = Array.from(new Set([...STOP_PRIORITY.filter((k) => ctx.definition.stops.includes(k)), ...ctx.definition.stops])).filter(
    (k): k is StopKey => (STOP_KEYS as readonly string[]).includes(k),
  );
  const stopAnswers = await answerConditions(stops, { ...condCtx, facts });
  const stop = stops.find((k) => stopAnswers[k] === true) ?? null;

  const kind = ctx.definition.emailKind;
  if (permission && (PAUSABLE_KINDS as readonly string[]).includes(kind)) {
    const answer = await permission(kind as PermissionKind).catch(() => null);
    if (answer?.pausedUntil && answer.pausedUntil > ctx.now.getTime()) facts = { ...facts, pausedUntil: new Date(answer.pausedUntil) };
  }
  return { facts, stop };
}

/** Which of an enrollment's steps the ledger already holds. */
async function postedSteps(pool: Pool, definition: JourneyDefinition, facts: GatheredFacts, enrollmentId: string): Promise<Set<string>> {
  const byLedger = new Map<string, string>();
  for (const { step } of effectiveSteps(definition, facts)) byLedger.set(ledgerKey(stepKeyOf(definition.key, step.key, enrollmentId)), step.key);
  const held = await postedLedgerKeys(pool, Array.from(byLedger.keys()));
  return new Set(Array.from(held).map((k) => byLedger.get(k) as string));
}

function planInputOf(deps: TickDeps, ctx: JourneyContext, facts: GatheredFacts, posted: Set<string>): PlanInput {
  const quiet = quietHoursOf(deps);
  return {
    definition: ctx.definition,
    enrolledAt: ctx.enrollment.enrolledAt,
    now: ctx.now,
    facts,
    posted,
    readerZone: ctx.contact?.timezone ?? null,
    villageZone: ctx.villageZone,
    quietStartHour: quiet.start,
    quietEndHour: quiet.end,
  };
}

// ── Posting one step ────────────────────────────────────────────────────────

/** Render one step for one person with every builder's values, the way it is sent. */
async function renderStep(deps: TickDeps, ctx: JourneyContext, facts: GatheredFacts, step: JourneyStep, village: EmailVillage) {
  const content = await buildStepContent({ ...ctx, facts, step, village });
  const email = await renderTemplate(step.templateKey, content.vars, {
    getPool: deps.getPool,
    village,
    contactId: ctx.contact?.id ?? null,
    kind: ctx.definition.emailKind,
  });
  return { email, attachments: content.attachments };
}

/**
 * A gathering step meant for before the start expires at the start: a
 * reminder that could not go in time is not sent late (5.1, expiry defaults).
 */
function expiryOf(definition: JourneyDefinition, facts: GatheredFacts, at: Date | null): Date | null {
  if (definition.kind !== "event" || !(facts.eventStart instanceof Date) || !at) return null;
  return at.getTime() < facts.eventStart.getTime() ? facts.eventStart : null;
}

interface TickCache {
  statuses: Map<string, JourneyStatus | null>;
  village: Promise<EmailVillage> | null;
  zone: string;
}

/** Look at one enrollment now: stop it, post what is due, and say when to look again. */
async function advance(deps: TickDeps, row: EnrollmentRow, now: Date, cache: TickCache, summary: TickSummary): Promise<void> {
  const pool = deps.getPool();
  if (!cache.statuses.has(row.journeyKey)) cache.statuses.set(row.journeyKey, await journeyStatus(deps, row.journeyKey));
  const status = cache.statuses.get(row.journeyKey) ?? null;
  if (!status) {
    if (await stopEnrollmentById(pool, row.id, "no_such_journey")) summary.stopped += 1;
    return;
  }
  if (status.state !== "on") {
    await setNextCheck(pool, row.id, seconds(new Date(now.getTime() + OFF_RECHECK_MINUTES * MINUTE)));
    summary.waiting += 1;
    return;
  }
  const contact = await contactViewOf(pool, row.contactId);
  if (!contact) {
    if (await stopEnrollmentById(pool, row.id, "contact_gone")) summary.stopped += 1;
    return;
  }
  const definition = await definitionForEnrollment(deps, status, row.journeyVersion);
  const ctx: JourneyContext = { getPool: deps.getPool, now, villageZone: cache.zone, enrollment: viewOf(row), contact, definition };
  const { facts, stop } = await gather(deps, ctx);
  if (stop) {
    if (await stopEnrollmentById(pool, row.id, stop)) summary.stopped += 1;
    return;
  }
  const posted = await postedSteps(pool, definition, facts, row.id);
  const plan = planJourney(planInputOf(deps, ctx, facts, posted));

  let fault = false;
  for (const due of plan.due) {
    try {
      cache.village = cache.village ?? loadEmailVillage(pool, deps.postOffice.origin());
      const village = await cache.village;
      const { email, attachments } = await renderStep(deps, ctx, facts, due.step, village);
      const result = await post(deps.postOffice, {
        idempotencyKey: stepKeyOf(definition.key, due.key, row.id),
        kind: definition.emailKind,
        origin: "journey",
        to: { email: contact.email, name: contact.name, userId: contact.userId, contactId: contact.id },
        subject: email.subject,
        html: email.html,
        text: email.text,
        preheader: email.preheader,
        ...(attachments.length ? { attachments } : {}),
        source: {
          templateKey: due.step.templateKey,
          ...(email.version !== null ? { templateVersion: email.version } : {}),
          journeyKey: definition.key,
          stepKey: due.key,
          enrollmentId: row.id,
        },
        expiresAt: expiryOf(definition, facts, due.at),
        urgent: due.step.urgent === true,
      });
      if (result.status !== "duplicate") summary.posted += 1;
    } catch (err) {
      fault = true;
      console.error(`[comms] journey step ${definition.key}/${due.key} for enrollment ${row.id} could not be posted, so it is tried again shortly`, err);
    }
  }

  if (fault) {
    await setNextCheck(pool, row.id, seconds(new Date(now.getTime() + FAULT_RECHECK_MINUTES * MINUTE)));
    summary.failed += 1;
  } else if (plan.finished) {
    if (await finishEnrollment(pool, row.id)) summary.finished += 1;
  } else {
    await setNextCheck(pool, row.id, plan.nextCheckAt ? seconds(plan.nextCheckAt) : null);
    summary.waiting += 1;
  }
}

/**
 * Plan and post every due step (see the header). Answers what it did.
 * `enrollmentIds` narrows it to those enrollments; `anyTime` reads them
 * whatever their next look says.
 */
export async function tick(
  deps: TickDeps,
  opts: { limit?: number; enrollmentIds?: readonly string[]; anyTime?: boolean } = {},
): Promise<TickSummary> {
  const summary: TickSummary = { checked: 0, posted: 0, stopped: 0, finished: 0, waiting: 0, failed: 0 };
  const lifecycle: ModuleLifecycle = deps.lifecycle ? deps.lifecycle() : "off";
  if (lifecycle === "off") return summary;
  const now = nowOf(deps);
  const pool = deps.getPool();
  const rows = await dueEnrollments(pool, {
    limit: Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? DEFAULT_TICK_LIMIT))),
    atEpoch: opts.anyTime ? FAR_FUTURE_EPOCH : deps.now ? seconds(now) : null,
    ids: opts.enrollmentIds ?? null,
  });
  const cache: TickCache = { statuses: new Map(), village: null, zone: deps.villageZone?.() || "UTC" };
  for (const row of rows) {
    summary.checked += 1;
    try {
      await advance(deps, row, now, cache, summary);
    } catch (err) {
      summary.failed += 1;
      console.error(`[comms] journey enrollment ${row.id} could not be looked at, so it is tried again shortly`, err);
      await setNextCheck(pool, row.id, seconds(new Date(now.getTime() + FAULT_RECHECK_MINUTES * MINUTE))).catch(() => undefined);
    }
  }
  return summary;
}

/**
 * Look at one enrollment now, whatever its next look says: for a lane that
 * enrolls somebody inside a request and wants the urgent first step (a
 * confirmation) to go inside it too. Respects the module and the journey's
 * state like any tick.
 */
export function runEnrollment(deps: TickDeps, enrollmentId: string): Promise<TickSummary> {
  return tick(deps, { enrollmentIds: [enrollmentId], anyTime: true, limit: 1 });
}

/** The scheduler's job: the tick, or a sentence saying why nothing ran. */
export async function runJourneysJob(deps: TickDeps): Promise<string> {
  if ((deps.lifecycle ? deps.lifecycle() : "off") === "off") return "nothing checked: the comms module is off";
  const s = await tick(deps);
  return `checked ${s.checked}, posted ${s.posted}, stopped ${s.stopped}, finished ${s.finished}, waiting ${s.waiting}, failed ${s.failed}`;
}

// ── Walking somebody through it ─────────────────────────────────────────────

/** Who to walk through a journey: somebody on it, somebody real who is not, or a made-up person. */
export type WalkInput =
  | { enrollmentId: string }
  | { contactId: string; subjectRef: string }
  | {
      madeUp: {
        name?: string | null;
        timezone?: string | null;
        /** For a gathering journey: when the gathering starts and ends. */
        startsAt?: Date | null;
        endsAt?: Date | null;
        attendance?: Attendance | null;
        /** When they start. Absent: now. */
        enrolledAt?: Date | null;
      };
    };

export interface WalkStep {
  key: string;
  label: string;
  templateKey: string;
  timing: string;
  /** The step's own moment, ISO. */
  at: string | null;
  /** When the tick sends it, ISO: within one run of its job after this. */
  sendsAt: string | null;
  outcome: "sent" | "skipped" | "pending";
  alreadySent: boolean;
  reason: StepSkipReason | StepWaitReason | null;
  condition: ConditionKey | null;
  /** The reason in words. */
  why: string;
  /** The subject line as it would read, or null when it could not be rendered. */
  subject: string | null;
}

export interface Walk {
  journeyKey: string;
  version: number;
  state: "on" | "off";
  person: { name: string | null; email: string | null; timezone: string | null; madeUp: boolean };
  subjectRef: string | null;
  enrolledAt: string;
  /** The zone daytime steps are held in. */
  zone: string;
  /** A stop rule that already holds: nothing more would be sent. */
  stoppedBy: StopKey | null;
  steps: WalkStep[];
}

/**
 * What one person gets from a journey, step by step, from now on: the same
 * facts, conditions and planner the tick uses, run forward in time
 * (`walkJourney`). Answers `{ missing }` naming what was not found.
 */
export async function walkThrough(deps: TickDeps, journeyKey: string, input: WalkInput): Promise<Walk | { missing: "journey" | "enrollment" | "contact" }> {
  const pool = deps.getPool();
  const now = nowOf(deps);
  const status = await journeyStatus(deps, journeyKey);
  if (!status) return { missing: "journey" };
  const zone = deps.villageZone?.() || "UTC";

  let ctx: JourneyContext;
  let facts: GatheredFacts;
  let stop: StopKey | null = null;
  let posted = new Set<string>();
  let madeUp = false;

  if ("madeUp" in input) {
    madeUp = true;
    const m = input.madeUp;
    const enrolledAt = m.enrolledAt instanceof Date && Number.isFinite(m.enrolledAt.getTime()) ? m.enrolledAt : now;
    const contact: ContactView = { id: "walkthrough", email: "", name: m.name?.trim() || null, userId: null, timezone: m.timezone ?? null };
    ctx = {
      getPool: deps.getPool,
      now,
      villageZone: zone,
      enrollment: { id: "walkthrough", journeyKey, journeyVersion: status.version, contactId: contact.id, subjectRef: "", enrolledAt, stored: {} },
      contact,
      definition: status.definition,
      madeUp: true,
    };
    const start = m.startsAt ?? null;
    // A made-up person has done nothing yet: only time decides what they get.
    const conditions: Partial<Record<ConditionKey, boolean>> = {};
    for (const s of status.definition.steps) {
      for (const k of s.skipIf) conditions[k] = k === "signed_up_within_36_hours" ? signedUpLate(enrolledAt, start) : false;
    }
    facts = { eventStart: start, eventEnd: m.endsAt ?? null, attendance: m.attendance ?? null, conditions };
  } else {
    let row: EnrollmentRow | null;
    let contactId: string;
    let subjectRef: string;
    if ("enrollmentId" in input) {
      row = await enrollmentById(pool, input.enrollmentId);
      if (!row || row.journeyKey !== journeyKey) return { missing: "enrollment" };
      contactId = row.contactId;
      subjectRef = row.subjectRef;
    } else {
      row = await enrollmentFor(pool, journeyKey, input.contactId, input.subjectRef);
      contactId = input.contactId;
      subjectRef = input.subjectRef;
    }
    const contact = await contactViewOf(pool, contactId);
    if (!contact) return { missing: "contact" };
    const enrollment: EnrollmentView = row
      ? viewOf(row)
      : { id: "walkthrough", journeyKey, journeyVersion: status.version, contactId, subjectRef, enrolledAt: now, stored: {} };
    const definition = await definitionForEnrollment(deps, status, enrollment.journeyVersion);
    ctx = { getPool: deps.getPool, now, villageZone: zone, enrollment, contact, definition };
    const g = await gather(deps, ctx);
    facts = g.facts;
    stop = g.stop;
    if (row) posted = await postedSteps(pool, definition, facts, row.id);
  }

  const { entries, zone: heldIn } = walkJourney(planInputOf(deps, ctx, facts, posted));
  const village = await loadEmailVillage(pool, deps.postOffice.origin());
  const steps: WalkStep[] = [];
  for (const e of entries) {
    let subject: string | null = null;
    try {
      if (madeUp) {
        const first = ctx.contact?.name?.split(/\s+/)[0] ?? null;
        const vars: MergeValues = sampleValues({ villageUrl: village.url, firstName: first, fullName: ctx.contact?.name ?? null });
        if (facts.eventStart instanceof Date) {
          const w = gatheringWhen(facts.eventStart, zone, ctx.contact?.timezone ?? null);
          vars["gathering.when"] = w.when;
          vars["gathering.whenLocal"] = w.whenLocal;
        }
        subject = (await renderTemplate(e.step.templateKey, vars, { getPool: deps.getPool, village, kind: ctx.definition.emailKind })).subject;
      } else {
        subject = (await renderStep(deps, { ...ctx, now: e.sendsAt ?? now }, facts, e.step, village)).email.subject;
      }
    } catch {
      subject = null;
    }
    steps.push({
      key: e.key,
      label: templateLabel(e.step.templateKey),
      templateKey: e.step.templateKey,
      timing: timingLabel(ctx.definition.kind, e.step),
      at: e.at ? e.at.toISOString() : null,
      sendsAt: e.sendsAt ? e.sendsAt.toISOString() : null,
      outcome: e.outcome,
      alreadySent: e.alreadySent,
      reason: e.reason ?? null,
      condition: e.condition ?? null,
      why: e.outcome === "sent" ? "" : reasonLabel(e.reason, e.condition),
      subject,
    });
  }
  return {
    journeyKey,
    version: ctx.enrollment.journeyVersion,
    state: status.state,
    person: { name: ctx.contact?.name ?? null, email: madeUp ? null : (ctx.contact?.email ?? null), timezone: ctx.contact?.timezone ?? null, madeUp },
    subjectRef: madeUp ? null : ctx.enrollment.subjectRef,
    enrolledAt: ctx.enrollment.enrolledAt.toISOString(),
    zone: heldIn,
    stoppedBy: stop,
    steps,
  };
}
