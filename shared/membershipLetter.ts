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
 *                (`project.commitmentName`), and the two content sections a
 *                founder writes in Admin (`covenant`, `legal`). The server
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

/** The subject type a membership letter's text is stored under. */
export const MEMBERSHIP = "membership";

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
export function letterSourceFrom(config: any, content: { covenant?: unknown; legal?: unknown } | null | undefined): LetterSource {
  return {
    villageName: text(config?.project?.name) || "the village",
    tokenName: text(config?.currency?.name) || "recognition",
    commitmentName: text(config?.project?.commitmentName) || DEFAULT_COMMITMENT_NAME,
    covenant: (content?.covenant as LetterSource["covenant"]) ?? null,
    legal: (content?.legal as LetterSource["legal"]) ?? null,
  };
}

/** The eight commitments. The covenant names the village in one of them. */
export function letterCommitments(villageName: string): string[] {
  return [
    "Treat all beings with respect, compassion, and authentic communication",
    "Participate in community governance through our sociocratic circles",
    "Contribute to the regeneration of the land and ecosystem",
    "Support fellow community members in their growth and wellbeing",
    `Honor the values and agreements of the ${villageName} community`,
    "Practice Nonviolent Communication and authentic relating",
    "Meet financial obligations as agreed with the community",
    "Show up for community life, circles, celebrations, and shared care",
  ];
}

/** The entity a member joins: the village's published one, else the village's own name. A name, never a legal claim. */
export function letterEntity(src: LetterSource): string {
  return text(src.legal?.membership?.entityLabel) || src.villageName;
}

/** The letter, paragraph by paragraph, in the order the page draws it. */
export function letterParts(src: LetterSource): LetterParts {
  const village = src.villageName;
  const entity = letterEntity(src);
  return {
    greeting: `Dear Future ${village} Family Member,`,
    opening: text(src.covenant?.opening) || DEFAULT_OPENING,
    joining:
      "By signing this Love Letter, you are not just joining a community. You are becoming a co-creator of the most beautiful village we can imagine together. You are saying yes to regeneration, of the land, of community, of yourself.",
    commitLead: `As a member of ${entity}, you commit to:`,
    commitments: letterCommitments(village),
    inReturn: `In return, you become a full member of ${entity}, gaining access to community spaces, governance participation, ${src.tokenName} economy, and the opportunity to deepen your involvement through roles, residency, or business creation.`,
    governance: text(src.covenant?.governance) || DEFAULT_GOVERNANCE,
    contribution: text(src.legal?.membership?.contributionParagraph) || null,
    closing: "With love and anticipation,",
    signature: `The ${village} Community`,
  };
}

/** The plain words the store keeps: every part, in order, one paragraph a block, the commitments one a line. */
export function letterBody(p: LetterParts): string {
  const blocks = [
    p.greeting,
    p.opening,
    p.joining,
    [p.commitLead, ...p.commitments.map((c) => `  ${c}`)].join("\n"),
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

/** What the page says to a member about aligning with the letter. Never "sign": that word is the letter's own. */
export const LETTER_WORDS = {
  readReflect: "Read. Reflect. Align.",
  heading: (title: string) => `Align with the ${title}`,
  lede: (village: string) => `Read the letter above, add a few words about yourself, and align from your account to join the ${village} Family.`,
  asYou: (name: string) => `Aligning as ${name}, from your account. No typed name.`,
  button: (village: string) => `Align and join the ${village} Family`,
  busy: "Aligning…",
  kept: "Your alignment is kept under What you have aligned with, on your profile.",
  changed: "The letter changed while you were reading it. Read it again, then align.",
  unreadable: "The letter could not be read just now, so there is nothing to align with yet. Try again in a moment.",
  done: "You aligned with the letter. The village has your request.",
} as const;
