/**
 * THE OUTSIDE SERVICE'S SIDE OF COMPANIONS, AS A TYPED SEAM AND NOTHING MORE
 * (the companions contract, section 4; emailed 2026-10-30, not yet answered).
 *
 * Three things cross when the outside side exists, and each one has a type
 * here and no network call anywhere:
 *
 *   1. The poll: `list_records` serves a `companion_item` record kind. The
 *      village pulls, the service never pushes.
 *   2. The return path: `upsert_companion_outcome` tells the service what the
 *      member decided. No amounts, no member ids.
 *   3. The chat: `companion_chat` answers a role companion's chat. Until it
 *      exists, a companion set to the outside engine chats through the village
 *      guide, and the page says so.
 *
 * `NOT_CONNECTED` is the only implementation. Swapping in a real one is this
 * file plus the poll job, and no route or table changes: the records land
 * through `landItem`, the same door the village guide uses, after
 * `recordToLandInput` has applied the refusals below.
 *
 * Refused whole, never stored (section 4.1): no source, a fractional amount,
 * an unknown kind, and an email address or phone number in any field. The
 * contract asks Rye whether `to_outside` may carry a vendor's address; until
 * that is ruled, it may not, so this file refuses it with the rest.
 */
import { carriesContact, isDraftKind, refusalFor, type DraftKind } from "../../shared/companionItems";
import type { LandInput } from "./companions";

/** One `companion_item` record as the service would serve it. Flat, because its store cannot nest. */
export interface SeraCompanionItemRecord {
  id: string;
  updated_at: string;
  status: "Open" | "Withdrawn" | "Superseded";
  supersedes?: string | null;
  item_type: "Question" | "Draft";
  scope: "Role" | "Project" | "Quest";
  scope_ref: string;
  draft_kind?: string | null;
  title: string;
  body?: string | null;
  amount?: number | null;
  currency_or_token?: string | null;
  to_role_ref?: string | null;
  to_outside?: string | null;
  subject?: string | null;
  draft_text?: string | null;
  event_ref?: string | null;
  project_ref?: string | null;
  budget_note?: string | null;
  blocking?: boolean | null;
  due_on?: string | null;
  source_quote?: string | null;
  source_ref?: string | null;
  source_occurred_at?: string | null;
  confidence?: string | null;
  sera_task_id?: string | null;
}

export type SeraOutcome = "answered" | "confirmed" | "edited_then_confirmed" | "declined" | "expired";

/** What the village sends back. No amounts and no member ids, by construction of this type. */
export interface SeraOutcomeUpsert {
  companion_item_id: string;
  outcome: SeraOutcome;
  /** The member's own words, for `answered` only, 1000 characters at most. */
  answer?: string;
  edited_fields?: string[];
  /** What the village made, for example `wallet_transfer`. */
  outcome_kind?: string;
}

export interface SeraChatRequest {
  scope: "Role" | "Project" | "Quest";
  scope_ref: string;
  message: string;
  /** A short recent history, nothing that names the member. */
  history: { speaker: "member" | "companion"; text: string }[];
}

export interface SeraChatReply {
  reply_text: string;
  /** Items made in the chat also arrive through the poll, with the same checks. */
  proposed_items: SeraCompanionItemRecord[];
}

/** The outside side, as the village would call it. */
export interface SeraCompanionLink {
  readonly connected: boolean;
  listItems(since: string | null): Promise<SeraCompanionItemRecord[]>;
  upsertOutcome(outcome: SeraOutcomeUpsert): Promise<{ ok: boolean }>;
  chat(req: SeraChatRequest): Promise<SeraChatReply | null>;
}

/** The only link there is today. It makes no call and changes nothing. */
export const NOT_CONNECTED: SeraCompanionLink = {
  connected: false,
  async listItems() {
    return [];
  },
  async upsertOutcome() {
    return { ok: false };
  },
  async chat() {
    return null;
  },
};

const KIND_MAP: Record<string, DraftKind> = {
  token_payment: "token_payment",
  cash_payment: "cash_payment",
  budget_spend: "budget_spend",
  purchase: "purchase",
  email: "email",
  message: "message",
  rsvp: "rsvp",
  quest: "quest",
  gratitude_note: "gratitude_note",
  ask: "ask",
};

