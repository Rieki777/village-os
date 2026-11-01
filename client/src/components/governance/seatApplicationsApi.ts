/**
 * The member door's client half (seat settings PR4): read one application, and
 * the three acts a page can take on it.
 *
 * Every call carries the member's token. The read answers 401 to anybody who
 * does not hold terms.read, and the page says "members read applications"
 * rather than "something went wrong", so the status travels with the answer.
 */
import { authToken } from "@/lib/gameApi";
import type { ApplicationStatus } from "@shared/seatApplications";
import type { ServedAlignment } from "@/components/alignment/alignmentsApi";
import type { ConsentOut } from "@/components/roleProposal/proposalApi";

export interface ServedApplication {
  id: string;
  href: string;
  status: ApplicationStatus;
  statusWords: string;
  /** The application whose terms this one amends (seat settings PR8), or null. */
  supersedesId?: string | null;
  candidate: { id: string; name: string | null };
  seats: Array<{ id: string; name: string; aim: string | null }>;
  note: string | null;
  deliverables: string | null;
  settings: unknown;
  term: { endsOn: string; followsSeason: boolean; seasonId: string | null };
  startsOn: string | null;
  adoptedVia: "holder" | "ballot" | null;
  adoptedBy: string | null;
  ballotId: string | null;
  /** True when the village's vote carried and the decision has not landed yet. */
  carried?: boolean;
  decidedAt: string | null;
  /** The day it was decided, in the village's calendar. */
  decidedOn?: string | null;
  createdAt: string | null;
  /** The words the parties align with, and where each party stands (PR5). */
  alignment?: ServedAlignment;
  /**
   * The role proposal it came from (role proposals PR B): where the circle's
   * consent stands for this reader, and the decision record in words once
   * adopted. Null for an ordinary application; absent from an older server.
   */
  proposal?: { id: string; changesRoles: boolean; consent: ConsentOut | null; decided: string | null } | null;
  /** Who adopts it in this village, in words, while it waits (E8); null once decided, absent from the list. */
  whoAdopts?: string | null;
  you?: {
    isCandidate: boolean;
    mayAdopt: boolean;
    mayPutToVillage: boolean;
    mayWithdraw: boolean;
    holdsThePower: boolean;
  };
}

export type ApplicationAnswer<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const headers = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

async function call<T>(path: string, method: "GET" | "POST" = "GET"): Promise<ApplicationAnswer<T>> {
  try {
    const res = await fetch(path, { method, headers: headers(), ...(method === "POST" ? { body: "{}" } : {}) });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: String(body?.message ?? body?.error ?? "Something went wrong. Try again") };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "Nothing answered. Check your connection and try again" };
  }
}

const base = (id: string) => `/api/governance/role-applications/${encodeURIComponent(id)}`;

export const fetchApplication = (id: string) => call<{ application: ServedApplication }>(base(id));
/** Every application, for a reader holding terms.read. The profile keeps the reader's own open ones. */
export const fetchApplications = () => call<{ applications: ServedApplication[] }>("/api/governance/role-applications");
export const adoptApplication = (id: string) => call<{ status: ApplicationStatus; message?: string }>(`${base(id)}/adopt`, "POST");
export const putApplicationToVillage = (id: string) =>
  call<{ status: ApplicationStatus; ballot: { id: string } }>(`${base(id)}/put-to-village`, "POST");
export const withdrawApplication = (id: string) => call<{ status: ApplicationStatus }>(`${base(id)}/withdraw`, "POST");
