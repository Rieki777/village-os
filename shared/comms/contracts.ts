/**
 * THE CONTRACTS EVERY COMMS LANE BUILDS AGAINST (the comms build spec
 * section 4, written as code).
 *
 * Fixed by the foundation lane and changed only by the integrator. Names may
 * gain fields; nothing is renamed. Twelve lanes build against these shapes at
 * once, and a rename in one lane is a type error in eleven others that none of
 * them can see until the merge.
 *
 * Pure and isomorphic, so the client's journey timeline and the server's
 * planner read one definition of a journey and cannot drift apart.
 */
import type { EmailKind, MessageStatus } from "./kinds";

// ── One email, posted ───────────────────────────────────────────────────────

/**
 * Everything the post office needs to record one email and then send it.
 *
 * ONE RECIPIENT PER EMAIL. The ledger is per person, because permission,
 * suppression, the daily cap and a delivery report are all facts about one
 * address. A caller with three inboxes posts three emails.
 */
export interface OutgoingEmail {
  /**
   * Stable per logical email: the same email posted twice is one row. A key
   * longer than 191 characters is hashed to 64 hex characters, which keeps it
   * inside the unique index and keeps it stable.
   */
  idempotencyKey: string;
  kind: EmailKind;
  /** What made it, for example `auth.reset`, `notify.immediate`, `journey`. */
  origin: string;
  to: { email: string; name?: string | null; userId?: string | null; contactId?: string | null };
  subject: string;
  html: string;
  /** The plain-text part. An empty string sends none. */
  text: string;
  preheader?: string | null;
  replyTo?: string | null;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  source?: {
    templateKey?: string;
    templateVersion?: number;
    journeyKey?: string;
    stepKey?: string;
    enrollmentId?: string;
    letterId?: string;
  };
  /** Null: as soon as possible. */
  sendAfter?: Date | null;
  /** An unsent row past this becomes `expired`. */
  expiresAt?: Date | null;
  /** Attempt the send now, inside this request: essential mail, confirmations. */
  urgent?: boolean;
  bypassCap?: boolean;
}

/**
 * What `post()` says happened. Never a throw.
 *
 * `reason` is free text beside the status. For `skipped` it is the skip
 * reason, and for an unconfigured deployment it names which half is missing
 * (`no_api_key` or `no_sender`), because the caller that set up a village
 * has to be told which one to fix.
 */
export interface PostResult {
  status: MessageStatus | "duplicate";
  messageId: string | null;
  reason?: string;
}

// ── What happened in the village ────────────────────────────────────────────

/**
 * The one shape domain code uses to tell comms that something happened.
 *
 * Fired through `commsSink` (server/lib/commsSink.ts) after the owning
 * transaction commits, never inside it, so a rolled-back change never tells
 * anybody anything.
 *
 * `personKey` follows the rule in shared/comms/kinds.ts: a user id, or
 * `guest:<contactId>` for somebody with no account.
 *
 * `gathering_cancelled` also fires when a gathering is DELETED, after its
 * answers are gone. The journey enrollments on `event:<id>:*` are what is left
 * of its audience then, which is why they are where a handler looks.
 */
export type CommsTrigger =
  | { type: "rsvp_changed"; eventId: string; occurrenceKey: string; personKey: string; status: "going" | "maybe" | "declined" | "withdrawn" }
  | { type: "waitlist_joined" | "waitlist_promoted"; eventId: string; occurrenceKey: string; personKey: string }
  | {
      type: "gathering_changed";
      eventId: string;
      fields: Array<"time" | "place" | "online" | "title">;
      /**
       * Set when the gathering's live time vote moved it (5.10). The vote
       * sends its own words ("the time is set", "new time"), so a handler
       * that writes "changed" to everyone going skips a change carrying this,
       * and still re-plans reminders and bumps the calendar sequence.
       */
      cause?: "time_vote";
    }
  | { type: "gathering_cancelled" | "gathering_published"; eventId: string }
  | {
      type: "path_joined" | "path_left";
      personKey: string;
      userId?: string | null;
      email?: string | null;
      name?: string | null;
      pathId: string;
      source: string;
      consent?: boolean;
    }
  | { type: "form_submitted"; formType: string; submissionId: string; email: string | null; name: string | null; consentPaths: boolean }
  | { type: "submission_status"; submissionId: string; formType: string; status: string }
  | {
      type: "housing_status";
      reservationId: string;
      status: string;
      email: string | null;
      /** The name on a new request, for the path's welcome (5.11). */
      name?: string | null;
      /** A new request whose "walk me through the next steps" box was ticked. */
      consentPaths?: boolean;
    }
  | { type: "member_joined"; userId: string }
  | { type: "member_admitted"; userId: string }
  | { type: "stage_advanced"; userId: string; stage: string };

