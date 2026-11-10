/**
 * WHAT THE CONNECTOR MAY PROPOSE (role journey L13, tier B).
 *
 * The 24 September ruling: machines and Sera may propose anything, and a
 * person or a vote adopts. Every tool in this tier leaves a WAITING item for a
 * person and changes nothing that is live. This file is the pure half: the
 * shapes the tools accept, the sentences they refuse with, and the village
 * setting that keeps the tools which touch applicant data off until the Anchor
 * records its approval of AI agents.
 *
 * Tier C is the list of acts that stay a person's, whatever any list says:
 * adopting, seating, publishing, changing powers, sending, setting pay or
 * terms, inviting and erasing. `TIER_C` names them for the tests and for the
 * refusal words; the paths that do them are held by `ALWAYS_A_PERSON` in
 * shared/agentAdmin.ts.
 *
 * NO AI IN SELECTION. Nothing here scores, ranks or summarises a candidate.
 */

export const AI_APPROVAL_DOC = "ai-agents-approval";

/** The village setting for AI agents touching applicant data. It starts OFF. */
export interface AiApprovalDoc {
  approved: boolean;
  /** Who recorded it: the member's id and the name they go by. */
  by: { userId: string; name: string } | null;
  /** When, as an ISO instant. */
  at: string | null;
  /** Where the Anchor decided, in the person's words. Required to turn it on. */
  note: string;
}

export const EMPTY_AI_APPROVAL: AiApprovalDoc = { approved: false, by: null, at: null, note: "" };

export const AI_APPROVAL_WORDS = {
  off: "AI agents may not read applicant data or draft letters in this village yet. The Anchor records its approval first.",
  needNote: "Say where the Anchor decided this (the thread, the meeting or the date), so the record shows it.",
} as const;

/** The stored document, or the shipped one (off) when it does not parse. */
export function parseAiApproval(raw: unknown): AiApprovalDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.approved !== true) return EMPTY_AI_APPROVAL;
  const by = r.by && typeof r.by === "object" ? (r.by as Record<string, unknown>) : null;
  const userId = typeof by?.userId === "string" ? by.userId.slice(0, 64) : "";
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : "";
  // Approval with no recorded person or time is not approval.
  if (!userId || !at) return EMPTY_AI_APPROVAL;
  return { approved: true, by: { userId, name: String(by?.name ?? "").slice(0, 80) }, at, note: String(r.note ?? "").slice(0, 400) };
}

/** What turning it on needs from a person. */
export function approvalProblem(body: unknown): string | null {
  const r = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof r.approved !== "boolean") return "Send {approved: true or false, note}.";
  if (r.approved && String(r.note ?? "").trim().length < 3) return AI_APPROVAL_WORDS.needNote;
  return null;
}

/** The acts that stay a person's, in the brief's words. Tested against the always-a-person list. */
export const TIER_C = ["adopt", "seat", "publish", "change powers", "send", "set pay or terms", "invite", "erase"] as const;

/** One representative admin-style path per tier C act. A test holds that every one is refused, even when listed. */
export const TIER_C_PATHS: ReadonlyArray<{ act: (typeof TIER_C)[number]; method: "POST" | "PUT" | "PATCH" | "DELETE"; path: string }> = [
  { act: "adopt", method: "POST", path: "/api/governance/open-proposals/p1/adopt" },
  { act: "adopt", method: "POST", path: "/api/org/seat-claims/c1/confirm" },
  { act: "seat", method: "POST", path: "/api/admin/org/roles/r1/holders" },
  { act: "seat", method: "POST", path: "/api/org/seatings/s1/claim" },
  { act: "seat", method: "POST", path: "/api/admin/org/seatings/s1" },
  { act: "publish", method: "POST", path: "/api/admin/org/drafts/d1/publish" },
  { act: "publish", method: "POST", path: "/api/org/drafts/d1/publish-by-power" },
  { act: "change powers", method: "PUT", path: "/api/admin/roles/r1/powers" },
  { act: "change powers", method: "POST", path: "/api/admin/power-assign" },
  { act: "send", method: "POST", path: "/api/governance/applications/a1/first-reply" },
  { act: "send", method: "POST", path: "/api/admin/letters/send" },
  { act: "set pay or terms", method: "PUT", path: "/api/admin/org/roles/r1" },
  { act: "set pay or terms", method: "PUT", path: "/api/admin/role-pay/r1" },
  { act: "invite", method: "POST", path: "/api/admin/invites" },
  { act: "invite", method: "POST", path: "/api/admin/join-requests/j1/accept" },
  { act: "erase", method: "POST", path: "/api/admin/members/u1/anonymize" },
  { act: "erase", method: "DELETE", path: "/api/admin/members/u1" },
];

