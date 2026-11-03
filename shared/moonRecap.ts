/**
 * THE END-OF-MOON REVIEW: the contract (module `moon-review`, lane A).
 *
 * Once a moon a member who holds a role sends a RECAP of what they delivered,
 * read against their role cards and the season goals, and, when the adopted
 * terms of one of their roles carry money, a DRAFT INVOICE for approval. This
 * file is the part with no database and no request in it: the shapes, the
 * limits, the statuses and their words, coverage, invoice lines from terms
 * with proration, the route and payer checks, `endOfMoonFriday`, the approval
 * hash, the work summary, and every sentence a member reads. The store
 * (server/repos/moonRecaps.ts), the library (server/lib/moonRecap.ts) and the
 * routes (server/routes/moonRecaps.ts) read these, so a rule has one spelling.
 *
 * ── WHAT THIS FLOW NEVER CARRIES ──────────────────────────────────────────
 *
 * Hours. Pay is for approved deliverables, so no type here holds a duration,
 * and `member_tasks.minutes` and a role's CCOS `timeCommitment` are never
 * read. Quests are separate from role pay: no origin below is a quest.
 *
 * ── WHO APPROVES (decisions 8, 18 and 19, 3 November) ─────────────────────
 *
 * The default is two people, neither of them the member: a holder of
 * `moon.approve` approves the work, then a holder of `cash.pay` approves the
 * invoice. Two held-back keys widen it, and `approvalDecision` is the one
 * rule that reads all four:
 *
 *   - `moon.approve_alone` (the founders' and stewards' power groups): its
 *     holder may give BOTH approvals by themselves. Never on their own recap.
 *   - `moon.approve_own` (the Treasury power group, an interim step): its
 *     holder may approve their OWN recap and invoice, and every such
 *     approval carries `selfApproved`, read as "Approved by the member
 *     themselves" on the invoice, in the events and on the payouts desk.
 *
 * Every key is read from the holder's own seat, counted without the admin
 * short-circuit, so an admin or a break-glass never passes an approval here,
 * and none of the four can come from a badge. The work approver is resolved
 * by `workApproverFor`, the one function a later circle lead rule changes.
 *
 * ── THE MEMBER'S OWN INVOICE IS THE LEGAL ONE (decision 16 revised) ───────
 *
 * Contractors always issue their own invoice: by email, through the
 * electronic invoice system, or however they invoice today. The app's draft
 * invoice is a SUPPORT document (lines, Bill to, period, work summary) and
 * never the legal invoice. Sending it for approval needs the member's own
 * invoice number, and on the contractor route the electronic invoice key.
 * When Finance changes a range amount the invoice returns to the member, who
 * voids and reissues their own invoice and sends again with its new number.
 * Finance approves one at a time or in bulk, pays outside the platform and
 * records the transfer on the existing `/api/cash-owed/transfers` door. When
 * every cash owed row on an invoice is paid it reads Paid. A payer's
 * authority is a NOTE on the payers document, never a gate.
 *
 * ── WHO READS WHAT ────────────────────────────────────────────────────────
 *
 * Kept items marked Members are read by every member. Suggested and dropped
 * items, review notes, Sera evidence and Approvers only items are for the
 * member and the approvers. Amounts, the pay route, legal details, the tax
 * form and the invoice are for the member and the holders of `cash.pay`. No
 * room panel shape below has a field that can hold an amount.
 *
 * The platform records money and never moves it.
 *
 * ── NOTHING VILLAGE-SPECIFIC LIVES HERE (decision 22) ─────────────────────
 *
 * Every value one village decides is data with an admin editor: the payers
 * (`payers` in `app_config`) and the village's moon-review settings
 * (`moon-review-settings`: the host country, its VAT rate, rate source and
 * currency, the tax forms on file, the hold rules and the pilot
 * acknowledgement). What stays here is the closed list of route kinds, the
 * status words, the scoring rules and the safety checks, worded with no
 * village, country, entity, tax or rate name. Defaults ship EMPTY: a fresh
 * install refuses an invoice with `SEND_REFUSALS.notConfigured` until a
 * `cash.pay` holder fills them in.
 */
import { canonicalJson } from "./canonicalJson";
import { looksLikePaymentDetails, moneyWords, type SeatSettings } from "./seatSettings";
import type { CycleBounds } from "./cycleClock";
import { civilDateKey } from "./lunar";
import { circleDay, guideSheetLink, halfwayDay, walkthroughDay, type RhythmDoc } from "./moonRhythm";

// ── Ids and limits ───────────────────────────────────────────────────────────

/** The module id, and the capability a work approval asks for. */
export const MOON_REVIEW_MODULE = "moon-review";
export const WORK_APPROVE_CAPABILITY = "moon.approve";
export const INVOICE_APPROVE_CAPABILITY = "cash.pay";
/** Decision 18: both approvals by one person, never on their own recap. */
export const APPROVE_ALONE_CAPABILITY = "moon.approve_alone";
/** Decision 19: the holder's own recap and invoice, marked as such. */
export const APPROVE_OWN_CAPABILITY = "moon.approve_own";

/** The power groups decision 18 grants `moon.approve_alone` to (the two 0307 granted admin to). */
export const APPROVE_ALONE_GROUPS = ["founders-circle", "steward-circle"] as const;
/** The power group decision 19 grants `moon.approve_own` to: the seeded Treasury role. */
export const APPROVE_OWN_GROUPS = ["treasury"] as const;

/** A recap id: `mr-` and sixteen hex characters. */
export const RECAP_ID = /^mr-[0-9a-f]{16}$/;
/** An item id: `mi-` and sixteen hex characters. */
export const ITEM_ID = /^mi-[0-9a-f]{16}$/;
/** An invoice id: `mv-` and sixteen hex characters. */
export const INVOICE_ID = /^mv-[0-9a-f]{16}$/;

/** The `app_config` key the payers document lives under. */
export const PAYERS_DOC_KEY = "payers";
/** The `app_config` key the village's moon-review settings live under (decision 22). */
export const SETTINGS_DOC_KEY = "moon-review-settings";

export const LIMITS = {
  ownWords: 2000,
  itemText: 500,
  originNote: 120,
  accountabilityWords: 300,
  ownGoalWords: 200,
  evidenceUrl: 500,
  reviewNote: 500,
  returnNote: 1000,
  roleAuditNote: 500,
  newRoleName: 120,
  newRoles: 5,
  /** Items one recap may hold, from every origin together. */
  items: 200,
  /** Suggested items one Sera draft may add. */
  seraItems: 40,
  legalName: 200,
  address: 500,
  taxFormFiledWhere: 200,
  memberNumber: 40,
  externalInvoiceKey: 64,
  fundsSource: 300,
  fxSource: 120,
  workCountries: 20,
  /** Invoices one bulk approval may carry. */
  bulkApprove: 50,
  payers: 10,
  payerText: 300,
  payerNote: 1000,
  redirectTo: 120,
  letGoReason: 300,
  goalText: 200,
  goalDoneWhen: 300,
  invoiceCc: 5,
  pilotAckText: 2000,
} as const;

/** The Sera draft stops waiting after this long and keeps whatever arrived. */
export const SERA_TIMEOUT_MS = 90_000;

/** Working days an approver has, counted from the day the step opened. */
export const WORK_DUE_WORKING_DAYS = 5;
export const INVOICE_DUE_WORKING_DAYS = 5;
/** Calendar days after a step opened when its approvers are reminded. */
export const REMINDER_DAYS = [3, 7] as const;
/** Calendar days after which a waiting step becomes an item in the core circle's backlog. */
export const ESCALATE_DAYS = 14;

// ── Statuses, one set of words everywhere ────────────────────────────────────

export const RECAP_STATUSES = ["draft", "waiting", "returned", "approved"] as const;
export type RecapStatus = (typeof RECAP_STATUSES)[number];

/**
 * An invoice row is written at send, so a stored invoice starts at `waiting`.
 * `draft` is the unsent invoice the page computes and shows.
 */
export const INVOICE_STATUSES = ["draft", "waiting", "returned", "approved", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RECAP_STATUS_WORDS: Record<RecapStatus, string> = {
  draft: "Draft",
  waiting: "Waiting on approval",
  returned: "Returned with a note",
  approved: "Approved",
};

export const INVOICE_STATUS_WORDS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  waiting: "Waiting on approval",
  returned: "Returned with a note",
  approved: "Approved, waiting to be paid",
  paid: "Paid",
  void: "Void",
};

/** Which approval a sent recap waits on. */
export const APPROVAL_STAGES = ["work", "invoice"] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

/** The role each stage waits on, as a member reads it. "Finance" is the Treasury role. */
export const STAGE_ROLE_WORDS: Record<ApprovalStage, string> = {
  work: "the Operations role",
  invoice: "Finance",
};

export function isRecapStatus(v: unknown): v is RecapStatus {
  return typeof v === "string" && (RECAP_STATUSES as readonly string[]).includes(v);
}
export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return typeof v === "string" && (INVOICE_STATUSES as readonly string[]).includes(v);
}

/** A member edits a recap only while it is theirs to edit. */
export function recapEditable(status: RecapStatus): boolean {
  return status === "draft" || status === "returned";
}

/**
 * What a recap reads after its work is approved. A recap with no invoice has
 * nothing for Finance to approve, so the work approval is the whole of it.
 */
export function recapStatusAfterWork(hasInvoice: boolean): RecapStatus {
  return hasInvoice ? "waiting" : "approved";
}

/** The stage a sent recap waits on, or null when it waits on nothing. */
export function waitingStage(r: { status: RecapStatus; workApprovedAt: string | null; hasInvoice: boolean; financeApprovedAt: string | null }): ApprovalStage | null {
  if (r.status !== "waiting") return null;
  if (!r.workApprovedAt) return "work";
  if (r.hasInvoice && !r.financeApprovedAt) return "invoice";
  return null;
}

/** "Waiting on approval from the Operations role, due 13 November 2026". */
export function waitingLine(stage: ApprovalStage, dueOn: string | null): string {
  const due = dueOn ? `, due ${dayWords(dueOn)}` : "";
  return `${RECAP_STATUS_WORDS.waiting} from ${STAGE_ROLE_WORDS[stage]}${due}`;
}

/**
 * The line an approved invoice reads to the member: "Expected by <date>", and
 * past that date "Approved, payment overdue since <date>".
 */
export function invoiceStatusLine(inv: { status: InvoiceStatus; expectedOn: string | null; paidOn: string | null }, today: string): string {
  if (inv.status === "paid") return inv.paidOn ? paySentWords(inv.paidOn) : INVOICE_STATUS_WORDS.paid;
  if (inv.status === "approved" && inv.expectedOn) {
    return today > inv.expectedOn
      ? `Approved, payment overdue since ${dayWords(inv.expectedOn)}`
      : `${INVOICE_STATUS_WORDS.approved}. Expected by ${dayWords(inv.expectedOn)}`;
  }
  return INVOICE_STATUS_WORDS[inv.status];
}

/** What the member reads once Finance has recorded the transfer. */
export function paySentWords(paidOn: string): string {
  return `Your pay is sent on ${dayWords(paidOn)}`;
}

/**
 * An invoice is Paid when every cash owed row it wrote is paid. An invoice
 * that wrote no row (a line with no cash) is never paid by this rule.
 */
export function invoicePaidFrom(rows: readonly { state: string; paidAt: string | null }[]): { paid: boolean; paidOn: string | null } {
  if (rows.length === 0 || rows.some((r) => r.state !== "paid")) return { paid: false, paidOn: null };
  const last = rows.map((r) => r.paidAt ?? "").sort().pop() || null;
  return { paid: true, paidOn: last ? last.slice(0, 10) : null };
}

// ── Items ────────────────────────────────────────────────────────────────────

/** Where a piece of work came from. A quest is never one of them. */
export const ITEM_ORIGINS = ["task", "room", "sera", "hand", "carry", "claude"] as const;
export type ItemOrigin = (typeof ITEM_ORIGINS)[number];

export const ITEM_STATES = ["suggested", "kept", "dropped"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const ITEM_VISIBILITIES = ["members", "approvers"] as const;
export type ItemVisibility = (typeof ITEM_VISIBILITIES)[number];

export const ITEM_REVIEWS = ["pending", "approved", "returned"] as const;
export type ItemReview = (typeof ITEM_REVIEWS)[number];

export const ITEM_ORIGIN_WORDS: Record<ItemOrigin, string> = {
  task: "From my list",
  room: "From a room",
  sera: "From Sera",
  hand: "Added by hand",
  carry: "Carried from last moon",
  claude: "From the deep dive",
};

export const ITEM_STATE_WORDS: Record<ItemState, string> = {
  suggested: "Suggested",
  kept: "Kept",
  dropped: "Dropped",
};

export const ITEM_VISIBILITY_WORDS: Record<ItemVisibility, string> = {
  members: "Members",
  approvers: "Approvers only",
};

export const ITEM_REVIEW_WORDS: Record<ItemReview, string> = {
  pending: "Waiting on approval",
  approved: "Approved",
  returned: "Returned with a note",
};

/**
 * The key that keeps one piece of work from arriving twice. A Sera task keys
 * on its library id whichever path finds it: through the profile list or
 * through the Sera draft.
 */
export function itemDedupeKey(origin: "task" | "room" | "hand" | "carry" | "claude", ref: string): string;
export function itemDedupeKey(origin: "sera", externalId: string): string;
export function itemDedupeKey(origin: ItemOrigin, ref: string): string {
  return `${origin}:${String(ref).slice(0, 150)}`;
}

/**
 * The note on a Sera task the sync closed. Until the library sends a reason,
 * a task Sera removed looks done whether it was done, cancelled or handed on,
 * so it arrives Suggested with this note and is never kept for the member.
 */
export const SERA_CLOSED_NOTE = "Closed in Sera";

/** Where a deep-dive item's proof lives (spec section 17, A1). */
export const EVIDENCE_KINDS = ["sera", "artifact", "mail", "notes", "drive", "file", "build"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Kinds whose link another member never reads, even on an item marked Members (check 26). */
export const PRIVATE_EVIDENCE_KINDS: readonly EvidenceKind[] = ["mail", "notes", "drive", "file"];

/** How a piece of work ended this moon (decision 20). Null until the member says. */
export const TASK_STATUSES = ["done", "partly", "carry", "let_go", "redirect"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_WORDS: Record<TaskStatus, string> = {
  done: "Done",
  partly: "Partly",
  carry: "Carry",
  let_go: "Let go",
  redirect: "Redirect",
};

export interface RecapItem {
  id: string;
  origin: ItemOrigin;
  /** `task:`, `sera:`, `room:`, `hand:` or `carry:` and the source's id. */
  dedupeKey: string;
  text: string;
  originNote: string | null;
  /** YYYY-MM-DD, the day the work was done, when the source knows it. */
  doneOn: string | null;
  evidenceUrl: string | null;
  evidenceAsset: string | null;
  /** The member ticked this item's proof for the work summary. */
  proofInSummary: boolean;
  /** Null means Outside my roles. */
  roleId: string | null;
  accountabilityWords: string | null;
  seasonGoalId: string | null;
  ownGoalWords: string | null;
  state: ItemState;
  visibility: ItemVisibility;
  review: ItemReview;
  reviewNote: string | null;
  position: number;
  /** YYYY-MM-DD the task was set: the score counts this moon's tasks only. */
  setOn: string | null;
  taskStatus: TaskStatus | null;
  /** Redirect: who or which role it really belongs to, in words. */
  redirectTo: string | null;
  letGoReason: string | null;
  /** Outside my roles: the role this work really belongs to, for the role audit. */
  belongsToRoleId: string | null;
  /** A1: the deep dive's source kind and date, and the role named in words. */
  evidenceKind: EvidenceKind | null;
  evidenceOn: string | null;
  belongsToSeatWords: string | null;
}

/** The fields a member may set on an item while the recap is theirs to edit. */
export interface ItemFields {
  text?: string;
  evidenceUrl?: string | null;
  evidenceAsset?: string | null;
  proofInSummary?: boolean;
  roleId?: string | null;
  accountabilityWords?: string | null;
  seasonGoalId?: string | null;
  ownGoalWords?: string | null;
  state?: ItemState;
  visibility?: ItemVisibility;
  position?: number;
  taskStatus?: TaskStatus | null;
  redirectTo?: string | null;
  letGoReason?: string | null;
  belongsToRoleId?: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function optText(v: unknown, max: number, field: string): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, field, error: `${FIELD_WORDS[field] ?? field} must be words.` };
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return { ok: true, value: null };
  if (t.length > max) return { ok: false, field, error: `${FIELD_WORDS[field] ?? field} runs to ${max} characters at most.` };
  return { ok: true, value: t };
}

const FIELD_WORDS: Record<string, string> = {
  text: "The item",
  evidenceUrl: "The proof link",
  evidenceAsset: "The proof file",
  accountabilityWords: "The accountability",
  ownGoalWords: "Your seasonal goal",
  roleId: "The role",
  seasonGoalId: "The season goal",
  ownWords: "In my own words",
  note: "The note",
  legalName: "Your legal name",
  address: "Your address",
  taxFormFiledWhere: "Where the tax form is filed",
  externalInvoiceKey: "The electronic invoice key",
  fundsSource: "Where the funds came from",
  fxSource: "The rate's source",
  redirectTo: "Who it belongs to",
  letGoReason: "Why it was let go",
  belongsToRoleId: "The role it belongs to",
};

/** A proof link: http or https, or a path on this village. */
export function evidenceUrlProblem(url: string): string | null {
  if (/^\/[^/]/.test(url)) return null;
  if (/^https?:\/\/[^\s]+$/i.test(url)) return null;
  return "A proof link starts with https:// or with a page on this village.";
}

/** Read an item edit. Absent keys are left alone; a key present as null clears. */
export function parseItemFields(body: unknown): Parsed<ItemFields> {
  if (!isObj(body)) return { ok: false, field: "body", error: "Send the item's fields." };
  const out: ItemFields = {};
  if ("text" in body) {
    const t = optText(body.text, LIMITS.itemText, "text");
    if (!t.ok) return t;
    if (!t.value) return { ok: false, field: "text", error: ITEM_TEXT_EMPTY };
    out.text = t.value;
  }
  if ("evidenceUrl" in body) {
    const t = optText(body.evidenceUrl, LIMITS.evidenceUrl, "evidenceUrl");
    if (!t.ok) return t;
    if (t.value) {
      const p = evidenceUrlProblem(t.value);
      if (p) return { ok: false, field: "evidenceUrl", error: p };
    }
    out.evidenceUrl = t.value;
  }
  if ("evidenceAsset" in body) {
    const t = optText(body.evidenceAsset, 128, "evidenceAsset");
    if (!t.ok) return t;
    out.evidenceAsset = t.value;
  }
  for (const [key, max] of [["accountabilityWords", LIMITS.accountabilityWords], ["ownGoalWords", LIMITS.ownGoalWords], ["roleId", 64], ["seasonGoalId", 64]] as const) {
    if (key in body) {
      const t = optText(body[key], max, key);
      if (!t.ok) return t;
      out[key] = t.value;
    }
  }
  if ("proofInSummary" in body) out.proofInSummary = body.proofInSummary === true;
  if ("state" in body) {
    if (!(ITEM_STATES as readonly unknown[]).includes(body.state)) return { ok: false, field: "state", error: "An item is suggested, kept or dropped." };
    out.state = body.state as ItemState;
  }
  if ("visibility" in body) {
    if (!(ITEM_VISIBILITIES as readonly unknown[]).includes(body.visibility)) return { ok: false, field: "visibility", error: "An item shows to members or to approvers only." };
    out.visibility = body.visibility as ItemVisibility;
  }
  if ("position" in body) {
    const n = Number(body.position);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) return { ok: false, field: "position", error: "The position is a whole number." };
    out.position = n;
  }
  if ("taskStatus" in body) {
    if (body.taskStatus !== null && !(TASK_STATUSES as readonly unknown[]).includes(body.taskStatus)) return { ok: false, field: "taskStatus", error: "A task is Done, Partly, Carry, Let go or Redirect." };
    out.taskStatus = (body.taskStatus as TaskStatus | null) ?? null;
  }
  for (const [key, max] of [["redirectTo", LIMITS.redirectTo], ["letGoReason", LIMITS.letGoReason], ["belongsToRoleId", 64]] as const) {
    if (key in body) {
      const t = optText(body[key], max, key);
      if (!t.ok) return t;
      out[key] = t.value;
    }
  }
  if (out.taskStatus === "let_go" && "letGoReason" in out && !out.letGoReason) return { ok: false, field: "letGoReason", error: LET_GO_NEEDS_REASON };
  if (out.taskStatus === "redirect" && "redirectTo" in out && !out.redirectTo) return { ok: false, field: "redirectTo", error: REDIRECT_NEEDS_WHO };
  if (out.text && looksLikePaymentDetails(out.text)) return { ok: false, field: "text", error: PAYMENT_DETAILS_REFUSED };
  return { ok: true, value: out };
}

// ── The moon's days ──────────────────────────────────────────────────────────

/** YYYY-MM-DD plus n days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 is Sunday, 6 is Saturday. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days from a to b, inclusive of both. */
export function daysInclusive(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000) + 1);
}

