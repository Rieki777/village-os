/**
 * What the assistant may propose, and in exactly what shape (S75).
 *
 * She writes DRAFTS. A human opens a queue, edits, and accepts, and the accept
 * calls the same creation function the admin form calls, so every invariant and
 * every gate is inherited instead of reimplemented. There is no second write
 * path and she never touches a domain table.
 *
 * The kind is allowlisted server-side. The wire carries no open vocabulary
 * here, the same rule `SHARED_ITEM_TYPES` already follows: a free-string kind
 * is a renderer someone has to write defensively forever.
 *
 * Payloads are validated at draft time AND again at accept. A model's output is
 * untrusted input, and the gap between proposing and accepting is exactly long
 * enough for the platform's own rules to have changed underneath it.
 */
import { ALL_CAPABILITIES, type Capability } from "./capabilities";

export const DRAFT_KINDS = ["role", "circle"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * What a MEMBER confirms for themselves (round 4, lane L6), as opposed to what
 * an admin accepts for the village. Kept out of DRAFT_KINDS on purpose: that
 * list is what `checkDraft` admits into `assistant_drafts` and what the admin
 * accept route creates from, and an `event_rsvp` in that queue would be
 * treated as a circle. A member draft lives in `member_drafts` and is
 * confirmed by the member it belongs to, through its own route.
 */
export const MEMBER_DRAFT_KINDS = ["event_rsvp"] as const;
export type MemberDraftKind = (typeof MEMBER_DRAFT_KINDS)[number];

/** Every kind `validateDraftPayload` knows, admin and member together. */
export const ALL_DRAFT_KINDS: readonly string[] = [...DRAFT_KINDS, ...MEMBER_DRAFT_KINDS];

export interface RolePayload {
  name: string;
  description: string;
  capabilities: Capability[];
  minStage?: string | null;
  sortOrder?: number;
}

/**
 * The circle lifecycle, in one place.
 *
 * `circles.status` is a MySQL enum and the store writes circles with
 * `replaceAll`, which is a DELETE-all plus a re-INSERT of every row inside one
 * transaction. A value outside the enum therefore rolls back the WHOLE table,
 * so the admin dropdown, the draft validator and the edit route all read this
 * array instead of each carrying their own copy of the triple.
 */
export const CIRCLE_STATUSES = ["active", "forming", "dormant"] as const;
export type CircleStatus = (typeof CIRCLE_STATUSES)[number];

export interface CirclePayload {
  name: string;
  purpose: string;
  parentCircleId?: string | null;
  status?: CircleStatus;
}

/** An RSVP the assistant proposed and the member has not yet confirmed. */
export interface EventRsvpPayload {
  eventId: string;
  status: "going" | "maybe" | "declined";
  /** For a recurring gathering, which occurrence. Absent until the calendar carries them. */
  occurrenceKey?: string | null;
}

export type DraftPayload = RolePayload | CirclePayload | EventRsvpPayload;

const ALLOWED_KEYS: Record<DraftKind | MemberDraftKind, string[]> = {
  role: ["name", "description", "capabilities", "minStage", "sortOrder"],
  circle: ["name", "purpose", "parentCircleId", "status"],
  event_rsvp: ["eventId", "status", "occurrenceKey"],
};

function shapeErrors(kind: DraftKind | MemberDraftKind, payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "payload must be an object";
  // Unknown keys are refused, so a model that invents a field gets told, and a
  // future column cannot be written by a payload that predates the review UI.
  const extra = Object.keys(payload as object).filter((k) => !ALLOWED_KEYS[kind].includes(k));
  if (extra.length > 0) return `unexpected field(s): ${extra.join(", ")}`;
  return null;
}

function text(value: unknown, field: string, min: number, max: number): string | null {
  if (typeof value !== "string" || value.trim().length < min) return `${field} must be at least ${min} characters`;
  if (value.length > max) return `${field} must be under ${max} characters`;
  return null;
}

/** Validate a payload for its kind. Returns a human sentence, or null. */
export function validateDraftPayload(kind: string, payload: unknown): string | null {
  if (!ALL_DRAFT_KINDS.includes(kind)) return `unknown draft kind: ${String(kind)}`;
  const k = kind as DraftKind | MemberDraftKind;
  const shape = shapeErrors(k, payload);
  if (shape) return shape;
  const p = payload as Record<string, unknown>;

  if (k === "event_rsvp") {
    if (typeof p.eventId !== "string" || !p.eventId.trim() || p.eventId.length > 64) return "eventId must be a gathering id";
    if (!["going", "maybe", "declined"].includes(String(p.status))) return "status must be going, maybe, or declined";
    if (p.occurrenceKey !== undefined && p.occurrenceKey !== null && (typeof p.occurrenceKey !== "string" || p.occurrenceKey.length > 64)) {
      return "occurrenceKey must be a string or null";
    }
    return null;
  }

  if (k === "role") {
    const nameErr = text(p.name, "name", 2, 120);
    if (nameErr) return nameErr;
    const descErr = text(p.description, "description", 20, 2000);
    if (descErr) return descErr;
    if (!Array.isArray(p.capabilities)) return "capabilities must be a list, and may be empty";
    const unknown = (p.capabilities as unknown[]).filter((c) => !ALL_CAPABILITIES.includes(c as Capability));
    if (unknown.length > 0) return `unknown capabilit(y/ies): ${unknown.map(String).join(", ")}`;
    if (new Set(p.capabilities as string[]).size !== (p.capabilities as string[]).length) {
      return "capabilities must not repeat";
    }
    if (p.minStage !== undefined && p.minStage !== null && typeof p.minStage !== "string") {
      return "minStage must be a stage id or null";
    }
    if (p.sortOrder !== undefined && !Number.isInteger(p.sortOrder)) return "sortOrder must be a whole number";
    return null;
  }

  const nameErr = text(p.name, "name", 2, 120);
  if (nameErr) return nameErr;
  const purposeErr = text(p.purpose, "purpose", 20, 2000);
  if (purposeErr) return purposeErr;
  if (p.parentCircleId !== undefined && p.parentCircleId !== null && typeof p.parentCircleId !== "string") {
    return "parentCircleId must be a circle id or null";
  }
  if (p.status !== undefined && !["active", "forming", "dormant"].includes(String(p.status))) {
    return "status must be active, forming, or dormant";
  }
  return null;
}

/**
 * Plain sentences for what a capability lets a role do.
 *
 * These are read one at a time by an admin deciding whether to grant, so they
 * say the consequence and never the key. "exchange.manage" tells a founder
 * nothing; "post token prices and stock the treasury" tells them everything.
 */
export const CAPABILITY_CONSEQUENCE: Record<Capability, string> = {
  "quest.consent": "release recognition on someone else's finished work",
  "forum.post": "start threads in the forum",
  "forum.moderate": "hide posts and act on reports for the whole community",
  "proposal.open": "open a governance decision",
  "proposal.decide": "record the outcome of a governance decision and close it",
  "map.viewPeople": "see which named people hold which seats",
  "map.contact": "reach role holders through the contact relay",
  "map.edit": "reshape the land in build mode, as a draft nobody else sees yet",
  "map.publish": "put a drafted map in front of every visitor",
  "map.photograph": "add photographs of a place to the village's own record of it",
  "map.curatePhotos": "take any member's photograph off the map and pin the shot a place leads with",
  "feed.announce": "post announcements to the whole village feed",
  "stay.member_rate": "book accommodation at the member price",
  "exchange.buy": "buy listed tokens with money",
  "exchange.swap": "trade one village token for another",
  "exchange.manage": "list tokens, post prices, and stock the treasury",
  "health.record": "log the land's own measurements",
  "message.send": "start conversations with other members and write in them",
  "mechanics.propose": "propose changes to the game's own rules",
  "event.rsvp": "say they are coming to a gathering",
  "event.manage": "put gatherings on the village calendar, edit them, and cancel them",
  "org.declare": "declare the village's shape and how any circle decides",
  "ballot.vote": "vote on the village's own ballots",
  "member.vouch": "vouch for applicants at the membrane",
  "org.seat": "seat people in the village's seats, and take them out again",
  "org.seatAgent": "seat software agents in the village's seats, and take them out again",
  "intake.moderate": "work the queues the village puts things into, and act on what gets reported",
  "library.keep": "keep the shared library: what comes in, what goes out on loan, what comes back",
  "story.tell": "say what this village is, in public, in its own words",
  "dial.set": "turn the village's own dials, within the ring the village governs",
  "quest.approve": "put a proposed quest on the board, and set what finishing it pays",
  "redemption.confirm":
    "agree that a member has been paid off the platform, and destroy the tokens they redeemed",
};
