/**
 * GUESTS AT GATHERINGS: the request, the confirmation, and the seat they take
 * or give back (the comms build spec 5.8).
 *
 * ── THE PERSON KEY RULE ────────────────────────────────────────────────────
 *
 * A member is their user id. Somebody with no account is `guest:<contactId>`,
 * where the contact is their row in `comms_contacts` (`guestPersonKey`,
 * shared/comms/kinds.ts). That one string goes in `event_rsvps.user_id`,
 * `event_waitlist.user_id` and every `person_key` column (`event_attendance`,
 * `event_feedback`, `event_time_poll_votes`), so every seat count and waitlist
 * read that existed before guests counts a guest with no change at all.
 * drizzle/0245 writes the same rule down. Readers that NAME people learn the
 * prefix and read a guest's name from `comms_contacts`, never an address.
 *
 * ── THE FLOW ───────────────────────────────────────────────────────────────
 *
 *   1. A visitor gives a name, an address and (from their browser) a time
 *      zone on a gathering's card. `requestGuestSeat` asks every guest
 *      condition (`guestRefusal`), makes sure of their contact, writes a
 *      PENDING request whose token only the email holds (the table keeps its
 *      SHA-256), and posts `gathering.guest_confirm`: essential and urgent,
 *      because they just asked for it.
 *   2. Nothing else happens until they press the link. No seat is held, no
 *      journey starts, and no reminder can be sent: there is no answer on
 *      record for any journey to find.
 *   3. The press (`guestConfirmAction`, through `/email/a`) asks the
 *      conditions again, marks the request confirmed while it is still live
 *      (decided in SQL), and calls the ordinary `rsvp()`.
 *
 * ── CAPACITY ───────────────────────────────────────────────────────────────
 *
 * The seat is taken by `rsvp()` in server/lib/gatherings.ts, inside its own
 * `SELECT ... FOR UPDATE` on the gathering row, exactly as a member's is.
 * There is no second capacity check here, because a second check is a
 * check-then-act race: a guest and a member reaching for the last seat
 * together are serialised by the one lock that orders every seat. A full room
 * puts the guest in the queue (`joinWaitlist`, same lock), which is what the
 * confirmation email promised.
 *
 * ── WHO A CONFIRMING ADDRESS IS ────────────────────────────────────────────
 *
 * An address that belongs to a member answers as that member, under their
 * user id, so one person never holds two seats and the guest form never
 * tells a stranger whether an address has an account (it answers the same
 * words whatever happened). Such a member still needs `event.rsvp`, the gate
 * the signed-in RSVP asks.
 *
 * ── WHAT HAPPENS AFTER ─────────────────────────────────────────────────────
 *
 * `rsvp()` fires `rsvp_changed` through the comms sink, and the event email
 * lane's dispatch enrolls the person in `gathering.going` exactly as it
 * enrolls a member (the contract's `guest_confirmed` journey trigger is that
 * confirmation reaching `rsvp()`). Nothing here enrolls anybody.
 *
 * No raw SQL: the statements are in server/repos/eventGuests.ts.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { addressProblem } from "../../../shared/comms/address";
import {
  GUEST_LINK_DAYS,
  GUEST_REFUSAL_WORDS,
  GUEST_REQUEST_HOURS,
  guestNameProblem,
  guestRefusal,
  type GuestDoor,
  type GuestRefusal,
} from "../../../shared/comms/guests";
import { guestPersonKey } from "../../../shared/comms/kinds";
import type { ModuleLifecycle } from "../../../shared/modules";
import { contactById, type ContactRow } from "../../repos/commsContacts";
import {
  confirmGuestRequest,
  guestRequestByTokenHash,
  guestSettingFor,
  insertGuestRequest,
  rsvpStatusOf,
  waitlistPlaceOf,
  type GuestRequestRow,
} from "../../repos/eventGuests";
import { joinWaitlist, leaveWaitlist } from "../calendarCommunity";
import { rsvp, withdrawRsvp } from "../gatherings";
import { boolVar } from "../variables";
import { villageTimezone } from "../villageReaders";
import type { ActionDescription } from "../../../shared/comms/preferences";
import type { ActionHandler, ActResult } from "./actions";
import { ensureContact } from "./contacts";
import { eveningValues, personValues, readEvening, type Evening } from "./gatheringEvening";
import { signLink, type LinkPayload } from "./links";
import { memberOf, suppressionsPortFor, type MembersPort } from "./permissions";
import { post, type PostOfficeDeps } from "./postOffice";
import { loadEmailVillage, renderTemplate } from "./render";

// ── What this file is handed ────────────────────────────────────────────────

export interface GuestDeps {
  getPool(): Pool;
  postOffice: PostOfficeDeps;
  /** This village's own site, for the links in its emails. */
  origin(): string;
  /** The comms module's lifecycle. Handed in, so this file never imports the module registry. */
  commsLifecycle(): ModuleLifecycle;
  /** The calendar's lifecycle: a stranger reaches a gathering only through a public calendar. */
  eventsLifecycle(): ModuleLifecycle;
  /** The members repository, to tell a guest's address from a member's. */
  members: MembersPort;
  /** Whether a member may answer a gathering: `event.rsvp` through the one gate. */
  memberMayRsvp(userId: string): Promise<boolean>;
  /** The `events.rsvp_enabled` dial. Absent: the game variable. */
  rsvpEnabled?(): boolean;
  /** The `comms.guests_default` dial. Absent: the game variable. */
  guestsDefault?(): boolean;
  /** The village's zone. Absent: the zone the seasons turn on. */
  timezone?(): string;
  /** Epoch milliseconds, for tests. */
  now?(): number;
}