/** n working days (Monday to Friday) after a day. */
export function addWorkingDays(day: string, n: number): string {
  let out = day;
  let left = n;
  while (left > 0) {
    out = addDays(out, 1);
    const w = weekdayOf(out);
    if (w !== 0 && w !== 6) left -= 1;
  }
  return out;
}

export interface MoonDays {
  cycleId: string;
  /** YYYY-MM-DD, the first day of the moon. */
  firstDay: string;
  /** YYYY-MM-DD, the last day: the day before the next moon's first day. */
  lastDay: string;
  days: number;
}

/**
 * The days a moon covers, in village time. Each day belongs to exactly one
 * moon: the day the new moon falls on opens the moon it starts. The calendar
 * clock's boundaries are UTC instants (shared/cycleClock.ts), so a calendar
 * month is read in UTC and stays the month it names.
 */
export function moonDays(bounds: Pick<CycleBounds, "id" | "clock" | "startsAt" | "endsAt">, timeZone: string): MoonDays {
  const tz = bounds.clock === "calendar" ? "UTC" : timeZone || "UTC";
  const firstDay = civilDateKey(bounds.startsAt, tz);
  const lastDay = addDays(civilDateKey(bounds.endsAt, tz), -1);
  return { cycleId: bounds.id, firstDay, lastDay, days: daysInclusive(firstDay, lastDay) };
}

/**
 * THE END-OF-MOON FRIDAY, the prepare-by day: the last Friday before the
 * closing new moon's civil date, unless the village moved it
 * (`shared/moonRhythm.ts`). The moon ending with the 9 November 2026 new moon
 * gives Friday 6 November.
 */
export function endOfMoonFriday(bounds: Pick<CycleBounds, "id" | "clock" | "startsAt" | "endsAt">, timeZone: string, rhythm?: RhythmDoc): string {
  return walkthroughDay(bounds, timeZone, rhythm);
}

/**
 * THE SEND-BY DAY: the circle Monday, the first Monday after the end-of-moon
 * Friday, unless the village moved it (spec section 18 replaces decision 21's
 * new-moon-day rule). Monday 9 November 2026 for the October moon, Monday 7
 * December for November. Sending any time before then counts the same as
 * sending in the room.
 */
export function sendBy(bounds: Pick<CycleBounds, "id" | "clock" | "startsAt" | "endsAt">, timeZone: string, rhythm?: RhythmDoc): string {
  return circleDay(bounds, timeZone, rhythm);
}

/** The dates a moon pack must name: the cycle's civil start, and the civil day of its closing new moon. */
export function packMoonDates(bounds: Pick<CycleBounds, "id" | "clock" | "startsAt" | "endsAt">, timeZone: string): { start: string; end: string } {
  const d = moonDays(bounds, timeZone);
  return { start: d.firstDay, end: addDays(d.lastDay, 1) };
}