export type CommsTriggerType = CommsTrigger["type"];

/**
 * The data field a public form sets to `true` when its "walk me through the
 * next steps" box is ticked. One name for every form, so the hook that reads
 * it and the forms that write it cannot drift. The box's words live in the
 * comms settings document (`consentText`), never here.
 */
export const FORM_CONSENT_FIELD = "commsConsent";

/**
 * The trigger a submitted form fires, read out of the form's own data.
 *
 * Only an address that is a string is passed on, and only a box ticked with a
 * real `true` counts as a yes: a form that sent the string "false" has not
 * said yes to anything.
 */
export function formSubmittedTrigger(formType: string, submissionId: string, data: unknown): CommsTrigger {
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    type: "form_submitted",
    formType,
    submissionId,
    email: text(d.email),
    name: text(d.name) ?? text(d.firstName),
    consentPaths: d[FORM_CONSENT_FIELD] === true,
  };
}

/** The parts of a gathering whose change somebody who said yes is told about. */
export interface GatheringShape {
  status: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  recurrence: unknown;
  locationText: string | null;
  structureKeys: string[];
  onlineUrl: string | null;
  attendanceMode: string;
}

/**
 * What one saved edit to a gathering tells comms, read by comparing the
 * gathering before the save with the gathering after it.
 *
 * COMPARED, NEVER READ OFF THE PATCH. The editor sends every field on every
 * save, so "the patch named the time" is true of a save that only fixed a
 * typo in the description, and reading it that way would tell everybody
 * going that their gathering had moved.
 *
 *   cancelled   it became `cancelled`. Nothing else is said in the same
 *               breath: a cancelled gathering's new time is news to nobody.
 *   published   it became `scheduled` from a draft or from cancelled. The
 *               fields are all new to everyone, so no change is reported.
 *   changed     it is live (scheduled or postponed) and the time, the place,
 *               the online room or the title differs. A move between
 *               scheduled and postponed counts as a change of time, because
 *               the time a person agreed to is no longer the time.
 *
 * A draft edited and left a draft says nothing: nobody has been told it
 * exists.
 *
 * `cause` rides on a `changed` trigger when the time vote made the edit.
 */
