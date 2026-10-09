/**
 * GUESTS: who may say yes to a gathering with no account, as values and pure
 * rules (the comms build spec 5.8).
 *
 * A guest is somebody with no account. They give a name and an address on
 * the gathering's card, we email them a link, and pressing it takes their
 * seat. Until they press it nothing is held for them and nothing is sent to
 * them but that one email.
 *
 * THE PERSON KEY. A guest's seat is the string `guest:<contactId>` in
 * `event_rsvps.user_id` (shared/comms/kinds.ts, `guestPersonKey`), so every
 * seat count and waitlist read that exists counts them with no change. The
 * same rule is written in drizzle/0229 and in server/lib/comms/guests.ts.
 *
 * WHEN THE DOOR IS OPEN. `guestRefusal` answers every condition at once, in
 * one order, so the gathering's card, the request and the confirmation ask
 * the same questions and cannot disagree. The comms module has to be open to
 * everyone (`public`): the spec's 5.16 says "Guest RSVPs need public", the
 * dial a founder reads says "Guests need the comms module open to everyone",
 * and docs/modules/comms.md says the same. Its 5.8 list reads "members or
 * public", which would make the two live lifecycles mean the same thing for
 * comms; the narrower reading is the one the village was told.
 *
 * Pure and isomorphic: the client's form reads the same words the server
 * refuses with.
 */
import type { ModuleLifecycle } from "../modules";

/** How long a guest has to press the confirm link (5.8). */
export const GUEST_REQUEST_HOURS = 48;

/** The signed link lives exactly as long as the request it confirms. */
export const GUEST_LINK_DAYS = GUEST_REQUEST_HOURS / 24;

/** The longest name a guest may give. `comms_contacts.name` holds 255. */
export const GUEST_NAME_MAX = 120;

/** Requests from one address in a day, and from one network in ten minutes. The eleventh is refused. */
export const GUEST_REQUESTS_PER_ADDRESS = 10;
export const GUEST_ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GUEST_REQUESTS_PER_IP = 10;
export const GUEST_IP_WINDOW_MS = 10 * 60 * 1000;

/** Every reason a guest may not say yes, in the order they are asked. */
export const GUEST_REFUSALS = [
  "not_found",
  "not_a_gathering",
  "comms_closed",
  "calendar_closed",
  "rsvp_closed",
  "not_public",
  "not_open",
  "started",
  "priced",
  "guests_off",
] as const;
export type GuestRefusal = (typeof GUEST_REFUSALS)[number];

/** What each refusal says to the person at the door. Keyed by the union, so a new reason is a compile error here. */
export const GUEST_REFUSAL_WORDS: Record<GuestRefusal, string> = {
  not_found: "We could not find that gathering.",
  not_a_gathering: "This is not something you can say you are coming to.",
  comms_closed: "This village is not taking guests by email yet.",
  calendar_closed: "This calendar is not open to visitors.",
  rsvp_closed: "This village is not taking answers to its gatherings right now.",
  not_public: "This gathering is for members of the village.",
  not_open: "This gathering is not taking answers.",
  started: "This gathering has already begun.",
  priced: "A place at this gathering has a price, so it needs an account.",
  guests_off: "The host is keeping this one to members of the village.",
};

/** The facts `guestRefusal` reads, gathered by whoever holds them. */
export interface GuestFacts {
  /** The comms module's lifecycle, as the post office reads it. */
  commsLifecycle: ModuleLifecycle;
  /** The calendar's lifecycle: a stranger reaches a gathering only through a public calendar. */
  eventsLifecycle: ModuleLifecycle;
  /** The `events.rsvp_enabled` dial. */
  rsvpEnabled: boolean;
  kind: string;
  layer: string;
  status: string;
  /** 0 is free. */
  seatPrice: number;
  /** `event_comms.guests`: null follows the village dial. */
  guestSetting: boolean | null;
  /** The `comms.guests_default` dial. */
  guestsDefault: boolean;
  /** When this evening starts, epoch milliseconds. */
  startsAt: number;
  now: number;
}

/** A gathering's own guest setting, or the village's when it has none (drizzle/0229's header). */
export function guestsOn(stored: boolean | null, villageDefault: boolean): boolean {
  return stored === null ? villageDefault : stored;
}

/**
 * Why a guest may not say yes to this evening, or null when they may.
 *
 * The village's switches come first (is anybody taking guests at all), then
 * the gathering's own facts, so a refusal names the widest reason and a host
 * is never blamed for a switch the village holds.
 */
export function guestRefusal(f: GuestFacts): GuestRefusal | null {
  if (f.kind !== "gathering" && f.kind !== "festival") return "not_a_gathering";
  if (f.commsLifecycle !== "public") return "comms_closed";
  if (f.eventsLifecycle !== "public") return "calendar_closed";
  if (!f.rsvpEnabled) return "rsvp_closed";
  if (f.layer !== "public") return "not_public";
  if (f.status !== "scheduled") return "not_open";
  if (!(f.startsAt > f.now)) return "started";
  if (f.seatPrice > 0) return "priced";
  if (!guestsOn(f.guestSetting, f.guestsDefault)) return "guests_off";
  return null;
}

/** Why a name cannot be kept, or null. An address typed as a name would reach the organiser's list, so it is refused. */
export function guestNameProblem(name: unknown): string | null {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return "Tell us your name.";
  if (n.length > GUEST_NAME_MAX) return `A name is ${GUEST_NAME_MAX} characters at most.`;
  if (n.includes("@")) return "Write your name here, and your email in the box for it.";
  return null;
}

/** What the request answers, whatever happened: a stranger learns nothing about an address from it. */
export const GUEST_CHECK_YOUR_EMAIL =
  "Check your email. We sent you a link, and your place is saved when you press it. The link works for two days.";

/** What the gathering's card asks a visitor (GET /api/events/:id/guest-rsvp). */
export interface GuestDoor {
  open: boolean;
  /** Present when closed. */
  reason?: GuestRefusal;
  message?: string;
  /** The evening the answer is for: "" for a one-off. */
  occurrenceKey: string;
}