export { halfwayDay };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "6 November 2026". */
export function dayWords(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "10 October to 8 November 2026", with the first year only when it differs. */
export function periodWords(firstDay: string, lastDay: string): string {
  const [y1, m1, d1] = firstDay.split("-").map(Number);
  const year = y1 === Number(lastDay.slice(0, 4)) ? "" : ` ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]}${year} to ${dayWords(lastDay)}`;
}

/** When each approval is due, from the day it opened. */
export function workDueOn(sentDay: string): string {
  return addWorkingDays(sentDay, WORK_DUE_WORKING_DAYS);
}
export function invoiceDueOn(workApprovedDay: string): string {
  return addWorkingDays(workApprovedDay, INVOICE_DUE_WORKING_DAYS);
}

/** What the deadline job does for a step that opened on `openedDay`. */
export function deadlineAction(openedDay: string, today: string): "none" | "remind" | "escalate" {
  const age = daysInclusive(openedDay, today) - 1;
  if (age >= ESCALATE_DAYS) return "escalate";
  if ((REMINDER_DAYS as readonly number[]).includes(age)) return "remind";
  return "none";
}

// ── Roles held during the moon ───────────────────────────────────────────────

/** The fields of an `org_role_assignments` row this flow reads. Never `role_holder_terms`. */
export interface AssignmentRow {
  id: string;
  roleId: string;
  userId: string;
  holderKind: string;
  isExample: boolean;
  applicationId: string | null;
  /** YYYY-MM-DD in village time, or null when unknown. */
  startedOn: string | null;
  endedOn: string | null;
}

/**
 * A role counts for a moon when the member held it as a member, it is no
 * example, it started on or before the moon's last day, and it had not ended
 * before the moon's first day.
 */
export function heldDuring(a: AssignmentRow, moon: Pick<MoonDays, "firstDay" | "lastDay">): boolean {
  if (a.holderKind !== "member" || a.isExample) return false;
  if (a.startedOn && a.startedOn > moon.lastDay) return false;
  if (a.endedOn && a.endedOn < moon.firstDay) return false;
  return true;
}

/** The days of the moon a holding covers, clamped to the moon. */
export function daysHeldIn(a: Pick<AssignmentRow, "startedOn" | "endedOn">, moon: Pick<MoonDays, "firstDay" | "lastDay">): number {
  const from = a.startedOn && a.startedOn > moon.firstDay ? a.startedOn : moon.firstDay;
  const to = a.endedOn && a.endedOn < moon.lastDay ? a.endedOn : moon.lastDay;
  return to < from ? 0 : daysInclusive(from, to);
}

/** The one function a later circle lead rule changes: who approves a role's work. */
export function workApproverFor(_role: { roleId: string; circleId: string | null }): { capability: typeof WORK_APPROVE_CAPABILITY } {
  return { capability: WORK_APPROVE_CAPABILITY };
}

// ── Coverage ─────────────────────────────────────────────────────────────────

export interface RoleCardForCoverage {
  roleId: string;
  name: string;
  circleId: string | null;
  /** The role's accountabilities and CCOS responsibilities. Never its time commitment. */
  accountabilities: readonly string[];
  /** The application's deliverables text, split by line. */
  deliverables: readonly string[];
}

export interface SeasonGoalRef {
  id: string;
  words: string;
}

export interface CoverageLine {
  words: string;
  kind: "accountability" | "deliverable";
  itemIds: string[];
}

export interface RoleCoverage {
  roleId: string;
  name: string;
  lines: CoverageLine[];
  /** Kept items on this role that name no line on its card. */
  untagged: string[];
  itemCount: number;
}

export interface Coverage {
  roles: RoleCoverage[];
  /** Kept items with no role. */
  outsideMyRoles: string[];
  /** Kept items per village season goal, by goal id. */
  seasonGoals: Array<{ id: string; words: string; count: number }>;
  /** Kept items per own seasonal goal, by its words. */
  ownGoals: Array<{ words: string; count: number }>;
  /** Roles held this moon with no kept item. */
  rolesWithNoItems: string[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Split a deliverables text into its lines, dropping bullets and blanks. */
export function deliverableLines(text: string | null | undefined): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * A season goal an item names, by id, or by its words for a link still stored
 * as words (0298 gave goals ids; some links predate it).
 */
export function matchSeasonGoal(ref: string | null, goals: readonly SeasonGoalRef[]): SeasonGoalRef | null {
  if (!ref) return null;
  return goals.find((g) => g.id === ref) ?? goals.find((g) => norm(g.words) === norm(ref)) ?? null;
}

/** Coverage of a recap's KEPT items against the roles held, the season goals and the member's own goals. */
export function coverage(input: {
  roles: readonly RoleCardForCoverage[];
  items: readonly Pick<RecapItem, "id" | "state" | "roleId" | "accountabilityWords" | "seasonGoalId" | "ownGoalWords" | "review">[];
  seasonGoals: readonly SeasonGoalRef[];
  ownGoals: readonly string[];
  /** Leave returned items out of every count (the approver's and the summary's reading). */
  excludeReturned?: boolean;
}): Coverage {
  const kept = input.items.filter((i) => i.state === "kept" && !(input.excludeReturned && i.review === "returned"));
  const roleIds = new Set(input.roles.map((r) => r.roleId));
  const roles: RoleCoverage[] = input.roles.map((r) => {
    const mine = kept.filter((i) => i.roleId === r.roleId);
    const lines: CoverageLine[] = [
      ...r.accountabilities.map((w) => ({ words: w, kind: "accountability" as const, itemIds: [] as string[] })),
      ...r.deliverables.map((w) => ({ words: w, kind: "deliverable" as const, itemIds: [] as string[] })),
    ];
    const untagged: string[] = [];
    for (const i of mine) {
      const line = i.accountabilityWords ? lines.find((l) => norm(l.words) === norm(i.accountabilityWords as string)) : undefined;
      if (line) line.itemIds.push(i.id);
      else untagged.push(i.id);
    }
    return { roleId: r.roleId, name: r.name, lines, untagged, itemCount: mine.length };
  });
  const outsideMyRoles = kept.filter((i) => !i.roleId || !roleIds.has(i.roleId)).map((i) => i.id);
  const seasonGoals = input.seasonGoals.map((g) => ({
    id: g.id,
    words: g.words,
    count: kept.filter((i) => matchSeasonGoal(i.seasonGoalId, input.seasonGoals)?.id === g.id).length,
  }));
  const ownGoals = input.ownGoals.map((w) => ({ words: w, count: kept.filter((i) => i.ownGoalWords && norm(i.ownGoalWords) === norm(w)).length }));
  return { roles, outsideMyRoles, seasonGoals, ownGoals, rolesWithNoItems: roles.filter((r) => r.itemCount === 0).map((r) => r.roleId) };
}

// ── What another member reads ────────────────────────────────────────────────

export interface MemberViewItem {
  id: string;
  text: string;
  evidenceUrl: string | null;
  seasonGoalId: string | null;
}

export interface MemberViewRole {
  roleId: string | null;
  name: string;
  items: MemberViewItem[];
  /** Approvers only items on this role: shown as "1 item held privately". */
  heldPrivately: number;
}

/**
 * Another member's reading of a SENT recap: kept items marked Members, grouped
 * by role, with a count of the Approvers only ones. A returned item is left
 * out. Room items pass only where `roomVisible` says the reader may see the
 * task (`canSeeTask`). The returned shape has no field for an amount, a
 * route, an invoice, a review note, a suggested item or Sera evidence.
 */
export function memberView(input: {
  status: RecapStatus;
  roles: readonly { roleId: string; name: string }[];
  items: readonly RecapItem[];
  roomVisible: (item: RecapItem) => boolean;
}): MemberViewRole[] {
  // A1: mail, notes, Drive and file links stay with the member and approvers.
  if (input.status === "draft") return [];
  const kept = input.items.filter((i) => i.state === "kept" && i.review !== "returned" && (i.origin !== "room" || input.roomVisible(i)));
  const groups: MemberViewRole[] = [...input.roles.map((r) => ({ roleId: r.roleId as string | null, name: r.name, items: [] as MemberViewItem[], heldPrivately: 0 })), { roleId: null, name: OUTSIDE_MY_ROLES, items: [], heldPrivately: 0 }];
  for (const i of kept) {
    const g = groups.find((x) => x.roleId === i.roleId) ?? groups[groups.length - 1];
    if (i.visibility === "approvers") g.heldPrivately += 1;
    else g.items.push({ id: i.id, text: i.text, evidenceUrl: i.origin === "sera" || (i.evidenceKind && PRIVATE_EVIDENCE_KINDS.includes(i.evidenceKind)) ? null : i.evidenceUrl, seasonGoalId: i.seasonGoalId });
  }
  return groups.filter((g) => g.items.length > 0 || g.heldPrivately > 0);
}

/** "1 item held privately", "2 items held privately". */
export function heldPrivatelyWords(n: number): string {
  return n === 1 ? "1 item held privately" : `${n} items held privately`;
}

// ── The role audit ───────────────────────────────────────────────────────────

/** `fill`: a role the member does not hold and kept covering (A1). */
export const ROLE_AUDIT_CHOICES = ["keep", "expand", "contract", "hand_back", "fill"] as const;
export type RoleAuditChoice = (typeof ROLE_AUDIT_CHOICES)[number];

export const ROLE_AUDIT_WORDS: Record<RoleAuditChoice, string> = {
  keep: "Keep",
  expand: "Expand",
  contract: "Contract",
  hand_back: "Hand back",
  fill: "Fill",
};

export interface RoleAudit {
  roles: Array<{ roleId: string; choice: RoleAuditChoice; note: string | null }>;
  /** A role that should exist, prefilled from Outside my roles. */
  newRoles: Array<{ name: string; why: string | null }>;
}

export function parseRoleAudit(raw: unknown, heldRoleIds: readonly string[], knownRoleIds: readonly string[] = heldRoleIds): Parsed<RoleAudit> {
  if (raw === undefined || raw === null) return { ok: true, value: { roles: [], newRoles: [] } };
  if (!isObj(raw)) return { ok: false, field: "roleAudit", error: "The role audit is a list of roles and new roles." };
  const roles: RoleAudit["roles"] = [];
  for (const r of Array.isArray(raw.roles) ? raw.roles : []) {
    if (!isObj(r) || typeof r.roleId !== "string") return { ok: false, field: "roleAudit", error: "The role audit names only roles you held this moon." };
    if (!(ROLE_AUDIT_CHOICES as readonly unknown[]).includes(r.choice)) return { ok: false, field: "roleAudit", error: "Each role is kept, expanded, contracted, handed back, or filled." };
    // Fill names a role the member does NOT hold; every other verdict names one they do.
    if (r.choice === "fill" ? heldRoleIds.includes(r.roleId) || !knownRoleIds.includes(r.roleId) : !heldRoleIds.includes(r.roleId)) {
      return { ok: false, field: "roleAudit", error: r.choice === "fill" ? "Fill names a role you do not hold." : "The role audit names only roles you held this moon." };
    }
    if (roles.some((x) => x.roleId === r.roleId)) continue;
    const note = optText(r.note, LIMITS.roleAuditNote, "note");
    if (!note.ok) return note;
    roles.push({ roleId: r.roleId, choice: r.choice as RoleAuditChoice, note: note.value });
  }
  const newRoles: RoleAudit["newRoles"] = [];
  for (const n of Array.isArray(raw.newRoles) ? raw.newRoles : []) {
    if (!isObj(n)) continue;
    const name = optText(n.name, LIMITS.newRoleName, "note");
    if (!name.ok) return name;
    if (!name.value) continue;
    const why = optText(n.why, LIMITS.roleAuditNote, "note");
    if (!why.ok) return why;
    newRoles.push({ name: name.value, why: why.value });
  }
  if (newRoles.length > LIMITS.newRoles) return { ok: false, field: "roleAudit", error: `A recap names ${LIMITS.newRoles} new roles at most.` };
  return { ok: true, value: { roles, newRoles } };
}

/** The tensions a sent role audit raises: every choice except Keep, and every new role. */
export function auditTensions(audit: RoleAudit): Array<{ roleId: string | null; title: string; note: string | null }> {
  return [
    ...audit.roles.filter((r) => r.choice !== "keep").map((r) => ({ roleId: r.roleId, title: `${ROLE_AUDIT_WORDS[r.choice]} this role`, note: r.note })),
    ...audit.newRoles.map((n) => ({ roleId: null, title: `A role that should exist: ${n.name}`, note: n.why })),
  ];
}

// ── Pay routes ───────────────────────────────────────────────────────────────

/** A closed list. `pending` is the default. */
/**
 * A closed list, with neutral ids (decision 22). `pending` is the default.
 * `local_*` is the village's host country, named only in its settings.
 */
export const PAY_ROUTES = ["pending", "abroad", "nomad", "local_contractor", "local_employee", "visitor"] as const;
export type PayRoute = (typeof PAY_ROUTES)[number];

/** The routes that can carry a paid line. `pending`, `visitor` and `local_employee` never do. */
export const INVOICING_ROUTES: readonly PayRoute[] = ["abroad", "nomad", "local_contractor"];

/**
 * A tax form's key, from the village's settings (`taxForms`), or `none`.
 * The column holds eight characters.
 */
export type TaxFormKind = string;
export const NO_TAX_FORM = "none";

/**
 * The route form's choices, in the member's words. `{country}` is filled
 * from the village's settings, and reads "the host country" until set.
 */
export const PAY_ROUTE_WORDS: Record<PayRoute, string> = {
  pending: "Not chosen yet",
  abroad: "I live outside {country}, and did all the invoiced work outside it this moon",
  nomad: "I live in {country} on granted digital nomad status, and invoice only work that serves people abroad",
  local_contractor: "I live in {country} with the right to work there, working as an independent contractor",
  local_employee: "I live in {country}, working as an employee",
  visitor: "I am in {country} on a visitor entry, or my status application is still pending",
};

/** The words a host-country template takes when the village has not named one. */
export const HOST_FALLBACK = "the host country";

export function hostName(settings: Pick<MoonReviewSettings, "hostCountry">): string {
  return settings.hostCountry?.name || HOST_FALLBACK;
}

export function payRouteWords(route: PayRoute, settings: Pick<MoonReviewSettings, "hostCountry">): string {
  return PAY_ROUTE_WORDS[route].replace("{country}", hostName(settings));
}

/** The attestation's lines, filled from the village's settings. */
export function attestationWords(settings: Pick<MoonReviewSettings, "hostCountry">): { workCountries: string; daysIn: string; statusUnchanged: string; servedAbroad: string; visitorEntryWork: string } {
  const c = hostName(settings);
  return {
    workCountries: "The countries where the invoiced work was done",
    daysIn: `Days spent in ${c} this moon`,
    statusUnchanged: "My status is unchanged",
    servedAbroad: "The invoiced work served people abroad",
    visitorEntryWork: `Some invoiced work was done in ${c} on a visitor entry`,
  };
}

export function isPayRoute(v: unknown): v is PayRoute {
  return typeof v === "string" && (PAY_ROUTES as readonly string[]).includes(v);
}

export interface PayRouteRecord {
  userId: string;
  route: PayRoute;
  payerKey: string | null;
  currency: string | null;
  legalName: string | null;
  address: string | null;
  /** YYYY-MM-DD. Only the status's expiry date is stored, never a document number. */
  statusValidUntil: string | null;
  taxFormKind: TaxFormKind;
  taxFormSignedOn: string | null;
  taxFormExpiresOn: string | null;
  taxFormFiledWhere: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  pilotAckVersion: string | null;
  pilotAckAt: string | null;
  bankChangedOn: string | null;
  bankConfirmedByRole: string | null;
}

/** What a member may send to `PUT /api/me/pay-route`. Confirmation is never theirs to set. */
export type PayRouteInput = Pick<PayRouteRecord, "route" | "payerKey" | "currency" | "legalName" | "address" | "statusValidUntil" | "taxFormKind" | "taxFormSignedOn" | "taxFormExpiresOn" | "taxFormFiledWhere">;

/** The fields whose change clears a route's confirmation. */
export const CONFIRMED_FIELDS = ["route", "payerKey", "currency", "legalName", "address", "statusValidUntil", "taxFormKind", "taxFormSignedOn", "taxFormExpiresOn"] as const;

export function routeChangeClearsConfirmation(before: Partial<PayRouteInput> | null, after: PayRouteInput): boolean {
  if (!before) return true;
  return CONFIRMED_FIELDS.some((k) => (before[k] ?? null) !== (after[k] ?? null));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function optDate(v: unknown, field: string): Parsed<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { ok: false, field, error: "A date is written YYYY-MM-DD." };
  return { ok: true, value: v };
}

/**
 * Read a member's pay route. Legal name and address run the payment-details
 * check, so a bank or card number never lands in them.
 */
export function parsePayRouteInput(body: unknown, opts: { taxFormKeys?: readonly string[] } = {}): Parsed<PayRouteInput> {
  if (!isObj(body)) return { ok: false, field: "body", error: "Send your pay route." };
  if (!isPayRoute(body.route)) return { ok: false, field: "route", error: "Choose one of the pay routes listed." };
  const legalName = optText(body.legalName, LIMITS.legalName, "legalName");
  if (!legalName.ok) return legalName;
  const address = optText(body.address, LIMITS.address, "address");
  if (!address.ok) return address;
  for (const [f, v] of [["legalName", legalName.value], ["address", address.value]] as const) {
    if (v && looksLikePaymentDetails(v)) return { ok: false, field: f, error: PAYMENT_DETAILS_REFUSED };
  }
  const filed = optText(body.taxFormFiledWhere, LIMITS.taxFormFiledWhere, "taxFormFiledWhere");
  if (!filed.ok) return filed;
  if (filed.value && looksLikePaymentDetails(filed.value)) return { ok: false, field: "taxFormFiledWhere", error: PAYMENT_DETAILS_REFUSED };
  const payerKey = body.payerKey === undefined || body.payerKey === null || body.payerKey === "" ? null : String(body.payerKey);
  if (payerKey !== null && !PAYER_KEY.test(payerKey)) return { ok: false, field: "payerKey", error: "Choose one of the payers listed." };
  const currency = body.currency === undefined || body.currency === null || body.currency === "" ? null : String(body.currency).toUpperCase();
  if (currency !== null && !CURRENCY_RE.test(currency)) return { ok: false, field: "currency", error: "A currency is a three-letter code, such as USD." };
  const kind = body.taxFormKind === undefined || body.taxFormKind === null ? NO_TAX_FORM : body.taxFormKind;
  if (typeof kind !== "string" || (kind !== NO_TAX_FORM && !(opts.taxFormKeys ?? []).includes(kind))) return { ok: false, field: "taxFormKind", error: "Choose one of the tax forms listed, or none." };
  const dates: Record<string, string | null> = {};
  for (const f of ["statusValidUntil", "taxFormSignedOn", "taxFormExpiresOn"] as const) {
    const d = optDate(body[f], f);
    if (!d.ok) return d;
    dates[f] = d.value;
  }
  return {
    ok: true,
    value: {
      route: body.route,
      payerKey,
      currency,
      legalName: legalName.value,
      address: address.value,
      statusValidUntil: dates.statusValidUntil,
      taxFormKind: kind as TaxFormKind,
      taxFormSignedOn: dates.taxFormSignedOn,
      taxFormExpiresOn: dates.taxFormExpiresOn,
      taxFormFiledWhere: filed.value,
    },
  };
}

/** Nobody confirms their own route. */
export function confirmRouteRefusal(actorUserId: string, memberUserId: string): string | null {
  return actorUserId === memberUserId ? CONFIRM_OWN_ROUTE_REFUSED : null;
}

/** Is the member's tax form valid on a day? A route with no form needs none. */
export function taxFormValidOn(r: Pick<PayRouteRecord, "taxFormKind" | "taxFormSignedOn" | "taxFormExpiresOn">, day: string): boolean {
  if (r.taxFormKind === NO_TAX_FORM) return false;
  if (!r.taxFormSignedOn || r.taxFormSignedOn > day) return false;
  return !r.taxFormExpiresOn || r.taxFormExpiresOn >= day;
}

// ── The village's moon-review settings (decision 22) ─────────────────────────

/** A tax form the village keeps on file, by key (eight characters at most) and the label members read. */
export interface TaxFormDef {
  key: string;
  label: string;
}

/**
 * A hold: an invoice whose member holds this tax form and did invoiced work
 * in this country waits for Finance to decide with the accountant.
 */
export interface HoldRule {
  taxFormKey: string;
  workCountry: string;
  note: string;
}

export interface MoonReviewSettings {
  hostCountry: { code: string; name: string } | null;
  /** The host country's VAT rate, in basis points (1300 is 13%). Local contractor terms are before it. */
  hostVatRateBp: number | null;
  /** Where the exchange rate comes from, in the village's words. */
  hostRateSource: string | null;
  hostCurrency: string | null;
  /** A new version asks every member to accept again. */
  pilotAck: { text: string; version: string } | null;
  taxForms: TaxFormDef[];
  /** The routes that need a valid tax form on the expected payment date. */
  taxFormRoutes: PayRoute[];
  holds: HoldRule[];
}

/** Platform defaults: EMPTY. A fresh install names no country, no form and no acknowledgement. */
export const EMPTY_SETTINGS: MoonReviewSettings = {
  hostCountry: null, hostVatRateBp: null, hostRateSource: null, hostCurrency: null, pilotAck: null, taxForms: [], taxFormRoutes: [], holds: [],
};

const TAX_FORM_KEY = /^[A-Za-z0-9-]{1,8}$/;

/** Read the settings document, from storage or from `PUT /api/moon-review/settings`. */
export function parseMoonReviewSettings(raw: unknown): Parsed<MoonReviewSettings> {
  if (raw === undefined || raw === null) return { ok: true, value: EMPTY_SETTINGS };
  if (!isObj(raw)) return { ok: false, field: "settings", error: "The settings are a set of fields." };
  let hostCountry: MoonReviewSettings["hostCountry"] = null;
  if (raw.hostCountry !== undefined && raw.hostCountry !== null) {
    const h = isObj(raw.hostCountry) ? raw.hostCountry : {};
    const code = String(h.code ?? "").trim().toUpperCase();
    const name = typeof h.name === "string" ? h.name.replace(/\s+/g, " ").trim() : "";
    if (!COUNTRY_RE.test(code) || !name || name.length > 60) return { ok: false, field: "hostCountry", error: "The host country is a two-letter code and its name." };
    hostCountry = { code, name };
  }
  let vat: number | null = null;
  if (raw.hostVatRateBp !== undefined && raw.hostVatRateBp !== null) {
    vat = Number(raw.hostVatRateBp);
    if (!Number.isInteger(vat) || vat < 0 || vat > 10_000) return { ok: false, field: "hostVatRateBp", error: "The VAT rate is in basis points, from 0 to 10000." };
  }
  const source = optText(raw.hostRateSource, LIMITS.fxSource, "fxSource");
  if (!source.ok) return source;
  const currency = raw.hostCurrency === undefined || raw.hostCurrency === null || raw.hostCurrency === "" ? null : String(raw.hostCurrency).toUpperCase();
  if (currency !== null && !CURRENCY_RE.test(currency)) return { ok: false, field: "hostCurrency", error: "A currency is a three-letter code." };
  let pilotAck: MoonReviewSettings["pilotAck"] = null;
  if (raw.pilotAck !== undefined && raw.pilotAck !== null) {
    const a = isObj(raw.pilotAck) ? raw.pilotAck : {};
    const text = typeof a.text === "string" ? a.text.trim() : "";
    const version = typeof a.version === "string" ? a.version.trim() : "";
    if (!text || text.length > LIMITS.pilotAckText || !/^[A-Za-z0-9._-]{1,16}$/.test(version)) return { ok: false, field: "pilotAck", error: "The pilot acknowledgement needs its words and a version of up to 16 letters, digits, dots or dashes." };
    pilotAck = { text, version };
  }
  const taxForms: TaxFormDef[] = [];
  for (const f of Array.isArray(raw.taxForms) ? raw.taxForms : []) {
    const key = isObj(f) ? String(f.key ?? "").trim() : "";
    const label = isObj(f) && typeof f.label === "string" ? f.label.trim() : "";
    if (!TAX_FORM_KEY.test(key) || key === NO_TAX_FORM || !label || label.length > 80) return { ok: false, field: "taxForms", error: "Each tax form has a key of up to 8 letters, digits or dashes, and a label." };
    if (!taxForms.some((x) => x.key === key)) taxForms.push({ key, label });
  }
  const taxFormRoutes = (Array.isArray(raw.taxFormRoutes) ? raw.taxFormRoutes : []).filter(isPayRoute).filter((r) => INVOICING_ROUTES.includes(r));
  const holds: HoldRule[] = [];
  for (const h of Array.isArray(raw.holds) ? raw.holds : []) {
    if (!isObj(h)) continue;
    const taxFormKey = String(h.taxFormKey ?? "");
    const workCountry = String(h.workCountry ?? "").toUpperCase();
    const note = typeof h.note === "string" ? h.note.trim().slice(0, LIMITS.payerText) : "";
    if (!taxForms.some((f) => f.key === taxFormKey) || !COUNTRY_RE.test(workCountry) || !note) return { ok: false, field: "holds", error: "Each hold names a listed tax form, a two-letter country and a note." };
    holds.push({ taxFormKey, workCountry, note });
  }
  return { ok: true, value: { hostCountry, hostVatRateBp: vat, hostRateSource: source.value, hostCurrency: currency, pilotAck, taxForms, taxFormRoutes: Array.from(new Set(taxFormRoutes)), holds } };
}

/** Old and new values for every settings field a `PUT` changed, for the event note. */
export function settingsChanges(before: MoonReviewSettings, after: MoonReviewSettings): Array<{ field: string; from: unknown; to: unknown }> {
  return (Object.keys(after) as Array<keyof MoonReviewSettings>).filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k])).map((k) => ({ field: k, from: before[k], to: after[k] }));
}

/**
 * What a village still has to name before an invoice can go, in order. Empty
 * means ready. Payers come from the payers document; the rest from settings.
 */
export function setupGaps(payers: PayersDoc, settings: MoonReviewSettings): string[] {
  const gaps: string[] = [];
  if (!payers.payers.some((p) => p.invoicing && p.routes.length > 0)) gaps.push(SETUP_GAP_WORDS.payer);
  if (!settings.hostCountry) gaps.push(SETUP_GAP_WORDS.country);
  if (!settings.pilotAck) gaps.push(SETUP_GAP_WORDS.pilotAck);
  return gaps;
}

export const SETUP_GAP_WORDS = {
  payer: "Name who you pay: a payer with invoicing on and the routes it pays",
  country: "Name the host country",
  pilotAck: "Write the pilot acknowledgement and its version",
} as const;

// ── The moon attestation ─────────────────────────────────────────────────────

export interface MoonAttestation {
  /** ISO 3166 alpha-2 codes of every country where invoiced work was done. */
  workCountries: string[];
  /** Days spent in the host country this moon. */
  daysInHostCountry: number;
  statusUnchanged: boolean;
  /** Nomad route: the invoiced work served people abroad. */
  servedAbroad: boolean | null;
  /** Any invoiced work done in the host country on a visitor entry. */
  visitorEntryWork: boolean;
}

const COUNTRY_RE = /^[A-Z]{2}$/;

export function parseAttestation(raw: unknown, route: PayRoute, moon: Pick<MoonDays, "days">): Parsed<MoonAttestation> {
  if (!isObj(raw)) return { ok: false, field: "attestation", error: ATTESTATION_MISSING };
  const countries = Array.isArray(raw.workCountries) ? Array.from(new Set(raw.workCountries.map((c) => String(c).trim().toUpperCase()))) : [];
  if (countries.length === 0 || countries.length > LIMITS.workCountries || countries.some((c) => !COUNTRY_RE.test(c))) {
    return { ok: false, field: "workCountries", error: "Name every country where the invoiced work was done, as two-letter codes." };
  }
  const days = Number(raw.daysInHostCountry);
  if (!Number.isInteger(days) || days < 0 || days > moon.days) return { ok: false, field: "daysInHostCountry", error: `The days spent in the country run from 0 to ${moon.days}.` };
  if (raw.statusUnchanged !== true) return { ok: false, field: "statusUnchanged", error: "Confirm that your status is unchanged, or tell Finance what changed." };
  const servedAbroad = route === "nomad" ? raw.servedAbroad === true : null;
  if (route === "nomad" && !servedAbroad) return { ok: false, field: "servedAbroad", error: "On the nomad route, confirm the invoiced work served people abroad." };
  return { ok: true, value: { workCountries: countries, daysInHostCountry: days, statusUnchanged: true, servedAbroad, visitorEntryWork: raw.visitorEntryWork === true } };
}

// ── The payers document ──────────────────────────────────────────────────────

export const PAYER_KEY = /^[a-z][a-z0-9-]{1,40}$/;
const EMAIL_RE = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[A-Za-z]{2,}$/;

export const AUTHORITY_KINDS = ["none", "bridge_agreement", "written_authorization"] as const;
export type AuthorityKind = (typeof AUTHORITY_KINDS)[number];

/**
 * The payer's authority. A NOTE since decision 16: Finance reads it beside
 * each invoice and it refuses nothing. The legal risk stays logged.
 */
export interface PayerAuthority {
  kind: AuthorityKind;
  /** YYYY-MM-DD of the signed agreement or the written authorization. */
  date: string | null;
  routes: PayRoute[];
  monthlyCeilingMinor: number | null;
  ceilingCurrency: string | null;
  filedWhere: string | null;
}

export interface Payer {
  key: string;
  legalName: string;
  address: string;
  taxId: string | null;
  /** ISO 3166 alpha-2. */
  country: string;
  currencies: string[];
  /** Where invoices go: an email address or a link. */
  invoiceTo: string;
  /** Who is copied on each invoice: email addresses, data only (decision 21). */
  invoiceCc: string[];
  /** Off means no invoice may be sent to this payer. */
  invoicing: boolean;
  /** The routes this payer pays. */
  routes: PayRoute[];
  authority: PayerAuthority;
  /** A line Finance reads on the queue, such as where the money must come from. */
  queueNote: string | null;
}

export interface PayersDoc {
  payers: Payer[];
}

/** Platform defaults: EMPTY (decision 22). */
export const EMPTY_PAYERS: PayersDoc = { payers: [] };

function reqText(v: unknown, max: number, what: string): Parsed<string> {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!t) return { ok: false, field: what, error: `Each payer needs ${what}.` };
  if (t.length > max) return { ok: false, field: what, error: `A payer's ${what} runs to ${max} characters at most.` };
  return { ok: true, value: t };
}