export function gatheringTriggers(
  eventId: string,
  before: GatheringShape | null,
  after: GatheringShape | null,
  cause?: "time_vote",
): CommsTrigger[] {
  if (!before || !after) return [];
  const live = (s: string) => s === "scheduled" || s === "postponed";
  if (after.status === "cancelled" && before.status !== "cancelled") return [{ type: "gathering_cancelled", eventId }];
  if (after.status === "scheduled" && !live(before.status)) return [{ type: "gathering_published", eventId }];
  if (!live(after.status) || !live(before.status)) return [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fields: Array<"time" | "place" | "online" | "title"> = [];
  if (
    !same(before.startsAt, after.startsAt) ||
    !same(before.endsAt, after.endsAt) ||
    !same(before.recurrence, after.recurrence) ||
    before.status !== after.status
  ) {
    fields.push("time");
  }
  if (!same(before.locationText, after.locationText) || !same([...before.structureKeys].sort(), [...after.structureKeys].sort())) {
    fields.push("place");
  }
  if (!same(before.onlineUrl, after.onlineUrl) || before.attendanceMode !== after.attendanceMode) fields.push("online");
  if (before.title !== after.title) fields.push("title");
  if (!fields.length) return [];
  return [cause ? { type: "gathering_changed", eventId, fields, cause } : { type: "gathering_changed", eventId, fields }];
}

// ── Journeys ────────────────────────────────────────────────────────────────

/**
 * What starts a journey. These are journey-level names, and a dispatcher maps
 * each `CommsTrigger` onto them:
 *
 *   rsvp_going             `rsvp_changed` with status `going`, and
 *                          `waitlist_promoted`
 *   guest_confirmed        a guest confirming by email (server/lib/comms/guests.ts)
 *   gathering_published    `gathering_published`; enrolls the host
 *   path_joined            `path_joined`
 *   membership_requested   `form_submitted` with formType `membership-request`
 *   member_joined          `member_joined`
 */
export const JOURNEY_TRIGGERS = [
  "rsvp_going",
  "guest_confirmed",
  "gathering_published",
  "path_joined",
  "membership_requested",
  "member_joined",
] as const;
export type JourneyTrigger = (typeof JOURNEY_TRIGGERS)[number];

export const JOURNEY_KINDS = ["event", "path", "joining", "member", "poll"] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

/**
 * A step is skipped when any of its conditions holds. Each key is one query
 * in server/lib/comms/conditions.ts, and the question it answers is the
 * comment beside it.
 */
export const CONDITION_KEYS = [
  // Gatherings (5.6).
  "time_still_being_voted", // the gathering's time poll is open, so its steps wait for the lock
  "signed_up_within_36_hours", // the person said yes less than 36 hours before the start
  "recap_already_sent", // the host already sent this gathering's recap
  "nobody_answered", // nobody said they were coming
  // Paths: the first step is skipped once it is done (5.11).
  "resident_first_step_done", // a housing request or a visit inquiry exists
  "investor_first_step_done", // the investor packet was requested
  "steward_first_step_done", // a hand was raised for a seat
  "prosperity_first_step_done", // a Work With Us proposal arrived
  "member_first_step_done", // a first quest was claimed
  // Come meet us: skipped when they are already coming (5.11).
  "going_to_next_gathering", // already said yes to the next public gathering
  // The investor journey is held until its words are reviewed (5.11).
  "investor_words_unreviewed", // comms-settings.investorWordsReviewed is not set
] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

/** A journey stops for good when any of its stop rules holds. One query each, same file. */
export const STOP_KEYS = [
  // Gatherings (5.6).
  "withdrew", // the person took their yes back
  "gathering_cancelled", // the gathering was called off
  "gathering_removed", // the gathering was deleted
  // Paths and joining: the goals (5.11).
  "left_path", // the person left the path
  "resident_reserved", // a housing reservation reached `reserved`
  "investor_committed", // an agreement signed, or until that has a writer, an investor call accepted
  "steward_seated", // seated in a role
  "prosperity_venture_listed", // a venture listed, or until that has a writer, the proposal accepted
  "joining_admitted", // admitted as a member
  "joining_declined", // the request to join was declined
  "member_took_part", // consented a quest, or came to a gathering
  // Every journey.
  "unsubscribed", // said no to this journey's kind of email
  "suppressed", // the address bounced, complained, or asked to stop everything
] as const;
export type StopKey = (typeof STOP_KEYS)[number];

/** Where a step's clock starts. */
export type JourneyAnchor = "enrolled" | "event_start" | "event_end";

/**
 * One email in a journey.
 *
 * `offsetMinutes` is negative for before the anchor. `window: "daytime"`
 * holds a step inside `comms.quiet_start_hour` to `comms.quiet_end_hour` in
 * the reader's own zone (the village's when theirs is unknown). `catchUp` is
 * what a late enrollment does with steps whose time had already passed, and
 * `maxLateMinutes` is how late a step may be and still go; past that it is
 * skipped, which is the rule that stops "in seven days" arriving a day before.
 */
export interface JourneyStep {
  key: string;
  anchor: JourneyAnchor;
  offsetMinutes: number;
  window: "any" | "daytime";
  audience: "all" | "came" | "missed";
  templateKey: string;
  skipIf: ConditionKey[];
  catchUp: "skip" | "latest";
  maxLateMinutes: number;
  /** Posted inside the request that enrolled the person, with a short timeout. */
  urgent?: boolean;
}

export interface JourneyDefinition {
  key: string;
  kind: JourneyKind;
  trigger: JourneyTrigger;
  /**
   * Further triggers that start this same journey. `gathering.going` starts
   * on a member's yes and on a guest's confirmation (5.6); the enrollment's
   * unique key keeps a person to one enrollment whichever door fires first.
   */
  alsoOn?: JourneyTrigger[];
  emailKind: EmailKind;
  version: number;
  steps: JourneyStep[];
  stops: StopKey[];
  /**
   * Path journeys only (5.11), both off unless a village turns them on.
   * `includeExisting`: members already on the path when comms arrived (the
   * backfill) are walked through it too. `rungEmails`: a move up the path's
   * ladder posts "you reached X, here is the next step".
   */
  includeExisting?: boolean;
  rungEmails?: boolean;
}

// ── What an enrollment is about ─────────────────────────────────────────────

/**
 * `comms_enrollments.subject_ref`, built in one place so the writer and every
 * reader spell it the same way. A `touch("event:<id>")` re-plans every
 * occurrence of one gathering because the prefix ends where the id does.
 */
export const subjectRef = {
  event: (eventId: string, occurrenceKey: string): string => `event:${eventId}:${occurrenceKey}`,
  /** Every occurrence of one gathering, for `touch` and for `stop`. */
  eventPrefix: (eventId: string): string => `event:${eventId}`,
  path: (pathId: string): string => `path:${pathId}`,
  form: (submissionId: string): string => `form:${submissionId}`,
  account: (): string => "account",
  poll: (pollId: string): string => `poll:${pollId}`,
};
