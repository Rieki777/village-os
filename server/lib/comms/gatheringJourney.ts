/**
 * THE GATHERING LANE'S PLUG INTO THE JOURNEY ENGINE (the comms build spec 5.6
 * and 5.7): a facts provider and a vars builder, written as plain functions in
 * the shapes the engine's registries take, and the one call that registers
 * both.
 *
 *   gatheringFactsProvider   registered for journey kind `event`. For a
 *                            `gathering.going` enrollment it answers the
 *                            gathering's reminder times, read live, as
 *                            `stepOverrides` (every reminder step kept or
 *                            skipped) and `extraSteps` (a time no step sits
 *                            at), and skips the confirmation for a seat the
 *                            waitlist handed over. So a host who turns
 *                            reminders off, or a village that changes its
 *                            dial, is heard on the next tick.
 *   gatheringVarsBuilder     registered under the merge group `gathering`.
 *                            Every `gathering.*` field for the enrollment's
 *                            evening and reader, and for the confirmation the
 *                            `.ics` the step carries.
 *
 * The engine is built in parallel (server/lib/comms/journeyRegistry.ts, the
 * journeys lane). Its types are mirrored here as the small structural shapes
 * this file reads, so this compiles on its own and the engine's own types are
 * accepted wherever they arrive. Connecting the two is one call at boot:
 *
 *   registerGatheringJourneyParts({ registerFactsProvider, registerVarsBuilder }, { getPool, postOffice })
 */
import type { Pool } from "mysql2/promise";
import type { JourneyDefinition, JourneyStep, OutgoingEmail } from "../../../shared/comms/contracts";
import { addressOfSender } from "../../../shared/comms/address";
import {
  effectiveReminders,
  GATHERING_GOING_JOURNEY,
  journeyReminderMinutes,
  reminderPlan,
  reminderSettingFromColumn,
  type GatheringReminderFacts,
  type GatheringStepOverride,
} from "../../../shared/comms/gatheringSettings";
import type { MergeValues } from "../../../shared/comms/mergeFields";
import { lockNoticeReached, readEventComms } from "../../repos/eventComms";
import { gatheringValues, icsGatheringOf, loadGathering } from "./gatheringVars";
import { buildGatheringIcs, hostOf, icsAttachment } from "./ics";
import type { PostOfficeDeps } from "./postOffice";
import type { EmailVillage } from "./render";

// ── The engine's shapes, as far as this file reads them ────────────────────

export interface JourneyContextLike {
  getPool(): Pool;
  now: Date;
  villageZone: string;
  enrollment: { id: string; journeyKey: string; contactId: string; subjectRef: string; stored: Record<string, unknown> };
  contact: { id: string; email: string; name: string | null; timezone: string | null } | null;
  definition: Pick<JourneyDefinition, "key" | "steps">;
  madeUp?: boolean;
}

export interface VarsContextLike extends JourneyContextLike {
  facts: Record<string, unknown>;
  step: Pick<JourneyStep, "key" | "templateKey">;
  village: EmailVillage;
}

export interface GatheringFactsAnswer {
  [field: string]: unknown;
  stepOverrides?: Record<string, GatheringStepOverride>;
  extraSteps?: JourneyStep[];
  personKey?: string | null;
}

export interface StepContentLike {
  vars?: MergeValues;
  attachments?: NonNullable<OutgoingEmail["attachments"]>;
}

export interface GatheringJourneyDeps {
  getPool(): Pool;
  postOffice: Pick<PostOfficeDeps, "origin" | "sender">;
}

/** `event:<id>:<occ>` read back into its two parts, or null for another subject. */
export function eventSubjectOf(subjectRef: string): { eventId: string; occurrenceKey: string } | null {
  const m = String(subjectRef ?? "").match(/^event:(.+):(\d{4}-\d{2}-\d{2}|)$/);
  return m ? { eventId: m[1], occurrenceKey: m[2] } : null;
}

const personKeyOf = (ctx: JourneyContextLike & { facts?: Record<string, unknown> }): string | null => {
  const from = ctx.facts?.personKey ?? ctx.enrollment.stored.personKey;
  return typeof from === "string" && from ? from : null;
};

