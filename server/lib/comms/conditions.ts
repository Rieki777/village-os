/**
 * EVERY SKIP-IF AND STOP RULE, BY KEY (the comms build spec 5.6 and 5.11).
 *
 *   registerCondition(key, answer)
 *
 * One answer per key, for every `ConditionKey` (a step's `skipIf`) and every
 * `StopKey` (a journey's `stops`), both declared in shared/comms/contracts.ts.
 * An answer is async and says true (the rule holds), false (it does not), or
 * null (it could not tell). Registering a key again replaces its answer, which
 * is how a later lane takes over a key this file answers provisionally.
 *
 * WHAT AN UNANSWERED KEY MEANS, and it differs on purpose:
 *
 *   a skip-if   the step WAITS (shared/comms/journeyPlan.ts, "unanswered").
 *               An email whose rule cannot be checked is never sent on a
 *               guess; the investor path's words awaiting review is the case
 *               this protects.
 *   a stop      the journey carries on. A rule nobody can check never ends
 *               somebody's journey.
 *
 * An answer that throws counts as unanswered, and the tick logs it with the
 * key and never with the person.
 *
 * WHO ANSWERS WHAT. This lane answers the gathering keys it can read from the
 * tables that exist (`withdrew`, `gathering_cancelled`, `gathering_removed`,
 * `time_still_being_voted`, `recap_already_sent`, `nobody_answered`,
 * `signed_up_within_36_hours`) and the two every journey stops on
 * (`unsubscribed`, `suppressed`). The paths lane (D1) adds the path, member and
 * joining keys through this same registry.
 *
 * An answer reads `ctx.facts`, which the facts providers filled
 * (./journeyRegistry.ts): the gathering occurrence (`facts.event`) and the
 * person's key (`facts.personKey`) for event journeys. SQL lives in
 * server/repos/, never here.
 */
import type { ConditionKey, StopKey } from "../../../shared/comms/contracts";
import { signedUpLate } from "../../../shared/comms/journeyPlan";
import { PERMISSION_KINDS, type PermissionKind, type PermissionState } from "../../../shared/comms/kinds";
import { goingCountOf, openTimePollOf, recapSentFor, rsvpStatusOf } from "../../repos/commsEventFacts";
import type { GatheredFacts, JourneyContext } from "./journeyRegistry";
import { isSuppressed } from "./suppressions";

/** A person's answer about one kind of email, as the people lane reads it (`answerFor`). */
export interface PermissionView {
  state: PermissionState;
  /** True when nothing stored decided it: the answer follows from what they did. */
  derived: boolean;
  /** Epoch ms their pause ends, while one holds. */
  pausedUntil: number | null;
}

export interface ConditionContext extends JourneyContext {
  facts: GatheredFacts;
  /**
   * The person's answer about one kind of email, through the people lane's
   * `answerFor` (server/lib/comms/permissions.ts). Handed in, because that file
   * imports this engine and an import back would be a cycle. Absent in a test
   * that does not need it, and then `unsubscribed` cannot be answered.
   */
  permission?(kind: PermissionKind): Promise<PermissionView | null>;
}

export type RuleKey = ConditionKey | StopKey;

export type ConditionAnswer = (ctx: ConditionContext) => Promise<boolean | null> | boolean | null;

const answers = new Map<RuleKey, ConditionAnswer>();

/** Answer one key. A second registration for the same key replaces the first. */
export function registerCondition(key: RuleKey, answer: ConditionAnswer): () => void {
  if (typeof answer !== "function") throw new TypeError(`conditions: the answer for "${key}" is not a function`);
  answers.set(key, answer);
  return () => {
    if (answers.get(key) === answer) answers.delete(key);
  };
}

/** True when some answer is registered for the key. */
export function hasCondition(key: RuleKey): boolean {
  return answers.has(key);
}

/** Every key with an answer, for the Journeys screen and the tests. */
export function registeredConditions(): RuleKey[] {
  return Array.from(answers.keys());
}

/**
 * Answer each key once. A key with no answer, or whose answer threw, comes
 * back null; so does a key whose answer was not a boolean.
 */
