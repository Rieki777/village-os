/**
 * OUTCOMES: for each step of a journey, what became of its email and what
 * people did next (the comms build spec 5.12). The Journeys screen shows them
 * beside each step (client/src/components/admin/comms/JourneyOutcomes.tsx).
 *
 *   sent, delivered, bounced    from the post office ledger and its delivery
 *                               reports. Opens are not tracked.
 *   unsubscribed after          said no to that kind of email, stopped
 *                               everything, or complained, after it was sent.
 *   RSVP'd, came                said yes to a gathering, or was marked as
 *                               having come, within 7 days after it.
 *   reached the goal            their journey ended on one of its goals within
 *                               7 days after it (the path goals of 5.11:
 *                               a home reserved, a commitment, a seat, a
 *                               venture listed, admitted, took part).
 *   took the next step          for a journey with a first step (the path and
 *                               welcome journeys), how many of the people this
 *                               email reached have taken it by now. Asked of
 *                               the same rule the journey skips that step on
 *                               (`<path>_first_step_done`), through the
 *                               condition registry, so it is answered by
 *                               whichever lane answers that rule. A rule with
 *                               no answer reads as "not measured", never as
 *                               zero; a count is never a guess.
 *
 * SQL lives in server/repos/commsOutcomes.ts.
 */
import type { Pool } from "mysql2/promise";
import type { ConditionKey, JourneyDefinition, StopKey } from "../../../shared/comms/contracts";
import { contactById } from "../../repos/commsContacts";
import { enrollmentById } from "../../repos/commsJourneys";
import { enrollmentsSentStep, journeyStepCounts, OUTCOME_WINDOW_DAYS } from "../../repos/commsOutcomes";
import { answerConditions } from "./conditions";
import { factsProvidersFor, mergeFacts, type GatheredFacts, type JourneyContext } from "./journeyRegistry";

/** The stop reasons that mean a journey reached its goal (5.11). */
export const GOAL_STOPS: readonly StopKey[] = [
  "resident_reserved",
  "investor_committed",
  "steward_seated",
  "prosperity_venture_listed",
  "joining_admitted",
  "member_took_part",
];

/** How many of a step's people "took the next step" is asked of, newest first. */
export const NEXT_STEP_SAMPLE = 300;

export interface StepOutcome {
  stepKey: string;
  sent: number;
  delivered: number;
  bounced: number;
  unsubscribed: number;
  rsvpd: number;
  came: number;
  reachedGoal: number;
  /** Null when this journey has no first step, or its rule has no answer here. */
  tookNextStep: number | null;
  /** How many people the next-step count was asked of. */
  askedNextStep: number;
}

export interface JourneyOutcomes {
  journeyKey: string;
  windowDays: number;
  /** The goals this journey can end on, for the screen's one line about them. */
  goals: StopKey[];
  /** The rule "took the next step" is asked of, or null when there is none. */
  nextStepRule: ConditionKey | null;
  steps: StepOutcome[];
}

export interface OutcomeDeps {
  getPool(): Pool;
  villageZone?(): string;
  now?(): Date;
}

/** The rule a journey skips its first step on, when it has one. */
export function nextStepRuleOf(def: JourneyDefinition): ConditionKey | null {
  for (const s of def.steps) for (const k of s.skipIf) if (/_first_step_done$/.test(k)) return k;
  return null;
}

/** Ask the first-step rule of each person the step reached. Answers the count, or null when it cannot be answered. */
async function tookNextStep(deps: OutcomeDeps, def: JourneyDefinition, rule: ConditionKey, stepKey: string): Promise<{ count: number | null; asked: number }> {
  const pool = deps.getPool();
  const ids = await enrollmentsSentStep(pool, def.key, stepKey, NEXT_STEP_SAMPLE);
  let yes = 0;
  let answered = 0;
  for (const id of ids) {
    const row = await enrollmentById(pool, id);
    if (!row) continue;
    const c = await contactById(pool, row.contactId);
    const ctx: JourneyContext = {
      getPool: deps.getPool,
      now: deps.now ? deps.now() : new Date(),
      villageZone: deps.villageZone ? deps.villageZone() : "UTC",
      enrollment: {
        id: row.id,
        journeyKey: row.journeyKey,
        journeyVersion: row.journeyVersion,
        contactId: row.contactId,
        subjectRef: row.subjectRef,
        enrolledAt: new Date(row.enrolledAt * 1000),
        stored: row.facts,
      },
      contact: c ? { id: c.id, email: c.email, name: c.name, userId: c.userId, timezone: c.timezone } : null,
      definition: def,
    };
    let facts: GatheredFacts = {};
    try {
      for (const provide of factsProvidersFor(def.kind)) facts = mergeFacts(facts, await provide(ctx));
    } catch {
      continue;
    }
    const answer = (await answerConditions([rule], { ...ctx, facts }))[rule];
    if (answer === null || answer === undefined) continue;
    answered += 1;
    if (answer) yes += 1;
  }
  return { count: ids.length > 0 && answered === 0 ? null : yes, asked: answered };
}

/** One journey's outcomes, step by step, in the order its steps run. */
export async function journeyOutcomes(deps: OutcomeDeps, def: JourneyDefinition): Promise<JourneyOutcomes> {
  const goals = GOAL_STOPS.filter((g) => def.stops.includes(g));
  const counts = await journeyStepCounts(deps.getPool(), def.key, goals);
  const byStep = new Map(counts.map((c) => [c.stepKey, c]));
  const rule = nextStepRuleOf(def);
  const order = [...def.steps.map((s) => s.key), ...counts.map((c) => c.stepKey).filter((k) => !def.steps.some((s) => s.key === k))];
  const steps: StepOutcome[] = [];
  for (const key of order) {
    const c = byStep.get(key);
    const next = rule && c && c.sent > 0 ? await tookNextStep(deps, def, rule, key) : { count: null, asked: 0 };
    steps.push({
      stepKey: key,
      sent: c?.sent ?? 0,
      delivered: c?.delivered ?? 0,
      bounced: c?.bounced ?? 0,
      unsubscribed: c?.unsubscribed ?? 0,
      rsvpd: c?.rsvpd ?? 0,
      came: c?.came ?? 0,
      reachedGoal: c?.reachedGoal ?? 0,
      tookNextStep: rule ? next.count : null,
      askedNextStep: next.asked,
    });
  }
  return { journeyKey: def.key, windowDays: OUTCOME_WINDOW_DAYS, goals, nextStepRule: rule, steps };
}
