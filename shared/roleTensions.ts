/**
 * RAISE A TENSION WITH A ROLE: the contract (player role card, PR 5 of 7).
 *
 * Rulings (Rye, 2026-10-22):
 *
 *   - Any signed-in member, never a guest, can raise a tension with a role.
 *   - It lands with every live holder of the role: a notice in the bell, and
 *     a row in Waiting on you on their task board.
 *   - While it is open, only the holders and the member who raised it can
 *     read its words.
 *   - Once answered, the role card shows a count only. The words become
 *     readable to every member only when a holder brings it to the circle.
 *   - A tension often names a person, which is why it is private by default.
 *
 * Doors (server/routes/roleTensions.ts; the rules are server/lib/roleTensions.ts):
 *
 *   POST /api/roles/:id/tensions            { text } -> 201 { tension }
 *   GET  /api/roles/:id/tensions            RoleTensionsPayload for this reader
 *   GET  /api/role-tensions/mine            { tensions: HeldTension[] }, open ones a reader holds
 *   POST /api/role-tensions/:id/respond     { action, note? } -> { tension }
 *
 * A LIVE HOLDER is a member seated in the role now: the seating has not ended,
 * it is held as a member and it is no standing example. A seating whose term
 * has lapsed still counts: the holder is still acting in the role, and a
 * tension raised with it has to reach whoever is.
 *
 * Statuses: `open` (nobody has picked it up), `taken` (a holder is on it),
 * `answered`, and `brought_to_circle` (answered by putting it in the role's
 * circle backlog, which is the one road that makes its words public to
 * members).
 */
import { cleanLine, cleanText } from "./sessions";
import { civilDayWords } from "./seasonPlans";
import { looksLikePaymentDetails } from "./seatSettings";

export const TENSION_STATUSES = ["open", "taken", "answered", "brought_to_circle"] as const;
export type TensionStatus = (typeof TENSION_STATUSES)[number];

export const TENSION_ACTIONS = ["take", "answer", "bring_to_circle"] as const;
export type TensionAction = (typeof TENSION_ACTIONS)[number];

export const TENSION_LIMITS = {
  /** The words, 1 to 600 characters, the width of a session entry. */
  text: 600,
  /** A holder's word back. */
  note: 300,
  /** Tensions one member may raise in an hour. */
  raisesPerHour: 10,
  /** Answers one member may give in an hour. */
  respondsPerHour: 60,
} as const;

/** After this many business days open, each holder hears once more. */
export const TENSION_REMINDER_BUSINESS_DAYS = 2;

/** `rt-` and sixteen hex characters. */
export const TENSION_ID = /^rt-[0-9a-f]{16}$/;

export const MY_TENSIONS_URL = "/api/role-tensions/mine";

export function roleTensionsUrl(roleId: string): string {
  return `/api/roles/${encodeURIComponent(roleId)}/tensions`;
}

export function tensionRespondUrl(id: string): string {
  return `/api/role-tensions/${encodeURIComponent(id)}/respond`;
}

export function isTensionStatus(v: unknown): v is TensionStatus {
  return typeof v === "string" && (TENSION_STATUSES as readonly string[]).includes(v);
}

export function isTensionAction(v: unknown): v is TensionAction {
  return typeof v === "string" && (TENSION_ACTIONS as readonly string[]).includes(v);
}

/** Nobody has answered it yet. */
export function isOpenTension(status: TensionStatus): boolean {
  return status === "open" || status === "taken";
}

/**
 * WHO MAY READ THE WORDS. The raiser and the role's live holders, always.
 * Every other member once a holder brought it to the circle. Nobody else,
 * ever: a guest and a visitor read counts at most.
 */
export function mayReadTensionWords(
  t: { status: TensionStatus; raisedBy: string | null },
  viewer: { userId: string | null; member: boolean; holdsRole: boolean },
): boolean {
  if (!viewer.userId) return false;
  if (viewer.holdsRole) return true;
  if (t.raisedBy !== null && t.raisedBy === viewer.userId) return true;
  return t.status === "brought_to_circle" && viewer.member;
}

