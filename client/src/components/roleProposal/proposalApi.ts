/**
 * The role proposal steps' calls (role proposals PR C), and the payload as the
 * page reads it. The contract is the server's (server/routes/roleProposals.ts,
 * #563 and #576): this file names its routes once and types what they send.
 *
 *   fetchMine         GET    /api/governance/role-proposals/mine
 *   startFromCard     POST   /api/governance/role-proposals/prefill
 *   fetchProposal     GET    /api/governance/role-proposals/:id
 *   saveProposal      PUT    /api/governance/role-proposals/:id
 *   fetchProposalCard GET    /api/governance/role-proposals/:id/card
 *   fetchSubmitWords  POST   /api/governance/role-proposals/:id/words
 *   setShare          POST   /api/governance/role-proposals/:id/share
 *   regenerateShare   POST   /api/governance/role-proposals/:id/share/regenerate
 *   shareOff          DELETE /api/governance/role-proposals/:id/share
 *   fetchComments     GET    /api/governance/role-proposals/:id/comments
 *   submitProposal    POST   /api/governance/role-proposals/:id/submit
 *   fetchShared       GET    /api/governance/role-proposals/shared/:token
 *   fetchSharedComments / postSharedComment   .../shared/:token/comments
 *
 * Every call carries the member's token and answers `{ ok: false, status,
 * error }` with the server's own sentence, so a page says what the server
 * said. A 400 also carries the `field` it named.
 */
import { authToken } from "@/lib/gameApi";
import type { PlayerCardPayload } from "@shared/playerCardPayload";
import type { ConsentAnswer, ConsentState } from "@shared/roleProposalConsent";
import type { ProposalStatus, ShareAudience, WordValue } from "@shared/roleProposals";
import type { SeatSettings } from "@shared/seatSettings";
import type { WorkPay } from "@shared/workValue";

export const PROPOSALS_URL = "/api/governance/role-proposals";

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string; field?: string; body?: any };

export const FAILED = "That did not reach the server. Try again.";

async function call<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown): Promise<Answer<T>> {
  const t = authToken();
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : method === "POST" ? { body: "{}" } : {}),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) {
      // The sentence is `message`, or `error` itself when the route sends one there (a 400 names its field too).
      const sentence = typeof out?.message === "string" ? out.message : typeof out?.error === "string" && out.error.includes(" ") ? out.error : "";
      return {
        ok: false,
        status: res.status,
        error: sentence || FAILED,
        ...(typeof out?.field === "string" ? { field: out.field } : {}),
        body: out,
      };
    }
    return { ok: true, data: out as T };
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

// ── The payload ─────────────────────────────────────────────────────────────

/** One word field, posted against proposed. Gold when `changed`. */
export interface WordFieldOut {
  field: string;
  posted: WordValue;
  proposed: WordValue;
  changed: boolean;
}

export interface ProposalRoleOut {
  roleId: string;
  name: string;
  circle: { id: string; name: string } | null;
  live: boolean;
  fields: WordFieldOut[];
  changedCount: number;
  reviewOn?: string | null;
}

export interface NewRoleOut {
  id: string;
  name: string;
  circle: { id: string; name: string } | null;
  seats: number;
  fields: WordFieldOut[];
  reviewOn?: string | null;
}

export interface ConsentOut {
  state: ConsentState;
  words: string;
  closesAt: string | null;
  closesOn: string | null;
  asked: number;
  consented: number;
  objected: number;
  objections: string[];
  /** The titles of the roles the asked hold in the circle, for the tally (PR D). Absent from an older server. */
  roles?: { asked: string[]; consented: string[]; objected: string[] };
  record: string | null;
  you: { asked: boolean; answer: string | null; mayAnswer: boolean };
}

/** `POST /api/governance/role-applications/:id/consent`, what an asked holder's answer returns (PR B). */
export interface ConsentAnswerOut {
  answer: ConsentAnswer;
  carried: boolean;
  carriedWords: string | null;
  consent: ConsentOut;
}

export interface ShareOut {
  on: boolean;
  audience: ShareAudience;
  link: string | null;
  token: string | null;
  anyoneReaches: boolean;
  anyoneNote: string | null;
}

export interface SeasonWordsOut {
  aim: string | null;
  seasonalGoals: Array<{ title: string; doneWhen: string | null }>;
  servesGoals: Array<{ goal: string; howItHelps: string | null }>;
}

