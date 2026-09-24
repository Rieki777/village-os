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
  userName?: unknown;
  submittedAt?: unknown;
  data?: unknown;
}

/** Why a hand cannot go up, or cannot be put to the village, in a member's words. */
export interface HandRefusal {
  status: 403 | 404 | 409;
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

/* ────────────────────────────────────────────────────────────────────────────
 *
 * RULING 1 (Rye, 2026-09-23): WHO MAY PUT A RAISED HAND TO THE VILLAGE.
 *
 * A hand asks and never grants, so something has to carry it from the inbox to
 * a vote. Until this, nothing did: the only answer a hand could get was an
 * admin moving its row (`PUT /api/admin/submissions/:id/status`), and the
 * appointment was a separate act somewhere else. Asked who may take a standing
 * hand and open a vote from it, Rye answered:
 *
 *   "It's both 1 and 2 depending on who owns the power (if roles hold the
 *    power it's option 1 if the village holds the power it's option 2)"
 *
 * Option 1 was "Only holders": ordinary members read the inbox and nothing
 * more. Option 2 was "Members can propose": any member can select hands and put
 * them to the village once the village holds the approving power, because the
 * vote decides and proposing costs nothing.
 *
 * ── THE TWO INPUTS, AND WHY THEY ARE INPUTS ────────────────────────────────
 *
 * This function is handed the two answers rather than working them out, and
 * both of them already have exactly one home:
 *
 *   villageHolds   `isVillageHeld(cap, ctx.villageHeld)` in shared/capabilities.ts
 *   liveHolders    `liveHoldersOfCapability(...)` in server/lib/roleGrants.ts,
 *                  which already honours lapsed terms, carried keys and the
 *                  deny a warning badge lands
 *
 * A second walk of the tables here would be a twin of both, and the docblock on
 * `carriedBy` says what twins do: the gate lets a `member.superVouch` holder
 * vouch while the counter reports that nobody can. Two answers, one question.
 *
 * ── THE TWO CASES THE RULING DOES NOT NAME ─────────────────────────────────
 *
 * The ruling's two conditions are neither exhaustive nor mutually exclusive, so
 * both gaps are read here on purpose rather than fallen into.
 *
 * BOTH TRUE, the village holds it AND a role carries it. This reads it as
 * option 2, any member, because village-held is already the stronger statement
 * everywhere else in the gate: on a village-held key the admin short-circuit
 * does not apply (`capabilityDecision`, shared/capabilities.ts), which is the
 * one place in the whole order of authority where holding beats being admin.
 * Reading it the other way would mean a village that took a power on ended up
 * with a NARROWER door than a village that never did. THIS IS A READING OF THE
 * RULING AND NOT A THING RYE SAID.
 *
 * NEITHER TRUE, no live holder and the village does not hold it. This reads it
 * as option 2 as well, and that one is NOT this ruling at all: it comes from
 * Rye's `org.decide` ruling of 2026-09-14, "holder publishes live or sends to
 * ballot, no holder means a ballot". A power nobody holds has nobody to ask, so
 * the alternative is a hand that can never be answered. Stated separately
 * because it stands on a separate ruling, and if that one is ever revisited
 * this branch goes with it rather than with the one above.
 *
 * ── WHAT THIS IS ON A VILLAGE THAT HOLDS NOTHING ───────────────────────────
 *
 * Measured, and it matters: `capability_holding` is created empty by migration
 * 0098 and no seed or migration ever writes a row into it, so every village
 * begins holding nothing, and live Amora still held 0 of 20 on 2026-09-19. On a
 * village in that state the first branch below never fires. What the feature
 * does there is the other two branches: holder-only on a power some role still
 * carries, open to any member on a power nobody holds.
 */

/** Which of the three states a power is in, in this rule's own vocabulary. */
export type HandOpenerReason =
  /** The village holds it (`capability_holding`). Option 2, in Rye's words. */
  | "village-holds-it"
  /** A role holds it and somebody is live in the chair. Option 1. */
  | "a-role-holds-it"
  /** Nobody holds it live and the village does not hold it. The org.decide reading. */
  | "nobody-holds-it";

/** Who may put a hand for one power to the village, and which reading said so. */
export interface HandOpenerRule {
  who: "any-member" | "live-holders";
  because: HandOpenerReason;
  /** Who holds it live. Empty when nobody does, and never the deciding fact on its own. */
  holders: readonly string[];
}

/**
 * Ruling 1 as one expression. Pure, so both readings above are provable
 * without a database.
 */
export function whoMayPutHandToVillage(
  villageHolds: boolean,
  liveHolders: readonly string[],
): HandOpenerRule {
  const holders = liveHolders.filter((h) => h !== "");
  if (villageHolds) return { who: "any-member", because: "village-holds-it", holders };
  if (holders.length > 0) return { who: "live-holders", because: "a-role-holds-it", holders };
  return { who: "any-member", because: "nobody-holds-it", holders: [] };
}

/**
 * Why this member cannot put this hand to the village, or null when they can.
 *
 * The refusal names the door rather than saying no: a member who is not one of
 * the holders is told who to ask, which is the same courtesy
 * `STEWARD_SEAT_REFUSAL` pays an administrator.
 */
export function putToVillageRefusal(
  rule: HandOpenerRule,
  userId: string,
  /** What the power is called, for the sentence. Falls back to a plain noun. */
  powerLabel = "",
): HandRefusal | null {
  if (rule.who === "any-member") return null;
  if (userId && rule.holders.includes(userId)) return null;
  const power = powerLabel.trim() ? `"${powerLabel.trim()}"` : "this power";
  return {
    status: 403,
    error: "not_a_holder",
    message:
      `${power} belongs to a role, so putting a hand for it to the village is for whoever holds it. ` +
      "Ask one of them, or ask the village to take the power on, and then anybody can.",
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 *
 * RULING 2 (Rye, 2026-09-23): THE NOTE ON A RAISED HAND IS PUBLIC.
 *
 * He was offered "Ask public, note private" and chose "Everything public",
 * members see the notes too. Asked again specifically about notes ALREADY
 * written, against a recommended "only new notes public" whose own description
 * warned that the alternative "publishes writing done under a different
 * expectation", he chose "All notes public". That is deliberate and it is his
 * call, so there is no written-before cutoff here and no consent step.
 *
 * What the build owes in return is that nobody writes a note without being
 * told first, which is `NOTE_IS_PUBLIC` below, said on the writing screen
 * before the box rather than after the send.
 *
 * ── THE PROJECTION IS A LIST OF NAMES, NEVER A SPREAD ──────────────────────
 *
 * `submissions` is one table carrying every kind of thing a village collects:
 * membership requests, visit inquiries, investor enquiries, work-with-us. A
 * read widened by status or by nothing at all would publish those, which is a
 * real privacy break and not a bug you notice. So this builds the public row
 * FIELD BY FIELD from a row it has already checked is a `power-application`,
 * and `email`, which the raise-hand route stores beside the note, is one of the
 * fields it does not name.
 */

/** A raised hand as anybody in the village may read it. No email, ever. */
export interface PublicHand {
  id: string;
  capability: string;
  powerLabel: string;
  userId: string;
  userName: string;
  status: StandingHandStatus;
  submittedAt: string;
  /** What they wrote. Public by Rye's ruling of 2026-09-23, existing notes included. */
  note: string;
}

/**
 * The hands that are up across the whole village, oldest first, as members
 * read them.
 *
 * `present` decides whose hands are listed. A member who has asked to be
 * forgotten keeps their inbox row (the erasure step anonymises it rather than
 * removing it) and NOT their place in a list members read, so the caller hands
 * in the test for whether somebody is still here. Absent means everybody.
 */
export function publicHands(
  rows: readonly InboxRow[],
  present?: (userId: string) => boolean,
): PublicHand[] {
  const out: PublicHand[] = [];
  for (const row of rows) {
    if (row.type !== POWER_APPLICATION) continue;
    const status = row.status;
    if (!isStanding(status)) continue;
    const capability = handCapability(row);
    if (!capability) continue;
    const userId = String(row.userId ?? "");
    if (!userId) continue;
    if (present && !present(userId)) continue;
    const data = row.data !== null && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
    out.push({
      id: String(row.id ?? ""),
      capability,
      powerLabel: typeof data.powerLabel === "string" ? data.powerLabel : "",
      userId,
      userName: typeof row.userName === "string" ? row.userName : "",
      status,
      submittedAt: String(row.submittedAt ?? ""),
      note: typeof data.note === "string" ? data.note : "",
    });
  }
  return out.sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
}

/** Said on the writing screen, above the box, before anybody types into it. */
export const NOTE_IS_PUBLIC = "Everyone in the village can read what you write here.";

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
