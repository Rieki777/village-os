/**
 * The role card's calls (server/routes/roleCardImport.ts), kept apart from
 * ./proposalApi.ts because a file upload is not JSON and a download is not a
 * payload.
 *
 *   importRoleText   POST /api/governance/role-proposals/:id/import   { text } or { link }
 *   importRoleFile   POST /api/governance/role-proposals/:id/import   a .docx, .pdf, .md or .txt file
 *   downloadCard     GET  .../:id/text or .../mine/text, saved as role-card.txt
 *
 * Every call carries the member's token and answers the server's own
 * sentence when it refuses, as ./proposalApi.ts does.
 */
import { authToken } from "@/lib/gameApi";
import type { ProposalBody } from "@shared/roleProposals";
import type { RoleCardRead } from "@shared/roleCardText";
import type { RoleCardChange } from "@shared/roleCardApply";
import { FAILED, PROPOSALS_URL, type Answer } from "./proposalApi";

/** What an import answers. A card comes with what it would fill; anything else comes back as words alone. */
export interface ImportOut {
  source: "file" | "text" | "link";
  kind: string;
  isCard: boolean;
  /** The words read out of what was brought in. Never kept on the server. */
  text: string;
  read?: RoleCardRead;
  changes?: RoleCardChange[];
  /** The draft as the server held it when the card was read, for keeping only what is ticked. */
  current?: ProposalBody;
}

export const importUrl = (id: string) => `${PROPOSALS_URL}/${encodeURIComponent(id)}/import`;
export const cardTextUrl = (id: string) => `${PROPOSALS_URL}/${encodeURIComponent(id)}/text`;
export const MY_CARD_TEXT_URL = `${PROPOSALS_URL}/mine/text`;
/** The name a downloaded card is saved under, as the server's Content-Disposition names it. */
export const ROLE_CARD_FILENAME_CLIENT = "role-card.txt";

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

export async function importRoleText(id: string, body: { text: string } | { link: string }): Promise<Answer<ImportOut>> {
  try {
    return await answer<ImportOut>(await fetch(importUrl(id), { method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body: JSON.stringify(body) }));
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

export async function importRoleFile(id: string, file: File): Promise<Answer<ImportOut>> {
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    return await answer<ImportOut>(await fetch(importUrl(id), { method: "POST", headers: auth(), body: form }));
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

/** The card's text from the server, or the sentence why not. */
export async function fetchCardText(url: string): Promise<Answer<string>> {
  try {
    const res = await fetch(url, { headers: auth() });
    if (!res.ok) {
      const out = await res.json().catch(() => null);
      return { ok: false, status: res.status, error: typeof out?.message === "string" ? out.message : FAILED };
    }
    return { ok: true, data: await res.text() };
  } catch {
    return { ok: false, status: 0, error: FAILED };
  }
}

/** Save text as a file the member keeps, the way a download link does. */
export function saveTextFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
