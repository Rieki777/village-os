/**
 * A RAISED HAND FOR A POWER.
 *
 * Rye's ruling (2026-09-09) puts the powers a village entrusts to the members
 * they suit, from Contributor, and `shared/powerAffinity.ts` decides which
 * those are. A recommendation a member cannot act on is half a loop, so this
 * lets them answer one: raise a hand for a power put to them, and the hand lands
 * in the same inbox a raised hand for a seat already lands in.
 *
 * ── A HAND ASKS. IT NEVER GRANTS. ──────────────────────────────────────────
 *
 * Saying yes to a hand in the inbox gives nobody anything. A power reaches a
 * member the way every entrusted power does: through a role that carries it
 * (`roles.capabilities`) and a seat on that role (`role_holders`), or through a
 * badge. The inbox row is the member's offer, and the appointment is the
 * village's answer, made where appointments are made. Keeping the two apart is
 * what stops the inbox becoming a second gate beside the one gate.
 *
 * ── A HAND IS UP UNTIL IT IS ANSWERED ──────────────────────────────────────
 *
 * The inbox's five words are `new`, `reviewing`, `in-conversation`, `accepted`
 * and `declined`. A hand is up through the first three, while an answer is
 * still coming, and either answer puts it down.
 *
 * A yes puts it down too, and that is a correction. Counting `accepted` as a
 * hand still up kept it up for good, because nothing moves an inbox row once it
 * is answered: when the seat that carried the power reached the end of its
 * term (every seat has one), the member's profile went on promising the power
 * would open when someone appointed them, and refused every new hand. The yes
 * reaches the member as the notice that names the power. The appointment is
 * then the village's to make, and a member still waiting can raise a hand again.
 *
 * ── NO TAKING A HAND DOWN, YET ─────────────────────────────────────────────
 *
 * A member cannot take a hand down, the same as a hand for a seat, and here the
 * reason is the store. The inbox is a `dbCollection`, whose only way to remove a
 * row is `replaceAll`: the whole table, written back from a cached snapshot. A
 * member's click must not rewrite every row a founder works, so until the store
 * can remove one row by id under its version lock, a member who changes their
 * mind tells the founders, who can decline or delete the row.
 *
 * Pure on purpose, so every rule here is provable without a database.
 */

/** The inbox type a hand for a power is filed under. */
export const POWER_APPLICATION = "power-application";

/** The inbox statuses in which a hand is still up. An answer, yes or no, puts it down. */
export const STANDING_HAND_STATUSES = ["new", "reviewing", "in-conversation"] as const;
export type StandingHandStatus = (typeof STANDING_HAND_STATUSES)[number];

/** A hand that is up, as the server reads it off the inbox. */
export interface RaisedHand {
  id: string;
  status: StandingHandStatus;
  submittedAt: string;
}

/** As much of an inbox row as a hand reads. The inbox stores anything, so every field is checked. */
export interface InboxRow {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  userId?: unknown;
  submittedAt?: unknown;
  data?: unknown;
}

/** Why a hand cannot go up, with the words a member reads. */
export interface HandRefusal {
  status: 404 | 409;
  error: string;
  message: string;
}

function isStanding(status: unknown): status is StandingHandStatus {
  return (STANDING_HAND_STATUSES as readonly unknown[]).indexOf(status) >= 0;
}

/** The power a hand names, or "" for a row that names none. */
export function handCapability(row: InboxRow): string {
  const data = row.data !== null && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
  return typeof data.capability === "string" ? data.capability.trim() : "";
}

/**
 * One member's hands that are still up, by power.
 *
 * Two rows for one power can exist (a row written by hand, or two taps that
 * landed either side of a restart), and the newest wins, so the member sees the
 * hand the inbox lists first.
 */
export function standingHands(rows: readonly InboxRow[], userId: string): Map<string, RaisedHand> {
  const out = new Map<string, RaisedHand>();
  if (!userId) return out;
  for (const row of rows) {
    const status = row.status;
    if (row.type !== POWER_APPLICATION || String(row.userId ?? "") !== userId || !isStanding(status)) continue;
    const key = handCapability(row);
    if (!key) continue;
    const hand: RaisedHand = { id: String(row.id ?? ""), status, submittedAt: String(row.submittedAt ?? "") };
    const seen = out.get(key);
    if (!seen || hand.submittedAt > seen.submittedAt) out.set(key, hand);
  }
  return out;
}

/**
 * Why this member cannot raise a hand for this power now, or null when they can.
 *
 * `row` is the power as the member's own catalogue shows it, rebuilt on the
 * server for the request, because the button on a profile loaded an hour ago is
 * never the authority. The refusals come in the order a member would want to
 * hear them.
 */
export function raiseHandRefusal(
  row: { held: boolean; recommended?: boolean } | undefined,
  hand: RaisedHand | undefined,
): HandRefusal | null {
  if (!row) return { status: 404, error: "power_not_found", message: "This village has no power by that name." };
  if (row.held) return { status: 409, error: "already_held", message: "You already hold this power." };
  if (hand) return { status: 409, error: "hand_already_up", message: "Your hand is already up for this power." };
  if (!row.recommended) {
    return {
      status: 409,
      error: "not_recommended",
      message:
        "This power is not one the village puts to you yet. It goes to members who play a character it suits, once they have climbed far enough.",
    };
  }
  return null;
}

/**
 * A power's label as the thing somebody offers to do. Labels read as
 * instructions ("Keep the shared library and its loans"), so the first letter
 * comes down to follow "to".
 */
export function asOffer(label: string): string {
  const said = label.trim();
  return said ? said.charAt(0).toLowerCase() + said.slice(1) : said;
}

/** "The Architect", "The Architect and The Storyteller", "A, B and C". */
function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The data keys the inbox says in a sentence, which its generic table leaves out. */
export const POWER_HAND_KEYS: readonly string[] = ["capability", "powerLabel", "suits"];

/** What a hand for a power asks for, as the inbox says it to a founder. */
export function powerHandSentence(data: Record<string, unknown>): string {
  const label = typeof data.powerLabel === "string" ? data.powerLabel.trim() : "";
  const key = typeof data.capability === "string" ? data.capability.trim() : "";
  const asks = label ? `Asks to ${asOffer(label)}.` : key ? `Asks for the power ${key}.` : "Asks for a power.";
  const suits = Array.isArray(data.suits)
    ? data.suits.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
  if (!suits.length) return asks;
  const played = suits.length === 1 ? "which they play" : suits.length === 2 ? "both of which they play" : "all of which they play";
  return `${asks} It suits ${namesOf(suits)}, ${played}.`;
}