/** Read the payers document, from storage or from `PUT /api/moon-review/payers`. */
export function parsePayers(raw: unknown): Parsed<PayersDoc> {
  if (raw === undefined || raw === null) return { ok: true, value: EMPTY_PAYERS };
  if (!isObj(raw)) return { ok: false, field: "payers", error: "The payers document is a list of payers." };
  const list = Array.isArray(raw.payers) ? raw.payers : [];
  if (list.length > LIMITS.payers) return { ok: false, field: "payers", error: `The document holds ${LIMITS.payers} payers at most.` };
  const payers: Payer[] = [];
  for (const p of list) {
    if (!isObj(p)) return { ok: false, field: "payers", error: "Each payer is a set of fields." };
    const key = String(p.key ?? "");
    if (!PAYER_KEY.test(key)) return { ok: false, field: "key", error: "A payer's key is lowercase letters, digits and hyphens." };
    if (payers.some((x) => x.key === key)) return { ok: false, field: "key", error: "Two payers share a key." };
    const legalName = reqText(p.legalName, LIMITS.payerText, "a legal name");
    if (!legalName.ok) return legalName;
    const address = reqText(p.address, LIMITS.payerText, "an address");
    if (!address.ok) return address;
    const invoiceTo = reqText(p.invoiceTo, LIMITS.payerText, "a place invoices go");
    if (!invoiceTo.ok) return invoiceTo;
    const cc = Array.isArray(p.invoiceCc) ? Array.from(new Set(p.invoiceCc.map((c) => String(c).trim()).filter(Boolean))) : [];
    if (cc.length > LIMITS.invoiceCc) return { ok: false, field: "invoiceCc", error: `A payer copies ${LIMITS.invoiceCc} addresses at most.` };
    if (cc.some((c) => !EMAIL_RE.test(c))) return { ok: false, field: "invoiceCc", error: "Each copied address is an email address." };
    const country = String(p.country ?? "").trim().toUpperCase();
    if (!COUNTRY_RE.test(country)) return { ok: false, field: "country", error: "A payer's country is a two-letter code." };
    const currencies = Array.isArray(p.currencies) ? Array.from(new Set(p.currencies.map((c) => String(c).toUpperCase()))) : [];
    if (currencies.length === 0 || currencies.some((c) => !CURRENCY_RE.test(c))) return { ok: false, field: "currencies", error: "A payer pays in one or more three-letter currencies." };
    const routes = (Array.isArray(p.routes) ? p.routes : []).filter(isPayRoute).filter((r) => INVOICING_ROUTES.includes(r));
    const taxId = optText(p.taxId, 60, "taxId");
    if (!taxId.ok) return taxId;
    const note = optText(p.queueNote, LIMITS.payerNote, "note");
    if (!note.ok) return note;
    const a = isObj(p.authority) ? p.authority : {};
    const kind = (AUTHORITY_KINDS as readonly unknown[]).includes(a.kind) ? (a.kind as AuthorityKind) : "none";
    const aDate = optDate(a.date, "authority");
    if (!aDate.ok) return aDate;
    const ceiling = a.monthlyCeilingMinor === undefined || a.monthlyCeilingMinor === null ? null : Number(a.monthlyCeilingMinor);
    if (ceiling !== null && (!Number.isInteger(ceiling) || ceiling < 0)) return { ok: false, field: "authority", error: "A monthly ceiling is a whole number of minor units." };
    const filed = optText(a.filedWhere, LIMITS.payerText, "note");
    if (!filed.ok) return filed;
    payers.push({
      key,
      legalName: legalName.value,
      address: address.value,
      taxId: taxId.value,
      country,
      currencies,
      invoiceTo: invoiceTo.value,
      invoiceCc: cc,
      invoicing: p.invoicing === true,
      routes,
      authority: {
        kind,
        date: aDate.value,
        routes: (Array.isArray(a.routes) ? a.routes : []).filter(isPayRoute),
        monthlyCeilingMinor: ceiling,
        ceilingCurrency: typeof a.ceilingCurrency === "string" && CURRENCY_RE.test(a.ceilingCurrency.toUpperCase()) ? a.ceilingCurrency.toUpperCase() : null,
        filedWhere: filed.value,
      },
      queueNote: note.value,
    });
  }
  return { ok: true, value: { payers } };
}

/** The payer for a route: the member's chosen one when it pays that route, else the only one that does. */
export function payerForRoute(doc: PayersDoc, route: PayRoute, chosenKey: string | null): Payer | null {
  const paying = doc.payers.filter((p) => p.routes.includes(route));
  if (chosenKey) return paying.find((p) => p.key === chosenKey) ?? null;
  return paying.length === 1 ? paying[0] : null;
}

/** The authority note Finance reads beside an invoice. Never a refusal. */
export function authorityNote(p: Payer): string {
  const a = p.authority;
  if (a.kind === "none") return "No authority is recorded for this payer.";
  const what = a.kind === "bridge_agreement" ? "Bridge agreement signed" : "Written authorization given";
  const when = a.date ? ` on ${dayWords(a.date)}` : "";
  const ceiling = a.monthlyCeilingMinor !== null && a.ceilingCurrency ? `, up to ${moneyWords(a.monthlyCeilingMinor, a.ceilingCurrency)} a month` : "";
  const filed = a.filedWhere ? `. Filed: ${a.filedWhere}` : "";
  return `${what}${when}${ceiling}${filed}.`;
}

/** Old and new values for every payer field a `PUT` changed, for the event note. */
export function payersChanges(before: PayersDoc, after: PayersDoc): Array<{ key: string; field: string; from: unknown; to: unknown }> {
  const out: Array<{ key: string; field: string; from: unknown; to: unknown }> = [];
  const keys = Array.from(new Set([...before.payers.map((p) => p.key), ...after.payers.map((p) => p.key)]));
  for (const k of keys) {
    const a = before.payers.find((p) => p.key === k) as Record<string, unknown> | undefined;
    const b = after.payers.find((p) => p.key === k) as Record<string, unknown> | undefined;
    if (!a || !b) {
      out.push({ key: k, field: "*", from: a ?? null, to: b ?? null });
      continue;
    }
    for (const f of Object.keys({ ...a, ...b })) if (canonicalJson(a[f]) !== canonicalJson(b[f])) out.push({ key: k, field: f, from: a[f] ?? null, to: b[f] ?? null });
  }
  return out;
}

/** The Bill to block on the invoice. */
export interface BillTo {
  payerKey: string;
  legalName: string;
  address: string;
  taxId: string | null;
  /** To, beside the work summary. */
  invoiceTo: string;
  /** Cc, beside the work summary. */
  invoiceCc: string[];
}

export function billToOf(p: Payer): BillTo {
  return { payerKey: p.key, legalName: p.legalName, address: p.address, taxId: p.taxId, invoiceTo: p.invoiceTo, invoiceCc: [...p.invoiceCc] };
}

/** The From block: the member's legal name and address. No tax id. */
export interface FromBlock {
  legalName: string;
  address: string;
}

// ── Invoice lines from terms ─────────────────────────────────────────────────

/** One adopted seat application in force this moon, with the roles it covers. */
export interface TermsInForce {
  applicationId: string;
  /** Its first assignment id: the cash owed key's seat part. */
  firstSeatId: string;
  roleIds: string[];
  roleNames: string[];
  settings: SeatSettings | null;
  deliverables: string | null;
  /** Days of the moon the member held any role this application covers. */
  daysHeld: number;
}

export const LINE_BASES = ["per_moon", "per_month", "range", "allowance", "listed"] as const;
export type LineBasis = (typeof LINE_BASES)[number];

export const LINE_BASIS_WORDS: Record<LineBasis, string> = {
  per_moon: "Fixed per moon",
  per_month: "Fixed per month, prorated by days",
  range: "A range",
  allowance: "Allowance",
  listed: "Listed, no cash",
};

export interface InvoiceLine {
  /** `<application id>` for pay, `<application id>:allowance` for an allowance. */
  key: string;
  applicationId: string;
  firstSeatId: string;
  kind: "pay" | "allowance";
  roleIds: string[];
  roleNames: string[];
  basis: LineBasis;
  /** The words a pay kind carries when it moves no cash: honorary, in-kind, deferred, none. */
  listedAs: string | null;
  currency: string | null;
  /** The terms' amount, per `per`. */
  termsMinor: number | null;
  per: "month" | "moon" | null;
  range: { minMinor: number; maxMinor: number } | null;
  /** A range: what the member proposes, per `per`, inside the range. */
  proposedMinor: number | null;
  /** A range: what Finance sets, per `per`. */
  finalMinor: number | null;
  daysInMoon: number;
  daysHeld: number;
  /** The line's amount, rounded once. Null for a listed line or an unset range. */
  amountMinor: number | null;
  /** The arithmetic, shown on the line. */
  basisLine: string;
  /** Approved item ids under this line, filled at approval. */
  approvedItemIds: string[];
  /** The cash owed row this line wrote, filled at Finance approval. */
  cashOwedId: string | null;
  /** A range line the member asked to talk about is held. */
  held: boolean;
}

/** The days in a year a monthly amount is spread over. */
export const DAYS_PER_YEAR = 365.25;

/** An amount per `per`, prorated to the days held. Rounded once. */
export function prorate(minor: number, per: "month" | "moon", daysHeld: number, daysInMoon: number): number {
  if (per === "month") return Math.round((minor * 12 * daysHeld) / DAYS_PER_YEAR);
  return Math.round((minor * daysHeld) / Math.max(1, daysInMoon));
}

function basisLineWords(minor: number, currency: string, per: "month" | "moon", daysHeld: number, daysInMoon: number): string {
  const amount = moneyWords(minor, currency);
  if (per === "month") return `${amount} a month x 12 / 365.25 x ${daysHeld} days`;
  if (daysHeld >= daysInMoon) return `${amount} per moon`;
  return `${amount} per moon, held ${daysHeld} of ${daysInMoon} days`;
}

/**
 * THE LINES OF A DRAFT INVOICE. One pay line per application in force, never
 * one per role: an application covering three roles records its pay once,
 * and its line names all three. An allowance is its own line. A pay kind that
 * moves no cash is listed. An application with no amount or no currency
 * makes no line, and the page says `NO_TERMS`.
 */
export function linesFromTerms(terms: readonly TermsInForce[], moon: Pick<MoonDays, "days">, proposals: Readonly<Record<string, number>> = {}, finals: Readonly<Record<string, number>> = {}): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  for (const t of terms) {
    const base = { applicationId: t.applicationId, firstSeatId: t.firstSeatId, roleIds: [...t.roleIds], roleNames: [...t.roleNames], daysInMoon: moon.days, daysHeld: Math.min(t.daysHeld, moon.days), approvedItemIds: [] as string[], cashOwedId: null, held: false };
    const pay = t.settings?.pay;
    if (pay && pay.kind !== "fixed" && pay.kind !== "range") {
      out.push({ ...base, key: t.applicationId, kind: "pay", basis: "listed", listedAs: pay.kind, currency: null, termsMinor: null, per: null, range: null, proposedMinor: null, finalMinor: null, amountMinor: null, basisLine: LISTED_WORDS[pay.kind] ?? LISTED_WORDS.none });
    } else if (pay && pay.currency && pay.kind === "fixed" && Number.isInteger(pay.amountMinor) && (pay.amountMinor as number) > 0) {
      const per = pay.per ?? "moon";
      const amount = pay.amountMinor as number;
      out.push({ ...base, key: t.applicationId, kind: "pay", basis: per === "month" ? "per_month" : "per_moon", listedAs: null, currency: pay.currency, termsMinor: amount, per, range: null, proposedMinor: null, finalMinor: null, amountMinor: prorate(amount, per, base.daysHeld, moon.days), basisLine: basisLineWords(amount, pay.currency, per, base.daysHeld, moon.days) });
    } else if (pay && pay.currency && pay.kind === "range" && Number.isInteger(pay.minMinor) && Number.isInteger(pay.maxMinor)) {
      const per = pay.per ?? "moon";
      const range = { minMinor: pay.minMinor as number, maxMinor: pay.maxMinor as number };
      const proposed = proposals[t.applicationId];
      const proposedMinor = Number.isInteger(proposed) && proposed >= range.minMinor && proposed <= range.maxMinor ? proposed : null;
      const fin = finals[t.applicationId];
      const finalMinor = Number.isInteger(fin) && fin >= 0 ? fin : null;
      const chosen = finalMinor ?? proposedMinor;
      out.push({ ...base, key: t.applicationId, kind: "pay", basis: "range", listedAs: null, currency: pay.currency, termsMinor: null, per, range, proposedMinor, finalMinor, amountMinor: chosen === null ? null : prorate(chosen, per, base.daysHeld, moon.days), basisLine: `${moneyWords(range.minMinor, pay.currency)} to ${moneyWords(range.maxMinor, pay.currency)} ${per === "month" ? "a month" : "per moon"}${chosen === null ? "" : `. ${basisLineWords(chosen, pay.currency, per, base.daysHeld, moon.days)}`}` });
    }
    const al = t.settings?.allowance;
    if (al && al.kind === "flat" && al.currency && Number.isInteger(al.amountMinor) && (al.amountMinor as number) > 0) {
      const per = al.per ?? "moon";
      const amount = al.amountMinor as number;
      out.push({ ...base, key: `${t.applicationId}:allowance`, kind: "allowance", basis: "allowance", listedAs: null, currency: al.currency, termsMinor: amount, per, range: null, proposedMinor: null, finalMinor: null, amountMinor: prorate(amount, per, base.daysHeld, moon.days), basisLine: basisLineWords(amount, al.currency, per, base.daysHeld, moon.days) });
    }
  }
  return out;
}

const LISTED_WORDS: Record<string, string> = {
  none: "No cash",
  honorary: "Honorary, no cash",
  "in-kind": "In kind, no cash",
  deferred: "Deferred, no cash",
};

/** A line that carries money: an amount above zero in a currency. */
export function isPayableLine(l: InvoiceLine): boolean {
  return !l.held && l.currency !== null && l.amountMinor !== null && l.amountMinor > 0;
}

/** Does any of these terms carry money? Decides whether the invoice part shows. */
export function termsCarryMoney(terms: readonly TermsInForce[]): boolean {
  return terms.some((t) => {
    const p = t.settings?.pay;
    const a = t.settings?.allowance;
    return (!!p && (p.kind === "fixed" || p.kind === "range") && !!p.currency) || (!!a && a.kind === "flat" && !!a.currency);
  });
}

/** The total, the sum of the rounded lines, per currency. */
export function invoiceTotals(lines: readonly InvoiceLine[]): Array<{ currency: string; minor: number }> {
  const by = new Map<string, number>();
  for (const l of lines) if (isPayableLine(l)) by.set(l.currency as string, (by.get(l.currency as string) ?? 0) + (l.amountMinor as number));
  return Array.from(by, ([currency, minor]) => ({ currency, minor })).sort((a, b) => a.currency.localeCompare(b.currency));
}

// ── Sends and approvals: the refusals ────────────────────────────────────────

export interface InvoiceSendFacts {
  route: PayRoute;
  payer: Payer | null;
  lines: readonly InvoiceLine[];
  attestation: Parsed<MoonAttestation> | null;
  pilotAckVersion: string | null;
  /** The village's settings and payers, for `setupGaps` and the acknowledgement's version. */
  settings: MoonReviewSettings;
  payers: PayersDoc;
  /** The member's own invoice number, typed at send (decision 16 revised). */
  memberNumber: string | null;
  /** The electronic invoice key, needed on the contractor route. */
  externalInvoiceKey: string | null;
  /** The member's numbers already used on other invoices, Void ones included. */
  usedNumbers?: readonly string[];
}

/**
 * Why a draft invoice may not be sent, in one sentence, or null. A recap
 * needs none of this: it sends with no pay route at all.
 */
export function invoiceSendRefusal(f: InvoiceSendFacts): string | null {
  if (setupGaps(f.payers, f.settings).length > 0) return SEND_REFUSALS.notConfigured;
  if (f.route === "pending") return SEND_REFUSALS.pending;
  if (f.route === "visitor") return SEND_REFUSALS.visitor;
  if (f.route === "local_employee") return SEND_REFUSALS.employee;
  if (!f.payer) return SEND_REFUSALS.noPayer;
  if (!f.payer.invoicing) return SEND_REFUSALS.invoicingOff;
  if (!f.lines.some(isPayableLine)) return SEND_REFUSALS.noPayableLine;
  if (invoiceTotals(f.lines).length > 1) return SEND_REFUSALS.twoCurrencies;
  if (!f.attestation || !f.attestation.ok) return f.attestation && !f.attestation.ok ? f.attestation.error : ATTESTATION_MISSING;
  if (f.pilotAckVersion !== f.settings.pilotAck?.version) return SEND_REFUSALS.pilotAck;
  const numberProblem = memberNumberProblem(f.memberNumber);
  if (numberProblem) return numberProblem;
  if (f.usedNumbers?.includes((f.memberNumber as string).trim())) return SEND_REFUSALS.numberUsed;
  if (f.route === "local_contractor") {
    if (!f.externalInvoiceKey) return SEND_REFUSALS.externalKey;
    const keyProblem = externalInvoiceKeyProblem(f.externalInvoiceKey);
    if (keyProblem) return keyProblem;
  }
  return null;
}

export const SEND_REFUSALS = {
  pending: "Choose your pay route before you send an invoice. Your recap sends without one.",
  visitor: "Work done on a visitor entry, or with a status application still pending, carries no paid line. Your recap still counts.",
  notConfigured: "Name who you pay first. A cash power holder fills in the payers and the village settings on the Cash payouts desk. Your recap still sends.",
  employee: "Employees are paid through payroll, so there is no invoice to send. Your recap still counts.",
  noPayer: "No payer pays your route yet. Finance has been told.",
  invoicingOff: "Invoicing is off for this payer. Finance has been told.",
  noPayableLine: "There is no line that carries money this moon, so there is no invoice to send.",
  twoCurrencies: "These lines carry two currencies. Finance splits them before the invoice can go.",
  pilotAck: "Read and accept the pilot note before you send this invoice.",
  numberMissing: "Type the number of the invoice you issued, so Finance can match it to this one.",
  numberUsed: "You have used this invoice number before. A new invoice takes a new number.",
  externalKey: "Type the key of the electronic invoice you issued.",
} as const;

/**
 * What one person holds, read from their own seats and never from the admin
 * short-circuit or a badge. The caller counts live holders the way
 * `liveHoldersOfCapability` does.
 */
export interface ApproverKeys {
  userId: string;
  approve: boolean;
  pay: boolean;
  alone: boolean;
  own: boolean;
}

