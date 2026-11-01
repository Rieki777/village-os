/**
 * WHAT A COMPANION MAY BRING A MEMBER, AND WHICH DOOR EACH YES OPENS (0295).
 *
 * Every member has companions: one personal, one for each role they hold that
 * has one, one for each quest or project that has one. A companion brings a
 * member QUESTIONS (at most three a day) and DRAFTS (every one it made). The
 * member answers a question, and says yes or no to a draft. Nothing acts
 * without that yes, and the yes always runs a door the village already has, so
 * every permission check that door carries still runs against the member who
 * said it (the contract with the outside service, section 5).
 *
 * This file is the vocabulary and the arithmetic. No database, no clock of its
 * own, no imports from the server. The policy lives in server/lib/companions.ts.
 *
 * ── A KIND WITH NO DOOR IS REFUSED, WITH A SENTENCE ──────────────────────
 *
 * `cash_payment`, `purchase` and `ask` name doors this village does not have
 * yet. A companion that drafts one is told why, the draft is never stored, and
 * a stored one is refused again at the yes. No money path is invented here:
 * a kind earns a door when the door exists, and not before.
 *
 * ── PAYLOADS ARE CHECKED TWICE ───────────────────────────────────────────
 *
 * At landing and again at the yes, the `shared/draftKinds.ts` rule. A model's
 * output is untrusted input, and the days between a draft and its yes are
 * exactly long enough for the village's own rules to have moved.
 */

export const COMPANION_SCOPES = ["personal", "role", "quest", "project"] as const;
export type CompanionScope = (typeof COMPANION_SCOPES)[number];

/** Who answers a companion: the village guide's engine, or the outside service. */
export const COMPANION_PROVIDERS = ["village", "saberra"] as const;
export type CompanionProvider = (typeof COMPANION_PROVIDERS)[number];

export const COMPANION_STATUSES = ["active", "resting", "retired"] as const;
export type CompanionStatus = (typeof COMPANION_STATUSES)[number];

