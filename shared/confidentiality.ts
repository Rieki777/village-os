/**
 * THE CONFIDENTIALITY AGREEMENT, AS WORDS A MEMBER ALIGNS WITH (role journey L7).
 *
 * A village that keeps private records (finance, investor papers) asks the
 * people who will read them to align with its confidentiality agreement first.
 * The words are the VILLAGE'S OWN, kept as village data in its
 * `confidentiality` content section ({ title, body }), written in Admin by
 * whoever holds `story.tell`, the same door the covenant and the legal section
 * use. The platform ships no agreement of its own: a village that has written
 * none has nothing to align with, and says so.
 *
 * WHICH VERSION. The content section is overwritten in place and keeps no
 * history, so the version is the words themselves: the server fingerprints the
 * title and the body (`agreementVersionOf`, server/lib/confidentiality.ts). A
 * member aligned with one fingerprint read those words, and when the words
 * change the fingerprint changes and every holder is asked again
 * (`holdsCurrentAgreement`).
 *
 * ONE CLICK, IDENTITY RE-CONFIRMED. Aligning asks the village's identity
 * re-confirm every time it is older than fifteen minutes, as money terms do
 * (shared/alignments.ts, RECONFIRM_FRESH_MS): the agreement binds a person,
 * so a stolen session alone must not align anybody.
 *
 * Pure, so the page and the server import it alike.
 */
import type { AlignmentSubject } from "./alignments";

export const CONFIDENTIALITY: Extract<AlignmentSubject, "confidentiality"> = "confidentiality";

/** The content section the village's words live in. */
export const CONFIDENTIALITY_SECTION = "confidentiality";

/** What the agreement is called when the village wrote words but no title. */
export const DEFAULT_AGREEMENT_TITLE = "Confidentiality agreement";

/** An agreement version: `cv-` and sixteen hex characters, a fingerprint of the words. */
export const AGREEMENT_VERSION = /^cv-[0-9a-f]{16}$/;

/** A text's `subject_ref`: the version it holds, then the alignment it came from. At most 64 characters. */
export const confidentialityRef = (version: string, alignmentId: string): string => `${version}:${alignmentId}`;

/** The version a confidentiality text holds, or null for anything else. */
export function readConfidentialityRef(ref: string): { version: string; alignmentId: string } | null {
  const at = ref.indexOf(":");
  if (at < 0) return null;
  const version = ref.slice(0, at);
  const alignmentId = ref.slice(at + 1);
  return AGREEMENT_VERSION.test(version) && alignmentId ? { version, alignmentId } : null;
}

export interface AgreementWords {
  title: string;
  body: string;
  /** The sentence beside the button, kept on the alignment row. */
  intent: string;
}

/** The agreement as the server serves it: the words, and the version the page sends back. */
export interface ServedAgreement extends AgreementWords {
  version: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Line endings folded, trailing spaces gone, so a save from another machine is not new words. */
const tidy = (body: string): string =>
  body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();

/** The sentence beside the button. At most 300 characters. */
export function agreementIntent(title: string): string {
  return `I align with the ${title}.`.slice(0, 300);
}

/**
 * The village's words from its content section, or null when it has written
 * none. A section with a title and no body is no agreement.
 */
export function renderAgreement(section: unknown): AgreementWords | null {
  const o = section && typeof section === "object" ? (section as Record<string, unknown>) : {};
  const body = tidy(text(o.body));
  if (!body) return null;
  const title = (text(o.title) || DEFAULT_AGREEMENT_TITLE).slice(0, 200);
  return { title, body: `${body}\n`, intent: agreementIntent(title) };
}

/** What every surface says about the agreement. Never "sign" alone: aligning is the village's way of signing (D11). */
export const CONFIDENTIALITY_WORDS = {
  heading: (title: string) => `Align with the ${title}`,
  lede: "Some of the village's records are private. Before you read them, and before a role that needs them starts, you align with the village's confidentiality agreement.",
  asYou: "You align from your own account, and the village asks you to confirm it is you first.",
  aligned: "You are aligned with the words as they read now.",
  askedAgain: "The words changed since you aligned, so the village asks you to align again.",
  none: "The village has not written its confidentiality agreement yet.",
  changed: "The agreement changed while you were reading it. Read it again, then align.",
  unreadable: "The agreement could not be read just now. Try again in a moment.",
} as const;
