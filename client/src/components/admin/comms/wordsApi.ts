/**
 * The Words screen's calls to `/api/admin/comms/words/*`
 * (server/routes/commsWords.ts), and the shapes they answer.
 *
 * Every call reads the status before it reads the body, and a refusal comes
 * back as a sentence a founder can read (`refusal` in ../adminApi), never as
 * a body that looks like a success.
 */
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import type { EmailKind } from "@shared/comms/kinds";
import type { VoiceFinding } from "@shared/comms/voiceLint";

export interface WordsItem {
  key: string;
  label: string;
  kind: EmailKind;
  subject: string;
  source: "village" | "platform";
  version: number;
  platformVersion: number | null;
  upgradeAvailable: boolean;
}

export interface WordsGroup {
  id: string;
  title: string;
  journeyKey: string | null;
  items: WordsItem[];
}

export interface WordsList {
  groups: WordsGroup[];
  postalAddressSet: boolean;
}

export interface Words {
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout?: string;
  version: number | null;
  source: "village" | "platform" | "draft";
  platformVersion: number | null;
}

export interface WordsVersion {
  version: number;
  state: "live" | "retired";
  subject: string;
  preheader: string | null;
  bodyMd: string;
  platformVersion: number | null;
  editedBy: string | null;
  editedByName: string | null;
  /** Epoch seconds. */
  createdAt: number;
}

export interface WordsField {
  key: string;
  group: string;
  groupLabel: string;
  type: "text" | "url" | "markdown" | "links";
  label: string;
  hint: string;
  optional: boolean;
}

export interface WordsDetail {
  key: string;
  label: string;
  kind: EmailKind;
  live: Words;
  platform: Words | null;
  upgradeAvailable: boolean;
  versions: WordsVersion[];
  fields: WordsField[];
}

export interface WordsPreview {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  version: number | null;
  source: Words["source"];
  kind: EmailKind;
  missing: string[];
  omitted: string[];
  unknown: string[];
  problems: string[];
  voice: VoiceFinding[];
}

export interface WordsDraft {
  subject: string;
  preheader: string;
  bodyMd: string;
}

/** A call's answer: the body when it worked, a sentence when it did not. */
export type Answer<T> = { ok: true; body: T } | { ok: false; error: string; problems?: string[] };

async function read<T>(res: Response, fallback: string): Promise<Answer<T>> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const problems = Array.isArray(body?.problems) ? (body.problems as string[]) : undefined;
    return { ok: false, error: refusal(body, `${fallback} (${res.status}).`), problems };
  }
  return { ok: true, body: body as T };
}

const json = (password: string) => authHeaders(password, { "Content-Type": "application/json" });
const keyPath = (key: string) => encodeURIComponent(key);

export async function fetchWordsList(password: string): Promise<Answer<WordsList>> {
  const res = await fetch(`${API_BASE}/admin/comms/words`, { headers: authHeaders(password) });
  return read<WordsList>(res, "The list of emails could not be read");
}

export async function fetchWordsDetail(password: string, key: string): Promise<Answer<WordsDetail>> {
  const res = await fetch(`${API_BASE}/admin/comms/words/${keyPath(key)}`, { headers: authHeaders(password) });
  return read<WordsDetail>(res, "These words could not be read");
}

export async function previewWords(password: string, key: string, draft: WordsDraft | null): Promise<Answer<WordsPreview>> {
  const res = await fetch(`${API_BASE}/admin/comms/words/${keyPath(key)}/preview`, {
    method: "POST",
    headers: json(password),
    body: JSON.stringify(draft ? { draft } : {}),
  });
  return read<WordsPreview>(res, "The preview could not be made");
}

export async function sendTestWords(
  password: string,
  key: string,
  draft: WordsDraft | null,
): Promise<Answer<{ status: string; reason: string | null; messageId: string | null; sentTo: string }>> {
  const res = await fetch(`${API_BASE}/admin/comms/words/${keyPath(key)}/test`, {
    method: "POST",
    headers: json(password),
    body: JSON.stringify(draft ? { draft } : {}),
  });
  return read(res, "The test email could not be sent");
}

export async function saveWords(password: string, key: string, draft: WordsDraft): Promise<Answer<{ saved: number; detail: WordsDetail }>> {
  const res = await fetch(`${API_BASE}/admin/comms/words/${keyPath(key)}`, {
    method: "PUT",
    headers: json(password),
    body: JSON.stringify(draft),
  });
  return read(res, "These words could not be saved");
}

export async function restoreWords(password: string, key: string, version: number): Promise<Answer<{ restored: number; detail: WordsDetail }>> {
  const res = await fetch(`${API_BASE}/admin/comms/words/${keyPath(key)}/restore`, {
    method: "POST",
    headers: json(password),
    body: JSON.stringify({ version }),
  });
  return read(res, "That version could not be brought back");
}

export async function adoptWords(password: string, key: string): Promise<Answer<{ adopted: number; detail: WordsDetail }>> {
  const res = await fetch(`${API_BASE}/admin/comms/words/${keyPath(key)}/adopt`, {
    method: "POST",
    headers: json(password),
  });
  return read(res, "The platform's words could not be taken");
}

/** What a test's answer means, in a sentence. */
export function testOutcome(answer: { status: string; reason: string | null; sentTo: string }): string {
  if (answer.status === "sent") return `Sent to ${answer.sentTo}. It should arrive in a minute or two.`;
  if (answer.reason === "no_api_key") return "Not sent: the village has no email provider key yet. Add it in Comms Settings.";
  if (answer.reason === "no_sender") return "Not sent: the village has no sender address yet. Add it in Comms Settings.";
  if (answer.status === "skipped" && answer.reason === "bad_address") return "Not sent: your account's email address cannot be written to.";
  return "Not sent: the email provider refused it. Sent mail has the details.";
}