export const ITEM_TYPES = ["question", "draft"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_STATUSES = ["held", "open", "answered", "confirmed", "declined", "expired", "withdrawn"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Where an item came from. `chat` is one the member asked for in a chat. */
export const ITEM_ORIGINS = ["sera", "maia", "chat"] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

export const DRAFT_KINDS = [
  "token_payment",
  "cash_payment",
  "budget_spend",
  "purchase",
  "email",
  "message",
  "rsvp",
  "quest",
  "gratitude_note",
  "ask",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * The ceiling on questions a day, per companion. A member may lower theirs and
 * a village may lower its own; neither raises it above this without Rye.
 */
export const MAX_QUESTIONS_PER_DAY = 3;

/** An unanswered question expires this many village days after it was shown. */
export const QUESTION_EXPIRY_DAYS = 7;

/** How long a member's name for a companion may be (the column's width). */
export const MAX_COMPANION_NAME = 60;

export const MAX_TITLE = 200;
export const MAX_BODY = 1000;
export const MAX_ANSWER = 1000;
export const MAX_QUOTE = 300;
export const MAX_CHAT_MESSAGE = 1000;

// ── The doors ────────────────────────────────────────────────────────────

/**
 * What a yes does, per kind.
 *
 *   door   a route the village already has runs, as the member
 *   mail   nothing is sent by the village; the member's own mail opens
 *   none   there is no door, and the kind is refused with `refusal`
 */
export interface DraftDoor {
  way: "door" | "mail" | "none";
  /** The "On yes:" line the card shows, in plain words. */
  onYes: string;
  /** The gold button's words. */
  yesLabel: string;
  /** For `none`: why it is refused. Shown to the member and to the companion. */
  refusal?: string;
  /** Which fields of the payload the member may change before saying yes. */
  editable: readonly string[];
}

export const DRAFT_DOORS: Record<DraftKind, DraftDoor> = {
  rsvp: {
    way: "door",
    onYes: "your answer to the gathering, the same as the calendar button.",
    yesLabel: "Yes, send my answer",
    editable: ["status"],
  },
  token_payment: {
    way: "door",
    onYes: "a send from your own wallet, the same as the send form. Your balance has to cover it.",
    yesLabel: "Yes, send it",
    editable: ["amountMinor", "note"],
  },
  budget_spend: {
    way: "door",
    onYes: "a circle budget spend, the same as the treasury page. It needs the circle's speaking role, and it never pays the person asking.",
    yesLabel: "Yes, record the spend",
    editable: ["amountMinor", "note"],
  },
  gratitude_note: {
    way: "door",
    onYes: "it counts only when you press Send, and it comes out of what you have left this cycle.",
    yesLabel: "Send it",
    editable: ["amount", "message"],
  },
  message: {
    way: "door",
    onYes: "a message in the village, sent as you.",
    yesLabel: "Yes, send the message",
    editable: ["body"],
  },
  quest: {
    way: "door",
    onYes: "it goes to the review inbox as a quest idea. One approval puts it live, and the approver sets the pay.",
    yesLabel: "Yes, propose it",
    editable: ["title", "description", "firstStep"],
  },
  email: {
    way: "mail",
    onYes: "the village sends no email for you. Yes opens it in your own mail, ready to send.",
    yesLabel: "Open in my mail",
    editable: ["subject", "text"],
  },
  cash_payment: {
    way: "none",
    onYes: "",
    yesLabel: "",
    refusal: "Marking a cash line paid has no door in this village yet, so a companion cannot draft it.",
    editable: [],
  },
  purchase: {
    way: "none",
    onYes: "",
    yesLabel: "",
    refusal: "This village has no way to buy something from here yet, so a companion cannot draft a purchase.",
    editable: [],
  },
  ask: {
    way: "none",
    onYes: "",
    yesLabel: "",
    refusal: "Asks between members are not built yet, so a companion cannot draft one.",
    editable: [],
  },
};

/** The plain name of a kind, for the card's small caps line. */
export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  rsvp: "Draft RSVP",
  token_payment: "Draft payment",
  budget_spend: "Draft budget spend",
  gratitude_note: "Draft thank-you",
  message: "Draft message",
  quest: "Draft quest",
  email: "Draft email",
  cash_payment: "Draft cash payment",
  purchase: "Draft purchase",
  ask: "Draft ask",
};

/** What a yes made, counted: one and many. "Done this week with your yes: 2 RSVPs, 1 thank-you sent." */
export const DONE_WORDS: Record<DraftKind, readonly [string, string]> = {
  rsvp: ["RSVP", "RSVPs"],
  token_payment: ["payment sent", "payments sent"],
  budget_spend: ["budget spend", "budget spends"],
  gratitude_note: ["thank-you sent", "thank-yous sent"],
  message: ["message sent", "messages sent"],
  quest: ["quest proposed", "quests proposed"],
  email: ["email opened", "emails opened"],
  cash_payment: ["cash line marked paid", "cash lines marked paid"],
  purchase: ["purchase", "purchases"],
  ask: ["ask", "asks"],
};

export function isDraftKind(v: unknown): v is DraftKind {
  return typeof v === "string" && (DRAFT_KINDS as readonly string[]).includes(v);
}

/** The sentence a kind with no door is refused with, or null when it has one. */
export function refusalFor(kind: DraftKind): string | null {
  return DRAFT_DOORS[kind].way === "none" ? (DRAFT_DOORS[kind].refusal ?? "That kind has no door.") : null;
}

// ── Payloads ─────────────────────────────────────────────────────────────

const RECIPIENT_KEYS = ["toUserId", "toRoleId"];

const ALLOWED_KEYS: Record<Exclude<DraftKind, "cash_payment" | "purchase" | "ask">, readonly string[]> = {
  rsvp: ["eventId", "status", "occurrenceKey", "memberDraftId"],
  token_payment: ["tokenType", "amountMinor", "note", ...RECIPIENT_KEYS],
  budget_spend: ["budgetId", "amountMinor", "note", ...RECIPIENT_KEYS],
  gratitude_note: ["amount", "message", ...RECIPIENT_KEYS],
  message: ["conversationId", "body", ...RECIPIENT_KEYS],
  quest: ["title", "description", "firstStep"],
  email: ["subject", "text"],
};

/** The payload fields that hold words. Ids are left out: a record id is often seven digits in a row. */
const PROSE_FIELDS = ["note", "message", "body", "title", "description", "firstStep", "subject", "text"] as const;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** Seven or more digits, allowing the spaces, dots, dashes and brackets a phone number is written with. */
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/;

/** True when any string anywhere in the value carries an email address or a phone number. */
export function carriesContact(v: unknown): boolean {
  if (typeof v === "string") return EMAIL_RE.test(v) || PHONE_RE.test(v.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""));
  if (Array.isArray(v)) return v.some(carriesContact);
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).some(carriesContact);
  return false;
}

