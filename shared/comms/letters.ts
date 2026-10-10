/**
 * LETTERS, AS VALUES: who a letter is for, where a letter stands, and the
 * rules that keep a send safe (the comms build spec 5.12). The server
 * (server/lib/comms/letters.ts) and the Letters screen
 * (client/src/components/admin/comms/CommsLetters.tsx) read the same words
 * from here, so a rule the screen explains is the rule the server applies.
 *
 * PORTED FROM ReGen Civics' Outbound safe send (`server/lib/newsletter-issue-
 * email.ts` and `shared/outboundSchedule.ts` there): a confirmation that lasts
 * fifteen minutes and is bound to the words, the audience and the count; ten
 * minutes between letters; a schedule at least a minute and at most ninety
 * days ahead. What changed is who decides the daily limit: a village dial,
 * `comms.letters_per_day`, in place of a constant.
 *
 * Pure and isomorphic: no imports beyond types, nothing that touches a
 * database or the DOM.
 */

// ── Where a letter stands ───────────────────────────────────────────────────

/**
 * The states drizzle/0246 names for `comms_letters.state`.
 *
 *   draft      being written. The only state whose words may change, with
 *              `cancelled`.
 *   scheduled  confirmed, waiting for `scheduled_for`.
 *   sending    claimed: its recipients are being handed to the post office.
 *              A letter left here by a crash is picked up again by the
 *              letters job once its claim is ten minutes old.
 *   sent       every recipient was handed to the post office, or skipped.
 *   cancelled  a scheduled letter taken back. It may be edited and sent again.
 */
export const LETTER_STATES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
export type LetterState = (typeof LETTER_STATES)[number];

/** The states whose words may still change, and which a confirmation may claim. */
export const EDITABLE_LETTER_STATES: readonly LetterState[] = ["draft", "cancelled"];

/**
 * One snapshot row's state (`comms_letter_recipients.status`).
 *
 *   pending  in the snapshot, not yet handed to the post office.
 *   posted   handed over; `message_id` names the post office row.
 *   skipped  not handed over, or refused at the door, and `skip_reason` says why.
 */
export const LETTER_RECIPIENT_STATES = ["pending", "posted", "skipped"] as const;
export type LetterRecipientState = (typeof LETTER_RECIPIENT_STATES)[number];

/**
 * The frames a letter may be set in. One today: the village's own "Every
 * letter" words (`letter.layout`), which Words edits. The column exists so a
 * second frame is a new member here and nothing more.
 */
export const LETTER_LAYOUTS = ["plain"] as const;
export type LetterLayout = (typeof LETTER_LAYOUTS)[number];

/** The template each layout renders through. */
export const LAYOUT_TEMPLATE: Record<LetterLayout, string> = { plain: "letter.layout" };

// ── The rules ───────────────────────────────────────────────────────────────

/** A confirmation lasts this long after the preview that made it. */
export const CONFIRM_MINUTES = 15;

/** Two letters go at least this far apart. */
export const LETTER_GAP_MINUTES = 10;

/** A letter left `sending` this long belonged to a send that stopped; the job picks it up. */
export const LETTER_RESUME_MINUTES = 10;

/** A schedule goes at least this far ahead... */
export const MIN_SCHEDULE_AHEAD_MS = 60_000;
/** ...and at most this far. */
export const MAX_SCHEDULE_AHEAD_MS = 90 * 86_400_000;

/** The letters per day when the dial cannot be read: the dial's own default. */
export const DEFAULT_LETTERS_PER_DAY = 3;

/** How many names the preview shows. */
export const PREVIEW_NAMES = 5;

export const LETTER_LIMITS = { subject: 200, preheader: 255, bodyMd: 100_000 } as const;

/** The scheduler job that sends due letters and picks up a stopped send. */
export const LETTERS_JOB = "comms-letters";
export const LETTERS_EVERY_MS = 60_000;

// ── Who a letter is for ─────────────────────────────────────────────────────

/**
 * The four audiences of 5.12. Every one of them is filtered to people who
 * said yes to letters, because letters go only on an explicit yes (5.3); the
 * preview says how many were left out for that reason.
 *
 *   members    every member who said yes to letters.
 *   path       people walking one path.
 *   gathering  the people who came to one gathering (or, when nobody marked
 *              who came, everyone who said yes to it: the recap's rule, 5.9).
 *   everyone   every contact who said yes to letters, members or not.
 */
export const LETTER_AUDIENCE_KINDS = ["members", "path", "gathering", "everyone"] as const;
export type LetterAudienceKind = (typeof LETTER_AUDIENCE_KINDS)[number];

export type LetterAudience =
  | { kind: "members" }
  | { kind: "path"; pathId: string }
  | { kind: "gathering"; eventId: string }
  | { kind: "everyone" };

const ID = /^[A-Za-z0-9:_.-]{1,64}$/;

