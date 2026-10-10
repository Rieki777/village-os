/**
 * THE JOURNEY ENGINE'S EXTENSION POINTS: what a lane plugs in so the tick
 * knows the facts of its journeys and the words' values (the comms build spec
 * 5.6). The condition registry sits beside these in ./conditions.ts.
 *
 * ── FACTS PROVIDERS, BY JOURNEY KIND ───────────────────────────────────────
 *
 *   registerFactsProvider(kind, provider, name?)
 *
 * Before planning one enrollment, the tick calls every provider registered for
 * its journey's kind (`event`, `path`, `joining`, `member`, `poll`), in the
 * order they were registered, and merges what they answer:
 *
 *   - plain fields: a later provider's value replaces an earlier one's;
 *   - `stepOverrides`: merged key by key, a later provider winning a key;
 *   - `extraSteps`: added together, a later step replacing an earlier one
 *     with the same key;
 *   - `conditions`: merged key by key.
 *
 * The planner reads `PlanFacts` (shared/comms/journeyPlan.ts). The two fields
 * an event lane needs are there for it: `stepOverrides`, a step key to
 * `{ offsetMinutes?, skip? }`, and `extraSteps`, a gathering's own reminders.
 * Anything else a provider returns rides along in `GatheredFacts` for the
 * conditions and the vars builders to read; name such fields after your lane
 * so two providers never collide.
 *
 * This lane registers the `event` provider (./journeyFacts.ts): the gathering
 * occurrence's live start and end through server/lib/calendar.ts, its status,
 * the person's attendance, and their person key.
 *
 * ── VARS BUILDERS, BY JOURNEY KIND AND BY MERGE GROUP ──────────────────────
 *
 *   registerVarsBuilder(key, builder, name?)
 *
 * Before rendering one step, the tick calls the builders registered under
 * `common`, then under the journey's KIND, then under each MERGE GROUP the
 * step's template may use (`groupsForTemplate`, shared/comms/mergeFields.ts),
 * each key once, in that order. Their values are merged (a later builder wins
 * a field) and their attachments added together. So the gathering lane may
 * register its builder as "event" or as "gathering", and the path lane as
 * "path", "member" and "joining": every one is found. This lane registers
 * `common`: the reader's name.
 *
 * A builder answers `{ vars, attachments }`. Values follow the catalogue
 * (`MERGE_FIELDS`); an attachment is how a confirmation carries its `.ics`.
 *
 * ── NAMES ───────────────────────────────────────────────────────────────────
 *
 * The optional `name` makes a registration replaceable: registering again
 * under the same name swaps the function in place, so a module loaded twice
 * (a test, a hot reload) never answers twice. Without a name, the same
 * function registered twice is still one registration. Every register call
 * answers a function that takes the registration back out, for tests.
 *
 * Nothing here touches the database. A provider or builder that throws is
 * reported by the tick and the enrollment is looked at again later; it never
 * takes the rest of the tick down.
 */
import type { Pool } from "mysql2/promise";
import type { JourneyDefinition, JourneyKind, JourneyStep, OutgoingEmail, PostResult } from "../../../shared/comms/contracts";
import type { PlanFacts } from "../../../shared/comms/journeyPlan";
import { groupsForTemplate, type MergeGroup, type MergeValues } from "../../../shared/comms/mergeFields";
import type { EmailVillage } from "./render";

// ── What every extension is handed ─────────────────────────────────────────

/** One enrollment, as the engine reads it. */
export interface EnrollmentView {
  id: string;
  journeyKey: string;
  /** The version of the journey this person is walking (they keep it when it is edited). */
  journeyVersion: number;
  contactId: string;
  /** `event:<id>:<occ>`, `path:<pathId>`, `form:<submissionId>`, `account` or `poll:<pollId>`. */
  subjectRef: string;
  enrolledAt: Date;
  /** What the trigger stored when it enrolled the person (`comms_enrollments.facts`). */
  stored: Record<string, unknown>;
}

/** The person, from the address book. Null for a contact that is gone. */
export interface ContactView {
  id: string;
  email: string;
  name: string | null;
  userId: string | null;
  /** Their own IANA zone, when their device told us. */
  timezone: string | null;
}

export interface JourneyContext {
  getPool(): Pool;
  /** The moment being planned: now for the tick, a later moment for a walk-through. */
  now: Date;
  /** The village's IANA zone. */
  villageZone: string;
  enrollment: EnrollmentView;
  contact: ContactView | null;
  /** The definition this enrollment walks. */
  definition: JourneyDefinition;
  /**
   * True for a made-up person on "Walk someone through it": nothing about
   * them is in the database, so a provider should answer from `stored` alone.
   */
  madeUp?: boolean;
}