export type ApprovalDecision =
  | { ok: true; selfApproved: boolean; alone: boolean }
  | { ok: false; refusal: string };

/**
 * THE ONE APPROVAL RULE: may this person give this approval on this recap?
 *
 *   own recap      only with `moon.approve_own`, for either stage, marked
 *                  `selfApproved`. `moon.approve_alone` never covers it.
 *   work stage     `moon.approve`, or `moon.approve_alone`, or `cash.pay`
 *                  when no other `moon.approve` holder can.
 *   invoice stage  `cash.pay` or `moon.approve_alone`; the person who
 *                  approved the work may give it only with
 *                  `moon.approve_alone` (or on their own recap with
 *                  `moon.approve_own`), and then `alone` is true.
 *
 * Every other check (route, attestation, tax form, hash) still runs after
 * this one passes.
 */
export function approvalDecision(f: {
  stage: ApprovalStage;
  actor: ApproverKeys;
  memberUserId: string;
  workApprovedBy: string | null;
  /** Live `moon.approve` holders, for the `cash.pay` fallback on work. */
  approveHolders: readonly string[];
}): ApprovalDecision {
  const a = f.actor;
  const own = a.userId === f.memberUserId;
  if (own) {
    if (!a.own) return { ok: false, refusal: APPROVAL_REFUSALS.own };
    const holds = f.stage === "work" ? a.approve || a.pay || a.alone : a.pay || a.alone;
    if (!holds) return { ok: false, refusal: APPROVAL_REFUSALS.noKey };
    return { ok: true, selfApproved: true, alone: f.stage === "invoice" && f.workApprovedBy === a.userId };
  }
  if (f.stage === "work") {
    const holds = a.approve || a.alone || (a.pay && f.approveHolders.every((u) => u === f.memberUserId));
    return holds ? { ok: true, selfApproved: false, alone: false } : { ok: false, refusal: APPROVAL_REFUSALS.noKey };
  }
  if (!(a.pay || a.alone)) return { ok: false, refusal: APPROVAL_REFUSALS.noKey };
  const same = !!f.workApprovedBy && f.workApprovedBy === a.userId;
  if (same && !a.alone) return { ok: false, refusal: APPROVAL_REFUSALS.sameApprover };
  return { ok: true, selfApproved: false, alone: same };
}

/** The live holders of each key, for the queue's "who can give each approval". */
export interface ApproverPool {
  approve: readonly string[];
  pay: readonly string[];
  alone: readonly string[];
  own: readonly string[];
}

/**
 * Who could give each approval on this recap, by user id. Empty means
 * nobody can, and the queue says so for the core circle to name a stand-in.
 */
export function eligibleApprovers(f: { memberUserId: string; pool: ApproverPool; workApprovedBy: string | null }): { work: string[]; invoice: string[] } {
  const keysOf = (u: string): ApproverKeys => ({ userId: u, approve: f.pool.approve.includes(u), pay: f.pool.pay.includes(u), alone: f.pool.alone.includes(u), own: f.pool.own.includes(u) });
  const people = Array.from(new Set([...f.pool.approve, ...f.pool.pay, ...f.pool.alone, ...f.pool.own]));
  const can = (stage: ApprovalStage) => people.filter((u) => approvalDecision({ stage, actor: keysOf(u), memberUserId: f.memberUserId, workApprovedBy: f.workApprovedBy, approveHolders: f.pool.approve }).ok);
  return { work: can("work"), invoice: can("invoice") };
}

/** What the invoice, the events and the payouts desk say about a self-approval. */
export const SELF_APPROVED_WORDS = "Approved by the member themselves";

export interface FinanceCheckFacts {
  route: PayRouteRecord;
  settings: MoonReviewSettings;
  attestation: MoonAttestation | null;
  moonLastDay: string;
  expectedOn: string;
}

/**
 * Why Finance may not approve an invoice, or why it is held for Finance to
 * decide with the accountant. Payer authority is a note, never a refusal
 * (decision 16).
 */
export function financeApprovalRefusal(f: FinanceCheckFacts): { refusal: string } | { hold: string } | null {
  if (!f.route.confirmedAt || !f.route.confirmedBy) return { refusal: FINANCE_REFUSALS.unconfirmed };
  if (f.route.route === "nomad" && (!f.route.statusValidUntil || f.route.statusValidUntil < f.moonLastDay)) return { refusal: FINANCE_REFUSALS.nomadEnded };
  if (f.attestation?.visitorEntryWork) return { refusal: FINANCE_REFUSALS.visitorEntry };
  if (f.settings.taxFormRoutes.includes(f.route.route) && !taxFormValidOn(f.route, f.expectedOn)) return { refusal: FINANCE_REFUSALS.taxForm };
  if (!DATE_RE.test(f.expectedOn)) return { refusal: FINANCE_REFUSALS.expectedOn };
  const hold = f.settings.holds.find((h) => h.taxFormKey === f.route.taxFormKind && !!f.attestation?.workCountries.includes(h.workCountry));
  if (hold) return { hold: `${FINANCE_REFUSALS.held} ${hold.note}` };
  return null;
}

export const APPROVAL_REFUSALS = {
  own: "Nobody approves their own recap.",
  sameApprover: "The work and the invoice are approved by two different people.",
  notWaiting: "This recap is not waiting on this approval.",
  workFirst: "The work is approved first, then the invoice.",
  noKey: "This approval needs a role holding the power to give it. An admin cannot stand in.",
  hashChanged: "The recap changed after it was read. Open it again before you approve.",
} as const;

export const FINANCE_REFUSALS = {
  unconfirmed: "The pay route is not confirmed yet. Another person holding the cash power confirms it.",
  nomadEnded: "The nomad status ends before the moon's last day.",
  visitorEntry: "Invoiced work was done in the host country on a visitor entry, so it carries no paid line.",
  taxForm: "The tax form is not valid on the expected payment date.",
  expectedOn: "Set the expected payment date.",
  held: "Held for Finance to decide with the accountant.",
  rowExists: "A cash owed row already holds this key and this invoice did not write it",
} as const;

/** The sentence when a cash owed row already holds the key an approval would write. */
export function rowExistsRefusal(rowId: string): string {
  return `${FINANCE_REFUSALS.rowExists}: ${rowId}.`;
}

export const CONFIRM_OWN_ROUTE_REFUSED = "Nobody confirms their own pay route.";

/**
 * Decision 16 revised: Finance changing a range amount sends the invoice back
 * to the member, who voids and reissues their own invoice before approval.
 */
export function rangeChangedNote(roleNames: readonly string[], amount: string): string {
  return `Finance set ${amount} on the line for ${roleNames.join(", ")}. Void your own invoice, issue a new one with this figure, and send it again with its new number.`;
}

// ── The approval hash ────────────────────────────────────────────────────────

export interface ApprovalSubject {
  payerKey: string | null;
  route: PayRoute | null;
  currency: string | null;
  from: FromBlock | null;
  lines: ReadonlyArray<Pick<InvoiceLine, "key" | "applicationId" | "basis" | "currency" | "amountMinor" | "daysHeld" | "finalMinor" | "proposedMinor">>;
  /** The kept, not returned, items: id, text, role, accountability, goals, visibility. */
  items: ReadonlyArray<Pick<RecapItem, "id" | "text" | "roleId" | "accountabilityWords" | "seasonGoalId" | "ownGoalWords" | "visibility" | "evidenceUrl" | "proofInSummary">>;
}

/** The canonical bytes an approval binds to. Any change to these clears both approvals. */
export function approvalSubjectBytes(s: ApprovalSubject): string {
  return canonicalJson({
    payerKey: s.payerKey,
    route: s.route,
    currency: s.currency,
    from: s.from,
    lines: s.lines.map((l) => ({ key: l.key, applicationId: l.applicationId, basis: l.basis, currency: l.currency, amountMinor: l.amountMinor, daysHeld: l.daysHeld, finalMinor: l.finalMinor, proposedMinor: l.proposedMinor })),
    items: [...s.items].sort((a, b) => a.id.localeCompare(b.id)).map((i) => ({ id: i.id, text: i.text, roleId: i.roleId, accountabilityWords: i.accountabilityWords, seasonGoalId: i.seasonGoalId, ownGoalWords: i.ownGoalWords, visibility: i.visibility, evidenceUrl: i.evidenceUrl, proofInSummary: i.proofInSummary })),
  });
}