/**
 * An audience from stored or posted JSON, or null when it names none. Only
 * the fields of its kind are kept, in a fixed order, so two equal audiences
 * always serialise to the same string and hash to the same value.
 */
export function parseLetterAudience(raw: unknown): LetterAudience | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  switch (r.kind) {
    case "members":
      return { kind: "members" };
    case "everyone":
      return { kind: "everyone" };
    case "path":
      return typeof r.pathId === "string" && ID.test(r.pathId) ? { kind: "path", pathId: r.pathId } : null;
    case "gathering":
      return typeof r.eventId === "string" && ID.test(r.eventId) ? { kind: "gathering", eventId: r.eventId } : null;
    default:
      return null;
  }
}

/** The audience in one plain line, for the screen and for History. */
export function audienceLabel(a: LetterAudience, names: { path?: string | null; gathering?: string | null } = {}): string {
  switch (a.kind) {
    case "members":
      return "Members who said yes to letters";
    case "everyone":
      return "Everyone who said yes to letters";
    case "path":
      return `People on the ${names.path || a.pathId} path`;
    case "gathering":
      return `People who came to ${names.gathering || "a gathering"}`;
  }
}

// ── The words, and what a confirmation is bound to ──────────────────────────

export interface LetterDraft {
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: LetterLayout;
  audience: LetterAudience;
}

/**
 * Exactly what a confirmation approves, as one string: the words, the frame
 * and the audience. The server hashes it (SHA-256) and binds the confirmation
 * to that hash, so an edit after the preview refuses the old confirmation.
 */
export function letterCanonical(d: LetterDraft): string {
  return JSON.stringify([d.subject, d.preheader ?? "", d.bodyMd, d.layout, d.audience]);
}

/**
 * A draft from a request body, or the problems with it, each one a sentence
 * the screen shows.
 */
export function readLetterDraft(body: unknown): { draft: LetterDraft } | { problems: string[] } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const problems: string[] = [];
  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  const preheaderRaw = typeof b.preheader === "string" ? b.preheader.trim() : "";
  const bodyMd = typeof b.bodyMd === "string" ? b.bodyMd.replace(/\r\n/g, "\n") : "";
  const layout = (LETTER_LAYOUTS as readonly string[]).includes(String(b.layout ?? "plain")) ? (String(b.layout ?? "plain") as LetterLayout) : null;
  const audience = parseLetterAudience(b.audience);
  if (!subject) problems.push("Give the letter a subject.");
  if (subject.length > LETTER_LIMITS.subject) problems.push(`Keep the subject under ${LETTER_LIMITS.subject} characters.`);
  if (preheaderRaw.length > LETTER_LIMITS.preheader) problems.push(`Keep the preview line under ${LETTER_LIMITS.preheader} characters.`);
  if (!bodyMd.trim()) problems.push("Write the letter before saving it.");
  if (bodyMd.length > LETTER_LIMITS.bodyMd) problems.push("The letter is too long to send as one email.");
  if (!layout) problems.push("Choose a layout this village has.");
  if (!audience) problems.push("Choose who the letter is for.");
  if (problems.length || !layout || !audience) return { problems };
  return { draft: { subject, preheader: preheaderRaw || null, bodyMd, layout, audience } };
}

/**
 * Why a schedule time cannot be used, or null when it can. `when` and `now`
 * are epoch milliseconds.
 */
export function scheduleProblem(when: number, now: number): string | null {
  if (!Number.isFinite(when)) return "That send time is not a date.";
  const ahead = when - now;
  if (ahead < MIN_SCHEDULE_AHEAD_MS) return "Pick a time at least one minute from now.";
  if (ahead > MAX_SCHEDULE_AHEAD_MS) return "Schedule a letter at most 90 days ahead.";
  return null;
}

/**
 * Why another letter cannot go now, or null when it can. `sentToday` counts
 * letters that began going out in the last 24 hours; `minutesSinceLast` is
 * how long ago the latest of them did, or null when none did.
 */
export function capProblem(sentToday: number, minutesSinceLast: number | null, perDay: number): string | null {
  const limit = Math.max(1, Math.trunc(Number.isFinite(perDay) ? perDay : DEFAULT_LETTERS_PER_DAY));
  if (sentToday >= limit) {
    return `This village sends at most ${limit} ${limit === 1 ? "letter" : "letters"} a day, and that many went in the last 24 hours. Send it tomorrow, or schedule it.`;
  }
  if (minutesSinceLast !== null && minutesSinceLast < LETTER_GAP_MINUTES) {
    const wait = Math.max(1, Math.ceil(LETTER_GAP_MINUTES - minutesSinceLast));
    return `Letters go at least ${LETTER_GAP_MINUTES} minutes apart. Try again in ${wait} ${wait === 1 ? "minute" : "minutes"}.`;
  }
  return null;
}
