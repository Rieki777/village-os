/**
 * Live Sessions: CIRCLE MEETINGS ON A CALENDAR.
 *
 * ONE FILE IS THE CONTRACT for following circles on your own calendar, the
 * way shared/sessionRhythm.ts is for when circles meet. The store
 * (server/repos/sessionCalendar.ts), the logic (server/lib/sessionCalendar.ts),
 * the doors (server/routes/sessionCalendar.ts) and "Follow the calendar" on
 * /sessions read their shapes, rules and words from here. The schema is
 * drizzle/0275_a_member_follows_circles_on_their_calendar.sql.
 *
 * WHERE IT COMES FROM. The founder asked for circle meetings to sit on the
 * village calendar, and for a button on /sessions where a member picks which
 * circles to follow and adds them to Google Calendar, Apple or Outlook, kept
 * in sync. It follows what the village calendar already does (its .ics feed
 * and its private address, server/lib/icsFeed.ts):
 *
 *   - Each circle's rhythm is mirrored into the one calendar, so it shows on
 *     the Events calendar and in that calendar's own feeds.
 *   - A member chooses circles, or every circle with the new ones too. The
 *     list is the live circles, read from the village each time.
 *   - Their private address carries the meetings of the circles they follow
 *     at the moment a calendar app reads it, so a changed rhythm, a skipped
 *     meeting or a new circle reaches the app with no new address.
 *
 * WHO: any member who may use Live Sessions follows circles and makes an
 * address. A meeting time is the circle's door, readable by every member
 * (shared/sessionRhythm.ts), so following asks no standing.
 *
 * THE ADDRESS IS A CREDENTIAL: a key of 32 random bytes, shown once inside
 * the address, stored only as its sha256. A new one takes the place of the
 * old. It answers nothing while the module is off or in preview, or once the
 * member has left the village or is no longer admitted.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */
import { CIRCLES_API } from "./sessionRhythm";
import { circleWords } from "./sessionTasks";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door. A refusal is `{ error: <a sentence> }` with a 4xx status.
 *
 *   GET    /api/sessions/circles/following       FollowPayload
 *   PUT    /api/sessions/circles/following       FollowInput -> FollowPayload
 *   POST   /api/sessions/circles/following/key   -> { url } (the address, shown this once)
 *   DELETE /api/sessions/circles/following/key   -> { ok: true }
 *   GET    /api/calendar/circles.ics?key=        text/calendar, for a calendar app
 *
 * The first four sit behind the room's gates on `/api/sessions`. The feed
 * cannot: a calendar app reads it with no sign-in, so it lives outside that
 * prefix, measures the module's state and the key holder itself, and answers
 * a bare 404 to anything it will not serve.
 */
export const FOLLOW_API = `${CIRCLES_API}/following`;
export const FOLLOW_KEY_API = `${FOLLOW_API}/key`;
export const CIRCLE_FEED_PATH = "/api/calendar/circles.ics";

/** The one row that means every circle, the ones still to come included. */
export const EVERY_CIRCLE = "*";

/** Where the village calendar mirrors a circle's rhythm from, and as what. */
export const MIRROR_SOURCE = "sessions";

export const CALENDAR_LIMITS = {
  /** New addresses, per member, per day. */
  keysPerDay: 10,
  /** Saves of the circles followed, per member, per hour. */
  followsPerHour: 60,
  /**
   * Reads of the feed per network address per hour. Generous on purpose:
   * Google reads every subscriber's address from a shared pool of its own,
   * so one of its addresses can carry many members' calendars at once.
   */
  feedReadsPerAddressPerHour: 600,
  /** Reads of one address per hour. A calendar app reads a few times a day. */
  feedReadsPerKeyPerHour: 30,
} as const;

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface FollowCircle {
  id: string;
  name: string;
  followed: boolean;
  /** "Every Thursday at 18:00", or null while the circle has no rhythm. */
  rhythm: string | null;
}

export interface FollowPayload {
  /** Every live circle, by name. */
  circles: FollowCircle[];
  /** Every circle, the ones still to come included. */
  all: boolean;
  /** The member's address, when they hold one: when it was made and last read. Never the key. */
  address: { madeAt: string; lastReadAt: string | null } | null;
  /** Whether an address answers now: false while the module is in preview, the admins' own. */
  serving: boolean;
}