/** sha256 over the approval subject, lowercase hex. Async because Web Crypto is. */
export async function approvalHash(s: ApprovalSubject): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new Error("approvalHash needs Web Crypto, which this runtime does not provide");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(approvalSubjectBytes(s)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Invoice numbers ──────────────────────────────────────────────────────────

/**
 * The member's own invoice number, from the invoice they issued themselves:
 * letters, digits, spaces and . _ / - only, up to 40 characters. It has its
 * own check for the reason the electronic key does: the payment-details check
 * refuses runs of eight or more digits, and invoice numbers can carry them.
 */
export function memberNumberProblem(n: string | null | undefined): string | null {
  const t = String(n ?? "").trim();
  if (!t) return SEND_REFUSALS.numberMissing;
  if (t.length > LIMITS.memberNumber || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(t)) return "An invoice number is letters, digits and . _ / - only, up to 40 characters.";
  return null;
}

/** The payer's record of an invoice: "<payer key>-0042". */
export function billRef(payerKey: string, seq: number): string {
  return `${payerKey}-${String(seq).padStart(4, "0")}`;
}

/**
 * An electronic invoice key is digits only. It has its own check because the
 * payment-details check refuses runs of eight or more digits.
 */
export function externalInvoiceKeyProblem(key: string): string | null {
  return /^\d{1,64}$/.test(key) ? null : "An electronic invoice key is digits only, up to 64 of them.";
}

// ── The work summary ─────────────────────────────────────────────────────────

export interface SummaryInput {
  firstDay: string;
  lastDay: string;
  memberNumber: string;
  recapId: string;
  memberLegalName: string;
  billToName: string;
  lines: ReadonlyArray<Pick<InvoiceLine, "roleNames" | "approvedItemIds" | "kind">>;
  items: ReadonlyArray<Pick<RecapItem, "id" | "text" | "accountabilityWords" | "evidenceUrl" | "proofInSummary" | "seasonGoalId" | "ownGoalWords" | "review" | "state">>;
  seasonGoals: readonly SeasonGoalRef[];
  /** YYYY-MM-DD, the day the second approval was given. */
  approvedOn: string;
  /** A4: the `READING:` line, when the caller has one. */
  reading?: Reading | null;
  /** A7: the THANK YOU section from `thankYouLines`, when the caller includes it. */
  thankYou?: readonly string[];
}

interface SummaryBlock {
  roles: string;
  groups: Array<{ heading: string; items: Array<{ text: string; proof: string | null }> }>;
}

function summaryBlocks(s: SummaryInput): { blocks: SummaryBlock[]; goals: string; own: string } {
  const byId = new Map(s.items.map((i) => [i.id, i]));
  const used: Array<SummaryInput["items"][number]> = [];
  const blocks: SummaryBlock[] = [];
  for (const l of s.lines) {
    if (l.kind !== "pay") continue;
    const items = l.approvedItemIds.map((id) => byId.get(id)).filter((i): i is SummaryInput["items"][number] => !!i && i.state === "kept" && i.review === "approved");
    if (items.length === 0) continue;
    used.push(...items);
    const groups: SummaryBlock["groups"] = [];
    for (const i of items) {
      const heading = i.accountabilityWords ?? "Deliverables";
      let g = groups.find((x) => x.heading === heading);
      if (!g) groups.push((g = { heading, items: [] }));
      g.items.push({ text: i.text, proof: i.proofInSummary && i.evidenceUrl ? i.evidenceUrl : null });
    }
    blocks.push({ roles: l.roleNames.join(", "), groups });
  }
  const goalCounts = s.seasonGoals.map((g) => ({ words: g.words, n: used.filter((i) => matchSeasonGoal(i.seasonGoalId, s.seasonGoals)?.id === g.id).length })).filter((g) => g.n > 0);
  const own = new Map<string, number>();
  for (const i of used) if (i.ownGoalWords) own.set(i.ownGoalWords, (own.get(i.ownGoalWords) ?? 0) + 1);
  return {
    blocks,
    goals: goalCounts.map((g) => `${g.words} (${g.n})`).join(", "),
    own: Array.from(own, ([w, n]) => `${w} (${n})`).join(", "),
  };
}

/**
 * THE WORK SUMMARY, as plain text. Only the invoiced lines and their approved
 * items; Outside my roles and returned items stay in the village's record.
 * Proof links only where the member ticked them. No amounts: the invoice
 * carries those, and a payer checks approval against the bill ref.
 */
export function workSummaryText(s: SummaryInput): string {
  const { blocks, goals, own } = summaryBlocks(s);
  const out = [`Work summary, ${periodWords(s.firstDay, s.lastDay)}`, `Invoice ${s.memberNumber} · Recap ${s.recapId}`, `${s.memberLegalName}, for ${s.billToName}`];
  for (const b of blocks) {
    out.push("", b.roles);
    for (const g of b.groups) {
      out.push(`- ${g.heading}: ${g.items.map((i) => (i.proof ? `${i.text} (proof: ${i.proof})` : i.text)).join("; ")}`);
    }
  }
  out.push("");
  if (goals) out.push(`Season goals served: ${goals}`);
  if (own) out.push(`My seasonal goals: ${own}`);
  if (goals || own) out.push("");
  if (s.reading) out.push(readingLine(s.reading), "");
  if (s.thankYou && s.thankYou.length > 0) out.push(...s.thankYou, "");
  out.push(`Approved by the Operations and Finance roles on ${dayWords(s.approvedOn)}`);
  return out.join("\n");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The same summary for email: the proof links stay clickable. */
export function workSummaryHtml(s: SummaryInput): string {
  const { blocks, goals, own } = summaryBlocks(s);
  const p = (t: string) => `<p>${t}</p>`;
  const out = [p(`Work summary, ${esc(periodWords(s.firstDay, s.lastDay))}<br>Invoice ${esc(s.memberNumber)} · Recap ${esc(s.recapId)}<br>${esc(s.memberLegalName)}, for ${esc(s.billToName)}`)];
  for (const b of blocks) {
    out.push(p(esc(b.roles)));
    out.push(`<ul>${b.groups.map((g) => `<li>${esc(g.heading)}: ${g.items.map((i) => (i.proof ? `${esc(i.text)} (<a href="${esc(i.proof)}">proof</a>)` : esc(i.text))).join("; ")}</li>`).join("")}</ul>`);
  }
  if (goals) out.push(p(`Season goals served: ${esc(goals)}`));
  if (own) out.push(p(`My seasonal goals: ${esc(own)}`));
  out.push(p(`Approved by the Operations and Finance roles on ${esc(dayWords(s.approvedOn))}`));
  return out.join("\n");
}

// ── Moon rhythm reminders (B1) ───────────────────────────────────────────────

/** One row per member, cycle and kind in `moon_nudges`: the insert is the claim. */
export const NUDGE_KINDS = ["eom_prep", "eom_day", "halfway"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** The notification preference category members opt out of. */
export const NUDGE_CATEGORY = "moon";

export const NUDGE_WORDS: Record<NudgeKind, string> = {
  eom_prep: "The end-of-moon walkthrough is coming. Start in My moon, or ask Claude \"What's my monthly recap?\". Tap Done on your task board as you go, and your recap starts already marked.",
  eom_day: "Today is the end-of-moon walkthrough. Your recap is still a draft: open My moon to finish it.",
  halfway: "The moon is halfway. Open My moon for the Halfway card. Tap Done on your task board as you go, and your recap starts already marked.",
};

/** A reminder's words, with the guide's worksheet when the village has set one, and nothing about it when not. */
export function nudgeText(kind: NudgeKind, rhythm: Pick<RhythmDoc, "guideUrl">): string {
  const sheet = guideSheetLink(rhythm);
  return sheet ? `${NUDGE_WORDS[kind]} The worksheet: ${sheet}` : NUDGE_WORDS[kind];
}

/** The notification key for one reminder (B1): sent once per cycle, kind and member. */
export function nudgeDedupeKey(cycleId: string, kind: NudgeKind, userId: string): string {
  return `moon:${cycleId}:${kind}:${userId}`;
}

/** The link My moon and the moon card show, or null when the village has set no guide. */
export const GUIDE_WORDS = { open: "Open the End of Moon guide" } as const;

// ── Events ───────────────────────────────────────────────────────────────────

export const REVIEW_EVENT_KINDS = [
  "sent", "taken_back", "work_approved", "returned", "amount_set", "range_answered", "invoice_sent",
  "invoice_approved", "paid", "void", "route_confirmed", "route_changed", "payers_changed", "settings_changed", "rhythm_changed", "self_approved", "imported",
] as const;
export type ReviewEventKind = (typeof REVIEW_EVENT_KINDS)[number];

/** One notification key per (event, recipient, round), so a resend notifies again. */
export function reviewDedupeKey(kind: string, recapId: string, round: number, recipientUserId: string): string {
  return `moon:${kind}:${recapId}:${round}:${recipientUserId}`;
}

// ── The score (decision 20, spec section 16) ─────────────────────────────────

/**
 * A score in half-points, so nothing stored is a decimal: Done counts 2
 * halves, Partly 1, Carry 0. `den` is Done + Partly + Carry.
 */
export interface Score {
  numHalves: number;
  den: number;
  /** Whole percent, or null when there is nothing to count. */
  pct: number | null;
}

export function scoreOf(numHalves: number, den: number): Score {
  return { numHalves, den, pct: den > 0 ? Math.round((numHalves / 2 / den) * 100) : null };
}

/** "12½ of 18, 69%". */
export function scoreWords(s: Score): string {
  if (s.den === 0 || s.pct === null) return "Nothing to count yet";
  const whole = Math.floor(s.numHalves / 2);
  const half = s.numHalves % 2 === 1 ? "\u00bd" : "";
  return `${whole}${half} of ${s.den}, ${s.pct}%`;
}

/** The days at the end of a moon whose new tasks count only when already done. */
export const LAST_WEEK_DAYS = 7;

export interface TaskScore extends Score {
  done: number;
  partly: number;
  carry: number;
  /** Left out of the count, and why. */
  leftOut: { letGo: number; redirect: number; lastWeekNotDone: number; olderThanMoon: number };
}

/**
 * THE TASK SCORE: (Done + half of Partly) over (Done + Partly + Carry).
 *
 *   1. This moon only: a task set before the moon's first day never counts
 *      (it is triaged once). An item with no set day was made in this recap,
 *      so it counts.
 *   2. The last week: a task set in the moon's final seven days counts only
 *      if it is Done; otherwise it moves to the next moon untouched.
 *   Let go and Redirect are left out. Dropped items and items with no status
 *   are not tasks scored this moon.
 */
export function taskScore(items: readonly Pick<RecapItem, "state" | "taskStatus" | "setOn">[], moon: Pick<MoonDays, "firstDay" | "lastDay">): TaskScore {
  const lastWeekFrom = addDays(moon.lastDay, -(LAST_WEEK_DAYS - 1));
  const out: TaskScore = { numHalves: 0, den: 0, pct: null, done: 0, partly: 0, carry: 0, leftOut: { letGo: 0, redirect: 0, lastWeekNotDone: 0, olderThanMoon: 0 } };
  for (const i of items) {
    if (i.state === "dropped" || !i.taskStatus) continue;
    if (i.setOn && i.setOn < moon.firstDay) { out.leftOut.olderThanMoon += 1; continue; }
    if (i.taskStatus === "let_go") { out.leftOut.letGo += 1; continue; }
    if (i.taskStatus === "redirect") { out.leftOut.redirect += 1; continue; }
    if (i.setOn && i.setOn >= lastWeekFrom && i.taskStatus !== "done") { out.leftOut.lastWeekNotDone += 1; continue; }
    out[i.taskStatus] += 1;
  }
  return { ...out, ...scoreOf(out.done * 2 + out.partly, out.done + out.partly + out.carry) };
}

/**
 * SEAT COVERAGE: the share of the member's role accountabilities with at
 * least one kept item this moon. Outside my roles work never counts here; it
 * counts toward season goals and feeds the role audit.
 */
export function seatCoverage(seats: readonly Pick<RoleCardForCoverage, "roleId" | "accountabilities">[], items: readonly Pick<RecapItem, "state" | "roleId" | "accountabilityWords" | "review">[]): { on: number; total: number; pct: number | null } {
  let on = 0;
  let total = 0;
  for (const r of seats) {
    for (const a of r.accountabilities) {
      total += 1;
      if (items.some((i) => i.state === "kept" && i.review !== "returned" && i.roleId === r.roleId && !!i.accountabilityWords && norm(i.accountabilityWords) === norm(a))) on += 1;
    }
  }
  return { on, total, pct: total > 0 ? Math.round((on / total) * 100) : null };
}

// ── The thank-you step (addendum v5, A7) ─────────────────────────────────────

/**
 * Each recap names who helped. A member is picked from the directory; a
 * free-text name is kept for people outside the game. Gratitude still moves
 * only when the member sends it through the gratitude flow: nothing here
 * sends or moves anything. A note follows the item visibility rule, so it
 * shows to other members only when the member chooses.
 */
export const THANKS_MAX = 10;
export const THANKS_NOTE_MAX = 200;

export interface ThanksEntry {
  userId: string | null;
  name: string | null;
  note: string | null;
  visibility: ItemVisibility;
}

export function parseThanks(raw: unknown, memberIds: readonly string[] = []): Parsed<ThanksEntry[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, field: "thanks", error: "Who helped is a list." };
  if (raw.length > THANKS_MAX) return { ok: false, field: "thanks", error: `A recap thanks ${THANKS_MAX} people at most.` };
  const out: ThanksEntry[] = [];
  for (const t of raw) {
    if (!isObj(t)) return { ok: false, field: "thanks", error: "Each thank-you names a member or a person." };
    const userId = typeof t.userId === "string" && t.userId.trim() ? t.userId.trim() : null;
    if (userId && memberIds.length > 0 && !memberIds.includes(userId)) return { ok: false, field: "thanks", error: "Pick the member from the directory." };
    const name = optText(t.name, 120, "note");
    if (!name.ok) return name;
    if (!userId && !name.value) return { ok: false, field: "thanks", error: "Each thank-you names a member or a person." };
    const note = optText(t.note, THANKS_NOTE_MAX, "note");
    if (!note.ok) return note;
    if (note.value && looksLikePaymentDetails(note.value)) return { ok: false, field: "note", error: PAYMENT_DETAILS_REFUSED };
    if (userId && out.some((x) => x.userId === userId)) continue;
    out.push({ userId, name: userId ? null : name.value, note: note.value, visibility: t.visibility === "members" ? "members" : "approvers" });
  }
  return { ok: true, value: out };
}

/** One notice per thanked member per recap. */
export function thanksDedupeKey(recapId: string, userId: string): string {
  return `moon-thanks:${recapId}:${userId}`;
}

/** The recap text's THANK YOU section. `nameOf` turns a member id into a name. */
export function thankYouLines(thanks: readonly ThanksEntry[], nameOf: (userId: string) => string, includeNotes: boolean): string[] {
  if (thanks.length === 0) return [];
  return ["THANK YOU", ...thanks.map((t) => {
    const who = t.userId ? nameOf(t.userId) : (t.name as string);
    return includeNotes && t.note ? `- ${who}: ${t.note}` : `- ${who}`;
  })];
}

export const THANKS_WORDS = {
  heading: "Who helped you this moon?",
  sendGratitude: "Send gratitude",
  notice: (name: string) => `${name} thanked you in their moon recap.`,
} as const;

// ── Reading the score (spec section 17, A4) ──────────────────────────────────

/**
 * Every score shows a named range, a plain sentence and context lines, in
 * the same words everywhere. The score never sets pay (no invoice path reads
 * it) and is never ranked (no members view or room panel returns it).
 * Each band includes its lower edge, compared on half-points so no decimal
 * drifts.
 */
export const TASK_BANDS = [
  { key: "very_full", minPct: 85, label: "Very full", says: "You finished nearly everything you set. Next moon, check your goals still stretch you, and that nothing hard was let go just to keep the number up." },
  { key: "steady", minPct: 60, label: "Steady", says: "The normal range for real work, where priorities move mid-moon. Nothing to fix." },
  { key: "pulled", minPct: 40, label: "Pulled", says: "Something took your time: work outside your roles, tasks waiting on others, or tasks too big for one moon. Name which, and shape next moon's tasks around it." },
  { key: "rethink", minPct: 0, label: "Rethink the plan", says: "Usually this points to the plan: the tasks weren't the work the village needed this moon, or you were covering an empty role. Bring it to the circle. That's what it's for." },
] as const;

/**
 * THE TWO GUARDS (addendum v5, from adversarial tests on 3 November).
 *
 *   The let-go cap: "set" is Done + Partly + Carry + Let go + Redirect and
 *   "shed" is Let go + Redirect. When shed is more than a third of set and
 *   the score is 60% or more, the reading stops at Steady with its own
 *   sentence and line. The number is shown unchanged. Without it, a 50% moon
 *   read 100% Very full by letting go of its five unfinished tasks.
 *
 *   Covering an empty role: when the score is under 60% and the member's
 *   Outside my roles items number at least max(3, Done), the reading names
 *   that, in place of Pulled or Rethink the plan. Without it, an honest
 *   member at 3 of 8 Done with 7 outside-role items read Rethink the plan.
 *
 * The addendum names the second band "Covering an empty seat"; the voice
 * gate's rule 6 refuses "seat" for a role, so the platform says "role".
 */
export const CAPPED_BAND = {
  key: "steady_capped",
  label: "Steady",
  says: "The number looks high, but much of this moon was let go or redirected.",
  line: "More than a third of the tasks set this moon were let go or redirected, so the reading stops at Steady. Each needs its reason, and each redirect its new owner.",
} as const;

export const COVERING_BAND = {
  key: "covering",
  label: "Covering an empty role",
  says: "Much of your moon went to work no role holds, which is why the task score is where it is. Bring the role to the circle so it can be filled.",
} as const;

export const SEAT_BANDS = [
  { key: "well_held", minPct: 90, label: "Role well held", says: "Nearly every accountability had work under it." },
  { key: "mostly_held", minPct: 70, label: "Mostly held", says: "One or two accountabilities were quiet. Ask whether they're still needed this season." },
  { key: "bigger", minPct: 0, label: "Role bigger than the moon", says: "Consider contracting the role, or handing an accountability to another role." },
] as const;

export type TaskBandKey = (typeof TASK_BANDS)[number]["key"];
export type SeatBandKey = (typeof SEAT_BANDS)[number]["key"];

export interface ScoreContext {
  /** Done, for the covering guard. */
  done: number;
  counted: number;
  outside: number;
  redirected: number;
  lastWeek: number;
  letGo: number;
}

export const CONTEXT_WORDS = {
  few: "Fewer than five tasks were counted, so read the score lightly.",
  outside: "Three or more items sat outside your roles. That time went where the village needed it: name it as tasks next moon, or bring the role to the circle.",
  redirected: "Three or more tasks were redirected to the people they belong to.",
  lastWeek: "Three or more tasks arrived in the final week, and wait for next moon.",
  letGo: "Three or more tasks were let go, each with its reason.",
} as const;

export interface Reading {
  band: string;
  label: string;
  says: string;
  lines: string[];
  /** The let-go cap stopped the reading at Steady; the number is unchanged. */
  capped: boolean;
}

/** The task score's reading: its band, its sentence and its context lines. Null when nothing was counted. */
export function readingOf(score: Pick<Score, "numHalves" | "den">, context: ScoreContext): Reading | null {
  if (score.den <= 0) return null;
  let band: { key: string; label: string; says: string } = TASK_BANDS.find((b) => score.numHalves * 100 >= b.minPct * score.den * 2) ?? TASK_BANDS[TASK_BANDS.length - 1];
  const lines: string[] = [];
  const atLeast60 = score.numHalves * 100 >= 60 * score.den * 2;
  const shed = context.letGo + context.redirected;
  const set = context.counted + shed;
  let capped = false;
  if (atLeast60 && shed * 3 > set) {
    band = CAPPED_BAND;
    capped = true;
    lines.push(CAPPED_BAND.line);
  } else if (!atLeast60 && context.outside >= Math.max(3, context.done)) {
    band = COVERING_BAND;
  }
  if (context.counted < 5) lines.push(CONTEXT_WORDS.few);
  if (context.outside >= 3) lines.push(CONTEXT_WORDS.outside);
  if (context.redirected >= 3) lines.push(CONTEXT_WORDS.redirected);
  if (context.lastWeek >= 3) lines.push(CONTEXT_WORDS.lastWeek);
  if (context.letGo >= 3) lines.push(CONTEXT_WORDS.letGo);
  return { band: band.key, label: band.label, says: band.says, lines, capped };
}

/** Role coverage's reading. Null when the member's roles list no accountabilities. */
export function seatReadingOf(on: number, total: number): Reading | null {
  if (total <= 0) return null;
  const band = SEAT_BANDS.find((b) => on * 100 >= b.minPct * total) ?? SEAT_BANDS[SEAT_BANDS.length - 1];
  return { band: band.key, label: band.label, says: band.says, lines: [], capped: false };
}

/** The context a task score is read in, from the same items `taskScore` counted. */
export function scoreContextOf(t: TaskScore, outsideItems: number): ScoreContext {
  return { done: t.done, counted: t.den, outside: outsideItems, redirected: t.leftOut.redirect, lastWeek: t.leftOut.lastWeekNotDone, letGo: t.leftOut.letGo };
}

/** The `READING:` line the recap text and the work summary carry. */
export function readingLine(r: Reading): string {
  return `READING: ${r.label}. ${r.says}`;
}

// ── Moon goals (decision 20) ─────────────────────────────────────────────────

export const GOAL_STATUSES = ["open", "done", "partly", "carried", "let_go"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_STATUS_WORDS: Record<GoalStatus, string> = {
  open: "Open",
  done: "Done",
  partly: "Partly",
  carried: "Carry",
  let_go: "Let go",
};

/** Each member sets three to five goals for the next moon. */
export const GOALS_MIN = 3;
export const GOALS_MAX = 5;
/** A goal carried this many times is flagged for the circle. */
export const CARRY_FLAG_AT = 2;

export interface MoonGoal {
  id: string;
  userId: string;
  cycleId: string;
  position: number;
  text: string;
  doneWhen: string | null;
  seasonGoalId: string | null;
  status: GoalStatus;
  letGoReason: string | null;
  carriedFromId: string | null;
  carryCount: number;
  setAt: string | null;
  scoredAt: string | null;
}

/**
 * THE GOAL SCORE, the task formula over the member's moon goals. Let go is
 * left out. An Open goal has not been scored yet and is left out too, and
 * `unscored` says how many.
 */
export function goalScore(goals: readonly Pick<MoonGoal, "status">[]): Score & { unscored: number } {
  const n = (st: GoalStatus) => goals.filter((g) => g.status === st).length;
  const done = n("done");
  const partly = n("partly");
  const carried = n("carried");
  return { ...scoreOf(done * 2 + partly, done + partly + carried), unscored: n("open") };
}

/** A goal or task carried twice is flagged: do it, reshape it, hand it on, or let it go. */
export function carriedTooOften(g: Pick<MoonGoal, "carryCount">): boolean {
  return g.carryCount >= CARRY_FLAG_AT;
}

export const CARRY_FLAG_WORDS = "Carried twice. Do it, reshape it, hand it on, or let it go.";

/** Score one goal. Let go needs a reason. */
export function goalScoreProblem(status: GoalStatus, letGoReason: string | null | undefined): string | null {
  if (status === "let_go" && !String(letGoReason ?? "").trim()) return LET_GO_NEEDS_REASON;
  return null;
}

export interface GoalInput {
  text: string;
  doneWhen: string | null;
  seasonGoalId: string | null;
}

/** Read the next moon's goals: three to five, each with words, a done-when line optional. */
export function parseMoonGoals(raw: unknown): Parsed<GoalInput[]> {
  if (!Array.isArray(raw)) return { ok: false, field: "goals", error: "Send the next moon's goals as a list." };
  const out: GoalInput[] = [];
  for (const g of raw) {
    if (!isObj(g)) return { ok: false, field: "goals", error: "Each goal is a set of fields." };
    const text = optText(g.text, LIMITS.goalText, "text");
    if (!text.ok) return text;
    if (!text.value) continue;
    const doneWhen = optText(g.doneWhen, LIMITS.goalDoneWhen, "note");
    if (!doneWhen.ok) return doneWhen;
    const goalId = optText(g.seasonGoalId, 64, "seasonGoalId");
    if (!goalId.ok) return goalId;
    out.push({ text: text.value, doneWhen: doneWhen.value, seasonGoalId: goalId.value });
  }
  if (out.length < GOALS_MIN || out.length > GOALS_MAX) return { ok: false, field: "goals", error: `Set ${GOALS_MIN} to ${GOALS_MAX} goals for the next moon.` };
  return { ok: true, value: out };
}

// ── Rolling over at send ─────────────────────────────────────────────────────

/** The items a sent recap carries into the next moon: every Partly and Carry. */
export function carriedItems(items: readonly RecapItem[]): Array<{ dedupeKey: string; text: string; roleId: string | null; seasonGoalId: string | null; setOn: string | null }> {
  return items
    .filter((i) => i.state !== "dropped" && (i.taskStatus === "partly" || i.taskStatus === "carry"))
    .map((i) => ({ dedupeKey: itemDedupeKey("carry", i.id), text: i.text, roleId: i.roleId, seasonGoalId: i.seasonGoalId, setOn: i.setOn }));
}

/** The goals a scored moon carries into the next: every goal not Done and not Let go, one carry more. */
export function carriedGoals(goals: readonly MoonGoal[]): Array<{ carriedFromId: string; text: string; doneWhen: string | null; seasonGoalId: string | null; carryCount: number }> {
  return goals
    .filter((g) => g.status === "partly" || g.status === "carried" || g.status === "open")
    .map((g) => ({ carriedFromId: g.id, text: g.text, doneWhen: g.doneWhen, seasonGoalId: g.seasonGoalId, carryCount: g.carryCount + 1 }));
}

// ── Closing the loop in Sera ─────────────────────────────────────────────────

/** The library id behind an item, when Sera sent it. */
export function seraExternalId(item: Pick<RecapItem, "dedupeKey">): string | null {
  return item.dedupeKey.startsWith("sera:") ? item.dedupeKey.slice(5) : null;
}

/** The reason codes Sera takes, the same ones the end-of-moon skill sends (A3). */
export const SERA_REASONS: Record<"done" | "let_go" | "redirect", "already_done" | "not_a_task" | "not_mine"> = {
  done: "already_done",
  let_go: "not_a_task",
  redirect: "not_mine",
};

export interface SeraClosure {
  itemId: string;
  externalId: string;
  action: "done" | "let_go" | "redirect";
  reason: "already_done" | "not_a_task" | "not_mine";
  note: string | null;
  /** Redirect: who it belongs to, when the member named them. */
  redirectTarget: string | null;
  idempotencyKey: string;
}

/**
 * What to tell Sera once the work is approved: each item Sera sent that the
 * member marked Done or Let go closes, and each Redirect goes with its words.
 * Only tasks Sera sent, and never one the board already told Sera about (the
 * caller passes `alreadyTold`, from the outbox). The caller sends these
 * through the feedback outbox (server/lib/memberTaskBridge.ts).
 */
export function seraClosures(items: readonly RecapItem[], moonStart: string, alreadyTold: ReadonlySet<string> = new Set()): SeraClosure[] {
  const out: SeraClosure[] = [];
  for (const i of items) {
    const ext = seraExternalId(i);
    if (!ext || i.state === "dropped" || alreadyTold.has(ext)) continue;
    if (i.taskStatus !== "done" && i.taskStatus !== "let_go" && i.taskStatus !== "redirect") continue;
    out.push({
      itemId: i.id, externalId: ext, action: i.taskStatus, reason: SERA_REASONS[i.taskStatus],
      note: i.taskStatus === "let_go" ? i.letGoReason : null,
      redirectTarget: i.taskStatus === "redirect" ? i.redirectTo : null,
      idempotencyKey: seraCloseKey(moonStart, ext),
    });
  }
  return out;
}

/**
 * ONE KEY FOR A SERA CLOSE (A3): `moon:<moon start, YYYY-MM-DD>:<sera task
 * id>`, for example `moon:2026-10-10:abc123`. The platform's outbox and the
 * end-of-moon skill each compute it with no shared state, so a task closed
 * from both sides lands once.
 */
export function seraCloseKey(moonStart: string, externalId: string): string {
  return `moon:${moonStart}:${externalId}`;
}

// ── The moon pack, version 1 (spec section 17, A2) ───────────────────────────

/** Whole-pack limits. */
export const PACK_MAX_BYTES = 200 * 1024;
export const PACK_MAX_ITEMS = 300;
export const PACK_MAX_GOALS = 5;

/** Any key, at any depth, matching this refuses the pack whole: a pack never carries money. */
export const PACK_FORBIDDEN_KEY = /amount|minor|total|currency|rate|fx|fee|pay|price|salary|bank|iban|tax/i;

const PACK_TOP_KEYS = ["kind", "version", "moon", "items", "role_audit", "next_goals", "own_words", "thanks"];
const PACK_THANKS_KEYS = ["name", "note"];
const PACK_ITEM_KEYS = ["text", "status", "redirect_to", "let_go_reason", "evidence", "sera_task_id", "seat", "accountability", "season_goal", "outside", "belongs_to_seat"];
const PACK_EVIDENCE_KEYS = ["kind", "ref", "on"];
const PACK_AUDIT_KEYS = ["seat", "verdict", "why"];
const PACK_GOAL_KEYS = ["text", "done_when", "season_goal", "carried_from"];

export type PackRefusalCode = "not_a_pack" | "too_big" | "too_many_items" | "too_many_goals" | "moon_mismatch" | "forbidden_key" | "unknown_key" | "invalid";
export type PackSkipReason = "seat_unknown" | "goal_unknown" | "outside_moon" | "duplicate";

export const PACK_REFUSAL_WORDS: Record<PackRefusalCode, string> = {
  not_a_pack: "This is not a moon pack. Paste the whole pack the deep dive gave you.",
  too_big: "This pack is over 200 KB. Ask for a shorter one.",
  too_many_items: "A pack holds 300 items at most.",
  too_many_goals: "A pack sets five next-moon goals at most.",
  moon_mismatch: "This pack is for another moon. Its start and end dates do not match this one.",
  forbidden_key: "A moon pack never carries amounts, pay, rates or tax. Ask for the pack again without them.",
  unknown_key: "This pack has a field the moon pack does not have. Ask for the pack again.",
  invalid: "Part of this pack is not in the moon pack's shape.",
};

export const PACK_SKIP_WORDS: Record<PackSkipReason, string> = {
  seat_unknown: "Names a role you do not hold",
  goal_unknown: "Names a season goal this season does not have",
  outside_moon: "Its date is outside this moon",
  duplicate: "Already on your recap",
};

export const PACK_WORDS = {
  button: "Import from Claude",
  preview: "Preview",
  confirm: "Import",
  added: (n: number) => `${n} to add`,
  merged: (n: number) => `${n} to merge with items already here`,
  skipped: (n: number) => `${n} to skip`,
} as const;

/** One item of the pack, read and placed: what the import writes or merges. */
export interface PackItemPlan {
  index: number;
  dedupeKey: string;
  text: string;
  taskStatus: TaskStatus | null;
  redirectTo: string | null;
  letGoReason: string | null;
  evidenceKind: EvidenceKind | null;
  evidenceUrl: string | null;
  /** A ref that is no link (an id or a file name), kept as words. */
  evidenceRef: string | null;
  evidenceOn: string | null;
  roleId: string | null;
  accountabilityWords: string | null;
  seasonGoalId: string | null;
  belongsToSeatWords: string | null;
}

export interface PackPreview {
  add: PackItemPlan[];
  /** A Sera task the recap already holds: the pack's words merge into that item. */
  merge: Array<PackItemPlan & { itemId: string }>;
  skip: Array<{ index: number; reason: PackSkipReason }>;
  roleAudit: Array<{ roleId: string; verdict: RoleAuditChoice; why: string | null }>;
  nextGoals: Array<GoalInput & { carriedFromId: string | null }>;
  ownWords: string | null;
  /** A7: names matched to members like roles are; an unmatched name stays as words. */
  thanks: ThanksEntry[];
}

export interface PackContext {
  /** From `packMoonDates`. */
  moon: { start: string; end: string };
  /** The member's roles this moon. */
  seats: ReadonlyArray<{ roleId: string; name: string }>;
  /** Every role, for a Fill verdict on one the member does not hold. */
  allRoles: ReadonlyArray<{ roleId: string; name: string }>;
  /** The running season's goals in order, so g1 to g7 name them by position. */
  seasonGoals: readonly SeasonGoalRef[];
  /** Dedupe keys already on the recap, to the item that holds each. */
  existingKeys: ReadonlyMap<string, string>;
  /** The directory, for matching a thanked name to a member. */
  members?: ReadonlyArray<{ userId: string; name: string }>;
}

export type PackResult =
  | { ok: true; preview: PackPreview; previewHash: string; packSha256: string }
  | { ok: false; code: PackRefusalCode; error: string; field?: string };

/** sha256 as lowercase hex. Async because Web Crypto is. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new Error("sha256Hex needs Web Crypto, which this runtime does not provide");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A deep-dive item's key (A1): `claude:` and the first 32 hex of the sha256
 * of its evidence kind, ref and words; or `sera:<id>` when it names a Sera
 * task, so the pack and the sync meet on one item.
 */
export async function claudeItemKey(input: { seraTaskId?: string | null; evidenceKind: string | null; ref: string | null; text: string }): Promise<string> {
  if (input.seraTaskId) return itemDedupeKey("sera", input.seraTaskId);
  const hex = await sha256Hex(`${input.evidenceKind ?? ""}\n${input.ref ?? ""}\n${input.text}`);
  return itemDedupeKey("claude", hex.slice(0, 32));
}

function forbiddenKeyIn(v: unknown, depth = 0): boolean {
  if (depth > 8 || !v || typeof v !== "object") return false;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(v) && PACK_FORBIDDEN_KEY.test(k)) return true;
    if (forbiddenKeyIn(x, depth + 1)) return true;
  }
  return false;
}

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

type Bad = { ok: false; code: PackRefusalCode; error: string; field?: string };
const invalid = (field: string, why?: string): Bad => ({ ok: false, code: "invalid", error: why ?? PACK_REFUSAL_WORDS.invalid, field });

function packText(v: unknown, max: number, field: string, required = false): { ok: true; value: string | null } | Bad {
  if (v === undefined || v === null || v === "") return required ? invalid(field) : { ok: true, value: null };
  if (typeof v !== "string") return invalid(field);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return required ? invalid(field) : { ok: true, value: null };
  if (t.length > max) return invalid(field, `${field} runs to ${max} characters at most.`);
  return { ok: true, value: t };
}

function seasonGoalOf(ref: string | null, goals: readonly SeasonGoalRef[]): string | null | undefined {
  if (!ref) return null;
  const pos = /^g([1-9])$/.exec(ref);
  if (pos) return goals[Number(pos[1]) - 1]?.id ?? undefined;
  return goals.find((g) => g.id === ref)?.id ?? undefined;
}

function seatOf(ref: string | null, seats: ReadonlyArray<{ roleId: string; name: string }>): string | null | undefined {
  if (!ref) return null;
  return (seats.find((r) => r.roleId === ref) ?? seats.find((r) => r.name === ref))?.roleId ?? undefined;
}

/**
 * READ A MOON PACK (A2): the preview of what an import would do, or the
 * reason the pack is refused whole. Pure: nothing writes. The door answers
 * the preview with `previewHash`, and writes only when the confirm carries
 * the same hash.
 *
 *   Refused whole: not a v1 moon pack, over 200 KB, over 300 items, over
 *   five next goals, moon dates that do not match the cycle, any key at any
 *   depth naming money, any field the pack does not have, or a field not in
 *   its shape.
 *   Skipped per item, never failing the pack: an unknown role, an unknown
 *   season goal, an evidence date outside the moon, or a key already on the
 *   recap or earlier in the pack. A Sera task the recap already holds merges.
 *   Built-but-not-live work (evidence kind `build`) never imports as Done:
 *   it imports as Partly.
 */
export async function validatePack(raw: unknown, ctx: PackContext): Promise<PackResult> {
  let v = raw;
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw).length : new TextEncoder().encode(JSON.stringify(raw ?? null)).length;
  if (bytes > PACK_MAX_BYTES) return { ok: false, code: "too_big", error: PACK_REFUSAL_WORDS.too_big };
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return { ok: false, code: "not_a_pack", error: PACK_REFUSAL_WORDS.not_a_pack };
    }
  }
  if (!isObj(v) || v.kind !== "moon_pack" || v.version !== 1) return { ok: false, code: "not_a_pack", error: PACK_REFUSAL_WORDS.not_a_pack };
  if (forbiddenKeyIn(v)) return { ok: false, code: "forbidden_key", error: PACK_REFUSAL_WORDS.forbidden_key };
  if (!onlyKeys(v, PACK_TOP_KEYS)) return { ok: false, code: "unknown_key", error: PACK_REFUSAL_WORDS.unknown_key };
  const items = Array.isArray(v.items) ? v.items : [];
  if (items.length > PACK_MAX_ITEMS) return { ok: false, code: "too_many_items", error: PACK_REFUSAL_WORDS.too_many_items };
  const goals = Array.isArray(v.next_goals) ? v.next_goals : [];
  if (goals.length > PACK_MAX_GOALS) return { ok: false, code: "too_many_goals", error: PACK_REFUSAL_WORDS.too_many_goals };
  const moon = isObj(v.moon) ? v.moon : {};
  if (moon.start !== ctx.moon.start || moon.end !== ctx.moon.end) return { ok: false, code: "moon_mismatch", error: PACK_REFUSAL_WORDS.moon_mismatch };

  const preview: PackPreview = { add: [], merge: [], skip: [], roleAudit: [], nextGoals: [], ownWords: null, thanks: [] };
  const seen = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const it = items[index];
    if (!isObj(it) || !onlyKeys(it, PACK_ITEM_KEYS)) return isObj(it) ? { ok: false, code: "unknown_key", error: PACK_REFUSAL_WORDS.unknown_key } : invalid(`items[${index}]`);
    const text = packText(it.text, LIMITS.itemText, "text", true);
    if (!text.ok) return text;
    if (looksLikePaymentDetails(text.value as string)) return invalid("text", PAYMENT_DETAILS_REFUSED);
    let status: TaskStatus | null = null;
    if (it.status !== undefined && it.status !== null) {
      if (!(TASK_STATUSES as readonly unknown[]).includes(it.status)) return invalid("status");
      status = it.status as TaskStatus;
    }
    const redirectTo = packText(it.redirect_to, 200, "redirect_to");
    if (!redirectTo.ok) return redirectTo;
    const letGo = packText(it.let_go_reason, 200, "let_go_reason");
    if (!letGo.ok) return letGo;
    if (status === "redirect" && !redirectTo.value) return invalid("redirect_to", REDIRECT_NEEDS_WHO);
    if (status === "let_go" && !letGo.value) return invalid("let_go_reason", LET_GO_NEEDS_REASON);
    let kind: EvidenceKind | null = null;
    let ref: string | null = null;
    let on: string | null = null;
    if (it.evidence !== undefined && it.evidence !== null) {
      if (!isObj(it.evidence)) return invalid("evidence");
      if (!onlyKeys(it.evidence, PACK_EVIDENCE_KEYS)) return { ok: false, code: "unknown_key", error: PACK_REFUSAL_WORDS.unknown_key };
      if (it.evidence.kind !== undefined && !(EVIDENCE_KINDS as readonly unknown[]).includes(it.evidence.kind)) return invalid("evidence.kind");
      kind = (it.evidence.kind as EvidenceKind | undefined) ?? null;
      const r = packText(it.evidence.ref, LIMITS.evidenceUrl, "evidence.ref");
      if (!r.ok) return r;
      ref = r.value;
      const d = optDate(it.evidence.on, "evidence.on");
      if (!d.ok) return invalid("evidence.on");
      on = d.value;
    }
    const seraId = packText(it.sera_task_id, 128, "sera_task_id");
    if (!seraId.ok) return seraId;
    const seatRef = packText(it.seat, 200, "seat");
    if (!seatRef.ok) return seatRef;
    const acc = packText(it.accountability, LIMITS.accountabilityWords, "accountability");
    if (!acc.ok) return acc;
    const goalRef = packText(it.season_goal, 64, "season_goal");
    if (!goalRef.ok) return goalRef;
    const belongs = packText(it.belongs_to_seat, 200, "belongs_to_seat");
    if (!belongs.ok) return belongs;
    const outside = it.outside === true;

    const roleId = outside ? null : seatOf(seatRef.value, ctx.seats);
    if (roleId === undefined) { preview.skip.push({ index, reason: "seat_unknown" }); continue; }
    const seasonGoalId = seasonGoalOf(goalRef.value, ctx.seasonGoals);
    if (seasonGoalId === undefined) { preview.skip.push({ index, reason: "goal_unknown" }); continue; }
    if (on && (on < ctx.moon.start || on > ctx.moon.end)) { preview.skip.push({ index, reason: "outside_moon" }); continue; }

    const key = await claudeItemKey({ seraTaskId: seraId.value, evidenceKind: kind, ref, text: text.value as string });
    const isLink = !!ref && evidenceUrlProblem(ref) === null;
    const plan: PackItemPlan = {
      index, dedupeKey: key, text: text.value as string,
      taskStatus: kind === "build" && status === "done" ? "partly" : status,
      redirectTo: status === "redirect" ? redirectTo.value : null,
      letGoReason: status === "let_go" ? letGo.value : null,
      evidenceKind: kind, evidenceUrl: isLink ? ref : null, evidenceRef: isLink ? null : ref, evidenceOn: on,
      roleId, accountabilityWords: acc.value, seasonGoalId, belongsToSeatWords: outside ? belongs.value : null,
    };
    const held = ctx.existingKeys.get(key);
    if (seen.has(key) || (held && !key.startsWith("sera:"))) { preview.skip.push({ index, reason: "duplicate" }); continue; }
    seen.add(key);
    if (held) preview.merge.push({ ...plan, itemId: held });
    else preview.add.push(plan);
  }

  for (const a of Array.isArray(v.role_audit) ? v.role_audit : []) {
    if (!isObj(a) || !onlyKeys(a, PACK_AUDIT_KEYS)) return isObj(a) ? { ok: false, code: "unknown_key", error: PACK_REFUSAL_WORDS.unknown_key } : invalid("role_audit");
    if (!(ROLE_AUDIT_CHOICES as readonly unknown[]).includes(a.verdict)) return invalid("role_audit.verdict");
    const why = packText(a.why, 200, "role_audit.why");
    if (!why.ok) return why;
    const verdict = a.verdict as RoleAuditChoice;
    const seat = typeof a.seat === "string" ? a.seat : "";
    const roleId = verdict === "fill" ? seatOf(seat, ctx.allRoles.filter((r) => !ctx.seats.some((m) => m.roleId === r.roleId))) : seatOf(seat, ctx.seats);
    if (!roleId || preview.roleAudit.some((x) => x.roleId === roleId)) continue;
    preview.roleAudit.push({ roleId, verdict, why: why.value });
  }

  for (const g of goals) {
    if (!isObj(g) || !onlyKeys(g, PACK_GOAL_KEYS)) return isObj(g) ? { ok: false, code: "unknown_key", error: PACK_REFUSAL_WORDS.unknown_key } : invalid("next_goals");
    const text = packText(g.text, LIMITS.goalText, "next_goals.text", true);
    if (!text.ok) return text;
    const doneWhen = packText(g.done_when, LIMITS.goalDoneWhen, "next_goals.done_when");
    if (!doneWhen.ok) return doneWhen;
    const goalRef = packText(g.season_goal, 64, "next_goals.season_goal");
    if (!goalRef.ok) return goalRef;
    const carried = packText(g.carried_from, 64, "next_goals.carried_from");
    if (!carried.ok) return carried;
    preview.nextGoals.push({ text: text.value as string, doneWhen: doneWhen.value, seasonGoalId: seasonGoalOf(goalRef.value, ctx.seasonGoals) ?? null, carriedFromId: carried.value });
  }

  const own = packText(v.own_words, LIMITS.ownWords, "own_words");
  if (!own.ok) return own;
  preview.ownWords = own.value;

  const thanks = Array.isArray(v.thanks) ? v.thanks : [];
  if (thanks.length > THANKS_MAX) return invalid("thanks", `A recap thanks ${THANKS_MAX} people at most.`);
  for (const t of thanks) {
    if (!isObj(t) || !onlyKeys(t, PACK_THANKS_KEYS)) return isObj(t) ? { ok: false, code: "unknown_key", error: PACK_REFUSAL_WORDS.unknown_key } : invalid("thanks");
    const name = packText(t.name, 120, "thanks.name", true);
    if (!name.ok) return name;
    const note = packText(t.note, THANKS_NOTE_MAX, "thanks.note");
    if (!note.ok) return note;
    const member = (ctx.members ?? []).find((m) => m.name === name.value);
    if (member && preview.thanks.some((x) => x.userId === member.userId)) continue;
    preview.thanks.push({ userId: member?.userId ?? null, name: member ? null : name.value, note: note.value, visibility: "approvers" });
  }

  const packSha256 = await sha256Hex(canonicalJson(v));
  const previewHash = await sha256Hex(canonicalJson({ pack: packSha256, preview }));
  return { ok: true, preview, previewHash, packSha256 };
}

