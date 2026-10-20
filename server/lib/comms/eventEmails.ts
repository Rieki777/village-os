/**
 * EVENT EMAILS: what comms does when somebody answers a gathering, joins its
 * waitlist, is handed a seat, or when the gathering itself changes, is called
 * off or goes live (the comms build spec 5.7). One function per trigger; the
 * dispatcher (./dispatch.ts) hands each trigger here.
 *
 *   rsvp_changed going     ensure the person's contact, put them on
 *                          `gathering.going` for `event:<id>:<occ>` with
 *                          facts naming the gathering, the evening, the
 *                          person, what they were told and the gathering's
 *                          own reminder times, and post the confirmation now
 *                          with its `.ics`. The host is put on
 *                          `gathering.host` for that evening.
 *   rsvp_changed otherwise stop that person's enrollment and withdraw any of
 *                          its emails still queued. No email.
 *   waitlist_joined        `gathering.waitlisted`.
 *   waitlist_promoted      `gathering.promoted` with the `.ics`, then enroll,
 *                          with the confirmation step skipped (the promoted
 *                          email is their confirmation).
 *   gathering_changed      re-plan everybody (`touch`). For a change of time
 *                          or place, bump the SEQUENCE and post
 *                          `gathering.changed` with the updated `.ics` to
 *                          everyone going who has not been told this version.
 *                          An evening taken out of a series, or called off on
 *                          its own, is cancelled for its people instead.
 *   gathering_cancelled    `gathering.cancelled` with a METHOD:CANCEL `.ics`
 *                          to everyone going or waiting, then stop every
 *                          enrollment on the gathering and withdraw their
 *                          queued emails. A DELETED gathering's answers are
 *                          already gone, so its audience is its active
 *                          enrollments and their facts say what to write.
 *   gathering_published    put the host on `gathering.host` for the next
 *                          evening.
 *
 * ── EVERY POST HAS A STABLE KEY, SO A RETRIED TRIGGER SENDS ONCE ───────────
 *
 *   confirmation  j:gathering.going:confirm:<enrollmentId>      the journey's
 *                 own key, so the tick sees the step as posted; a second yes
 *                 after a "can't make it" is a new round, `...:r<n>`
 *   changed       ev:<id>:<occ>:changed:<sequence>:<person>
 *   cancelled     ev:<id>:<occ>:cancelled:<person>
 *   waitlisted    ev:<id>:<occ>:waitlisted:<person>:<joined at>
 *   promoted      ev:<id>:<occ>:promoted:<person>:<seated at>
 *
 * A change is posted only to people whose facts say they were told something
 * else (`told`), so a trigger delivered twice finds everybody told and
 * neither bumps the SEQUENCE nor posts. A cancellation's key names no
 * sequence, and its SEQUENCE is stored only once a notice actually went.
 *
 * ── WHAT GOVERNS WHETHER THEY GO ───────────────────────────────────────────
 *
 * The confirmation is a step of `gathering.going`, so it goes only while the
 * village has that journey on, never while the gathering's time is still being
 * voted, and never for a seat the waitlist handed over. The other notices are
 * not a journey's (the Words screen files them under no journey), so they go
 * whenever the comms module lets gathering email go; the post office asks
 * that, and permission, suppression, the pause and rehearsal, of every one.
 * While a time vote is open, a moved time emails nothing here: the vote's own
 * emails say it (5.10).
 *
 * Runs after the change it reports has committed, from the sink, so it may
 * take its time and may fail without undoing anything.
 */