// ── propose_role_change ──────────────────────────────────────────────────────

/** The card words and parameters a draft change can carry, and no others. */
export const ROLE_CHANGE_FIELDS = ["aim", "domain", "whyItMatters", "bringMe", "notMine", "runbook", "seats", "criticality", "recruiting", "accountabilities"] as const;
export type RoleChangeField = (typeof ROLE_CHANGE_FIELDS)[number];

/** Asks that ride in the draft's reason, because a person sets them: the conversation list, listing and a pay group. */
export const LISTING_ASKS = ["list", "unlist"] as const;

export interface RoleChangeAsk {
  roleId: string;
  /** Fields the draft change applies when a holder of org.decide publishes. */
  fields: Partial<Record<RoleChangeField, unknown>>;
  conversations: string[];
  listing: "list" | "unlist" | null;
  payGroup: string | null;
  why: string;
}

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export function parseRoleChange(args: Record<string, unknown>): { ok: true; value: RoleChangeAsk } | { ok: false; error: string } {
  const roleId = clip(args.roleId, 64);
  if (!roleId) return { ok: false, error: "Name the role: roleId, from get_roles." };
  const why = clip(args.why, 600);
  if (why.length < 5) return { ok: false, error: "Say why in a sentence: why." };
  const fields: Partial<Record<RoleChangeField, unknown>> = {};
  const given = (args.fields && typeof args.fields === "object" && !Array.isArray(args.fields) ? args.fields : {}) as Record<string, unknown>;
  for (const k of Object.keys(given)) {
    if (!(ROLE_CHANGE_FIELDS as readonly string[]).includes(k)) return { ok: false, error: `fields.${k.slice(0, 40)} is not one a proposal can carry. It can carry: ${ROLE_CHANGE_FIELDS.join(", ")}.` };
  }
  for (const k of ROLE_CHANGE_FIELDS) {
    const v = given[k];
    if (v === undefined) continue;
    if (k === "seats") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 50) return { ok: false, error: "fields.seats is a whole number from 1 to 50." };
      fields[k] = n;
    } else if (k === "recruiting") {
      if (typeof v !== "boolean") return { ok: false, error: "fields.recruiting is true or false." };
      fields[k] = v;
    } else if (k === "accountabilities") {
      if (!Array.isArray(v) || v.length > 12 || v.some((x) => typeof x !== "string" || !x.trim())) return { ok: false, error: "fields.accountabilities is a list of up to 12 short sentences." };
      fields[k] = v.map((x) => clip(x, 300));
    } else if (k === "criticality") {
      fields[k] = clip(v, 20);
    } else {
      fields[k] = clip(v, 2000);
    }
  }
  const conversations = Array.isArray(args.conversations) ? args.conversations.map((c) => clip(c, 64)).filter(Boolean).slice(0, 5) : [];
  const listing = args.listing === undefined || args.listing === null ? null : (LISTING_ASKS as readonly unknown[]).includes(args.listing) ? (args.listing as "list" | "unlist") : "bad";
  if (listing === "bad") return { ok: false, error: "listing is list or unlist." };
  const payGroup = args.payGroup === undefined || args.payGroup === null ? null : clip(args.payGroup, 80) || null;
  if (!Object.keys(fields).length && !conversations.length && !listing && !payGroup) return { ok: false, error: "Name at least one change: fields, conversations, listing or payGroup." };
  return { ok: true, value: { roleId, fields, conversations, listing, payGroup, why } };
}

/** The reason line the draft carries, so the holder of org.decide reads every ask, including the ones a person sets. */
export function roleChangeReason(a: RoleChangeAsk): string {
  const lines = [a.why];
  if (a.conversations.length) lines.push(`Asks that the conversations be held by: ${a.conversations.join(", ")}. A person sets this on the role.`);
  if (a.listing) lines.push(`Asks that the role be ${a.listing === "list" ? "listed" : "unlisted"}. A person does this on the role.`);
  if (a.payGroup) lines.push(`Asks that the role sit in the pay group "${a.payGroup}", from Sera's range. A person sets pay.`);
  return lines.join("\n").slice(0, 2000);
}

// ── propose_seating ──────────────────────────────────────────────────────────

export interface SeatingAsk {
  roleId: string;
  memberId: string;
  from: string;
  why: string;
}

export const SELF_SEATING_REFUSED = "A member is never proposed into a role by their own agent. Another member, or a person in Admin, proposes it.";