/** `POST /api/me/moon/:cycle/import`. Call one sends `{pack}`; call two `{pack, confirm: true, previewHash}`. */
export interface ImportPackRequest {
  pack: unknown;
  confirm?: boolean;
  previewHash?: string;
}

export type ImportPackResponse =
  | { written: false; preview: PackPreview; previewHash: string }
  | { written: true; added: number; merged: number; skipped: number; items: RecapItem[] };

// ── Outside my roles in the role audit (check 23) ────────────────────────────

/**
 * Every kept Outside my roles item, with the role it really belongs to named
 * (or "No role yet"), and the Fill signals: a role with no holder that two or
 * more such items name.
 */
export function outsideRolesAudit(input: {
  items: readonly Pick<RecapItem, "id" | "text" | "state" | "roleId" | "belongsToRoleId">[];
  heldRoleIds: readonly string[];
  roleNames: Readonly<Record<string, string>>;
  emptyRoleIds: readonly string[];
}): { items: Array<{ itemId: string; text: string; belongsToRoleId: string | null; belongsTo: string }>; fill: Array<{ roleId: string; name: string; count: number }> } {
  const outside = input.items.filter((i) => i.state === "kept" && (!i.roleId || !input.heldRoleIds.includes(i.roleId)));
  const items = outside.map((i) => ({ itemId: i.id, text: i.text, belongsToRoleId: i.belongsToRoleId, belongsTo: i.belongsToRoleId ? input.roleNames[i.belongsToRoleId] ?? i.belongsToRoleId : NO_ROLE_YET }));
  const counts = new Map<string, number>();
  for (const i of outside) if (i.belongsToRoleId && input.emptyRoleIds.includes(i.belongsToRoleId)) counts.set(i.belongsToRoleId, (counts.get(i.belongsToRoleId) ?? 0) + 1);
  const fill = Array.from(counts, ([roleId, count]) => ({ roleId, name: input.roleNames[roleId] ?? roleId, count })).filter((f) => f.count >= 2);
  return { items, fill };
}

