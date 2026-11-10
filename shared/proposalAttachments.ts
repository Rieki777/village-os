/**
 * A PROPOSAL'S LINKS AND FILES (Rye, 10 Nov 2026).
 *
 * Somebody proposing for a role can point the village at their work: up to
 * five labelled https links, and up to three files (PDF, DOCX, PNG or JPG, at
 * most 10 MB each). Both are for the people who decide the proposal and nobody
 * else, and both follow the proposal's own retention:
 *
 *   - never confirmed in 48 hours: deleted with the proposal;
 *   - 90 days after the decision (or 90 days undecided): removed with the
 *     name and address;
 *   - kept nowhere else: the bytes live in a private folder outside the
 *     uploads volume, which `/api/uploads/:filename` would answer anybody
 *     from, as the confidentiality agreement's document does (#1088).
 *
 * LINKS ARE NEVER FETCHED. The server checks their shape and keeps their
 * words. It never opens one, previews one or follows one, so a link cannot
 * make the village call anybody. The page draws each one as plain text the
 * decider chooses to open.
 *
 * NO AI READS THEM. Neither the links nor the files reach any assistant,
 * agent tool or drafting prompt: they appear in exactly one members-only
 * response and one file door, both for the deciders.
 *
 * A FILE IS WHAT ITS BYTES SAY. The type is read from the file's first bytes
 * (its magic number), never from the name or the browser's word for it, and a
 * name whose extension disagrees is refused.
 *
 * Pure, so the page and the server import it alike.
 */

export const PROPOSAL_LINKS_MAX = 5;
export const PROPOSAL_LINK_LABEL_MAX = 80;
export const PROPOSAL_LINK_URL_MAX = 500;
export const PROPOSAL_FILES_MAX = 3;
export const PROPOSAL_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const PROPOSAL_FILE_NAME_MAX = 120;

export const PROPOSAL_FILE_KINDS = ["pdf", "docx", "png", "jpg"] as const;
export type ProposalFileKind = (typeof PROPOSAL_FILE_KINDS)[number];

/** What the file input offers. The server never trusts it. */
export const PROPOSAL_FILE_ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg";

export const PROPOSAL_FILE_TYPES: Record<ProposalFileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
};

const EXTENSIONS: Record<ProposalFileKind, readonly string[]> = { pdf: ["pdf"], docx: ["docx"], png: ["png"], jpg: ["jpg", "jpeg"] };

export interface ProposalLink {
  label: string;
  url: string;
}

/** A kept file: what the deciders' page lists. The bytes are `<id>.<kind>` in the proposal's private folder. */
export interface ProposalFile {
  id: string;
  kind: ProposalFileKind;
  name: string;
  size: number;
  sha256: string;
}

export const ATTACHMENT_WORDS = {
  linksHeading: "Links to your work (optional)",
  linksNote: `Up to ${PROPOSAL_LINKS_MAX} links, each starting with https://. We never open them for you: only the people who decide your proposal see them.`,
  filesHeading: "Files (optional)",
  filesNote: `Up to ${PROPOSAL_FILES_MAX} files: PDF, Word (.docx), PNG or JPG, ${PROPOSAL_FILE_MAX_BYTES / 1024 / 1024} MB each.`,
  /** The data promise, in one line on the form. */
  promise: "Only the people who decide your proposal can see your links and files. No AI reads them. We delete them when we delete your proposal, or when we remove your name and email.",
  // Refusals, each with what to do.
  tooManyLinks: `Add up to ${PROPOSAL_LINKS_MAX} links.`,
  linkNeedsLabel: "Give each link a few words saying what it is.",
  linkLabelTooLong: `Keep each link's label under ${PROPOSAL_LINK_LABEL_MAX} characters.`,
  linkNotHttps: "Each link has to be a full web address starting with https://.",
  linkTooLong: `Each link has to be under ${PROPOSAL_LINK_URL_MAX} characters.`,
  sameLinkTwice: "You added the same link twice.",
  tooManyFiles: `Attach up to ${PROPOSAL_FILES_MAX} files.`,
  fileTooBig: `Each file has to be ${PROPOSAL_FILE_MAX_BYTES / 1024 / 1024} MB or less.`,
  fileWrongType: "Attach PDF, Word (.docx), PNG or JPG files only. The file's contents have to match its name.",
  fileUnreadable: "We couldn't read one of those files. Try attaching it again.",
  // The deciders' page.
  shownHeading: "Links and files",
  shownNote: "Only the people who decide this proposal see these. Open links with care: they lead off this site.",
} as const;