/** The `event` provider's answer about a gathering occurrence (./journeyFacts.ts). */
export interface EventFacts {
  eventId: string;
  occurrenceKey: string;
  /** False when no gathering has this id, or the occurrence is not part of it any more. */
  found: boolean;
  /** Deleted, marked removed, or the occurrence taken out of its series. */
  removed: boolean;
  /** `draft`, `scheduled`, `cancelled` or `postponed`, or null when not found. */
  status: string | null;
  /** This occurrence alone was called off. */
  occurrenceCancelled: boolean;
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Everything gathered for one enrollment: the planner's facts, plus whatever
 * the providers add for the conditions and builders to read.
 */
export interface GatheredFacts extends PlanFacts {
  /** The person's key on gathering tables: a user id, or `guest:<contactId>`. */
  personKey?: string | null;
  /** The gathering occurrence, for event journeys. */
  event?: EventFacts | null;
  [extra: string]: unknown;
}

export type FactsProvider = (ctx: JourneyContext) => Promise<Partial<GatheredFacts>> | Partial<GatheredFacts>;

/** The keys a vars builder may be registered under. */
export type VarsKey = JourneyKind | MergeGroup;

export interface VarsContext extends JourneyContext {
  facts: GatheredFacts;
  /** The step being rendered, as planned (overrides applied). */
  step: JourneyStep;
  /** The village as its emails show it. */
  village: EmailVillage;
}

export type EmailAttachment = NonNullable<OutgoingEmail["attachments"]>[number];

/** What a builder adds to one email. */
export interface StepContent {
  vars?: MergeValues;
  attachments?: EmailAttachment[];
}

export type VarsBuilder = (ctx: VarsContext) => Promise<StepContent> | StepContent;

// ── The registries ─────────────────────────────────────────────────────────

interface Entry<F> {
  key: string;
  name: string | null;
  fn: F;
}

const factsProviders: Array<Entry<FactsProvider>> = [];
const varsBuilders: Array<Entry<VarsBuilder>> = [];

function add<F>(list: Array<Entry<F>>, key: string, fn: F, name?: string): () => void {
  if (typeof fn !== "function") throw new TypeError(`journeys: the registration for "${key}" is not a function`);
  const named = typeof name === "string" && name ? name : null;
  const at = list.findIndex((e) => (named !== null ? e.name === named : e.key === key && e.fn === fn));
  const entry: Entry<F> = { key, name: named, fn };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  return () => {
    const i = list.indexOf(entry);
    if (i >= 0) list.splice(i, 1);
  };
}

/** Add a facts provider for one journey kind. See the header for how answers merge. */
export function registerFactsProvider(kind: JourneyKind, provider: FactsProvider, name?: string): () => void {
  return add(factsProviders, kind, provider, name);
}

/** Add a vars builder under a journey kind or a merge group. See the header for the order they run in. */
export function registerVarsBuilder(key: VarsKey, builder: VarsBuilder, name?: string): () => void {
  return add(varsBuilders, key, builder, name);
}

/**
 * What a step-posted hook is handed: the step as it was rendered, and what
 * the post office said. Called once per step the tick posts (never for a
 * `duplicate`), after the post, so a hook can do the one thing a step means
 * beyond its email: the paths lane asks a person to write at day 21 (5.11).
 * A hook that throws is logged and changes nothing about the step.
 */
export interface StepPostedContext extends VarsContext {
  result: PostResult;
}

export type StepPostedHook = (ctx: StepPostedContext) => Promise<void> | void;

const stepPostedHooks: Array<Entry<StepPostedHook>> = [];

/** Add a hook for the steps of one journey kind, called after each is posted. */
export function registerStepPosted(kind: JourneyKind, hook: StepPostedHook, name?: string): () => void {
  return add(stepPostedHooks, kind, hook, name);
}

/** The step-posted hooks for one kind, in registration order. */
export function stepPostedHooksFor(kind: JourneyKind): StepPostedHook[] {
  return stepPostedHooks.filter((e) => e.key === kind).map((e) => e.fn);
}

/** The providers for one kind, in registration order. */
export function factsProvidersFor(kind: JourneyKind): FactsProvider[] {
  return factsProviders.filter((e) => e.key === kind).map((e) => e.fn);
}

/** The builders for one step: `common`, the journey's kind, then each merge group its template may use. */
export function varsBuildersFor(definition: Pick<JourneyDefinition, "kind">, step: Pick<JourneyStep, "templateKey">): VarsBuilder[] {
  const keys: string[] = [];
  for (const k of ["common", definition.kind, ...groupsForTemplate(step.templateKey)]) if (!keys.includes(k)) keys.push(k);
  const out: VarsBuilder[] = [];
  for (const k of keys) for (const e of varsBuilders) if (e.key === k && !out.includes(e.fn)) out.push(e.fn);
  return out;
}

// ── Merging ─────────────────────────────────────────────────────────────────

/** One provider's answer laid over what was gathered before it. */
export function mergeFacts(base: GatheredFacts, add: Partial<GatheredFacts> | null | undefined): GatheredFacts {
  if (!add || typeof add !== "object") return base;
  const out: GatheredFacts = { ...base, ...add };
  if (base.stepOverrides || add.stepOverrides) out.stepOverrides = { ...(base.stepOverrides ?? {}), ...(add.stepOverrides ?? {}) };
  if (base.conditions || add.conditions) out.conditions = { ...(base.conditions ?? {}), ...(add.conditions ?? {}) };
  if (base.extraSteps || add.extraSteps) {
    const byKey = new Map<string, JourneyStep>();
    for (const s of [...(base.extraSteps ?? []), ...(add.extraSteps ?? [])]) if (s && typeof s.key === "string") byKey.set(s.key, s);
    out.extraSteps = Array.from(byKey.values());
  }
  return out;
}

/** Every builder's content for one step, merged. */
export async function buildStepContent(ctx: VarsContext): Promise<{ vars: MergeValues; attachments: EmailAttachment[] }> {
  let vars: MergeValues = {};
  const attachments: EmailAttachment[] = [];
  for (const build of varsBuildersFor(ctx.definition, ctx.step)) {
    const got = await build(ctx);
    if (got?.vars) vars = { ...vars, ...got.vars };
    if (Array.isArray(got?.attachments)) attachments.push(...got.attachments);
  }
  return { vars, attachments };
}