function text(v: unknown, field: string, min: number, max: number): string | null {
  if (typeof v !== "string" || v.trim().length < min) return min > 0 ? `${field} needs at least ${min} characters` : `${field} must be words`;
  if (v.length > max) return `${field} holds up to ${max} characters`;
  return null;
}

function optionalText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  return text(v, field, 0, max);
}

function wholePositive(v: unknown, field: string): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${field} must be a number`;
  if (!Number.isInteger(v)) return `${field} must be a whole number`;
  if (v <= 0) return `${field} must be more than zero`;
  if (v > 1_000_000_000) return `${field} is larger than anything this village moves`;
  return null;
}

function id(v: unknown, field: string): string | null {
  if (typeof v !== "string" || !v.trim() || v.length > 128) return `${field} must name one record`;
  return null;
}

function oneRecipient(p: Record<string, unknown>): string | null {
  const named = RECIPIENT_KEYS.filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== "");
  if (named.length !== 1) return "a draft names one recipient, a role or a member";
  return id(p[named[0]], named[0]);
}

/**
 * Validate a draft's payload for its kind. Returns one sentence, or null.
 *
 * Refuses: a kind with no door (its refusal sentence), an unknown field, a
 * fraction anywhere an amount goes, and an email address or a phone number in
 * any field. No draft here carries an outside address: Rye has not ruled on
 * where one may live (the contract, section 7, question 4).
 */
export function validateCompanionPayload(kind: unknown, payload: unknown): string | null {
  if (!isDraftKind(kind)) return `This village does not know the draft kind ${JSON.stringify(String(kind ?? "")).slice(0, 40)}.`;
  const refused = refusalFor(kind);
  if (refused) return refused;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "A draft's payload must be an object.";
  const k = kind as keyof typeof ALLOWED_KEYS;
  const extra = Object.keys(payload as object).filter((f) => !ALLOWED_KEYS[k].includes(f));
  if (extra.length > 0) return `A ${kind} draft has no field called ${extra.join(", ")}.`;
  const p = payload as Record<string, unknown>;
  if (carriesContact(PROSE_FIELDS.map((f) => p[f]))) return "A draft may not carry an email address or a phone number.";

  switch (k) {
    case "rsvp":
      return (
        id(p.eventId, "eventId") ??
        (["going", "maybe", "declined"].includes(String(p.status)) ? null : "status must be going, maybe or declined") ??
        (p.occurrenceKey === undefined || p.occurrenceKey === null || (typeof p.occurrenceKey === "string" && p.occurrenceKey.length <= 64)
          ? null
          : "occurrenceKey must be a string or null") ??
        (p.memberDraftId === undefined || typeof p.memberDraftId === "string" ? null : "memberDraftId must be a string")
      );
    case "token_payment":
      return id(p.tokenType, "tokenType") ?? wholePositive(p.amountMinor, "amountMinor") ?? optionalText(p.note, "note", 180) ?? oneRecipient(p);
    case "budget_spend":
      return id(p.budgetId, "budgetId") ?? wholePositive(p.amountMinor, "amountMinor") ?? optionalText(p.note, "note", 180) ?? oneRecipient(p);
    case "gratitude_note":
      return wholePositive(p.amount, "amount") ?? text(p.message, "message", 1, 280) ?? oneRecipient(p);
    case "message": {
      const body = text(p.body, "body", 1, 2000);
      if (body) return body;
      if (p.conversationId !== undefined && p.conversationId !== null && p.conversationId !== "") {
        if (RECIPIENT_KEYS.some((r) => p[r] !== undefined && p[r] !== null && p[r] !== "")) return "a message goes to one conversation or one recipient";
        return id(p.conversationId, "conversationId");
      }
      return oneRecipient(p);
    }
    case "quest":
      return text(p.title, "title", 3, 120) ?? optionalText(p.description, "description", 2000) ?? optionalText(p.firstStep, "firstStep", 400);
    case "email":
      return text(p.subject, "subject", 1, 200) ?? text(p.text, "text", 1, 4000);
  }
  return "That kind has no validator.";
}

/**
 * A payload with the member's edits applied, and which fields they changed.
 * Only the kind's `editable` fields may change; anything else is refused.
 */
export function applyEdits(
  kind: DraftKind,
  payload: Record<string, unknown>,
  edits: unknown,
): { ok: true; payload: Record<string, unknown>; edited: string[] } | { ok: false; error: string } {
  if (edits === undefined || edits === null) return { ok: true, payload, edited: [] };
  if (typeof edits !== "object" || Array.isArray(edits)) return { ok: false, error: "Edits must be an object of fields." };
  const allowed = DRAFT_DOORS[kind].editable;
  const out = { ...payload };
  const edited: string[] = [];
  for (const [field, value] of Object.entries(edits as Record<string, unknown>)) {
    if (!allowed.includes(field)) return { ok: false, error: `You can change ${allowed.join(", ") || "nothing"} on this draft.` };
    if (JSON.stringify(out[field]) === JSON.stringify(value)) continue;
    out[field] = value;
    edited.push(field);
  }
  return { ok: true, payload: out, edited };
}

// ── The day, the cap and the expiry ──────────────────────────────────────

/** The village-local calendar day of an instant, as YYYY-MM-DD. An unknown zone reads as UTC. */
export function villageDayKey(at: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  }
  const n = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${n("year")}-${n("month")}-${n("day")}`;
}

