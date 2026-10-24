/**
 * THE MEMBERSHIP LETTER, AS WORDS A MEMBER ALIGNS WITH (seat settings PR9).
 *
 * The letter a member reads on the Love Letter page (`/love-letter`) used to
 * be assembled inside that page, so the only copy of what a member agreed to
 * was the page as it happened to render that day. Aligning with it now writes
 * those words into the alignment store, which means there has to be ONE
 * rendering that the page shows and the server stores. This is it.
 *
 *   the source   `letterSourceFrom` reads the village's own inputs: its name,
 *                its recognition token's name, what it calls the letter
 *                (`project.commitmentName`), and the three content sections a
 *                founder writes in Admin (`covenant`, `legal`, and since
 *                2026-10-22 `page-love-letter`, the letter's own words from
 *                Admin, Pages, read here so the page and the server agree). The server
 *                passes `mergedConfig()` and the content document; the page,
 *                while the server's copy is on its way, passes the same values
 *                as `/api/game/config` and `/api/content` serve them.
 *   the parts    `letterParts` is the letter paragraph by paragraph, which is
 *                what the page draws.
 *   the words    `letterBody` joins the parts into the plain text the store
 *                keeps and the receipt hashes. Every part is in it, in the
 *                order the page draws them, and nothing else is.
 *
 * The words are the letter exactly as the page has always shown it, the
 * village's own paragraphs and the platform's fallbacks for a village that has
 * not written its own. Its own sentence about signing stays: it is the
 * village's letter, and changing it would change every village's letter.
 *
 * WHICH VERSION. The village keeps no versions of its letter: the content
 * sections are overwritten in place and nothing records who wrote them or
 * when. So the version is the words themselves: the server fingerprints the
 * title and the body (`letterVersionOf`, server/lib/membershipLetter.ts), and
 * two members who aligned with the same fingerprint read the same words.
 *
 * Pure, so the page and the server import it alike, and a test pins it.
 */

import type { AlignmentSubject } from "./alignments";
import { LOVE_LETTER_PAGE } from "./pageContent/loveLetter";
import { resolvePage } from "./pageContent/resolve";
import { pageSectionKey, type PageVars } from "./pageContent/types";
import { pageVarsFrom } from "./pageContent/vars";
import { articleFor } from "./villageWord";

/**
 * The subject type a membership letter's text is stored under. Typed against
 * the store's own union (shared/alignments.ts), so the two names cannot drift;
 * the import is a type only, so the page that draws the letter loads nothing
 * of the store.
 */
export const MEMBERSHIP: Extract<AlignmentSubject, "membership"> = "membership";

/** What the village calls the letter when it has not named it. The platform's word, as shared/gameConfig.ts holds it. */
export const DEFAULT_COMMITMENT_NAME = "membership agreement";

/** A letter version: `lv-` and sixteen hex characters, a fingerprint of the words. */
export const LETTER_VERSION = /^lv-[0-9a-f]{16}$/;

/**
 * A membership text's `subject_ref`: the letter version it holds, then the
 * signing it came from. Keyed by the version, so every member who aligned
 * with one set of words shares the prefix; unique by the signing, because the
 * store allows one text per (subject, ref, version) and each member's
 * alignment is its own text, with its own parties, hash and endings.
 */
export const membershipRef = (letterVersion: string, signingId: string): string => `${letterVersion}:${signingId}`;

/** The two halves of a membership text's `subject_ref`, or null for anything else. */
export function readMembershipRef(ref: string): { letterVersion: string; signingId: string } | null {
  const at = ref.indexOf(":");
  if (at < 0) return null;
  const letterVersion = ref.slice(0, at);
  const signingId = ref.slice(at + 1);
  return LETTER_VERSION.test(letterVersion) && signingId ? { letterVersion, signingId } : null;
}

/** The opening, for a village that has not written its own (LoveLetter.tsx carried it until PR9). */
export const DEFAULT_OPENING =
  "Something in you called you here. Maybe it was the land itself, alive with possibility. Maybe it was the vision of a village where all beings belong and thrive. Maybe it was simply the feeling that the world you want to live in needs to be built.";

/** How the village will govern itself, for a village that has not written its own. */
export const DEFAULT_GOVERNANCE =
  "How residents govern themselves, and how we steward this land together, will be co-created by the first residents. Nothing here is handed down. You are not joining a finished system; you are helping write it.";

export interface LetterSource {
  /** The village's name. Never blank: the caller passes its own fallback. */
  villageName: string;
  /** The recognition token's name. */
  tokenName: string;
  /** What the village calls the letter: "Love Letter", or the platform's "membership agreement". */
  commitmentName: string;
  /** The `covenant` content section: the two paragraphs that describe this village's own land and plan. */
  covenant?: { opening?: unknown; governance?: unknown } | null;
  /** The `legal` content section: the entity a member joins and the contribution paragraph. */
  legal?: { membership?: { entityLabel?: unknown; contributionParagraph?: unknown } | null } | null;
  /**
   * The `page-love-letter` content section, as stored: the village's own words
   * for the rest of the letter (greeting, commitments, closing...). Absent or
   * null is the platform's words, which are the letter as it always read.
   */
  page?: unknown;
  /** The village's other `{words}` (tagline, location, member...), as the page fills them. */
  words?: PageVars | null;
}

export interface LetterParts {
  greeting: string;
  opening: string;
  joining: string;
  commitLead: string;
  commitments: string[];
  inReturn: string;
  governance: string;
  /** The village's contribution paragraph, when it published one. */
  contribution: string | null;
  closing: string;
  signature: string;
}

