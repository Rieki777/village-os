/**
 * ASKS: one member asking another to review, edit, approve or finish
 * something, so it lands on their "Waiting on you" list instead of in a chat
 * they have to scroll (the "Waiting on you" proposal, decided by the master
 * coordinator under Rye's delegation on 2026-10-31).
 *
 *   POST /api/asks                    ask someone (AskInput)
 *   GET  /api/asks                    AsksPayload: asks waiting on the reader, and the reader's own
 *   GET  /api/asks/people?q=          current members to ask, by name
 *   POST /api/asks/:id/done           the asked member did it
 *   POST /api/asks/:id/not-mine       the asked member hands it back
 *   POST /api/asks/:id/withdraw       the asker takes it back
 *
 * The rules, each decided on 2026-10-31:
 *   - ANYONE MAY ASK ANYONE who is a current member. Never themselves, never a
 *     former member, never an erased account.
 *   - AT MOST THREE OPEN BLOCKING ASKS per asker, so "I'm stuck" keeps its
 *     meaning. Asks that do not block have no cap.
 *   - ONLY THE TWO PEOPLE see an ask. The routes read rows by the reader's own
 *     id on one side or the other; nobody else's id reaches a row.
 *   - "NOT MINE" HANDS IT BACK. The same link cannot then go back to the same
 *     member, or the two would pass it between them for ever.
 *
 * Everything here is pure, so the routes and the list draw from one place.
 */

export const ASKS_URL = "/api/asks";

/** The most open blocking asks one member may have out at once. */
export const MAX_OPEN_BLOCKING = 3;
export const WHY_MAX = 300;
export const NOTE_MAX = 300;
export const LINK_MAX = 1000;

export type AskStatus = "open" | "done" | "handed_back" | "withdrawn";

/** Which band of "Waiting on you" an open ask sits in. */
export type AskTier = "blocking" | "this-week" | "whenever";

export interface AskInput {
  askedUserId: string;
  link: string;
  why: string;
  /** YYYY-MM-DD, or absent. */
  dueOn?: string | null;
  blocking?: boolean;
}

/** One ask as either of its two members reads it. */
export interface AskView {
  id: string;
  link: string;
  why: string;
  dueOn: string | null;
  blocking: boolean;
  status: AskStatus;
  /** The other member's first name: the asker on a waiting row, the asked on your own. */
  otherName: string;
  /** The day it was asked, a civil date. */
  askedOn: string;
  /** What the asked member said when handing it back. */
  handBackNote: string | null;
  tier: AskTier;
}

export interface AsksPayload {
  /** Open asks waiting on the reader, blocking first. */
  waitingOnYou: AskView[];
  /** The reader's own asks: open first, then the last few closed ones. */
  yourAsks: AskView[];
}

/** A link a member can follow: http(s), or a path on this site. Never `//host`, never `javascript:`. */
export function cleanLink(raw: unknown): string | null {
  const link = String(raw ?? "").trim();
  if (!link || link.length > LINK_MAX) return null;
  if (link.startsWith("/")) return link.startsWith("//") || link.startsWith("/\\") ? null : link;
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? link : null;
  } catch {
    return null;
  }
}

/** A civil date, or null for none. Anything else is undefined, which the route refuses. */
export function cleanDueOn(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) return undefined;
  return s;
}

export type AskRefusal = { status: 400 | 403 | 404 | 409; error: string };

/** Everything about an ask that can be checked without the database. */
export function refuseAskInput(askerId: string, input: Partial<AskInput>): AskRefusal | null {
  const askedUserId = String(input.askedUserId ?? "").trim();
  if (!askedUserId) return { status: 400, error: "Choose who you are asking." };
  if (askedUserId === askerId) return { status: 400, error: "You cannot ask yourself. Add it to your own tasks." };
  if (!cleanLink(input.link)) return { status: 400, error: "Add a link to what you need: a web address or a page on this site." };
  const why = String(input.why ?? "").trim();
  if (!why) return { status: 400, error: "Say in a line what you need them to do." };
  if (why.length > WHY_MAX) return { status: 400, error: `Keep why to ${WHY_MAX} characters.` };
  if (cleanDueOn(input.dueOn) === undefined) return { status: 400, error: "A due date is a day, like 2026-11-07." };
  return null;
}

/** The refusal for a new blocking ask once the asker already has the most allowed. */
export function refuseBlockingCap(openBlocking: number, blocking: boolean): AskRefusal | null {
  if (!blocking || openBlocking < MAX_OPEN_BLOCKING) return null;
  return {
    status: 409,
    error: `You already have ${MAX_OPEN_BLOCKING} asks marked as blocking you. Close one, or send this one without blocking.`,
  };
}

/** The refusal for sending back a link the same member already handed back. */
export function refuseHandedBackAgain(handedBackBefore: boolean): AskRefusal | null {
  return handedBackBefore
    ? { status: 409, error: "They already said this one is not theirs. Ask someone else, or talk it through with them first." }
    : null;
}

/** Whole days from one civil date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Blocking first; then anything due within seven days (or overdue); then whenever. */
export function tierOf(ask: { blocking: boolean; dueOn: string | null }, today: string): AskTier {
  if (ask.blocking) return "blocking";
  if (ask.dueOn && daysBetween(today, ask.dueOn) <= 7) return "this-week";
  return "whenever";
}

const TIER_ORDER: Record<AskTier, number> = { blocking: 0, "this-week": 1, whenever: 2 };

/** The order "Waiting on you" draws open asks in: tier, then the nearest due date, then the oldest ask. */
export function rankAsks<T extends { tier: AskTier; dueOn: string | null; askedOn: string }>(asks: readonly T[]): T[] {
  return [...asks].sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
      a.askedOn.localeCompare(b.askedOn),
  );
}

/** The words over each band. */
export const TIER_WORDS: Record<AskTier, string> = {
  blocking: "Someone is stuck until you do these",
  "this-week": "Due this week",
  whenever: "Whenever you can",
};

/** What the asker reads about an ask of theirs. */
export function statusWords(status: AskStatus): string {
  switch (status) {
    case "open":
      return "Waiting";
    case "done":
      return "Done";
    case "handed_back":
      return "Handed back";
    case "withdrawn":
      return "Withdrawn";
  }
}