export const NO_ROLE_YET = "No role yet";

/** "Fill this role: 3 pieces of work this moon sat under it." */
export function fillSignalWords(name: string, count: number): string {
  return `Fill ${name}: ${count} pieces of work this moon belonged to it.`;
}

// ── The routes: request and response shapes ──────────────────────────────────

/**
 * The doors, after decision 16: no member issue route, a bulk invoice approve
 * taking a list of ids, and paid from the existing `/api/cash-owed/transfers`.
 */
export const MOON_ROUTES = {
  myMoon: "/api/me/moon",
  gather: "/api/me/moon/:cycle/gather",
  askSera: "/api/me/moon/:cycle/ask-sera",
  addItem: "/api/me/moon/:cycle/items",
  editItem: "/api/me/moon/items/:id",
  sendRecap: "/api/me/moon/:cycle/send-recap",
  sendInvoice: "/api/me/moon/:cycle/send-invoice",
  takeBack: "/api/me/moon/:cycle/take-back",
  rangeAnswer: "/api/me/moon/:cycle/range-answer",
  nextGoals: "/api/me/moon/:cycle/goals",
  scoreGoal: "/api/me/moon/goals/:id",
  triage: "/api/me/moon/:cycle/triage",
  payRoute: "/api/me/pay-route",
  memberMoon: "/api/members/:handle/moon",
  queue: "/api/moon-review/queue",
  work: "/api/moon-review/:recap/work",
  returnRecap: "/api/moon-review/:recap/return",
  approveInvoices: "/api/moon-review/invoices/approve",
  setRange: "/api/moon-review/invoices/:id/range",
  voidInvoice: "/api/moon-review/invoices/:id/void",
  invoice: "/api/moon-review/invoices/:id",
  confirmRoute: "/api/moon-review/pay-routes/:user/confirm",
  payers: "/api/moon-review/payers",
  settings: "/api/moon-review/settings",
  importPack: "/api/me/moon/:cycle/import",
  room: "/api/moon-review/rooms/:sessionId",
  exportYear: "/api/moon-review/export",
} as const;

/** The two prefixes the module mounts behind `requireModule`. */
export const MOON_API_PREFIXES = ["/api/me/moon", "/api/me/pay-route", "/api/moon-review"] as const;

export interface MoonRef {
  cycleId: string;
  firstDay: string;
  lastDay: string;
  periodWords: string;
  /** The prepare-by day. */
  endOfMoonFriday: string;
  /** The send-by day: the circle Monday (spec section 18). */
  sendBy: string;
  /** The full moon's civil day, from which the Halfway card shows (B2). */
  halfwayDay: string | null;
}

export interface RoleHeld {
  roleId: string;
  name: string;
  circleId: string | null;
  accountabilities: string[];
  deliverables: string[];
  applicationId: string | null;
  daysHeld: number;
}

export interface SeraState {
  state: "idle" | "running" | "done" | "failed" | "not_linked";
  added: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** A sentence the member reads, such as `SERA_WORDS.notLinked`. */
  line: string | null;
}

export interface RecapView {
  id: string;
  cycleId: string;
  seasonId: string | null;
  status: RecapStatus;
  statusLine: string;
  round: number;
  ownWords: string | null;
  roleAudit: RoleAudit;
  sentAt: string | null;
  waitingOn: ApprovalStage | null;
  dueOn: string | null;
  workApprovedAt: string | null;
  financeApprovedAt: string | null;
  returnedNote: string | null;
  sera: SeraState;
}

/** The invoice as the member and `cash.pay` holders read it. Never sent to anyone else. */
export interface InvoiceView {
  id: string | null;
  status: InvoiceStatus;
  statusLine: string;
  memberNumber: string | null;
  billRef: string | null;
  billTo: BillTo | null;
  from: FromBlock | null;
  period: string;
  lines: InvoiceLine[];
  currency: string | null;
  totalMinor: number | null;
  expectedOn: string | null;
  paidOn: string | null;
  /** True when the member gave an approval on their own invoice (decision 19). */
  selfApproved: boolean;
  /** The member's own invoice is the legal one; this view supports it. */
  supportLine: string;
  externalInvoiceKey: string | null;
  /** Filled once both approvals are in. */
  workSummary: string | null;
  workSummaryHtml: string | null;
  /** Why it cannot be sent yet, or null. */
  sendRefusal: string | null;
}

/** `GET /api/me/moon?cycle=`. The moon load shows to the member only. */
export interface MyMoonResponse {
  moon: MoonRef;
  moons: Array<{ cycleId: string; periodWords: string; status: RecapStatus | null; statusWords: string }>;
  recap: RecapView | null;
  items: RecapItem[];
  roles: RoleHeld[];
  coverage: Coverage;
  seasonGoals: SeasonGoalRef[];
  ownGoals: string[];
  moonLoad: number | null;
  /** The two rings at the top (decision 20). */
  taskScore: TaskScore;
  /** A4: the band, its sentence and its context lines, under each number. Member only. */
  taskReading: Reading | null;
  seatReading: Reading | null;
  seatCoverage: { on: number; total: number; pct: number | null };
  lastMoonGoals: Array<MoonGoal & { flagged: boolean }>;
  goalScore: Score & { unscored: number };
  /** Carried goals first. */
  nextMoonGoals: Array<MoonGoal & { flagged: boolean }>;
  /** Older open Sera tasks, shown once for triage. Never in the score. */
  backlog: Array<{ taskId: string; title: string; createdOn: string | null }>;
  outsideRoles: ReturnType<typeof outsideRolesAudit>;
  /** Shown only when a role's terms carry money. */
  invoiceNeeded: boolean;
  noTermsLine: string | null;
  invoice: InvoiceView | null;
  payRoute: PayRouteRecord | null;
  routeChoices: Array<{ route: PayRoute; words: string }>;
  /** Null until a cash.pay holder writes it in the settings. */
  pilotAck: { version: string; text: string; acceptedVersion: string | null } | null;
  /** What the village still has to name before invoices can go (`setupGaps`). */
  setupGaps: string[];
  attestationWords: ReturnType<typeof attestationWords>;
  /** Who can read the member's route and invoice, by name. */
  cashPayHolders: string[];
  /** B1: the village's End of Moon guide, or null when it has set none (`moon_rhythm`). */
  guideUrl: string | null;
  /** A7: who helped this moon, as the member saved it. */
  thanks: ThanksEntry[];
}

export interface GatherResponse {
  added: number;
  items: RecapItem[];
}

export interface AskSeraResponse {
  sera: SeraState;
}

export interface NewItemRequest extends ItemFields {
  text: string;
}

export interface ItemResponse {
  item: RecapItem;
  /** True when the edit cleared an approval (it never does while Draft). */
  approvalsCleared: boolean;
}

export interface SendRecapRequest {
  ownWords?: string | null;
  roleAudit?: RoleAudit;
  /** A7: who helped, read with `parseThanks`. */
  thanks?: ThanksEntry[];
}

/** `PUT /api/me/moon/:cycle/goals`: the next moon's three to five goals. */
export interface NextGoalsRequest {
  goals: Array<GoalInput & { carriedFromId?: string | null }>;
}

/** `PATCH /api/me/moon/goals/:id`: score one of last moon's goals. */
export interface ScoreGoalRequest {
  status: Exclude<GoalStatus, "open">;
  letGoReason?: string | null;
}

/** `POST /api/me/moon/:cycle/triage`: the one-time triage of older open Sera tasks. */
export interface TriageRequest {
  tasks: Array<{ taskId: string; action: "done" | "let_go" | "redirect"; note?: string | null }>;
}

export interface SendRecapResponse {
  recap: RecapView;
  /** Backlog items the role audit raised. */
  tensionsRaised: number;
}

export interface SendInvoiceRequest {
  attestation: MoonAttestation;
  pilotAckVersion: string;
  /** The number of the invoice the member issued themselves. */
  memberNumber: string;
  /** On the contractor route, the electronic invoice key. */
  externalInvoiceKey?: string | null;
  /** A range line's proposed amount, per its `per`, by application id. */
  rangeProposals?: Record<string, number>;
}

export interface SendInvoiceResponse {
  invoice: InvoiceView;
}

export interface TakeBackResponse {
  recap: RecapView;
  invoice: InvoiceView | null;
}

/** A member's answer to the amount Finance set on a range line. */
export interface RangeAnswerRequest {
  applicationId: string;
  answer: "accept" | "talk";
}

export interface PayRouteResponse {
  payRoute: PayRouteRecord | null;
  billTo: BillTo | null;
  routeChoices: Array<{ route: PayRoute; words: string }>;
  cashPayHolders: string[];
  /** The tax forms the village keeps on file (`settings.taxForms`), for the form to offer. */
  taxForms: TaxFormDef[];
}

/** `PUT /api/me/pay-route`. A pilot acknowledgement rides with it the first time. */
export interface PayRouteRequest extends PayRouteInput {
  pilotAckVersion?: string;
}

/** `GET /api/members/:handle/moon?cycle=`. No amount, route, invoice, review note, suggestion or Sera evidence. */
export interface MemberMoonResponse {
  moon: MoonRef;
  roles: MemberViewRole[];
}

export interface QueueRow {
  recapId: string;
  userId: string;
  name: string;
  status: RecapStatus;
  waitingOn: ApprovalStage | null;
  dueOn: string | null;
  /** Shown to the founders' and stewards' groups for review after the fact. */
  selfApproved: boolean;
  /** Who can give each approval for this recap, by name. Empty means nobody can. */
  workApprovers: string[];
  invoiceApprovers: string[];
  roles: Array<{ roleId: string; name: string; itemCount: number }>;
  outsideMyRoles: number;
  /**
   * The approval hash of the recap as the queue read it (lane B). A work or
   * invoice approval sends it back, and the door refuses with
   * `APPROVAL_REFUSALS.hashChanged` when the recap moved since.
   */
  hash: string;
  /** A4: the reading first, the numbers second. Never an amount. */
  taskReading: Reading | null;
  seatReading: Reading | null;
  score: Score;
  /** The recap's items, for an approver to approve or return each one (lane B, for the client lane). */
  items: RecapItem[];
  /** `cash.pay` view only. `hash` is the row's, for `BulkApproveRequest`. */
  invoice: (InvoiceView & { routeCheck: string | null; taxFormValid: boolean; authorityNote: string | null; queueNote: string | null; hash: string }) | null;
}

/** `GET /api/moon-review/queue?cycle=`. The `moon.approve` view carries no invoice. */
export interface QueueResponse {
  moon: MoonRef;
  rows: QueueRow[];
  rolesWithNoItems: Array<{ userId: string; roleId: string; name: string }>;
  /** Recaps with no eligible second person, for the core circle to name a stand-in. */
  noEligible: Array<{ recapId: string; stage: ApprovalStage }>;
}

/** `POST /api/moon-review/:recap/work`: approve each item or return it with a note. */
export interface WorkReviewRequest {
  hash: string;
  items: Array<{ id: string; review: "approved" | "returned"; note?: string | null }>;
  note?: string | null;
}

export interface ReturnRequest {
  stage: ApprovalStage;
  note: string;
}

/** `POST /api/moon-review/invoices/approve`. Each invoice runs every check; one that fails stays out with its sentence. */
export interface BulkApproveRequest {
  invoices: Array<{ id: string; hash: string; expectedOn: string; fx?: { rate: string; source: string; date: string } | null }>;
}

export interface BulkApproveResponse {
  approved: string[];
  refused: Array<{ id: string; reason: string }>;
  held: Array<{ id: string; reason: string }>;
}

export interface SetRangeRequest {
  applicationId: string;
  finalMinor: number;
  note: string;
}

export interface VoidRequest {
  note: string;
}

export type PayersResponse = PayersDoc;
export type PayersRequest = PayersDoc;
/** `GET` / `PUT /api/moon-review/settings` (cash.pay). Each change writes a `settings_changed` event with old and new values. */
export type SettingsResponse = MoonReviewSettings;
export type SettingsRequest = MoonReviewSettings;

/** `GET /api/moon-review/rooms/:sessionId`. Never an amount, a quiet accountability or the moon load. */
export interface RoomResponse {
  moon: MoonRef;
  holder: { userId: string; name: string } | null;
  recap: {
    roles: Array<{ roleId: string | null; name: string; items: Array<{ text: string; evidenceUrl: string | null }>; heldPrivately: number }>;
    seasonGoals: Array<{ id: string; words: string; count: number }>;
  } | null;
  /** Who is ready to share. Nobody is marked as not ready. */
  ready: Array<{ userId: string; name: string }>;
  /** The `moon_goals` section: the holder's last-moon goals with their score, then the next moon's. */
  goals: {
    last: Array<{ text: string; status: GoalStatus; flagged: boolean }>;
    score: Score;
    next: Array<{ text: string; doneWhen: string | null }>;
  } | null;
  /** This viewer's own row in the sending section. */
  mine: { recapStatus: RecapStatus | null; statusWords: string; invoiceNeeded: boolean } | null;
  sentCount: number;
}

/** One row of `GET /api/moon-review/export?year=&payer=`. */
export interface ExportRow {
  legalName: string;
  taxFormKind: TaxFormKind;
  country: string | null;
  memberNumber: string;
  billRef: string;
  paidOn: string | null;
  amountMinor: number;
  currency: string;
  fxRate: string | null;
  fxSource: string | null;
}

// ── Member-facing words ──────────────────────────────────────────────────────

export const OUTSIDE_MY_ROLES = "Outside my roles";
export const NO_TERMS = "No adopted pay terms. Propose terms through a role application.";
export const ITEM_TEXT_EMPTY = "Say what the work was, in a few words.";
export const PAYMENT_DETAILS_REFUSED = "This looks like a bank or card number. Payment details are never stored here.";
export const ATTESTATION_MISSING = "Fill in the moon attestation before you send the invoice.";
export const NAMES_A_MEMBER = "This item names another member. Reword it to say what you delivered.";

/** "Send by Monday 9 November 2026. Sending any time before then counts the same as sending in the room." */
export function sendByLine(day: string): string {
  return `Send by ${WEEKDAYS[weekdayOf(day)]} ${dayWords(day)}. Sending any time before then counts the same as sending in the room.`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const LET_GO_NEEDS_REASON = "Say why it was let go, in a few words.";
export const REDIRECT_NEEDS_WHO = "Say who or which role it belongs to.";

export const SUPPORT_LINE = "A support document for your own invoice. The invoice you issue yourself is the legal one.";

/** Where the member sends the invoice they issue: the payer's `invoiceTo`. */
export function sendYourInvoiceTo(invoiceTo: string): string {
  return `Send the invoice you issue to ${invoiceTo}.`;
}

export const MOON_WORDS = {
  heading: "My moon",
  thisMoon: "This moon",
  roomView: "Room view",
  roomViewLine: "Every amount is hidden while Room view is on.",
  gather: "Bring in my tasks",
  askSera: "Ask Sera",
  addItem: "Add an item",
  keep: "Keep",
  drop: "Drop",
  againstMyCards: "Against my role cards",
  seasonGoals: "Season goals",
  myGoals: "My seasonal goals",
  roleAudit: "Role audit",
  newRole: "A role that should exist",
  ownWords: "In my own words",
  sendRecap: "Send my recap",
  sendRecapLine: "Your recap sends without a pay route.",
  invoice: "Invoice",
  sendInvoice: "Send draft invoice for approval",
  takeBack: "Take back",
  takeBackLine: "Back to Draft. Any approval given is cleared.",
  billTo: "Bill to",
  from: "From",
  period: "Period",
  total: "Total",
  attestation: "This moon's attestation",
  paymentDetails: "Payment goes to the account you have on file with Finance.",
  whoReads: "Who can read your pay details",
  memberNumber: "Your invoice number",
  externalKey: "Electronic invoice key",
  copySummary: "Copy work summary",
  copyEmail: "Copy for email",
  printable: "Open printable invoice",
  noRecapRoles: "You held no role this moon, so there is nothing to recap.",
  prepareBy: "Prepare by",
  sendBy: "Send by",
  to: "To",
  cc: "Cc",
  acceptRange: "Accept",
  talkRange: "Ask to talk",
} as const;

export const SERA_WORDS = {
  notLinked: "Your Sera record is not linked yet. Add your items by hand.",
  running: "Sera is drafting your moon.",
  done: "Sera's suggestions are below. They stay private to you until you keep them.",
  failed: "Sera did not answer in time. Whatever arrived is below; add the rest by hand.",
} as const;

export const NOTICE_WORDS = {
  sentToApprover: (name: string) => `${name} sent their moon recap. It is waiting on your approval.`,
  returned: "Your moon recap came back with a note.",
  workApproved: "The work in your moon recap is approved.",
  approved: "Your moon recap is approved. Finance pays outside the platform and tells you once it is sent.",
  rangeChanged: "Finance set a new amount on your invoice. Reissue your own invoice and send it again.",
  selfApprovedForReview: (name: string) => `${name} approved their own moon recap. It is open for review on the payouts desk.`,
  paid: (day: string) => paySentWords(day),
  reminder: (name: string) => `${name}'s moon recap is still waiting on your approval.`,
  escalated: (name: string, role: string) => `${name}'s moon recap has waited 14 days on ${role}.`,
  refusedToFinance: (name: string) => `${name} could not send an invoice this moon. Their recap still counts.`,
} as const;
