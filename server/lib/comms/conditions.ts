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
import type { PermissionKind, PermissionState } from "../../../shared/comms/kinds";
import type { GatheredFacts, JourneyContext } from "./journeyRegistry";

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
