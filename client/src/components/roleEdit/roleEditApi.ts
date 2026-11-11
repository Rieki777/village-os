/**
 * The editor's calls (server/routes/roleEdit.ts). Every call carries the
 * member's token and answers the server's own sentence when it refuses, as
 * client/src/components/roleProposal/roleCardApi.ts does.
 */
import { authToken } from "@/lib/gameApi";
import type { PaySettings } from "@shared/seatSettings";
import type { Interviewer, ParameterKey, ParameterValues } from "@shared/roleParameters";
import type { WordValue } from "@shared/roleProposals";
import type { RoleCardSections } from "@shared/roleCardSections";

export const EDIT_URL = "/api/org/role-edit";

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body?: any };

const FAILED = "That did not work. Try again in a moment.";

const auth = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function answer<T>(res: Response): Promise<Answer<T>> {
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const sentence = typeof out?.message === "string" ? out.message : typeof out?.error === "string" && out.error.includes(" ") ? out.error : "";
    return { ok: false, status: res.status, error: sentence || FAILED, body: out };
  }
  return { ok: true, data: out as T };
}

async function send<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  try {
    return await answer<T>(await fetch(`${EDIT_URL}${path}`, { method, headers: { "Content-Type": "application/json", ...auth() }, body: body === undefined ? undefined : JSON.stringify(body) }));
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

export interface EditorState {
  id: string;
  name: string;
  circleId: string | null;
  isExample: boolean;
  words: Record<string, WordValue>;
  parameters: ParameterValues;
  parameterKeys: ParameterKey[];
  pay: PaySettings | null;
  archetypes: string[];
  /** The founding sections (shared/roleCardSections.ts). Absent from a server that predates them. */
  sections?: RoleCardSections;
}

export interface EditorOpen {
  state: EditorState;
  door: "power" | "admin";
  lacksToList: string[];
  /** Whether the reader may read terms, which "Use Sera's range" needs. */
  mayReadTerms: boolean;
  roles: Array<{ id: string; name: string }>;
}

export interface Imported {
  isCard: boolean;
  matched?: boolean;
  sentence?: string;
  text: string;
  renamed?: { before: string; after: string } | null;
  words?: Record<string, { before: WordValue; after: WordValue; label: string }>;
  parameters?: Record<string, { before: unknown; after: unknown; label: string }>;
  pay?: { before: PaySettings | null; after: PaySettings | null; label: string } | null;
  problems?: Array<{ field: string; sentence: string; blocks: boolean }>;
}

export interface NewFromCard {
  isCard: boolean;
  created: boolean;
  text: string;
  title?: string | null;
  circleId?: string | null;
  circleName?: string | null;
  roleId?: string;
  listed?: boolean | null;
  problems?: Array<{ field: string; sentence: string; blocks: boolean }>;
  error?: string;
}

export interface SeraSuggestion {
  differences: Array<{ key: string; kind: string; field: string | null; sera: string | null; ours: string | null; takeable: boolean }>;
  pay: PaySettings | null;
  payFrom: { model: string | null; statusLabel: string | null; monthlyUsd: number | null } | null;
  readAt: string | null;
}

export interface HistoryEntry {
  draftId: string;
  title: string;
  at: string | null;
  by: string | null;
  fromEditor: boolean;
  status: "published" | "reverted";
  revertedAt: string | null;
  created: boolean;
  changes: Array<{ field: string; label: string; before: string | null; after: string | null }>;
  canRevert: boolean;
}

export interface SaveBody {
  words?: Record<string, string>;
  parameters?: Record<string, unknown>;
  pay?: PaySettings | null;
  archetypes?: string[];
  /** The founding sections as typed; the server reads them with `readSections`. */
  sections?: Record<string, unknown>;
}

export const readAccess = () => send<{ door: "power" | "admin" | null }>("GET", "/access");
export const openEditor = (id: string) => send<EditorOpen>("GET", `/${encodeURIComponent(id)}`);
export const saveEditor = (id: string, body: SaveBody) => send<{ success: true; changed: string[]; state: EditorState }>("POST", `/${encodeURIComponent(id)}`, body);
export const readHistory = (id: string) => send<{ entries: HistoryEntry[] }>("GET", `/${encodeURIComponent(id)}/history`);
export const revertEntry = (id: string, draftId: string) => send<{ success: true; state: EditorState }>("POST", `/${encodeURIComponent(id)}/history/${encodeURIComponent(draftId)}/revert`, {});
export const readSera = (id: string) => send<SeraSuggestion>("GET", `/${encodeURIComponent(id)}/sera`);
export const importText = (id: string, body: { text: string } | { link: string }) => send<Imported>("POST", `/${encodeURIComponent(id)}/import`, body);

export async function importFile(id: string, file: File): Promise<Answer<Imported>> {
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    return await answer<Imported>(await fetch(`${EDIT_URL}/${encodeURIComponent(id)}/import`, { method: "POST", headers: auth(), body: form }));
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

export const newFromText = (body: { text?: string; link?: string; circleId?: string; create?: boolean }) => send<NewFromCard>("POST", "/new-from-card", body);

export async function newFromFile(file: File, circleId: string, create: boolean): Promise<Answer<NewFromCard>> {
  const form = new FormData();
  // Text fields first: the server reads them with the file (multer), at most four.
  form.append("circleId", circleId);
  form.append("create", create ? "true" : "false");
  form.append("file", file, file.name);
  try {
    return await answer<NewFromCard>(await fetch(`${EDIT_URL}/new-from-card`, { method: "POST", headers: auth(), body: form }));
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

export type { Interviewer };