/** Whole days from one day key to another (positive when `to` is later). */
export function daysBetweenKeys(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The day key `days` after `from`. */
export function addDays(from: string, days: number): string {
  const t = Date.parse(`${from}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How many questions a companion shows today: the lowest of the member's own
 * cap, the village's ceiling and the platform ceiling. Never below zero, and
 * anything unreadable counts as zero, because a cap fails closed.
 */
export function effectiveCap(memberCap: unknown, villageCeiling: unknown): number {
  const m = Number(memberCap);
  const v = Number(villageCeiling);
  if (!Number.isFinite(m) || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(Math.trunc(m), Math.trunc(v), MAX_QUESTIONS_PER_DAY));
}

/** True when a question shown on `shownOn` has gone unanswered too long by `today`. */
export function questionExpired(shownOn: string, today: string): boolean {
  return daysBetweenKeys(shownOn, today) >= QUESTION_EXPIRY_DAYS;
}

// ── The look ─────────────────────────────────────────────────────────────

/** The pets a member may choose from. Each is drawn by client/src/components/profileDash/CompanionPet.tsx. */
export const PET_KINDS = ["sprout", "horns", "ears", "star"] as const;
export type PetKind = (typeof PET_KINDS)[number];

/** Body colours, each a dashboard token so a village re-tints them with the rest of the sheet. */
export const PET_TINTS = ["gold", "leaf", "rose", "lilac"] as const;
export type PetTint = (typeof PET_TINTS)[number];

export const LOOK_SOURCES = ["choose", "forge", "upload"] as const;
export type LookSource = (typeof LOOK_SOURCES)[number];

/**
 * A companion's look. `choose` is a pet from the set above. `forge` and
 * `upload` point at one of the member's own portraits by its path key, made
 * in the portrait studio (forge spends a grant, upload costs nothing), so
 * there is no second image store.
 */
export interface CompanionLook {
  source: LookSource;
  pet?: PetKind;
  tint?: PetTint;
  portraitKey?: string;
}

/** The default look for a companion, varied by where it sits in the army. */
export function defaultLook(index: number): CompanionLook {
  const i = Math.abs(Math.trunc(index));
  return { source: "choose", pet: PET_KINDS[i % PET_KINDS.length], tint: PET_TINTS[i % PET_TINTS.length] };
}

/** Read a stored or sent look. Anything unreadable becomes null. */
export function parseLook(v: unknown): CompanionLook | null {
  let o = v;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (!(LOOK_SOURCES as readonly string[]).includes(String(r.source))) return null;
  const source = r.source as LookSource;
  if (source === "choose") {
    if (!(PET_KINDS as readonly string[]).includes(String(r.pet))) return null;
    if (!(PET_TINTS as readonly string[]).includes(String(r.tint))) return null;
    return { source, pet: r.pet as PetKind, tint: r.tint as PetTint };
  }
  if (typeof r.portraitKey !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(r.portraitKey)) return null;
  return { source, portraitKey: r.portraitKey };
}

// ── What the client reads ────────────────────────────────────────────────

export interface CompanionItemView {
  id: string;
  type: ItemType;
  kind: DraftKind | null;
  status: ItemStatus;
  title: string;
  body: string | null;
  /** For a draft: what it moves, in plain words, with people named "Role (FirstName)". */
  detail: string | null;
  /** The "On yes:" line. */
  onYes: string | null;
  yesLabel: string | null;
  editable: readonly string[];
  payload: Record<string, unknown> | null;
  /** "Source: ..." in plain words, quote included. */
  source: string;
  blocking: boolean;
  dueOn: string | null;
  dayKey: string;
  answer: string | null;
  outcomeRef: string | null;
  /** For an email draft, the member's own mail opened with the words in it. */
  mailto?: string | null;
}

export interface CompanionView {
  id: string;
  scope: CompanionScope;
  scopeId: string;
  provider: CompanionProvider;
  /** The engine named above the chat: the village guide's name, or the outside service's. */
  engine: string;
  /** False for an outside engine whose side is not connected yet. */
  engineConnected: boolean;
  /** Who answers the chat right now, which is the village guide while the outside side is not connected. */
  chatEngine: string;
  name: string;
  /** "Personal companion", "Treasurer companion", "Pizza oven quest". */
  scopeLine: string;
  look: CompanionLook;
  /** For a forged or uploaded look, the portrait's address. Null for a chosen pet. */
  lookUrl: string | null;
  dailyCap: number;
  status: CompanionStatus;
  sortOrder: number;
  questions: CompanionItemView[];
  drafts: CompanionItemView[];
  /** Questions held for a later day, by the cap. */
  heldCount: number;
  /** What the member's yes made this week, counted by kind. */
  doneThisWeek: { kind: DraftKind; count: number }[];
}

export interface CompanionDisclosureView {
  provider: string;
  operator: string;
  source: string;
  sentence: string;
}

export interface CompanionsPayload {
  companions: CompanionView[];
  ceiling: number;
  today: string;
  /** The line a member reads before their words first go to a model, and whether they said yes to it. Null: no key, the record answers. */
  consent: { disclosure: CompanionDisclosureView; given: boolean } | null;
}