/** The letter as the server serves it and the store keeps it. */
export interface ServedLetter {
  /** `lv-` and sixteen hex characters. The page sends it back when a member aligns. */
  version: string;
  title: string;
  body: string;
  parts: LetterParts;
  /** The sentence beside the button, kept on the member's alignment row. */
  intent: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The letter's inputs from what the server's config and content document
 * hold, or what the page's config and content hooks serve: the same values
 * either way. `config` is `mergedConfig()` or `/api/game/config`; `content`
 * maps a section name to what that section holds.
 */
export function letterSourceFrom(
  config: any,
  content: { covenant?: unknown; legal?: unknown; [section: string]: unknown } | null | undefined,
): LetterSource {
  return {
    villageName: text(config?.project?.name) || "the village",
    tokenName: text(config?.currency?.name) || "recognition",
    commitmentName: text(config?.project?.commitmentName) || DEFAULT_COMMITMENT_NAME,
    covenant: (content?.covenant as LetterSource["covenant"]) ?? null,
    legal: (content?.legal as LetterSource["legal"]) ?? null,
    page: content?.[LETTER_PAGE_SECTION] ?? null,
    words: pageVarsFrom(config),
  };
}

/** The content section the letter's own words are stored under: `page-love-letter`. */
export const LETTER_PAGE_SECTION = pageSectionKey(LOVE_LETTER_PAGE);

/** The entity a member joins: the village's published one, else the village's own name. A name, never a legal claim. */
export function letterEntity(src: LetterSource): string {
  return text(src.legal?.membership?.entityLabel) || src.villageName;
}

/**
 * The `{words}` the letter's fields are filled with. The village's name, its
 * token, its name for the letter and the entity a member joins come from the
 * source itself, so they are the same words the title and the rest of the
 * letter use; every other word is the page's own (`pageVarsFrom`).
 */
export function letterVars(src: LetterSource): PageVars {
  return {
    ...(src.words ?? {}),
    village: src.villageName,
    token: src.tokenName,
    commitment: src.commitmentName,
    entity: letterEntity(src),
  };
}

/**
 * The letter, paragraph by paragraph, in the order the page draws it.
 *
 * Every part except the covenant's two paragraphs and the contribution
 * paragraph is a field of the page (shared/pageContent/loveLetter.ts), read
 * from what the village stored or its default. The defaults are the letter's
 * words as they were, so a village that calls its letter "Love Letter" and has
 * written none of these reads, and aligns with, exactly the letter it had.
 */
export function letterParts(src: LetterSource): LetterParts {
  const own = resolvePage(LOVE_LETTER_PAGE, src.page, letterVars(src)).letter;
  return {
    greeting: own.fields.greeting,
    opening: text(src.covenant?.opening) || DEFAULT_OPENING,
    joining: own.fields.joining,
    commitLead: own.fields.commitLead,
    // A row left blank in the editor is not a commitment.
    commitments: own.lists.commitments.map((row) => row.text ?? "").filter((c) => c.trim() !== ""),
    inReturn: own.fields.inReturn,
    governance: text(src.covenant?.governance) || DEFAULT_GOVERNANCE,
    contribution: text(src.legal?.membership?.contributionParagraph) || null,
    closing: own.fields.closing,
    signature: own.fields.signature,
  };
}

/**
 * The plain words the store keeps: every part, in order, one paragraph a
 * block, the commitments one a line. With no commitments the line that leads
 * into them goes too, as it does on the page.
 */
export function letterBody(p: LetterParts): string {
  const blocks = [
    p.greeting,
    p.opening,
    p.joining,
    ...(p.commitments.length ? [[p.commitLead, ...p.commitments.map((c) => `  ${c}`)].join("\n")] : []),
    p.inReturn,
    p.governance,
    ...(p.contribution ? [p.contribution] : []),
    [p.closing, p.signature].join("\n"),
  ];
  return `${blocks.join("\n\n")}\n`;
}

/** The letter's title: what the village calls it, with a capital. At most 200 characters. */
export function letterTitle(commitmentName: string): string {
  const name = text(commitmentName) || DEFAULT_COMMITMENT_NAME;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`.slice(0, 200);
}

/** The sentence beside the button, kept on the alignment row. At most 300 characters. */
export function letterIntent(title: string): string {
  return `I align with the ${title}.`.slice(0, 300);
}

/** Title, words and parts, from one source. The server adds the version. */
export function renderMembershipLetter(src: LetterSource): Omit<ServedLetter, "version"> {
  const parts = letterParts(src);
  const title = letterTitle(src.commitmentName);
  return { title, body: letterBody(parts), parts, intent: letterIntent(title) };
}

/**
 * What the page says to a member about aligning with the letter. Never "sign": that word is the letter's own.
 *
 * `member` is the village's word for a member (Admin, Make This Yours, "What
 * a member is called"). These said "join the {village} Family", one village's
 * own word for its members, under every village's name, while the setting
 * that names them was read nowhere (audit, 2026-10-22).
 */
export const LETTER_WORDS = {
  readReflect: "Read. Reflect. Align.",
  heading: (title: string) => `Align with the ${title}`,
  lede: (village: string, member: string) =>
    `Read the letter above, add a few words about yourself, and align from your account to join ${village} as ${articleFor(member)} ${member}.`,
  asYou: (name: string) => `Aligning as ${name}, from your account. No typed name.`,
  button: (village: string) => `Align and join ${village}`,
  busy: "Aligning…",
  kept: "Your alignment is kept under What you have aligned with, on your profile.",
  changed: "The letter changed while you were reading it. Read it again, then align.",
  unreadable: "The letter could not be read just now, so there is nothing to align with yet. Try again in a moment.",
  done: "You aligned with the letter. The village has your request.",
} as const;