const nowOf = (d: GuestDeps): number => (d.now ? d.now() : Date.now());
export const zoneOf = (d: GuestDeps): string => (d.timezone ? d.timezone() : villageTimezone()) || "UTC";
const site = (d: GuestDeps): string => String(d.origin() ?? "").trim().replace(/\/+$/, "");

/** The SHA-256 a request keeps in place of its token. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** A one-click link to the action page. */
export function actionUrl(origin: string, token: string): string {
  return `${String(origin ?? "").trim().replace(/\/+$/, "")}/email/a?t=${encodeURIComponent(token)}`;
}

// ── The door ────────────────────────────────────────────────────────────────

/** Whether a guest may say yes to one evening, and the evening itself when there is one. */
export async function guestDoorFacts(
  deps: GuestDeps,
  eventId: string,
  occurrenceKey: string,
): Promise<{ evening: Evening | null; refusal: GuestRefusal | null }> {
  const pool = deps.getPool();
  const evening = await readEvening(pool, eventId, occurrenceKey, zoneOf(deps));
  if (!evening) return { evening: null, refusal: "not_found" };
  const refusal = guestRefusal({
    commsLifecycle: deps.commsLifecycle(),
    eventsLifecycle: deps.eventsLifecycle(),
    rsvpEnabled: deps.rsvpEnabled ? deps.rsvpEnabled() : boolVar("events.rsvp_enabled"),
    kind: evening.row.kind,
    layer: evening.row.layer,
    // One evening of a series can be called off while the series stays scheduled.
    status: evening.cancelled ? "cancelled" : evening.row.status,
    seatPrice: evening.row.seatPrice,
    guestSetting: await guestSettingFor(pool, eventId),
    guestsDefault: deps.guestsDefault ? deps.guestsDefault() : boolVar("comms.guests_default"),
    startsAt: evening.startsAt.getTime(),
    now: nowOf(deps),
  });
  return { evening, refusal };
}