import type { Pool } from "mysql2/promise";
import type { CommsTrigger, OutgoingEmail, PostResult } from "../../../shared/comms/contracts";
import { subjectRef } from "../../../shared/comms/contracts";
import { addressOfSender, emailKeyOf } from "../../../shared/comms/address";
import { defaultJourney } from "../../../shared/comms/defaults/journeys";
import {
  effectiveReminders,
  GATHERING_GOING_JOURNEY,
  GATHERING_HOST_JOURNEY,
  parseReminderDial,
  reminderPlan,
  reminderSettingFromColumn,
  type GatheringReminderFacts,
} from "../../../shared/comms/gatheringSettings";
import { contactIdOfGuestKey } from "../../../shared/comms/kinds";
import type { MergeValues } from "../../../shared/comms/mergeFields";
import { getCalendarRow, type CalendarRow } from "../calendar";
import { isExampleUser } from "../examples";
import { isTombstone } from "../oauthAccounts";
import { stringVar } from "../variables";
import { villageTimezone } from "../villageReaders";
import { contactByEmailKey, contactById } from "../../repos/commsContacts";
import { cancelQueued } from "../../repos/commsMessages";
import { usersRepo } from "../../repos/users";
import {
  activeEnrollmentsOn,
  bumpIcsSequence,
  enrollmentFor,
  goingAnswers,
  journeyIsOn,
  openTimePollMode,
  queuedMessageIdsFor,
  raiseIcsSequence,
  readEventComms,
  rsvpStatusOf,
  updateGatheringFacts,
  waitingPlaces,
  waitlistPlaceOf,
} from "../../repos/eventComms";
import { ensureContact } from "./contacts";
import {
  gatheringValues,
  hostUserIdOf,
  icsGatheringOf,
  loadGathering,
  nextOccurrence,
  notEnded,
  occurrenceOf,
  personValues,
  snapshotOf,
  type GatheringSnapshot,
} from "./gatheringVars";
import { buildGatheringIcs, hostOf, icsAttachment, type IcsMethod } from "./ics";
import { enroll, stop, touch } from "./journeys";
import { post, type PostOfficeDeps } from "./postOffice";
import { loadEmailVillage, renderTemplate, type EmailVillage } from "./render";

export interface EventEmailDeps {
  getPool(): Pool;
  postOffice: PostOfficeDeps;
  /** The village's IANA zone. Absent: the zone the seasons turn on. */
  timezone?(): string;
  /** The clock. Tests pin it. */
  now?(): Date;
  /** The village's reminder times, in minutes. Absent: the `comms.event_reminder_minutes` dial. */
  reminderMinutes?(): number[];
}

/** The triggers this file answers. */
export const GATHERING_TRIGGERS = [
  "rsvp_changed",
  "waitlist_joined",
  "waitlist_promoted",
  "gathering_changed",
  "gathering_cancelled",
  "gathering_published",
] as const;

type GatheringTrigger = Extract<CommsTrigger, { type: (typeof GATHERING_TRIGGERS)[number] }>;

export const isGatheringTrigger = (t: CommsTrigger): t is GatheringTrigger =>
  (GATHERING_TRIGGERS as readonly string[]).includes(t.type);

/** What one handler run reads once and passes around. */
interface Run {
  deps: EventEmailDeps;
  pool: Pool;
  tz: string;
  now: Date;
  origin: string;
  village: () => Promise<EmailVillage>;
}

function runOf(deps: EventEmailDeps): Run {
  const pool = deps.getPool();
  const origin = deps.postOffice.origin();
  let village: Promise<EmailVillage> | null = null;
  return {
    deps,
    pool,
    tz: (deps.timezone ? deps.timezone() : villageTimezone()) || "UTC",
    now: deps.now ? deps.now() : new Date(),
    origin,
    village: () => (village ??= loadEmailVillage(pool, origin)),
  };
}

/** The journey every yes walks, as the platform defines it. */
const goingDefinition = () => defaultJourney(GATHERING_GOING_JOURNEY);

// ── Who a person key is ─────────────────────────────────────────────────────

export interface Person {
  personKey: string;
  contactId: string;
  email: string;
  name: string | null;
  userId: string | null;
  timezone: string | null;
}

/**
 * The person behind a key, with their contact. A member gets a contact made
 * when `create` and has none; an example identity and a closed account are
 * nobody, because nobody reads their inbox.
 */
export async function personFor(pool: Pool, personKey: string, create: boolean): Promise<Person | null> {
  const guest = contactIdOfGuestKey(personKey);
  if (guest) {
    const c = await contactById(pool, guest);
    return c ? { personKey, contactId: c.id, email: c.email, name: c.name, userId: c.userId, timezone: c.timezone } : null;
  }
  const member = await usersRepo(pool).byId(personKey);
  if (!member || isExampleUser(member) || isTombstone({ email: String(member.email ?? "") })) return null;
  const email = String(member.email ?? "").trim();
  if (!email) return null;
  let contactId: string | null = null;
  if (create) {
    contactId = (await ensureContact({ getPool: () => pool }, { email, name: member.name ?? null, userId: member.id, source: "account" }))?.id ?? null;
  } else {
    contactId = (await contactByEmailKey(pool, emailKeyOf(email)))?.id ?? null;
  }
  if (!contactId) return null;
  const c = await contactById(pool, contactId);
  return { personKey, contactId, email, name: String(member.name ?? "").trim() || c?.name || null, userId: member.id, timezone: c?.timezone ?? null };
}

