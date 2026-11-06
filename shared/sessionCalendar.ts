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
 * A CIRCLE'S OWN CALENDAR. A circle that already keeps its meetings in
 * Google Calendar, Apple or Outlook attaches that calendar's secret address
 * (drizzle/0277_a_circle_attaches_its_own_calendar.sql). It becomes one of the
 * village's own external calendar subscriptions (server/lib/externalCalendars.ts):
 * the address sealed in the secrets store and never returned, fetched through
 * the outbound guard every few hours, its events imported onto the circle
 * layer. Its meetings then count as the circle's: in Coming up (the sooner of
 * the rhythm's next meeting and the calendar's), the day-before notice, the
 * circle's summary, and the calendars of members who follow the circle. The
 * circle's members and admins attach, replace and detach it.
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

/** Attach (PUT `{ url }`) or detach (DELETE) a circle's own calendar: the circle's members and admins. */
export function ownCalendarUrl(circleId: string): string {
  return `${CIRCLES_API}/${encodeURIComponent(circleId)}/calendar`;
}
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
  /** Attaching or detaching a circle's own calendar, per member, per day. Each attach is read at once, from outside. */
  ownCalendarWritesPerDay: 10,
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

/** A circle's own calendar, as its members and admins see it. Never the address. */
export interface OwnCalendarView {
  /** Where the address points, "calendar.google.com". */
  host: string;
  /** Its last four characters, enough to recognise it. */
  last4: string;
  lastReadAt: string | null;
  /** How the last read went. */
  status: "ok" | "failed" | "never";
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

/** The words of a circle's own calendar. */
export const OWN_CALENDAR_COPY = {
  open: "Attach a circle's own calendar",
  title: "A circle's own calendar",
  lede: "If a circle keeps its meetings in Google Calendar, Apple or Outlook, attach that calendar here. Its meetings show under Coming up and reach everyone who follows the circle.",
  findIt: "In Google Calendar, open Settings, choose the calendar, and copy its secret address in iCal format.",
  circleLabel: "Which circle?",
  circleChoose: "Choose a circle",
  urlLabel: "The calendar's secret address",
  attach: "Attach the calendar",
  replace: "Attach a different calendar",
  attaching: "Attaching...",
  cancel: "Cancel",
  /** One attached calendar, as its keepers see it. */
  attachedLine: (circleName: string, host: string, last4: string): string => `${circleWords(circleName)}: ${host}, ending ${last4}`,
  readOn: (day: string): string => `Last read on ${day}.`,
  notReadYet: "Not read yet.",
  readFailed: "The last read did not work. Check that the address is the secret one, and attach it again.",
  detach: "Detach",
  /** The confirm "Detach" opens: undoing it takes the secret address again. */
  detachConfirm: (circleName: string): string =>
    `Detach the ${circleWords(circleName)} calendar? Its meetings leave Coming up and the calendars of those who follow the circle. Attaching it again takes its secret address.`,
  detachYes: "Detach it",
  keep: "Keep it",
  /** While the village cannot seal an address, nobody can attach one. */
  unavailable: "This village cannot keep calendar addresses yet. Ask an admin to set it up.",
  attached: (circleName: string): string => `Attached. The ${circleWords(circleName)} meetings from its own calendar now show under Coming up.`,
  attachedUnread: (circleName: string): string =>
    `Attached to the ${circleWords(circleName)}, but the first read did not work. Check that the address is the secret one.`,
  detached: (circleName: string): string => `Detached. The ${circleWords(circleName)} meetings from that calendar have gone from Coming up.`,
  /** The subscription's name on the admins' list of external calendars. */
  subscriptionName: (circleName: string): string => `${circleWords(circleName)}, its own calendar`,
  /** In place of a rhythm, on a row whose meetings come from the circle's own calendar. */
  fromOwnCalendar: "From the circle's own calendar",
} as const;

export const OWN_CALENDAR_REFUSALS = {
  notYours: "Only the circle's members and admins can attach its calendar.",
  urlNeeded: "Paste the calendar's address, starting with https:// or webcal://.",
  /** For any address the outbound guard turns away. Says nothing of why: that is the admins' to read. */
  cantRead: "That address cannot be read from here. Check that it is the calendar's secret address in iCal format.",
  /** While the village has no secrets key. The operator's own sentence stays with the admins. */
  noSecretsKey: "This village cannot keep calendar addresses yet. Ask an admin to set it up.",
  noneAttached: "This circle has no calendar of its own attached.",
  slowDown: "That was a lot at once. Try again tomorrow.",
} as const;

export const CALENDAR_REFUSALS = {
  circleUnknown: "One of those circles isn't one of the village's circles now. Choose again.",
  tooManyAddresses: "You have made enough addresses today. Try again tomorrow.",
  slowDown: "That was a lot at once. Try again in a little while.",
} as const;