/**
 * The gathering's reminder times and the waitlist's confirmation skip, for one
 * enrollment. A gathering on "default" keeps the journey's own reminder times
 * (`journeyReminderMinutes`): the dial while the journey is unedited, the
 * admin's edit once it is. "Off" and "custom" are the host's, and win.
 *
 * A confirmation a one-off vote held is skipped once "the time is set" has
 * reached the person: that email already says when, with the calendar file,
 * and a second one seconds later only repeats it.
 */
export async function gatheringFactsFor(
  pool: Pool,
  definition: Pick<JourneyDefinition, "key" | "steps">,
  subject: string,
  stored: Record<string, unknown>,
  contactId?: string,
): Promise<GatheringReminderFacts> {
  const ev = eventSubjectOf(subject);
  if (!ev || definition.key !== GATHERING_GOING_JOURNEY) return { stepOverrides: {}, extraSteps: [] };
  const setting = reminderSettingFromColumn((await readEventComms(pool, ev.eventId)).reminders);
  const plan = reminderPlan(effectiveReminders(setting, journeyReminderMinutes(definition)), definition);
  if (stored.promoted === true) plan.stepOverrides.confirm = { skip: true };
  else if (contactId && (await lockNoticeReached(pool, ev.eventId, contactId))) plan.stepOverrides.confirm = { skip: true };
  return plan;
}

/** The facts provider, for journey kind `event`. */
export function gatheringFactsProvider(deps: GatheringJourneyDeps) {
  return async (ctx: JourneyContextLike): Promise<GatheringFactsAnswer> => {
    if (ctx.definition.key !== GATHERING_GOING_JOURNEY) return {};
    const plan = await gatheringFactsFor(ctx.getPool(), ctx.definition, ctx.enrollment.subjectRef, ctx.enrollment.stored, ctx.enrollment.contactId);
    return { ...plan, personKey: personKeyOf(ctx) };
  };
}

/** The vars builder, for the merge group `gathering`. */
export function gatheringVarsBuilder(deps: GatheringJourneyDeps) {
  return async (ctx: VarsContextLike): Promise<StepContentLike> => {
    const ev = eventSubjectOf(ctx.enrollment.subjectRef);
    if (!ev) return {};
    const pool = ctx.getPool();
    const g = await loadGathering(pool, ev.eventId, ev.occurrenceKey, ctx.villageZone);
    if (!g) return {};
    const origin = deps.postOffice.origin();
    const vars = await gatheringValues(pool, g, {
      origin,
      villageZone: ctx.villageZone,
      readerZone: ctx.contact?.timezone ?? null,
      // Only somebody holding a seat can give it back.
      personKey: ctx.enrollment.journeyKey === GATHERING_GOING_JOURNEY ? personKeyOf(ctx) : null,
      now: ctx.now,
    });
    if (ctx.step.templateKey !== "gathering.confirm" || !ctx.contact) return { vars };
    const sender = addressOfSender(deps.postOffice.sender());
    const ics = buildGatheringIcs(icsGatheringOf(g, origin, ctx.villageZone), {
      method: "REQUEST",
      sequence: (await readEventComms(pool, ev.eventId)).icsSequence,
      host: hostOf(origin),
      organizer: sender ? { name: ctx.village.name, email: sender } : null,
      attendee: { name: ctx.contact.name, email: ctx.contact.email },
      now: ctx.now,
    });
    return { vars, attachments: [icsAttachment(ics, "REQUEST")] };
  };
}

/** The engine's two registries, as far as this lane calls them. */
export interface JourneyRegistriesLike {
  registerFactsProvider(kind: "event", provider: (ctx: any) => Promise<GatheringFactsAnswer>, name?: string): unknown;
  registerVarsBuilder(key: "gathering", builder: (ctx: any) => Promise<StepContentLike>, name?: string): unknown;
}

/** Register both, under names that make a second registration replace the first. */
export function registerGatheringJourneyParts(registries: JourneyRegistriesLike, deps: GatheringJourneyDeps): void {
  registries.registerFactsProvider("event", gatheringFactsProvider(deps), "gathering-reminders");
  registries.registerVarsBuilder("gathering", gatheringVarsBuilder(deps), "gathering-vars");
}
