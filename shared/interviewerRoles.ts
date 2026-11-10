/**
 * A ROLE'S CONVERSATIONS: the ordered list of who talks with an applicant, for
 * how long, and who gives the final approval (role journey, Rye 9 Nov 2026).
 *
 * Stored in `org_roles.conversations` (migration 0362) as an ordered JSON list
 * `[{ roleId, minutes, final? }]`. One module, two readers:
 *
 *   - `parseInterviewSteps` is STRICT, for a write: it says in a sentence what
 *     it refuses (a silly length, a repeated role, two final approvals).
 *   - `readInterviewerRoles` is TOLERANT, for reading what is stored or sent
 *     from another release: it drops entries it cannot read and never throws.
 *
 * Limits: 1 to 6 steps, 5 to 240 minutes each, at most one final approval, no
 * role twice. `org_roles.conversation_mode` says whether the village holds the
 * conversations as one block (the default when NULL) or separately (D30).
 *
 * Pure: no Node builtins. Shared by the server projection, the admin write, the
 * card and the interview lane.
 */

export interface InterviewStep {
  /** The role whose holder talks with the applicant. */
  roleId: string;
  /** How long this conversation runs. */
  minutes: number;
  /** This conversation gives the final approval. At most one step carries it. */
  final?: boolean;
}

export interface InterviewStepView extends InterviewStep {
  /** The role's name, resolved by the server so a visitor needs no second read. */
  roleName: string | null;
}

export const INTERVIEW_MAX_STEPS = 6;
export const INTERVIEW_MIN_MINUTES = 5;
export const INTERVIEW_MAX_MINUTES = 240;
/** What a plain role id reads as when an older list named roles without lengths. */
export const INTERVIEW_DEFAULT_MINUTES = 20;
const ROLE_ID_MAX = 120;

export const CONVERSATION_MODES = ["block", "separate"] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

function asJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

/**
 * The conversations in a write. A step is `{ roleId, minutes, final? }`; a bare
 * role id reads as 20 minutes. Null or an empty list means none.
 */
export function parseInterviewSteps(raw: unknown): Parsed<InterviewStep[] | null> {
  const value = asJson(raw);
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!Array.isArray(value)) return { ok: false, problem: "The conversations are an ordered list." };
  const out: InterviewStep[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    let roleId = "";
    let minutes: number = INTERVIEW_DEFAULT_MINUTES;
    let final = false;
    if (typeof item === "string") roleId = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      roleId = typeof o.roleId === "string" ? o.roleId.trim() : "";
      if (o.minutes !== undefined && o.minutes !== null && o.minutes !== "") {
        const m = Number(o.minutes);
        if (!Number.isInteger(m)) return { ok: false, problem: "A conversation's length is a whole number of minutes." };
        minutes = m;
      }
      final = o.final === true;
    } else continue;
    if (!roleId) return { ok: false, problem: "Each conversation names a role." };
    if (roleId.length > ROLE_ID_MAX) return { ok: false, problem: "A role id in the conversations is too long." };
    if (minutes < INTERVIEW_MIN_MINUTES || minutes > INTERVIEW_MAX_MINUTES) {
      return { ok: false, problem: `A conversation runs ${INTERVIEW_MIN_MINUTES} to ${INTERVIEW_MAX_MINUTES} minutes.` };
    }
    if (seen.has(roleId)) return { ok: false, problem: "A role holds one conversation in the list." };
    seen.add(roleId);
    out.push(final ? { roleId, minutes, final: true } : { roleId, minutes });
  }
  if (out.length > INTERVIEW_MAX_STEPS) return { ok: false, problem: `At most ${INTERVIEW_MAX_STEPS} conversations.` };
  if (out.filter((s) => s.final).length > 1) return { ok: false, problem: "Only one conversation gives the final approval." };
  return { ok: true, value: out.length ? out : null };
}

/**
 * The conversations as stored or received: every entry it can read, in order,
 * and the rest dropped. Never throws. A second final approval is kept as an
 * ordinary conversation, and a repeated role keeps its first place.
 */
export function readInterviewerRoles(raw: unknown): InterviewStep[] {
  const value = asJson(raw);
  if (!Array.isArray(value)) return [];
  const out: InterviewStep[] = [];
  const seen = new Set<string>();
  let finalTaken = false;
  for (const item of value) {
    if (out.length >= INTERVIEW_MAX_STEPS) break;
    let roleId = "";
    let minutes: number = INTERVIEW_DEFAULT_MINUTES;
    let final = false;
    if (typeof item === "string") roleId = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      roleId = typeof o.roleId === "string" ? o.roleId.trim() : "";
      if (o.minutes !== undefined && o.minutes !== null && o.minutes !== "") minutes = Number(o.minutes);
      final = o.final === true;
    }
    if (!roleId || roleId.length > ROLE_ID_MAX || seen.has(roleId)) continue;
    if (!Number.isInteger(minutes) || minutes < INTERVIEW_MIN_MINUTES || minutes > INTERVIEW_MAX_MINUTES) continue;
    seen.add(roleId);
    const isFinal = final && !finalTaken;
    if (isFinal) finalTaken = true;
    out.push(isFinal ? { roleId, minutes, final: true } : { roleId, minutes });
  }
  return out;
}

export function parseConversationMode(raw: unknown): Parsed<ConversationMode | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  return (CONVERSATION_MODES as readonly unknown[]).includes(raw)
    ? { ok: true, value: raw as ConversationMode }
    : { ok: false, problem: `The conversations are held as one of: ${CONVERSATION_MODES.join(", ")}.` };
}

/** NULL reads as one block. */
export function conversationModeOf(raw: unknown): ConversationMode {
  return raw === "separate" ? "separate" : "block";
}

/** The total time of a list of conversations, in minutes. */
export function conversationMinutes(steps: readonly InterviewStep[]): number {
  return steps.reduce((n, s) => n + s.minutes, 0);
}

function minutesWords(m: number): string {
  if (m % 60 === 0) {
    const h = m / 60;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  return `${m} minutes`;
}

/** The total in words: "2 hours", "1 hour 40 minutes". */
export function interviewTotalWords(steps: readonly InterviewStep[]): string {
  const total = conversationMinutes(steps);
  if (total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} minutes`;
  const hours = `${h} ${h === 1 ? "hour" : "hours"}`;
  return m === 0 ? hours : `${hours} ${m} minutes`;
}

/** One line per conversation, in order: "1. Some Role, 1 hour". The final approval says so. */
export function interviewLines(steps: ReadonlyArray<InterviewStep & { roleName?: string | null }>): string[] {
  return steps.map((s, i) => `${i + 1}. ${s.roleName ?? "An interviewer"}, ${minutesWords(s.minutes)}${s.final ? ", final approval" : ""}`);
}