// ── What a gathering's reminders tell the planner ──────────────────────────

/** The village's reminder times, from the `comms.event_reminder_minutes` dial. */
export function villageReminderMinutes(): number[] {
  try {
    return parseReminderDial(stringVar("comms.event_reminder_minutes"));
  } catch {
    return parseReminderDial("1440,120");
  }
}

const villageReminders = (deps: EventEmailDeps): number[] => (deps.reminderMinutes ? deps.reminderMinutes() : villageReminderMinutes());

/** One gathering's reminder times, as step overrides and extra steps against the going journey. */
export async function gatheringReminderFacts(deps: EventEmailDeps, eventId: string): Promise<GatheringReminderFacts> {
  const def = goingDefinition();
  if (!def) return { stepOverrides: {}, extraSteps: [] };
  const setting = reminderSettingFromColumn((await readEventComms(deps.getPool(), eventId)).reminders);
  return reminderPlan(effectiveReminders(setting, villageReminders(deps)), def);
}

/** What a person was last told about an evening: the facts a change is compared against. */
export interface Told {
  title: string;
  startsAt: string;
  endsAt: string | null;
  where: string | null;
  sequence: number;
}

export const toldOf = (g: GatheringSnapshot, sequence: number): Told => ({
  title: g.title,
  startsAt: g.startsAt.toISOString(),
  endsAt: g.endsAt ? g.endsAt.toISOString() : null,
  where: g.where,
  sequence,
});

/** True when what they were told about the time or the place is not what it is now. */
export function toldDiffers(told: unknown, g: GatheringSnapshot): boolean {
  if (!told || typeof told !== "object") return true;
  const t = told as Partial<Told>;
  const now = toldOf(g, 0);
  return t.startsAt !== now.startsAt || (t.endsAt ?? null) !== now.endsAt || (t.where ?? null) !== now.where;
}

// ── Posting one email ───────────────────────────────────────────────────────

interface Letter {
  templateKey: string;
  key: string;
  origin: string;
  urgent: boolean;
  expiresAt: Date | null;
  values: MergeValues;
  ics?: { method: IcsMethod; sequence: number; gathering: GatheringSnapshot } | null;
  source?: OutgoingEmail["source"];
}

/** Render one gathering email for one person, and post it. */
async function postLetter(run: Run, person: Person, letter: Letter): Promise<PostResult> {
  const village = await run.village();
  const rendered = await renderTemplate(
    letter.templateKey,
    { ...personValues(person.name), ...letter.values },
    { getPool: () => run.pool, village, contactId: person.contactId, kind: "events" },
  );
  let attachments: OutgoingEmail["attachments"];
  if (letter.ics) {
    const sender = addressOfSender(run.deps.postOffice.sender());
    const ics = buildGatheringIcs(icsGatheringOf(letter.ics.gathering, run.origin, run.tz), {
      method: letter.ics.method,
      sequence: letter.ics.sequence,
      host: hostOf(run.origin),
      organizer: sender ? { name: village.name, email: sender } : null,
      attendee: { name: person.name, email: person.email },
      now: run.now,
    });
    attachments = [icsAttachment(ics, letter.ics.method)];
  }
  return post(run.deps.postOffice, {
    idempotencyKey: letter.key,
    kind: "events",
    origin: letter.origin,
    to: { email: person.email, name: person.name, userId: person.userId, contactId: person.contactId },
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    preheader: rendered.preheader,
    attachments,
    source: { templateKey: letter.templateKey, templateVersion: rendered.version ?? undefined, ...(letter.source ?? {}) },
    urgent: letter.urgent,
    expiresAt: letter.expiresAt,
  });
}

const evKey = (g: { eventId: string; occurrenceKey: string }, what: string, ...rest: Array<string | number>) =>
  [`ev:${g.eventId}:${g.occurrenceKey}:${what}`, ...rest.map(String)].join(":");

async function valuesFor(run: Run, g: GatheringSnapshot, person: Person, withLink = true): Promise<MergeValues> {
  return gatheringValues(run.pool, g, {
    origin: run.origin,
    villageZone: run.tz,
    readerZone: person.timezone,
    personKey: withLink ? person.personKey : null,
    now: run.now,
  });
}

/** Withdraw what is still queued for these enrollments: reminders that must not go now. */
async function withdrawQueued(pool: Pool, enrollmentIds: string[]): Promise<number> {
  let n = 0;
  for (const id of await queuedMessageIdsFor(pool, enrollmentIds)) if (await cancelQueued(pool, id)) n += 1;
  return n;
}