export interface FollowInput {
  all: boolean;
  circleIds: string[];
}

// ── Reading a body ───────────────────────────────────────────────────────────

type Clean<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** The circles to follow, from a body. Every id must be a live circle's. */
export function cleanFollow(raw: unknown, liveIds: ReadonlySet<string>): Clean<FollowInput> {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const all = b.all === true;
  const list: unknown[] = Array.isArray(b.circleIds) ? b.circleIds : [];
  if (list.some((v) => typeof v !== "string")) return { ok: false, status: 400, error: CALENDAR_REFUSALS.circleUnknown };
  const ids = Array.from(new Set((list as string[]).map((v) => v.trim()).filter(Boolean)));
  if (ids.some((id) => !liveIds.has(id))) return { ok: false, status: 400, error: CALENDAR_REFUSALS.circleUnknown };
  return { ok: true, value: { all, circleIds: all ? [] : ids.sort() } };
}

/** A key as it travels in an address: 64 hex characters. */
export function looksLikeFeedKey(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

// ── Addresses ────────────────────────────────────────────────────────────────

/** The private address of a key. */
export function feedUrl(origin: string, key: string): string {
  return `${origin.replace(/\/$/, "")}${CIRCLE_FEED_PATH}?key=${key}`;
}

/** The same address as a calendar subscription link (Apple, Outlook). */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:/, "webcal:");
}

/** Google Calendar's own "add this calendar by its address" page. */
export function googleAddUrl(url: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`;
}

// ── Words ────────────────────────────────────────────────────────────────────

/** What a circle's meeting is called on a calendar: "Garden circle meeting". */
export function meetingTitle(circleName: string): string {
  return `${circleWords(circleName)} meeting`;
}

export const CALENDAR_COPY = {
  follow: "Follow the calendar",
  title: "Circle meetings on your own calendar",
  lede: "Choose the circles whose meetings you want on your calendar. Your calendar app checks every few hours, so new meetings, skipped ones and new circles reach it on their own.",
  everyCircle: "Every circle, new ones too",
  noRhythm: "No meeting rhythm yet",
  save: "Save my circles",
  saving: "Saving...",
  notSaved: "Not saved yet.",
  saved: (n: number, all: boolean): string =>
    all ? "Saved. Your calendar follows every circle." : n === 0 ? "Saved. Your calendar follows no circle now." : n === 1 ? "Saved. Your calendar follows 1 circle." : `Saved. Your calendar follows ${n} circles.`,
  addressTitle: "Your calendar address",
  makeAddress: "Make my calendar address",
  addressPrivate: "This address is yours. Anyone who has it can see the meetings of the circles you follow, so keep it to yourself.",
  shownOnce: "It shows only this once. If you lose it, make a new one.",
  ready: "Your calendar address is ready. It shows only this once.",
  notServing: "Live Sessions is in preview, so this address shows nothing until members can use it.",
  addGoogle: "Add to Google Calendar",
  addApple: "Add to Apple or Outlook",
  copy: "Copy the address",
  copied: "Copied.",
  addressLabel: "Your calendar address",
  madeOn: (day: string): string => `You made your calendar address on ${day}.`,
  readOn: (day: string): string => `Your calendar app last checked it on ${day}.`,
  notReadYet: "No calendar app has checked it yet.",
  newAddress: "Make a new address",
  newAddressHint: "The old one stops working.",
  stopAddress: "Stop my address",
  stopped: "Stopped. Your old address shows nothing now.",
  close: "Close",
  failed: "That did not go through. Try again in a moment.",
  /** The feed's own name, as a calendar app shows it. */
  feedName: (villageName: string): string => `${villageName} circle meetings`,
  /** Under each meeting in a calendar app. */
  feedDescription: "The agenda items waiting for it are on the sessions page.",
} as const;

export const CALENDAR_REFUSALS = {
  circleUnknown: "One of those circles isn't one of the village's circles now. Choose again.",
  tooManyAddresses: "You have made enough addresses today. Try again tomorrow.",
  slowDown: "That was a lot at once. Try again in a little while.",
} as const;