export interface ProposalOut {
  id: string;
  status: ProposalStatus;
  href: string;
  target: { seasonId: string; name: string; startsOn: string; endsOn: string | null; ended: boolean } | null;
  targetWords: string | null;
  orgGoals: string[];
  roles: ProposalRoleOut[];
  newRoles: NewRoleOut[];
  limits: { maxRoles: number };
  frameworkTerms?: boolean;
  settings?: SeatSettings;
  season?: SeasonWordsOut;
  share?: ShareOut;
  mayEdit?: boolean;
  readyToSubmit?: boolean;
  submitBlocked?: string | null;
  changesRoles?: boolean;
  application: { id: string; href: string } | null;
  consent: ConsentOut | null;
  decided: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

export interface MineOut {
  nextSeason: { seasonId: string; name: string; startsOn: string; endsOn: string | null; goals: string[] } | null;
  nextSeasonWords: string | null;
  draftId: string | null;
  proposals: ProposalOut[];
}

export interface CommentOut {
  id: string;
  text: string;
  mine: boolean;
  from?: string;
  writtenOn: string;
}

export interface SharedOut {
  proposal: ProposalOut;
  card: PlayerCardPayload | null;
  you: { isOwner: boolean; mayComment: boolean; tier: "member" | "public" };
}

/** What a PUT may carry: any of the four groups. A group sent replaces it whole. */
export interface ProposalUpdate {
  roles?: Array<{ roleId: string; words: Record<string, string | string[] | null>; reviewOn: string | null }>;
  newRoles?: Array<{ id?: string; circleId: string; seats?: number; words: Record<string, string | string[] | null>; reviewOn: string | null }>;
  settings?: SeatSettings;
  season?: SeasonWordsOut;
}

const one = (id: string) => `${PROPOSALS_URL}/${encodeURIComponent(id)}`;
const sharedPath = (token: string) => `${PROPOSALS_URL}/shared/${encodeURIComponent(token)}`;

export const fetchMine = () => call<MineOut>(`${PROPOSALS_URL}/mine`);
export const startFromCard = () => call<{ proposal: ProposalOut }>(`${PROPOSALS_URL}/prefill`, "POST");
export const fetchProposal = (id: string) => call<{ proposal: ProposalOut }>(one(id));
export const saveProposal = (id: string, update: ProposalUpdate) => call<{ proposal: ProposalOut }>(one(id), "PUT", update);
export const fetchProposalCard = (id: string) => call<PlayerCardPayload>(`${one(id)}/card`);
/** `whoApproves` names who adopts it in this village, read from who holds the power (E8); an older server sends none. */
export const fetchSubmitWords = (id: string) =>
  call<{ title: string; body: string; money: boolean; intent: string; whoApproves?: string | null }>(`${one(id)}/words`, "POST");
export const setShare = (id: string, audience: ShareAudience) => call<{ share: ShareOut }>(`${one(id)}/share`, "POST", { audience });
export const regenerateShare = (id: string, audience: ShareAudience) => call<{ share: ShareOut }>(`${one(id)}/share/regenerate`, "POST", { audience });
export const shareOff = (id: string) => call<{ share: ShareOut }>(`${one(id)}/share`, "DELETE");
export const fetchComments = (id: string) => call<{ comments: CommentOut[] }>(`${one(id)}/comments`);
export const submitProposal = (id: string, alignedWords?: string) =>
  call<{ proposal: ProposalOut | null; seasonPlanSaved: boolean; status?: string; message?: string }>(`${one(id)}/submit`, "POST", alignedWords === undefined ? {} : { alignedWords });
export const fetchShared = (token: string) => call<SharedOut>(sharedPath(token));
export const fetchSharedComments = (token: string) => call<{ comments: CommentOut[] }>(`${sharedPath(token)}/comments`);
export const postSharedComment = (token: string, text: string) => call<{ comments: CommentOut[] }>(`${sharedPath(token)}/comments`, "POST", { text });

/** An asked holder consents or objects, keyed by the application their bell notice links (PR D). */
export const consentUrl = (applicationId: string) => `/api/governance/role-applications/${encodeURIComponent(applicationId)}/consent`;
export const answerConsent = (applicationId: string, answer: ConsentAnswer, reason?: string) =>
  call<ConsentAnswerOut>(consentUrl(applicationId), "POST", answer === "object" ? { answer, reason } : { answer });

// ── What the pick step reads beside the proposal ────────────────────────────

/** A role in `/api/org` as the pick step reads it. Holders are read for their ids only, never printed. */
export interface OrgRoleIn {
  id: string;
  name: string;
  circleId: string | null;
  seats: number;
  state?: string;
  holderCount?: number;
  holders?: Array<{ userId?: string | null }>;
  isExample?: boolean;
  runbook?: string | null;
  /** What the role pays, at the `terms.read` tier (server/lib/workPay.ts). Absent below it. */
  pay?: WorkPay | null;
}

export interface OrgCircleIn {
  id: string;
  name: string;
  purpose?: string | null;
  isExample?: boolean;
  status?: string;
}

/** Applications as the list sends them, read for counts only: nobody's name is drawn. */
export interface ApplicationCountIn {
  status: string;
  candidate?: { id?: string | null };
  seats?: Array<{ id: string }>;
}

export const fetchApplicationsForCounts = () => call<{ applications: ApplicationCountIn[] }>("/api/governance/role-applications");