// ── The host ────────────────────────────────────────────────────────────────

/**
 * Put the gathering's host on `gathering.host` for one evening, so they are
 * asked for the recap after it. A gathering on somebody's own private calendar
 * has no audience to write to, so it has no host journey.
 */
export async function ensureHostEnrollment(run: Run, row: CalendarRow, occurrenceKey: string): Promise<string | null> {
  if (row.layer === "private") return null;
  const hostId = await hostUserIdOf(run.pool, row.id);
  if (!hostId) return null;
  const host = await personFor(run.pool, hostId, true);
  if (!host) return null;
  const made = await enroll(
    { getPool: () => run.pool },
    {
      journeyKey: GATHERING_HOST_JOURNEY,
      contactId: host.contactId,
      subjectRef: subjectRef.event(row.id, occurrenceKey),
      facts: { eventId: row.id, occurrenceKey, personKey: hostId, role: "host" },
    },
  );
  return made.enrollmentId;
}

// ── Saying yes ──────────────────────────────────────────────────────────────

/** Why a confirmation is not posted now, or null when it may go. */
async function confirmationHold(run: Run, g: GatheringSnapshot, promoted: boolean): Promise<string | null> {
  if (promoted) return "promoted";
  if (!notEnded(g, run.now)) return "over";
  if (!(await journeyIsOn(run.pool, GATHERING_GOING_JOURNEY))) return "journey_off";
  // A one-off vote holds it: the time is not known yet, and the vote's "the
  // time is set" email goes to everybody who said yes when it locks. A weekly
  // vote never locks, so holding would mean no confirmation at all; it goes
  // now, and a move sends its own email with the new time.
  if ((await openTimePollMode(run.pool, g.eventId)) === "once") return "time_still_being_voted";
  return null;
}

export interface GoingOutcome {
  enrollmentId: string | null;
  confirmation: PostResult | null;
  held: string | null;
}

/** Somebody holds a seat: enroll them, and confirm it when the confirmation may go. */
export async function onGoing(run: Run, eventId: string, occurrenceKey: string, personKey: string, opts: { promoted?: boolean } = {}): Promise<GoingOutcome> {
  const none: GoingOutcome = { enrollmentId: null, confirmation: null, held: "gone" };
  const row = await getCalendarRow(run.pool, eventId);
  if (!row) return none;
  const occ = occurrenceOf(row, occurrenceKey, run.tz);
  if (!occ) return none;
  const g = snapshotOf(row, occ);
  const person = await personFor(run.pool, personKey, true);
  if (!person) return { ...none, held: "no_person" };
  await ensureHostEnrollment(run, row, g.occurrenceKey);

  const promoted = opts.promoted === true;
  const subject = subjectRef.event(eventId, g.occurrenceKey);
  const before = await enrollmentFor(run.pool, GATHERING_GOING_JOURNEY, person.contactId, subject);
  const sequence = (await readEventComms(run.pool, eventId)).icsSequence;
  const reminders = await gatheringReminderFacts(run.deps, eventId);
  const stepOverrides = { ...reminders.stepOverrides, ...(promoted ? { confirm: { skip: true } } : {}) };
  const facts = {
    eventId,
    occurrenceKey: g.occurrenceKey,
    personKey,
    told: toldOf(g, sequence),
    stepOverrides,
    extraSteps: reminders.extraSteps,
    ...(promoted ? { promoted: true } : {}),
  };
  const made = await enroll({ getPool: () => run.pool }, { journeyKey: GATHERING_GOING_JOURNEY, contactId: person.contactId, subjectRef: subject, facts });

  // A second yes after a "can't make it" picked the old enrollment up again.
  // It is a new round: their facts start over, and so does their confirmation.
  let round = 0;
  if (before && before.state === "stopped") {
    round = Number(before.facts.round ?? 0) + 1;
    await updateGatheringFacts(run.pool, made.enrollmentId, () => ({ ...facts, round }));
  } else if (before && before.state === "active") {
    // The same yes again. Nothing about them changed, and nothing is sent twice.
    return { enrollmentId: made.enrollmentId, confirmation: null, held: "already_enrolled" };
  }

  const held = await confirmationHold(run, g, promoted);
  if (held) return { enrollmentId: made.enrollmentId, confirmation: null, held };
  const step = goingDefinition()?.steps.find((s) => s.key === "confirm");
  if (!step || stepOverrides.confirm?.skip) return { enrollmentId: made.enrollmentId, confirmation: null, held: "turned_off" };
  const confirmation = await postLetter(run, person, {
    templateKey: step.templateKey,
    key: `j:${GATHERING_GOING_JOURNEY}:${step.key}:${made.enrollmentId}${round ? `:r${round}` : ""}`,
    origin: "journey",
    urgent: true,
    expiresAt: g.startsAt,
    values: await valuesFor(run, g, person),
    ics: { method: "REQUEST", sequence, gathering: g },
    source: { journeyKey: GATHERING_GOING_JOURNEY, stepKey: step.key, enrollmentId: made.enrollmentId },
  });
  return { enrollmentId: made.enrollmentId, confirmation, held: null };
}