/** A link as typed, checked. The first problem is answered. Never fetches anything. */
function linkOf(raw: unknown): { ok: true; link: ProposalLink } | { ok: false; error: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const label = String(typeof o.label === "string" ? o.label : "").replace(/\s+/g, " ").trim();
  const url = String(typeof o.url === "string" ? o.url : "").trim();
  if (!label) return { ok: false, error: ATTACHMENT_WORDS.linkNeedsLabel };
  if (label.length > PROPOSAL_LINK_LABEL_MAX) return { ok: false, error: ATTACHMENT_WORDS.linkLabelTooLong };
  if (url.length > PROPOSAL_LINK_URL_MAX) return { ok: false, error: ATTACHMENT_WORDS.linkTooLong };
  const safe = safeHttpsUrl(url);
  if (!safe) return { ok: false, error: ATTACHMENT_WORDS.linkNotHttps };
  return { ok: true, link: { label, url: safe } };
}

/**
 * The address as the page may draw it, or null. https only, a host with a dot
 * in it, no user name or password in it (`https://bank.example@evil.example`
 * reads as one place and goes to another), and no whitespace or control
 * characters. Returned as the URL parser writes it.
 */
export function safeHttpsUrl(raw: string): string | null {
  if (!raw || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (!u.hostname.includes(".") || u.hostname.endsWith(".")) return null;
  const out = u.toString();
  return out.length <= PROPOSAL_LINK_URL_MAX ? out : null;
}

/** The links a form sent, checked. Blank rows are dropped; anything else wrong is refused. */
export function parseProposalLinks(raw: unknown): { ok: true; links: ProposalLink[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, links: [] };
  if (!Array.isArray(raw)) return { ok: false, error: ATTACHMENT_WORDS.linkNotHttps };
  const rows = raw.filter((r) => {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    return String(o.label ?? "").trim() || String(o.url ?? "").trim();
  });
  if (rows.length > PROPOSAL_LINKS_MAX) return { ok: false, error: ATTACHMENT_WORDS.tooManyLinks };
  const links: ProposalLink[] = [];
  for (const r of rows) {
    const one = linkOf(r);
    if (!one.ok) return one;
    if (links.some((l) => l.url === one.link.url)) return { ok: false, error: ATTACHMENT_WORDS.sameLinkTwice };
    links.push(one.link);
  }
  return { ok: true, links };
}

/** Stored links, read back safely: anything that is not one is dropped. Never throws. */
export function linksOf(raw: unknown): ProposalLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalLink[] = [];
  for (const r of raw.slice(0, PROPOSAL_LINKS_MAX)) {
    const one = linkOf(r);
    if (one.ok) out.push(one.link);
  }
  return out;
}

/** What a file's first bytes say it is, or null when it is none of the four. */
export function sniffProposalFile(bytes: Uint8Array): ProposalFileKind | null {
  const at = (i: number, ...want: number[]) => want.every((b, k) => bytes[i + k] === b);
  if (bytes.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf"; // %PDF-
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "jpg";
  // A .docx is a zip with the Word part in it. Any other zip (a spreadsheet, an archive) is not one.
  if (bytes.length >= 4 && at(0, 0x50, 0x4b, 0x03, 0x04) && includesAscii(bytes, "word/document.xml")) return "docx";
  return null;
}

function includesAscii(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let k = 0; k < n.length; k++) if (bytes[i + k] !== n[k]) continue outer;
    return true;
  }
  return false;
}

/** The file's kind when its bytes and its name agree, else null. */
export function proposalFileKind(name: string, bytes: Uint8Array): ProposalFileKind | null {
  const kind = sniffProposalFile(bytes);
  if (!kind) return null;
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  return EXTENSIONS[kind].includes(ext) ? kind : null;
}

/** A file's name as the page may show it: no path, no control characters, capped. */
export function safeFileName(raw: string, kind: ProposalFileKind): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim();
  const name = clean.slice(0, PROPOSAL_FILE_NAME_MAX);
  return name || `file.${kind}`;
}

/** A file id: `pf-` and sixteen hex characters. The only thing the file door takes from the address bar. */
export const PROPOSAL_FILE_ID = /^pf-[0-9a-f]{16}$/;

/** Stored files, read back safely: anything that is not one is dropped. Never throws. */
export function filesOf(raw: unknown): ProposalFile[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalFile[] = [];
  for (const r of raw.slice(0, PROPOSAL_FILES_MAX)) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const id = typeof o.id === "string" && PROPOSAL_FILE_ID.test(o.id) ? o.id : null;
    const kind = (PROPOSAL_FILE_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as ProposalFileKind) : null;
    const sha256 = typeof o.sha256 === "string" && /^[0-9a-f]{64}$/.test(o.sha256) ? o.sha256 : null;
    const size = typeof o.size === "number" && Number.isFinite(o.size) && o.size > 0 && o.size <= PROPOSAL_FILE_MAX_BYTES ? Math.floor(o.size) : 0;
    if (!id || !kind || !sha256 || !size) continue;
    out.push({ id, kind, sha256, size, name: safeFileName(String(o.name ?? ""), kind) });
  }
  return out;
}

/** Where the deciders' page opens one file. */
export const proposalFileHref = (proposalId: string, fileId: string): string =>
  `/api/governance/open-proposals/${encodeURIComponent(proposalId)}/files/${encodeURIComponent(fileId)}`;

/** "12 KB", "3.4 MB". */
export function fileSizeWords(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