/** What the gathering's card shows a visitor: open, or the reason in words. */
export async function guestDoor(deps: GuestDeps, eventId: string, occurrenceKey: string): Promise<GuestDoor> {
  const { evening, refusal } = await guestDoorFacts(deps, eventId, occurrenceKey);
  const occ = evening?.occurrenceKey ?? "";
  return refusal ? { open: false, reason: refusal, message: GUEST_REFUSAL_WORDS[refusal], occurrenceKey: occ } : { open: true, occurrenceKey: occ };
}

// ── The request ─────────────────────────────────────────────────────────────

export type GuestRequestOutcome =
  | { ok: true; requestId: string; contactId: string; sent: boolean }
  | { ok: false; status: number; error: string; reason?: GuestRefusal };

const refusedAt = (refusal: GuestRefusal) => ({
  ok: false as const,
  status: refusal === "not_found" ? 404 : 409,
  error: GUEST_REFUSAL_WORDS[refusal],
  reason: refusal,
});

/**
 * A visitor asks for a seat. Writes the pending request and posts the email
 * that confirms it. Holds no seat and starts nothing else.
 */
export async function requestGuestSeat(
  deps: GuestDeps,
  input: { eventId: string; occurrenceKey: string; name: unknown; email: unknown; timezone?: unknown },
): Promise<GuestRequestOutcome> {
  const nameProblem = guestNameProblem(input.name);
  if (nameProblem) return { ok: false, status: 400, error: nameProblem };
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (addressProblem(email) !== null) return { ok: false, status: 400, error: "Check your email address. It doesn't look right." };
  const name = String(input.name).trim();

  const { evening, refusal } = await guestDoorFacts(deps, input.eventId, input.occurrenceKey);
  if (refusal || !evening) return refusedAt(refusal ?? "not_found");

  const pool = deps.getPool();
  const contact = await ensureContact(deps, { email, name, source: "guest", timezone: typeof input.timezone === "string" ? input.timezone : null });
  if (!contact) return { ok: false, status: 400, error: "Check your email address. It doesn't look right." };
  const row = await contactById(pool, contact.id);

  const token = crypto.randomBytes(24).toString("hex");
  const requestId = `gr_${crypto.randomBytes(12).toString("hex")}`;
  await insertGuestRequest(pool, {
    id: requestId,
    eventId: evening.row.id,
    occurrenceKey: evening.occurrenceKey,
    contactId: contact.id,
    tokenHash: hashToken(token),
    hours: GUEST_REQUEST_HOURS,
  });

  const link = actionUrl(site(deps), signLink("guest_confirm", { r: requestId, k: token }, GUEST_LINK_DAYS));
  const village = await loadEmailVillage(pool, site(deps));
  const words = await renderTemplate(
    "gathering.guest_confirm",
    {
      ...eveningValues(evening, { village: zoneOf(deps), reader: row?.timezone ?? null }),
      ...personValues(name),
      "links.confirm": link,
    },
    { getPool: deps.getPool, village, contactId: contact.id },
  );
  const result = await post(deps.postOffice, {
    idempotencyKey: `guest:${requestId}`,
    kind: "essential",
    origin: "event.guest_confirm",
    to: { email, name, contactId: contact.id },
    subject: words.subject,
    html: words.html,
    text: words.text,
    preheader: words.preheader,
    urgent: true,
    source: { templateKey: "gathering.guest_confirm", ...(words.version !== null ? { templateVersion: words.version } : {}) },
  });
  const sent = result.status === "sent";
  if (!sent && result.status !== "queued") {
    console.warn(`[comms] a guest's confirmation email was not sent (${result.status}${result.reason ? `: ${result.reason}` : ""})`);
  }
  return { ok: true, requestId, contactId: contact.id, sent };
}

// ── Seats ───────────────────────────────────────────────────────────────────

export type SeatOutcome =
  | { kind: "going" }
  | { kind: "waitlisted"; position: number }
  | { kind: "refused"; status: number; error: string };