/** Somebody gave their seat up, or never took one: they leave the journey. No email. */
export async function onNotGoing(run: Run, eventId: string, occurrenceKey: string, personKey: string): Promise<number> {
  const person = await personFor(run.pool, personKey, false);
  if (!person) return 0;
  const subject = subjectRef.event(eventId, occurrenceKey);
  const enrollment = await enrollmentFor(run.pool, GATHERING_GOING_JOURNEY, person.contactId, subject);
  const stopped = await stop({ getPool: () => run.pool }, { journeyKey: GATHERING_GOING_JOURNEY, contactId: person.contactId, subjectRef: subject }, "withdrew");
  if (enrollment) await withdrawQueued(run.pool, [enrollment.id]);
  return stopped;
}

// ── The waitlist ────────────────────────────────────────────────────────────

export async function onWaitlistJoined(run: Run, eventId: string, occurrenceKey: string, personKey: string): Promise<PostResult | null> {
  const g = await loadGathering(run.pool, eventId, occurrenceKey, run.tz);
  if (!g || !notEnded(g, run.now)) return null;
  const place = await waitlistPlaceOf(run.pool, eventId, personKey, g.occurrenceKey);
  if (!place || !place.waiting) return null;
  const person = await personFor(run.pool, personKey, true);
  if (!person) return null;
  return postLetter(run, person, {
    templateKey: "gathering.waitlisted",
    key: evKey(g, "waitlisted", personKey, place.joinedAtMs),
    origin: "event.waitlisted",
    urgent: true,
    expiresAt: g.startsAt,
    values: await valuesFor(run, g, person, false),
  });
}

export async function onWaitlistPromoted(run: Run, eventId: string, occurrenceKey: string, personKey: string): Promise<{ promoted: PostResult | null; going: GoingOutcome | null }> {
  const g = await loadGathering(run.pool, eventId, occurrenceKey, run.tz);
  if (!g || !notEnded(g, run.now)) return { promoted: null, going: null };
  // Seated, and still holding the seat: a person who gave it straight back is told nothing.
  if ((await rsvpStatusOf(run.pool, eventId, personKey, g.occurrenceKey)) !== "going") return { promoted: null, going: null };
  const person = await personFor(run.pool, personKey, true);
  if (!person) return { promoted: null, going: null };
  const place = await waitlistPlaceOf(run.pool, eventId, personKey, g.occurrenceKey);
  const sequence = (await readEventComms(run.pool, eventId)).icsSequence;
  const promoted = await postLetter(run, person, {
    templateKey: "gathering.promoted",
    key: evKey(g, "promoted", personKey, place?.promotedAtMs ?? 0),
    origin: "event.promoted",
    urgent: true,
    expiresAt: g.startsAt,
    values: await valuesFor(run, g, person),
    ics: { method: "REQUEST", sequence, gathering: g },
  });
  const going = await onGoing(run, eventId, g.occurrenceKey, personKey, { promoted: true });
  return { promoted, going };
}

// ── Cancelling ──────────────────────────────────────────────────────────────

interface Notice {
  person: Person;
  g: GatheringSnapshot;
}

/**
 * Post one cancellation to each person, under one new SEQUENCE, and store the
 * SEQUENCE only when at least one notice actually went: a trigger delivered
 * twice finds every key used and moves nothing.
 */