export async function answerConditions<K extends RuleKey>(keys: readonly K[], ctx: ConditionContext): Promise<Partial<Record<K, boolean | null>>> {
  const out: Partial<Record<K, boolean | null>> = {};
  for (const key of keys) {
    if (key in out) continue;
    const answer = answers.get(key);
    if (!answer) {
      out[key] = null;
      continue;
    }
    try {
      const v = await answer(ctx);
      out[key] = typeof v === "boolean" ? v : null;
    } catch (err) {
      console.error(`[comms] the journey rule "${key}" could not be answered, so it counts as unanswered`, err);
      out[key] = null;
    }
  }
  return out;
}

// ── The answers this lane gives ─────────────────────────────────────────────

const HOUR = 3_600_000;

/** The gathering occurrence the event provider found, or null for a journey about something else. */
const eventOf = (ctx: ConditionContext) => ctx.facts.event ?? null;

/**
 * The gathering's time vote is open, so its emails wait (5.6). A one-off vote
 * holds every step until it locks. A weekly vote never locks, so it holds an
 * occurrence only while that occurrence can still move: once it is inside the
 * vote's freeze window its time is settled and its emails go (5.10).
 */
registerCondition("time_still_being_voted", async (ctx) => {
  const ev = eventOf(ctx);
  if (!ev || !ev.found) return false;
  const poll = await openTimePollOf(ctx.getPool(), ev.eventId);
  if (!poll) return false;
  if (poll.mode !== "weekly") return true;
  if (!ev.startsAt) return true;
  return ev.startsAt.getTime() > ctx.now.getTime() + Math.max(0, poll.freezeHours) * HOUR;
});

/** They said yes less than 36 hours before the start, so the day-before reminder is noise. */
registerCondition("signed_up_within_36_hours", (ctx) => {
  const start = ctx.facts.eventStart ?? eventOf(ctx)?.startsAt ?? null;
  if (!start) return null;
  return signedUpLate(ctx.enrollment.enrolledAt, start);
});

/** The host already sent this occurrence's recap. */
registerCondition("recap_already_sent", async (ctx) => {
  const ev = eventOf(ctx);
  if (!ev) return null;
  if (!ev.found) return false;
  return recapSentFor(ctx.getPool(), ev.eventId, ev.occurrenceKey);
});

/** Nobody said they are going to this occurrence. */
registerCondition("nobody_answered", async (ctx) => {
  const ev = eventOf(ctx);
  if (!ev) return null;
  if (!ev.found) return true;
  return (await goingCountOf(ctx.getPool(), ev.eventId, ev.occurrenceKey)) === 0;
});

/** The person's answer is no longer `going`: taken back, declined, or changed to maybe. */
registerCondition("withdrew", async (ctx) => {
  const ev = eventOf(ctx);
  const personKey = ctx.facts.personKey;
  if (!ev || !ev.found || !personKey) return null;
  return (await rsvpStatusOf(ctx.getPool(), ev.eventId, ev.occurrenceKey, personKey)) !== "going";
});

/** The gathering, or this one occurrence of it, was called off. */
registerCondition("gathering_cancelled", (ctx) => {
  const ev = eventOf(ctx);
  if (!ev) return null;
  return ev.found && (ev.status === "cancelled" || ev.occurrenceCancelled);
});

/** The gathering was deleted, marked removed, or this occurrence taken out of its series. */
registerCondition("gathering_removed", (ctx) => {
  const ev = eventOf(ctx);
  if (!ev) return null;
  return !ev.found || ev.removed;
});

/** The person said no to this journey's kind of email (a stored no, never a derived one). */
registerCondition("unsubscribed", async (ctx) => {
  const kind = ctx.definition.emailKind;
  if (!ctx.permission || !(PERMISSION_KINDS as readonly string[]).includes(kind)) return null;
  const answer = await ctx.permission(kind as PermissionKind);
  if (!answer) return null;
  return answer.state === "no" && !answer.derived;
});

/** The address bounced, complained, or asked to stop everything. */
registerCondition("suppressed", async (ctx) => {
  if (!ctx.contact) return null;
  return isSuppressed(ctx.getPool(), ctx.contact.email);
});