const seatRefusal = (reason: string, message?: string): SeatOutcome => {
  if (reason === "unpaid") return { kind: "refused", status: 409, error: message ?? "This one has a seat price. Create an account to come." };
  if (reason === "not_found") return { kind: "refused", status: 404, error: GUEST_REFUSAL_WORDS.not_found };
  return { kind: "refused", status: 409, error: GUEST_REFUSAL_WORDS.not_open };
};

/**
 * Take a seat for one person, or a place in the queue when the room is full.
 * Both go through the gathering's own row lock (`rsvp()`, `joinWaitlist()`);
 * a seat that opens between the two answers is taken on the next pass.
 */
export async function takeSeatOrQueue(pool: Pool, eventId: string, personKey: string, occurrenceKey: string): Promise<SeatOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answered = await rsvp(pool, eventId, personKey, "going", undefined, occurrenceKey || undefined);
    if (answered.ok) return { kind: "going" };
    if (answered.reason !== "full") return seatRefusal(answered.reason, answered.message);
    const queued = await joinWaitlist(pool, eventId, personKey, occurrenceKey || undefined);
    if (queued.ok) return { kind: "waitlisted", position: queued.position };
    if (queued.reason === "already_going") return { kind: "going" };
    if (queued.reason !== "not_full") return seatRefusal(queued.reason, queued.message);
  }
  return { kind: "refused", status: 409, error: "The room kept changing. Press again." };
}

/** Give a seat or a queue place back. The seat goes to whoever waited longest. */
export async function giveSeatBack(pool: Pool, eventId: string, personKey: string, occurrenceKey: string): Promise<"released" | "left_queue" | "nothing"> {
  if (await withdrawRsvp(pool, eventId, personKey, occurrenceKey)) return "released";
  if (await leaveWaitlist(pool, eventId, personKey, occurrenceKey)) return "left_queue";
  return "nothing";
}

/** Where one person stands for one evening: in, waiting (with their place), or neither. */
export async function standingOf(
  pool: Pool,
  eventId: string,
  personKey: string,
  occurrenceKey: string,
): Promise<{ going: boolean; place: number | null }> {
  if ((await rsvpStatusOf(pool, eventId, personKey, occurrenceKey)) === "going") return { going: true, place: null };
  return { going: false, place: await waitlistPlaceOf(pool, eventId, personKey, occurrenceKey) };
}

/** The person key a confirming address answers as: the member who owns it, or a guest. */
export async function personKeyForContact(deps: GuestDeps, contact: ContactRow): Promise<{ key: string; member: boolean }> {
  const m = await memberOf({ getPool: deps.getPool, members: deps.members, suppressions: suppressionsPortFor(deps.getPool) }, contact);
  return m ? { key: String(m.id), member: true } : { key: guestPersonKey(contact.id), member: false };
}

// ── The confirmation, from the email ────────────────────────────────────────

const GONE: ActResult = { ok: false, status: 404, error: "This link isn't ours any more. Ask again on the calendar." };
const EXPIRED = "This link has expired. Ask again on the calendar and we'll send a new one.";

interface Found {
  request: GuestRequestRow;
  contact: ContactRow;
  evening: Evening;
}

/** The request a link names, with its contact and its evening, or null when any of them is gone. */
async function findRequest(deps: GuestDeps, payload: LinkPayload): Promise<Found | null> {
  const id = typeof payload.r === "string" ? payload.r : "";
  const token = typeof payload.k === "string" ? payload.k : "";
  if (!id || !token) return null;
  const pool = deps.getPool();
  const request = await guestRequestByTokenHash(pool, hashToken(token));
  if (!request || request.id !== id) return null;
  const contact = await contactById(pool, request.contactId);
  if (!contact) return null;
  const evening = await readEvening(pool, request.eventId, request.occurrenceKey, zoneOf(deps));
  return evening ? { request, contact, evening } : null;
}