async function postCancellations(run: Run, eventId: string, notices: Notice[]): Promise<number> {
  if (!notices.length) return 0;
  const sequence = (await readEventComms(run.pool, eventId)).icsSequence + 1;
  let posted = 0;
  for (const { person, g } of notices) {
    const r = await postLetter(run, person, {
      templateKey: "gathering.cancelled",
      key: evKey(g, "cancelled", person.personKey),
      origin: "event.cancelled",
      urgent: false,
      expiresAt: g.startsAt,
      values: await valuesFor(run, g, person, false),
      ics: { method: "CANCEL", sequence, gathering: g },
    });
    if (r.status !== "duplicate") posted += 1;
  }
  if (posted) await raiseIcsSequence(run.pool, eventId, sequence);
  return posted;
}

/** Stop every gathering enrollment on a subject, and withdraw what they still had queued. */
async function stopAllOn(run: Run, subject: string, reason: string): Promise<number> {
  const active = await activeEnrollmentsOn(run.pool, [GATHERING_GOING_JOURNEY, GATHERING_HOST_JOURNEY], subject);
  let stopped = 0;
  for (const journeyKey of [GATHERING_GOING_JOURNEY, GATHERING_HOST_JOURNEY]) {
    stopped += await stop({ getPool: () => run.pool }, { journeyKey, subjectRef: subject }, reason);
  }
  await withdrawQueued(run.pool, active.map((e) => e.id));
  return stopped;
}