export type MappedRecord = { ok: true; input: LandInput } | { ok: false; error: string };

/**
 * One record, checked and shaped for `landItem`. `roleId` turns the service's
 * role page id into this village's role id, or null when the village does not
 * know it.
 */
export function recordToLandInput(rec: SeraCompanionItemRecord, roleId: (pageId: string) => string | null): MappedRecord {
  if (!rec || typeof rec !== "object" || typeof rec.id !== "string" || !rec.id) return { ok: false, error: "A record needs a stable id." };
  if (!rec.source_quote || !rec.source_ref) return { ok: false, error: "A record with no source is refused whole." };
  if (rec.amount !== undefined && rec.amount !== null && (!Number.isFinite(rec.amount) || !Number.isInteger(rec.amount))) {
    return { ok: false, error: "A fractional amount is refused whole." };
  }
  const words = [rec.title, rec.body, rec.draft_text, rec.subject, rec.source_quote, rec.to_outside, rec.budget_note, rec.confidence];
  if (carriesContact(words)) return { ok: false, error: "A record carrying an email address or a phone number is refused whole." };
  const type = rec.item_type === "Question" ? "question" : rec.item_type === "Draft" ? "draft" : null;
  if (!type) return { ok: false, error: "item_type must be Question or Draft." };

  let kind: DraftKind | null = null;
  let payload: Record<string, unknown> | null = null;
  if (type === "draft") {
    const k = KIND_MAP[String(rec.draft_kind ?? "")];
    if (!k || !isDraftKind(k)) return { ok: false, error: "An unknown kind is refused whole." };
    const refused = refusalFor(k);
    if (refused) return { ok: false, error: refused };
    kind = k;
    const toRole = rec.to_role_ref ? roleId(rec.to_role_ref) : null;
    if (rec.to_role_ref && !toRole) return { ok: false, error: "The record names a role this village does not know." };
    switch (k) {
      case "token_payment":
        payload = { tokenType: rec.currency_or_token ?? "", amountMinor: rec.amount ?? 0, toRoleId: toRole };
        break;
      case "gratitude_note":
        payload = { amount: rec.amount ?? 0, message: rec.draft_text ?? "", toRoleId: toRole };
        break;
      case "message":
        payload = { body: rec.draft_text ?? "", toRoleId: toRole };
        break;
      case "rsvp":
        payload = { eventId: rec.event_ref ?? "", status: "going" };
        break;
      case "quest":
        payload = { title: rec.title, description: rec.body ?? null };
        break;
      case "email":
        payload = { subject: rec.subject ?? "", text: rec.draft_text ?? "" };
        break;
      case "budget_spend":
        // The service names a project, and a budget is this village's own record. Until the
        // contract's question 6 is answered there is no mapping, so the draft cannot land.
        return { ok: false, error: "A budget spend from the outside service needs a project-to-budget mapping this village does not have yet." };
    }
  }

  return {
    ok: true,
    input: {
      type,
      kind,
      title: rec.title,
      body: rec.body ?? null,
      payload,
      quote: rec.source_quote,
      sourceRef: `sera:${rec.source_ref}`,
      sourceOccurredAt: rec.source_occurred_at ? new Date(rec.source_occurred_at) : null,
      origin: "sera",
      externalRef: rec.id,
      blocking: Boolean(rec.blocking),
      dueOn: rec.due_on ?? null,
    },
  };
}

/** The outcome the service hears for a decided item. */
export function outcomeFor(status: string, editedFields: readonly string[] | null, answer: string | null, outcomeKind: string | null): Omit<SeraOutcomeUpsert, "companion_item_id"> | null {
  switch (status) {
    case "answered":
      return { outcome: "answered", ...(answer ? { answer: answer.slice(0, 1000) } : {}) };
    case "confirmed":
      return editedFields && editedFields.length
        ? { outcome: "edited_then_confirmed", edited_fields: [...editedFields], ...(outcomeKind ? { outcome_kind: outcomeKind } : {}) }
        : { outcome: "confirmed", ...(outcomeKind ? { outcome_kind: outcomeKind } : {}) };
    case "declined":
      return { outcome: "declined" };
    case "expired":
      return { outcome: "expired" };
    default:
      return null;
  }
}
