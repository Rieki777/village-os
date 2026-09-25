/**
 * A RESTORATIVE INTAKE REACHES ITS RECIPIENTS, AND ITS WORDS STAY IN THE VILLAGE.
 *
 * `POST /api/exit/restorative-intake` is a member's private path to raise a
 * harm (the exit policy's restorative path, the Leaving Well page). F12's hard
 * rule is that the content reaches only its recipients: no forum thread, no
 * event row, no exits-row content. The route kept that rule for the village's
 * own tables and broke it one step further out, in three ways, all closed here:
 *
 *  1. THE WORDS LEFT THE VILLAGE BY EMAIL. The notice was titled "A private
 *     intake from <the sender's name>" and carried the message as its body.
 *     `restorative_intake` is emailed at once, and the notification email
 *     renders the title AND the body, so the sender's name and words went to
 *     outside mailboxes, which a role holder may share or read on a lock
 *     screen. Now the title names no one, and `emailCarriesBody` in
 *     ./notify.ts sends this kind's email as the title alone. The in-app row
 *     keeps the name and the words, and only its recipient can read that row
 *     (`notificationsFor` is keyed on the recipient).
 *
 *  2. A LAPSED HOLDER STILL RECEIVED IT. Holders came from the raw role_holders
 *     rows with no term check, so somebody whose seat had run out went on
 *     receiving harm reports. The filter below is the gate's own lapse rule,
 *     `holdingHasLapsed`, the same predicate `liveHolderCount` in ./roleGrants
 *     counts with, so the people reached are exactly the people the gate says
 *     hold the role today.
 *
 *  3. THE LINK OPENED A PAGE THE RECIPIENT COULD NOT OPEN. It pointed at
 *     /admin, and the care role is usually held by somebody who is not an
 *     admin. Members read notifications in the bell, which every page carries,
 *     and a notice with nowhere more specific to go opens the profile (the
 *     bell and the email both fall back to it). So it links there.
 *
 * `reached` counts the people whose row was actually written. A write that
 * failed reached nobody, and a sender told otherwise would wait for a reply
 * that is not coming.
 *
 * Everything else is as it was: the path, the three-a-day limit, and every
 * refusal sentence.
 */
import type { NotifyInput, NotifyResult } from "./notify";
import { holdingHasLapsed } from "./stewardship";

/** The title every recipient sees, and the whole of the email's subject. It names no one. */
export const INTAKE_TITLE = "A private intake is waiting for you";

/** Where the notice opens: a page every member can open. See point 3 above. */
export const INTAKE_LINK = "/profile";

/** The most of a member's words one notice keeps, unchanged from the route this came out of. */
export const INTAKE_MAX_CHARS = 2000;

/** One role_holders row, as far as this file reads it. */
export interface IntakeHolding {
  roleId: string;
  userId: string;
  termEndsAt?: Date | string | null;
}

/**
 * Who an intake reaches: the role's holders whose seat has not lapsed, one
 * entry per person however many rows they hold.
 */
export function liveIntakeRecipients(
  holders: ReadonlyArray<IntakeHolding>,
  roleId: string,
  now: Date = new Date(),
): string[] {
  const live = holders.filter((h) => h.roleId === roleId && !holdingHasLapsed(h, now));
  return Array.from(new Set(live.map((h) => String(h.userId))));
}

/**
 * The intake role as the published policy names it, so a member can see who
 * their words will reach before they send them. Null when no role is set, or
 * when the stored id no longer names a role.
 */
export function intakeRoleNamed(
  roleId: unknown,
  roles: ReadonlyArray<{ id: string; name?: string | null }>,
): { id: string; name: string } | null {
  const wanted = String(roleId ?? "");
  if (!wanted) return null;
  const role = roles.find((r) => r.id === wanted);
  return role ? { id: role.id, name: String(role.name ?? role.id) } : null;
}

/**
 * One recipient's notice. The title and the link carry nothing about the
 * sender. The body carries the sender's name and their words, for the
 * recipient's eyes in the app, and the email for this kind leaves the body out.
 */
export function intakeNotice(input: {
  intakeId: string;
  recipientId: string;
  sender: { id: string; name?: string | null };
  message: string;
}): NotifyInput {
  const who = String(input.sender.name ?? "").trim() || "A member";
  return {
    userId: input.recipientId,
    type: "restorative_intake",
    title: INTAKE_TITLE,
    body: `${who} wrote: ${input.message.slice(0, INTAKE_MAX_CHARS)}`,
    link: INTAKE_LINK,
    actorUserId: input.sender.id,
    dedupeKey: `restorative:${input.intakeId}:${input.recipientId}`,
  };
}

/** What the route is handed. The caches and the spine stay in server/index.ts. */
export interface IntakeDeps {
  readExitPolicy(): any;
  roleHolders(): ReadonlyArray<IntakeHolding>;
  notify(input: NotifyInput): Promise<NotifyResult>;
  overLimit(bucket: string, max: number, windowMs: number): Promise<boolean>;
  now?(): Date;
}

export interface IntakeAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** The whole intake, for a signed-in sender. The route answers with what this returns. */
export async function sendRestorativeIntake(
  deps: IntakeDeps,
  sender: { id: string; name?: string | null },
  rawMessage: unknown,
): Promise<IntakeAnswer> {
  if (await deps.overLimit(`restorative:${sender.id}`, 3, 24 * 60 * 60 * 1000)) {
    return { status: 429, body: { error: "Three intakes a day. The stewards are already listening" } };
  }
  const message = String(rawMessage ?? "").trim();
  if (!message) return { status: 400, body: { error: "Say what happened, in your own words" } };
  const policy: any = deps.readExitPolicy();
  const roleId = String(policy?.restorative?.intakeContactRole ?? "");
  if (!roleId) {
    return { status: 409, body: { error: "No intake contact role is configured yet. Write to the stewards directly" } };
  }
  const recipients = liveIntakeRecipients(deps.roleHolders(), roleId, deps.now?.() ?? new Date());
  if (!recipients.length) {
    return { status: 409, body: { error: "The intake role has no holders right now. Write to the stewards directly" } };
  }
  const intakeId = `ri-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let reached = 0;
  for (const recipientId of recipients) {
    const sent = await deps.notify(intakeNotice({ intakeId, recipientId, sender, message }));
    if (sent.fresh) reached += 1;
  }
  if (!reached) {
    return {
      status: 503,
      body: { error: "Your message could not be delivered just now, so nobody has it yet. Try again in a moment, or write to the stewards directly" },
    };
  }
  return { status: 200, body: { success: true, reached } };
}