/** Everybody going to or waiting for the evenings of a gathering that have not ended, each once. */
async function audienceOf(run: Run, row: CalendarRow, onlyOccurrence?: string): Promise<Notice[]> {
  const evenings = new Map<string, GatheringSnapshot | null>();
  const evening = (key: string): GatheringSnapshot | null => {
    if (!evenings.has(key)) {
      const occ = occurrenceOf(row, key, run.tz);
      evenings.set(key, occ ? snapshotOf(row, occ) : null);
    }
    return evenings.get(key) ?? null;
  };
  const seen = new Set<string>();
  const out: Notice[] = [];
  const people = [
    ...(await goingAnswers(run.pool, row.id)),
    ...(await waitingPlaces(run.pool, row.id)),
  ].filter((p) => onlyOccurrence === undefined || p.occurrenceKey === onlyOccurrence);
  for (const p of people) {
    const id = `${p.personKey}\u0000${p.occurrenceKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // An evening taken out of its series is read as the person was told it.
    const g = evening(p.occurrenceKey) ?? (await toldEvening(run, row.id, p.occurrenceKey, p.personKey));
    if (!g || !notEnded(g, run.now)) continue;
    const person = await personFor(run.pool, p.personKey, true);
    if (person) out.push({ person, g });
  }
  return out;
}

/** An evening that no longer exists, as the person was last told it. */
async function toldEvening(run: Run, eventId: string, occurrenceKey: string, personKey: string): Promise<GatheringSnapshot | null> {
  const person = await personFor(run.pool, personKey, false);
  if (!person) return null;
  const e = await enrollmentFor(run.pool, GATHERING_GOING_JOURNEY, person.contactId, subjectRef.event(eventId, occurrenceKey));
  return e ? snapshotFromTold(eventId, occurrenceKey, e.facts.told) : null;
}

/** A gathering that is gone, rebuilt from what a person was told about it. */
export function snapshotFromTold(eventId: string, occurrenceKey: string, told: unknown): GatheringSnapshot | null {
  if (!told || typeof told !== "object") return null;
  const t = told as Partial<Told>;
  const startsAt = new Date(String(t.startsAt ?? ""));
  if (!Number.isFinite(startsAt.getTime())) return null;
  const endsAt = t.endsAt ? new Date(t.endsAt) : null;
  return {
    eventId,
    occurrenceKey,
    title: String(t.title ?? ""),
    description: null,
    startsAt,
    endsAt: endsAt && Number.isFinite(endsAt.getTime()) ? endsAt : null,
    allDay: false,
    where: t.where ?? null,
    attendanceMode: "offline",
    onlineUrl: null,
    status: "cancelled",
    occurrenceCancelled: true,
    kind: "gathering",
    layer: "village",
    removed: true,
  };
}

export async function onGatheringCancelled(run: Run, eventId: string): Promise<{ notices: number; stopped: number }> {
  const row = await getCalendarRow(run.pool, eventId);
  if (row) {
    const notices = await postCancellations(run, eventId, await audienceOf(run, row));
    const stopped = await stopAllOn(run, subjectRef.eventPrefix(eventId), "gathering_cancelled");
    return { notices, stopped };
  }
  // Deleted: its answers went with it, and its enrollments are what is left of its audience.
  const notices: Notice[] = [];
  for (const e of await activeEnrollmentsOn(run.pool, [GATHERING_GOING_JOURNEY], subjectRef.eventPrefix(eventId))) {
    const occurrenceKey = String(e.facts.occurrenceKey ?? e.subjectRef.split(":").slice(2).join(":"));
    const g = snapshotFromTold(eventId, occurrenceKey, e.facts.told);
    const personKey = typeof e.facts.personKey === "string" ? e.facts.personKey : null;
    if (!g || !personKey || !notEnded(g, run.now)) continue;
    const person = await personFor(run.pool, personKey, false);
    if (person && person.contactId === e.contactId) notices.push({ person, g });
  }
  const posted = await postCancellations(run, eventId, notices);
  const stopped = await stopAllOn(run, subjectRef.eventPrefix(eventId), "gathering_removed");
  return { notices: posted, stopped };
}

// ── Changing ────────────────────────────────────────────────────────────────

export async function onGatheringChanged(
  run: Run,
  eventId: string,
  fields: ReadonlyArray<"time" | "place" | "online" | "title">,
  cause?: "time_vote",
): Promise<{ touched: number; changed: number; cancelledEvenings: number }> {
  const touched = await touch({ getPool: () => run.pool }, subjectRef.eventPrefix(eventId));
  const result = { touched, changed: 0, cancelledEvenings: 0 };
  // A vote moved it: everybody is re-planned above, and the vote's own "the
  // time is set" email (server/lib/comms/timePolls.ts) is the one they get.
  if (cause === "time_vote") return result;
  const row = await getCalendarRow(run.pool, eventId);
  if (!row || (row.status !== "scheduled" && row.status !== "postponed")) return result;
  if (!fields.includes("time") && !fields.includes("place")) return result;
  // While the time is being voted, the vote's own emails speak (5.10).
  if (await openTimePollMode(run.pool, eventId)) return result;

  const answers = await goingAnswers(run.pool, eventId);
  const gone = new Set<string>();
  const toTell: Array<{ person: Person; g: GatheringSnapshot; enrollmentId: string }> = [];
  for (const a of answers) {
    const occ = occurrenceOf(row, a.occurrenceKey, run.tz);
    if (!occ || occ.cancelled) {
      gone.add(a.occurrenceKey);
      continue;
    }
    const g = snapshotOf(row, occ);
    if (!notEnded(g, run.now)) continue;
    const person = await personFor(run.pool, a.personKey, true);
    if (!person) continue;
    const subject = subjectRef.event(eventId, g.occurrenceKey);
    let e = await enrollmentFor(run.pool, GATHERING_GOING_JOURNEY, person.contactId, subject);
    if (!e || e.state !== "active") {
      // Going with no journey (they said yes before comms ran): they join it now.
      // This email carries the calendar file, so no confirmation follows it.
      const reminders = await gatheringReminderFacts(run.deps, eventId);
      const made = await enroll(
        { getPool: () => run.pool },
        {
          journeyKey: GATHERING_GOING_JOURNEY,
          contactId: person.contactId,
          subjectRef: subject,
          facts: {
            eventId,
            occurrenceKey: g.occurrenceKey,
            personKey: a.personKey,
            told: null,
            stepOverrides: { ...reminders.stepOverrides, confirm: { skip: true } },
            extraSteps: reminders.extraSteps,
          },
        },
      );
      e = await enrollmentFor(run.pool, GATHERING_GOING_JOURNEY, person.contactId, subject);
      if (!e) e = { id: made.enrollmentId, journeyKey: GATHERING_GOING_JOURNEY, contactId: person.contactId, subjectRef: subject, state: "active", facts: {} };
    }
    if (toldDiffers(e.facts.told, g)) toTell.push({ person, g, enrollmentId: e.id });
  }

  if (toTell.length) {
    const sequence = await bumpIcsSequence(run.pool, eventId);
    for (const { person, g, enrollmentId } of toTell) {
      const r = await postLetter(run, person, {
        templateKey: "gathering.changed",
        key: evKey(g, "changed", sequence, person.personKey),
        origin: "event.changed",
        urgent: false,
        expiresAt: g.startsAt,
        values: await valuesFor(run, g, person),
        ics: { method: "REQUEST", sequence, gathering: g },
      });
      if (r.status !== "duplicate") result.changed += 1;
      await updateGatheringFacts(run.pool, enrollmentId, (f) => ({ ...f, told: toldOf(g, sequence) }));
    }
  }

  for (const occurrenceKey of Array.from(gone)) {
    const notices = await audienceOf(run, row, occurrenceKey);
    result.cancelledEvenings += await postCancellations(run, eventId, notices);
    await stopAllOn(run, subjectRef.event(eventId, occurrenceKey), "gathering_cancelled");
  }
  return result;
}

// ── Going live ──────────────────────────────────────────────────────────────

export async function onGatheringPublished(run: Run, eventId: string): Promise<string | null> {
  const row = await getCalendarRow(run.pool, eventId);
  if (!row || row.status !== "scheduled") return null;
  const next = nextOccurrence(row, run.tz, run.now);
  return next ? ensureHostEnrollment(run, row, next.occurrenceKey) : null;
}

// ── A host changing a gathering's settings ─────────────────────────────────

/**
 * What a saved settings change does to the people already on the gathering's
 * journeys. New reminder times are written into every active enrollment's
 * facts and the gathering is touched, so the next tick plans from them; a
 * confirmation a person was never meant to get stays skipped. A new host takes
 * the recap nudge over: the old host leaves `gathering.host`, the new one
 * joins it for the next evening and every evening people are coming to.
 */
export async function afterSettingsChange(
  deps: EventEmailDeps,
  eventId: string,
  change: { reminders: boolean; host: { from: string | null; to: string | null } | null },
): Promise<{ refreshed: number; touched: number; hostEnrollments: number }> {
  const run = runOf(deps);
  const prefix = subjectRef.eventPrefix(eventId);
  const out = { refreshed: 0, touched: 0, hostEnrollments: 0 };
  if (change.reminders) {
    const plan = await gatheringReminderFacts(deps, eventId);
    for (const e of await activeEnrollmentsOn(run.pool, [GATHERING_GOING_JOURNEY], prefix)) {
      const ok = await updateGatheringFacts(run.pool, e.id, (f) => {
        const kept = (f.stepOverrides as Record<string, unknown> | undefined)?.confirm;
        return { ...f, stepOverrides: { ...plan.stepOverrides, ...(kept ? { confirm: kept } : {}) }, extraSteps: plan.extraSteps };
      });
      if (ok) out.refreshed += 1;
    }
    out.touched = await touch({ getPool: () => run.pool }, prefix);
  }
  if (change.host && change.host.from !== change.host.to) {
    const old = change.host.from ? await personFor(run.pool, change.host.from, false) : null;
    if (old) await stop({ getPool: () => run.pool }, { journeyKey: GATHERING_HOST_JOURNEY, contactId: old.contactId, subjectRef: prefix }, "host_changed");
    const row = await getCalendarRow(run.pool, eventId);
    if (row && (row.status === "scheduled" || row.status === "postponed")) {
      const evenings = new Set<string>();
      const next = nextOccurrence(row, run.tz, run.now);
      if (next) evenings.add(next.occurrenceKey);
      for (const a of await goingAnswers(run.pool, eventId)) {
        const occ = occurrenceOf(row, a.occurrenceKey, run.tz);
        if (occ && notEnded(snapshotOf(row, occ), run.now)) evenings.add(a.occurrenceKey);
      }
      for (const key of Array.from(evenings)) if (await ensureHostEnrollment(run, row, key)) out.hostEnrollments += 1;
    }
  }
  return out;
}

// ── The one door ────────────────────────────────────────────────────────────

/**
 * Act on one gathering trigger. Answers what it did, for the tests and the
 * log; the dispatcher ignores it.
 */
export async function handleGatheringTrigger(deps: EventEmailDeps, t: GatheringTrigger): Promise<unknown> {
  const run = runOf(deps);
  switch (t.type) {
    case "rsvp_changed":
      return t.status === "going"
        ? onGoing(run, t.eventId, t.occurrenceKey, t.personKey)
        : onNotGoing(run, t.eventId, t.occurrenceKey, t.personKey);
    case "waitlist_joined":
      return onWaitlistJoined(run, t.eventId, t.occurrenceKey, t.personKey);
    case "waitlist_promoted":
      return onWaitlistPromoted(run, t.eventId, t.occurrenceKey, t.personKey);
    case "gathering_changed":
      return onGatheringChanged(run, t.eventId, t.fields, t.cause);
    case "gathering_cancelled":
      return onGatheringCancelled(run, t.eventId);
    case "gathering_published":
      return onGatheringPublished(run, t.eventId);
  }
}

/** For the settings route: the run a handler would use. */
export const eventEmailRun = runOf;
export type EventEmailRun = Run;
