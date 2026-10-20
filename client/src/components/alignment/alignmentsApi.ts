/**
 * The alignment store's client half (seat settings PR5): align, confirm it is
 * you, and read what you or another member have aligned with.
 *
 * Every call carries the member's token, and the status travels with the
 * answer, so a page can tell "members only" from "something went wrong" and a
 * money re-confirm from a refusal.
 */
import { authToken } from "@/lib/gameApi";
import type { AlignmentState, AlignMethod } from "@shared/alignments";

export interface PartyChip {
  partyKey: string;
  label: string;
  capacity: string;
  required: boolean;
  aligned: boolean;
  at: string | null;
  method: AlignMethod | null;
}

export interface ServedAlignment {
  textId: string | null;
  title: string;
  body: string;
  version: number;
  seatNames: string[];
  href: string | null;
  state: AlignmentState;
  why: string | null;
  sealed: boolean;
  money: boolean;
  parties: PartyChip[];
  you: { partyKey: string; aligned: boolean; alignedAt: string | null; mayAlign: boolean } | null;
  contentHash: string | null;
  createdAt: string | null;
  /** An application from before PR5: aligning writes its text from the stored terms. */
  retrofit?: boolean;
}

export type ConfirmWith = "password" | "google" | "none";

export interface ConfirmState {
  fresh: boolean;
  freshUntil: string | null;
  confirmWith: ConfirmWith;
}

export type Answer<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; code: string | null; body: any };

const headers = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

export async function call<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<Answer<T>> {
  try {
    const res = await fetch(path, { method, headers: headers(), ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(data?.message ?? data?.error ?? "Something went wrong. Try again"),
        code: typeof data?.error === "string" ? data.error : null,
        body: data,
      };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Nothing answered. Check your connection and try again", code: null, body: null };
  }
}

/** True when an answer is the money re-confirm asking first, rather than a refusal. */
export const asksReconfirm = (a: Answer<unknown>): boolean => !a.ok && a.status === 403 && a.code === "reconfirm_required";

export const fetchMyAlignments = () => call<{ alignments: ServedAlignment[] }>("/api/profile/alignments");
export const fetchTheirAlignments = (handle: string) =>
  call<{ alignments: ServedAlignment[] }>(`/api/alignments?party=${encodeURIComponent(handle)}`);
export const alignWithText = (textId: string, contentHash: string) =>
  call<{ alignment: ServedAlignment | null; already?: boolean }>("/api/profile/alignments", "POST", { textId, contentHash });
export const alignWithApplication = (applicationId: string, words: string) =>
  call<{ alignment: ServedAlignment | null }>("/api/profile/alignments", "POST", { applicationId, words });
export const fetchConfirmState = () => call<ConfirmState>("/api/profile/alignments/confirm");
export const confirmIdentity = (password?: string) =>
  call<ConfirmState & { success: true }>("/api/profile/alignments/confirm", "POST", password ? { password } : {});
export const receiptHref = (textId: string) => `/api/profile/alignments/${encodeURIComponent(textId)}/receipt`;

/** The words a Review step shows, rendered by the server exactly as it will store them. */
export const fetchApplicationWords = (body: Record<string, unknown>) =>
  call<{ title: string; body: string; money: boolean; intent: string }>("/api/governance/role-applications/words", "POST", body);

/** Download the receipt with the member's token, as a file. */
export async function downloadReceipt(textId: string): Promise<boolean> {
  try {
    const res = await fetch(receiptHref(textId), { headers: headers() });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aligned-${textId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