/** The one-click handler for `guest_confirm` (the action registry, server/lib/comms/actions.ts). */
export function guestConfirmAction(deps: GuestDeps): ActionHandler {
  const whenFor = (f: Found) => eveningValues(f.evening, { village: zoneOf(deps), reader: f.contact.timezone })["gathering.when"] as string;

  async function describe(payload: LinkPayload): Promise<ActionDescription | null> {
      const found = await findRequest(deps, payload);
      if (!found) return null;
      const who = await personKeyForContact(deps, found.contact);
      const stand = await standingOf(deps.getPool(), found.evening.row.id, who.key, found.evening.occurrenceKey);
      const base = { purpose: "guest_confirm" as const, input: null, current: null };
      const title = found.evening.title;
      if (stand.going) {
        return {
          ...base,
          title: "You're on the list",
          paragraphs: [`${title}, ${whenFor(found)}.`, "Plans changed? Give your place back below."],
          choices: [{ value: "release", label: "Give my place back" }],
        };
      }
      if (stand.place) {
        return {
          ...base,
          title: `Waitlist: number ${stand.place}`,
          paragraphs: [`${title}, ${whenFor(found)}.`, "We'll email you the moment a seat opens."],
          choices: [{ value: "release", label: "Leave the waitlist" }],
        };
      }
      if (!found.request.live) {
        return { ...base, title: "Link expired", paragraphs: [EXPIRED], choices: [] };
      }
      return {
        ...base,
        title: `Confirm your place at ${title}`,
        paragraphs: [`${whenFor(found)}.`, "Full by now? You'll go on the waitlist, and we'll email you when a seat opens."],
        choices: [{ value: "confirm", label: "Confirm my place", primary: true }],
      };
  }

  return {
    purpose: "guest_confirm",
    describe,
    async act(payload, body) {
      const found = await findRequest(deps, payload);
      if (!found) return GONE;
      const pool = deps.getPool();
      const eventId = found.evening.row.id;
      const occ = found.evening.occurrenceKey;
      const who = await personKeyForContact(deps, found.contact);
      const describeAgain = () => describe(payload);

      if (body.choice === "release") {
        const gave = await giveSeatBack(pool, eventId, who.key, occ);
        return {
          ok: true,
          outcome: {
            ok: true,
            title: gave === "nothing" ? "Nothing to give back" : "Place given back",
            paragraphs: gave === "released" ? ["It goes to whoever has waited longest."] : [],
            description: await describeAgain(),
          },
        };
      }
      if (body.choice !== "confirm") return { ok: false, status: 400, error: "Press Confirm my place." };

      if (!found.request.live) return { ok: false, status: 410, error: EXPIRED };
      const door = await guestDoorFacts(deps, eventId, occ);
      if (door.refusal) return { ok: false, status: door.refusal === "not_found" ? 404 : 409, error: GUEST_REFUSAL_WORDS[door.refusal] };
      if (who.member && !(await deps.memberMayRsvp(who.key))) {
        return { ok: false, status: 403, error: "Your account can't answer gatherings yet. Sign in to see what opens it." };
      }
      // The expiry is decided in the same statement as the write, so a press
      // a second too late changes nothing.
      if (found.request.status === "pending" && !(await confirmGuestRequest(pool, found.request.id))) {
        const again = await guestRequestByTokenHash(pool, hashToken(String(payload.k)));
        if (!again || again.status === "pending") return { ok: false, status: 410, error: EXPIRED };
      }
      const seat = await takeSeatOrQueue(pool, eventId, who.key, occ);
      if (seat.kind === "refused") return { ok: false, status: seat.status, error: seat.error };
      return {
        ok: true,
        outcome: {
          ok: true,
          title: seat.kind === "going" ? "You're in!" : `Waitlist: number ${seat.position}`,
          paragraphs:
            seat.kind === "going"
              ? [`See you at ${found.evening.title}, ${whenFor(found)}.`]
              : [`${found.evening.title} filled up, so you're in the queue. We'll email you the moment a seat opens.`],
          description: await describeAgain(),
        },
      };
    },
  };
}