/** Whether `action` may move a tension at `status`, as a refusal key, or null when it may. */
export function respondRefusal(status: TensionStatus, action: TensionAction): "alreadyTaken" | "alreadyAnswered" | null {
  if (status === "answered" || status === "brought_to_circle") {
    // An answered tension may still be brought to the circle, once.
    return action === "bring_to_circle" && status === "answered" ? null : "alreadyAnswered";
  }
  if (action === "take" && status === "taken") return "alreadyTaken";
  return null;
}

/** What a respond moves the tension to. */
export function statusAfter(action: TensionAction): TensionStatus {
  return action === "take" ? "taken" : action === "answer" ? "answered" : "brought_to_circle";
}

export type TensionTextRefusal = "textEmpty" | "textLong" | "paymentDetails";

/** The words as stored, or why they cannot be. Over 600 characters is refused, never cut. */
export function parseTensionText(raw: unknown): { ok: true; text: string } | { ok: false; refusal: TensionTextRefusal } {
  const text = cleanText(raw, TENSION_LIMITS.text * 4);
  if (!text) return { ok: false, refusal: "textEmpty" };
  if (text.length > TENSION_LIMITS.text) return { ok: false, refusal: "textLong" };
  if (looksLikePaymentDetails(text)) return { ok: false, refusal: "paymentDetails" };
  return { ok: true, text };
}

export type RespondRefusal = "badAction" | "noteLong" | "paymentDetails";

/** A respond body, or why it cannot be read. */
export function parseRespond(body: unknown): { ok: true; action: TensionAction; note: string | null } | { ok: false; refusal: RespondRefusal } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!isTensionAction(b.action)) return { ok: false, refusal: "badAction" };
  if (typeof b.note === "string" && b.note.trim().length > TENSION_LIMITS.note) return { ok: false, refusal: "noteLong" };
  const note = cleanLine(b.note, TENSION_LIMITS.note);
  if (note && looksLikePaymentDetails(note)) return { ok: false, refusal: "paymentDetails" };
  return { ok: true, action: b.action, note };
}

// ── What comes back ─────────────────────────────────────────────────────────

/** One tension as a reader allowed its words sees it. Never names the raiser. */
export interface TensionCard {
  id: string;
  roleId: string;
  status: TensionStatus;
  text: string;
  /** Whether this reader raised it, so the page can say "you raised this". */
  mine: boolean;
  answerNote: string | null;
  /** A civil date in the village's zone. */
  raisedOn: string;
  answeredOn: string | null;
}

/** GET /api/roles/:id/tensions. */
export interface RoleTensionsPayload {
  /** Whether this reader may raise one: a signed-in member. */
  mayRaise: boolean;
  /** Unanswered tensions, counted for members. */
  open: number;
  /** Answered tensions, brought to the circle or not. */
  answered: number;
  /** The tensions whose words this reader may read, newest first. */
  tensions: TensionCard[];
}

/** One open tension in a holder's Waiting on you. */
export interface HeldTension {
  id: string;
  roleId: string;
  /** The role's full title. */
  role: string;
  circle: string | null;
  text: string;
  status: "open" | "taken";
  raisedOn: string;
  /** Open past the reminder line: two business days on the village's clock. */
  overdue: boolean;
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** One held tension as the client trusts it, or null. */
export function readHeldTension(v: unknown): HeldTension | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (!isStr(t.id) || !isStr(t.roleId) || !isStr(t.role) || !isStr(t.text) || !isStr(t.raisedOn)) return null;
  if (t.status !== "open" && t.status !== "taken") return null;
  return {
    id: t.id,
    roleId: t.roleId,
    role: t.role,
    circle: isStr(t.circle) && t.circle.trim() ? t.circle : null,
    text: t.text,
    status: t.status,
    raisedOn: t.raisedOn,
    overdue: t.overdue === true,
  };
}