export function parseSeating(args: Record<string, unknown>, holderId: string | null): { ok: true; value: SeatingAsk } | { ok: false; error: string } {
  const roleId = clip(args.roleId, 64);
  const memberId = clip(args.memberId, 64);
  const from = clip(args.from, 10);
  if (!roleId) return { ok: false, error: "Name the role: roleId, from get_roles." };
  if (!memberId) return { ok: false, error: "Name the member: memberId." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) return { ok: false, error: "from is a date, YYYY-MM-DD." };
  if (holderId && memberId === holderId) return { ok: false, error: SELF_SEATING_REFUSED };
  return { ok: true, value: { roleId, memberId, from, why: clip(args.why, 600) } };
}

// ── draft_letter ─────────────────────────────────────────────────────────────

export const LETTER_KINDS = ["first_reply", "decision"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export interface LetterDraft {
  applicationRef: string;
  kind: LetterKind;
  subject: string;
  body: string;
}

export function parseLetter(args: Record<string, unknown>): { ok: true; value: LetterDraft } | { ok: false; error: string } {
  const applicationRef = clip(args.applicationRef, 64);
  if (!applicationRef) return { ok: false, error: "Name the application: applicationRef." };
  if (!(LETTER_KINDS as readonly unknown[]).includes(args.kind)) return { ok: false, error: `kind is one of ${LETTER_KINDS.join(", ")}.` };
  const subject = clip(args.subject, 160);
  const body = clip(args.body, 6000);
  if (!subject || body.length < 20) return { ok: false, error: "Give a subject and a letter of at least a few sentences." };
  return { ok: true, value: { applicationRef, kind: args.kind as LetterKind, subject, body } };
}

export const LETTER_WORDS = {
  queued: "The letter is drafted and waiting. A person reads it, changes what they like, and sends it from the app. Nothing was sent.",
} as const;

// ── Shared ───────────────────────────────────────────────────────────────────

export const PROPOSAL_KINDS = ["seating", "letter"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_STATES = ["waiting", "taken", "dismissed"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

// ── get_roles: the chart, public data only ───────────────────────────────────

/** The card words a complete role carries, by name. */
export const CARD_PARTS = ["aim", "domain", "whyItMatters", "accountabilities", "bringMe", "notMine", "timeCommitment"] as const;

export interface CardCompleteness {
  filled: number;
  of: number;
  missing: string[];
}

const hasWords = (v: unknown) => (Array.isArray(v) ? v.some((x) => typeof x === "string" && x.trim()) : typeof v === "string" && v.trim().length > 0);

/** How much of a role's card is written. A count and the missing names, never a score of a person. */
export function cardCompleteness(role: Record<string, unknown>): CardCompleteness {
  const missing: string[] = [];
  for (const part of CARD_PARTS) {
    const v = role[part];
    // Three to six accountabilities make a card (role card rule).
    const ok = part === "accountabilities" ? Array.isArray(v) && v.filter((x) => typeof x === "string" && x.trim()).length >= 3 : hasWords(v);
    if (!ok) missing.push(part);
  }
  return { filled: CARD_PARTS.length - missing.length, of: CARD_PARTS.length, missing };
}

const first = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] || "";

export interface ChartRole {
  id: string;
  name: string;
  circleId: string | null;
  listed: boolean;
  recruiting: boolean;
  seats: number;
  openPlaces: number;
  holders: string[];
  card: CardCompleteness;
}

/** The chart as `/api/org` sends it, cut down to public facts: no pay, no terms, no user ids, first names only. */
export function projectChart(body: unknown): { roles: ChartRole[]; circles: Array<{ id: string; name: string }> } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  const circles = (Array.isArray(b.circles) ? b.circles : []).filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
  return {
    circles: circles.map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? "") })),
    roles: roles
      .filter((r) => r.isExample !== true)
      .map((r) => {
        const seats = Math.max(0, Number(r.seats ?? 1) || 0);
        const holderRows = (Array.isArray(r.holders) ? r.holders : []).filter((h): h is Record<string, unknown> => !!h && typeof h === "object");
        const holders = holderRows.map((h) => first(h.name ?? h.displayName)).filter(Boolean);
        const count = Number(r.holderCount ?? holders.length) || 0;
        return {
          id: String(r.id ?? ""),
          name: String(r.name ?? ""),
          circleId: typeof r.circleId === "string" ? r.circleId : null,
          // NULL and absent read as listed; only an explicit false hides a role (the listing lane's rule).
          listed: r.listed !== false,
          recruiting: r.recruiting === true,
          seats,
          openPlaces: Math.max(0, seats - count),
          holders,
          card: cardCompleteness(r),
        };
      }),
  };
}
