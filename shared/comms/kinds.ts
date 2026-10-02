/**
 * THE VOCABULARY OF VILLAGE COMMS, as values.
 *
 * Every word the post office, the address book and the journey engine write
 * into a column is declared here once, as a `const` tuple with its union
 * beside it. A union alone vanishes at runtime, so a reader validating a
 * stored row, a route checking a request, and a client keying a lookup table
 * all need the VALUE, and keying a `Record` by the union is what makes a new
 * member a compile error at every table that forgot it (CLAUDE.md, the hand
 * kept map trap).
 *
 * Fixed by the foundation lane and changed only by the integrator
 * (docs/comms/BUILD_SPEC.md section 4). A list may gain a member; nothing is
 * renamed, because these strings are stored and a renamed one reads as
 * unknown on every row written before the rename.
 *
 * Pure and isomorphic: no imports, nothing that touches a database or the
 * DOM, so the client bundle can carry it.
 */

// ── What kind of email it is ────────────────────────────────────────────────

/**
 * The five kinds, and each is a separate question of permission.
 *
 *   essential  the person just asked for it: a password link, a confirmation
 *              of something they did. Always sent, even to a suppressed
 *              address, never counted against a cap, never stored as a
 *              permission.
 *   events     reminders and changes for a gathering somebody said yes to.
 *   paths      the emails that walk somebody through a path they chose, and
 *              the welcome series for a new member.
 *   letters    village news. Only on an explicit yes.
 *   notices    the notification spine's emails. They follow `users.prefs`
 *              exactly as they did before this existed.
 */
export const EMAIL_KINDS = ["essential", "events", "paths", "letters", "notices"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** The kinds a person can say yes or no to. `essential` is never asked. */
export const PERMISSION_KINDS = ["events", "paths", "letters", "notices"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export const PERMISSION_STATES = ["yes", "no"] as const;
export type PermissionState = (typeof PERMISSION_STATES)[number];

/**
 * Why the village holds a yes or a no.
 *
 *   asked     the person ticked a box whose words were recorded as evidence.
 *   implied   it follows from something they did, such as saying yes to a
 *             gathering, which implies its reminders.
 *   account   a member chose it in their own account.
 *   imported  it came in with a list the village brought from elsewhere.
 */
export const PERMISSION_BASES = ["asked", "implied", "account", "imported"] as const;
export type PermissionBasis = (typeof PERMISSION_BASES)[number];

/**
 * Why an address receives nothing but essential mail.
 *
 * `erased` is written when a person's record is deleted, so an address that
 * asked to be forgotten is never written to again by an automation that
 * still held it.
 */
export const SUPPRESSION_REASONS = ["bounced", "complained", "unsubscribed_all", "manual", "erased"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

// ── The post office ledger ──────────────────────────────────────────────────

/**
 * Where one `comms_messages` row stands.
 *
 *   queued     written, waiting for the drain or for its `send_after`.
 *   sending    claimed by a drain. A row stuck here past ten minutes goes
 *              back to queued, and the provider's idempotency key (the row
 *              id) makes the second attempt safe.
 *   sent       the provider ACCEPTED it. Accepted is not delivered.
 *   delivered  the provider's delivery report says it arrived.
 *   bounced, complained  the provider's report said so.
 *   failed     the provider refused it, or every retry ran out.
 *   skipped    never sent, and `skip_reason` says why.
 *   expired    still unsent when its `expires_at` passed.
 *   rehearsed  sent to the rehearsal inbox in place of the person, while the
 *              comms module is in preview.
 *   cancelled  withdrawn before it went.
 */
export const MESSAGE_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
  "expired",
  "rehearsed",
  "cancelled",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Why a row was skipped. Written to `comms_messages.skip_reason`.
 *
 *   no_permission   the person has not said yes to this kind.
 *   suppressed      the address bounced, complained or asked to stop.
 *   over_cap        reserved for a cap with no later window. The daily cap
 *                   DEFERS a row to its next window and never drops it.
 *   paused          the village pressed Pause all.
 *   module_off      the comms module is off and this kind is not plumbing.
 *   not_configured  no provider key, no sender, or no verified domain.
 *   bad_address     the address cannot be written to.
 *   expired         too late to be worth sending.
 *   duplicate       the idempotency key had already been used.
 */
export const SKIP_REASONS = [
  "no_permission",
  "suppressed",
  "over_cap",
  "paused",
  "module_off",
  "not_configured",
  "bad_address",
  "expired",
  "duplicate",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

// ── Signed links ────────────────────────────────────────────────────────────

/**
 * What a signed link is FOR. A link signed for one purpose verifies for no
 * other, so a "can't make it" link can never be replayed as an unsubscribe.
 */
export const LINK_PURPOSES = [
  "unsubscribe",
  "preferences",
  "guest_confirm",
  "cant_make_it",
  "time_vote",
  "recap_answer",
  "letters_confirm",
  "rsvp_next",
] as const;
export type LinkPurpose = (typeof LINK_PURPOSES)[number];

// ── Journeys ────────────────────────────────────────────────────────────────

/**
 * Where one `comms_enrollments` row stands.
 *
 *   active    the tick still reads it.
 *   stopped   a stop rule, an unsubscribe or a person ended it, and
 *             `stop_reason` says which.
 *   finished  every step was sent or skipped.
 */
export const ENROLLMENT_STATES = ["active", "stopped", "finished"] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

/** A village turns each journey on or off. Off is how every journey ships. */
export const JOURNEY_STATES = ["off", "on"] as const;
export type JourneyState = (typeof JOURNEY_STATES)[number];

// ── Person keys ─────────────────────────────────────────────────────────────

/**
 * THE PERSON KEY RULE (drizzle/0229 writes it down too).
 *
 * A member is their user id. Somebody with no account is `guest:<contactId>`.
 * That one string goes in `event_rsvps.user_id`, `event_waitlist.user_id` and
 * every `person_key` column, so every seat count and waitlist read that
 * exists today counts a guest with no change.
 */
export const GUEST_KEY_PREFIX = "guest:";

/** The person key for a contact with no account. */
export function guestPersonKey(contactId: string): string {
  return `${GUEST_KEY_PREFIX}${contactId}`;
}

/** The contact id inside a guest's person key, or null for a member's user id. */
export function contactIdOfGuestKey(personKey: string): string | null {
  return personKey.startsWith(GUEST_KEY_PREFIX) && personKey.length > GUEST_KEY_PREFIX.length
    ? personKey.slice(GUEST_KEY_PREFIX.length)
    : null;
}

/** True when the key names somebody with no account. */
export function isGuestKey(personKey: string): boolean {
  return contactIdOfGuestKey(personKey) !== null;
}