/** A list of held tensions; anything else reads as none. */
export function readHeldTensions(v: unknown): HeldTension[] {
  return Array.isArray(v) ? v.map(readHeldTension).filter((t): t is HeldTension => t !== null) : [];
}

// ── The words ───────────────────────────────────────────────────────────────

export const TENSION_COPY = {
  raise: "Raise a tension",
  /** Said before a word is written. */
  privacy: "Only the role's holders and you can read this until it's answered.",
  label: "What could this role do differently?",
  hint: "Say what you noticed and what you need. Up to 600 characters.",
  send: "Send to the role",
  cancel: "Not now",
  sent: "Sent. The role's holders will see it in their tasks.",
  sendFailed: "That did not send. Try again.",
  count: (n: number): string => `${n} ${n === 1 ? "character" : "characters"} left`,

  // Waiting on you
  groupHeading: "Raised with your roles",
  rowWhere: (role: string, circle: string | null): string => [role, circle].filter(Boolean).join(" · "),
  raisedOn: (day: string): string => `Raised ${civilDayWords(day)}`,
  takenBy: "You or another holder took it",
  overdue: `Waiting ${TENSION_REMINDER_BUSINESS_DAYS} business days`,
  take: "Take it",
  answer: "Answer",
  bring: "Bring to the circle",
  notePlaceholder: "A word back, if you like",
  noteLabel: "Your answer",
  confirmAnswer: "Send the answer",
  confirmBring: "Bring it to the circle",
  bringWarning: "Its words go into the circle's backlog, where every member can read them.",
  responded: {
    take: "Taken. It stays here until you answer it.",
    answer: "Answered. The role card shows it as a count.",
    bring_to_circle: "Brought to the circle. It waits in the circle's backlog for the next session.",
  } satisfies Record<TensionAction, string>,
  respondFailed: "That did not save. Try again.",

  // The notices
  noticeTitle: (role: string): string => `A tension was raised with ${role}`,
  noticeBody: "Only the role's holders and whoever raised it can read it. Take it, answer it, or bring it to the circle from Tasks on your profile.",
  reminderTitle: (role: string): string => `A tension raised with ${role} has waited ${TENSION_REMINDER_BUSINESS_DAYS} business days`,
  reminderBody: "Take it, answer it, or bring it to the circle from Tasks on your profile.",
} as const;

export const TENSION_REFUSALS = {
  membersOnly: "Only members can raise a tension with a role.",
  signIn: "Sign in to raise a tension with a role.",
  noRole: "There is no role by that id.",
  noHolders: "Nobody holds this role now, so there is nobody to read a tension. Bring it to the circle instead.",
  textEmpty: "Write the tension first.",
  textLong: `A tension is at most ${TENSION_LIMITS.text} characters.`,
  paymentDetails: "That looks like payment details. Leave card and account numbers out.",
  tooMany: "That is a lot of tensions in an hour. Wait a little and try again.",
  notFound: "There is no tension by that id.",
  notHolder: "Only the role's holders can answer a tension raised with it.",
  badAction: "Say take, answer or bring_to_circle.",
  noteLong: `An answer is at most ${TENSION_LIMITS.note} characters.`,
  alreadyTaken: "A holder has already taken this tension.",
  alreadyAnswered: "This tension has already been answered.",
  respondsTooMany: "That is a lot of answers in an hour. Wait a little and try again.",
  noCircle: "This role sits in no circle, so there is no backlog to bring it to.",
  circleNotMet: "This role's circle has not met yet, so there is no backlog to bring it to. Answer it for now.",
  sessionsOff: "Live Sessions is off in this village, so there is no circle backlog to bring it to.",
  wordsCleared: "The words of this tension were cleared, so there is nothing to bring to the circle.",
} as const;
