/**
 * THE ALIGNMENT STORE, THE PART WITH NO DATABASE IN IT (seat settings PR5).
 *
 * Aligning is one click from a member's own account (Rye, 2026-10-01): no
 * typed name, no drawn signature. What the click binds to is a TEXT, the exact
 * words shown beside the button, written once and never updated. This file
 * holds what every side of that agrees on:
 *
 *   the words      `renderSeatTermsText` turns seat names and settings into the
 *                  title and body a member reads at Review and on the page. The
 *                  server stores what this returns, and the page shows what the
 *                  server stored, so there is one rendering.
 *   the sentence   `intentSentence` is the line beside the button, kept on the
 *                  alignment row.
 *   the money      `carriesMoney` says when aligning asks the identity
 *                  re-confirm (decision 3, 2026-10-09).
 *   in force       `deriveAlignmentState` decides pending, in force or ended
 *                  from rows, never from a stored flag.
 *
 * The UI says "Align" and "Aligned", never "sign". The hash, the version and
 * the salt live in the receipt, never beside the button.
 *
 * Money in these words is a record. Nothing here pays, posts or settles.
 */
import { seatList } from "./seatApplications";
import { MONEY_GROUPS, settingsWords, type SeatSettings } from "./seatSettings";

/** The subjects a text can be about. Seat terms today; the rest arrive with their own PRs. */
export const SEAT_TERMS = "seat_terms";
export type AlignmentSubject = typeof SEAT_TERMS;

/** The village, as a party. A member is `user:<id>`. */
export const VILLAGE_PARTY = "village";
export const userParty = (userId: string): string => `user:${userId}`;

/** How each party holds the terms, as the receipt and the chips say it. */
export const CAPACITY = {
  individually: "individually",
  forTheVillage: "for the village",
} as const;

export const ALIGN_METHODS = ["click", "holder", "ballot"] as const;
export type AlignMethod = (typeof ALIGN_METHODS)[number];

/** A text id: `at-` and sixteen hex characters. */
export const TEXT_ID = /^at-[0-9a-f]{16}$/;
/** A sha256 in lowercase hex. */
export const HASH = /^[0-9a-f]{64}$/;

/** How long an identity re-confirm stands before money terms ask again. */
export const RECONFIRM_FRESH_MS = 15 * 60 * 1000;

export const ALIGN_WORDS = {
  align: "Align",
  aligned: "Aligned",
  proposeAndAlign: "Propose and align",
  forTheVillage: "Align for the village",
  ownTerms: "Your own terms go to the village to adopt.",
  youAligned: (on: string) => `You aligned on ${on}`,
  partyAligned: (who: string) => `${who}, aligned`,
  partyWaiting: (who: string) => `${who}, not yet`,
  village: "The village",
  formerMember: "A former member",
  sectionHeading: "What you have aligned with",
  theirHeading: "What they have aligned with",
  pending: "Waiting",
  inForce: "In force",
  ended: "Ended",
  unsealed: "Unsealed",
  receipt: "Download the receipt",
  reconfirmLine: "These terms carry money, so the village asks you to confirm it is you before you align.",
  reconfirm: "Confirm it is you",
  reconfirmed: "Confirmed. You can align for the next fifteen minutes.",
  wordsChanged: "The words changed since you read them. Read them again before you align.",
} as const;

/** Whether these terms record money: pay, allowance or bonus of a kind other than none or honorary. */
export function carriesMoney(settings: SeatSettings | null | undefined): boolean {
  if (!settings) return false;
  return MONEY_GROUPS.some((g) => {
    const value = (settings as unknown as Record<string, { kind?: unknown } | undefined>)[g];
    if (!value || typeof value !== "object") return false;
    return value.kind !== "none" && value.kind !== "honorary";
  });
}

/** The sentence beside the button, kept on the alignment row. At most 300 characters. */
export function intentSentence(seatNames: readonly string[], forTheVillage = false): string {
  const who = forTheVillage ? "The village aligns" : "I align";
  return `${who} with these terms for ${seatList(seatNames)}.`.slice(0, 300);
}

export interface RenderedText {
  title: string;
  body: string;
}

/**
 * The words a member aligns with, for an application's seats and terms.
 *
 * Built from the seat names and `settingsWords` alone, so nothing the member
 * did not see can be in it. No candidate name: the parties carry who, and a
 * name in the words would be one more thing an erasure has to find.
 */
export function renderSeatTermsText(seatNames: readonly string[], settings: SeatSettings): RenderedText {
  const title = `Terms for ${seatList(seatNames)}`.slice(0, 200);
  const rows = settingsWords(settings);
  const set = rows.filter((r) => r.set);
  const unset = rows.filter((r) => !r.set);
  const lines = [
    title,
    "",
    seatNames.length === 1 ? "THE SEAT" : "THE SEATS",
    ...seatNames.map((n) => `  ${n.trim()}`),
    "",
    "THE TERMS",
    ...set.flatMap((r) => [
      `  ${r.label}: ${r.headline}`,
      ...r.lines.map((l) => `    ${l}`),
      ...(r.moneyLine ? [`    ${r.moneyLine}`] : []),
    ]),
    ...(set.length === 0 ? ["  None set."] : []),
    ...(unset.length > 0 ? ["", `Not set: ${unset.map((r) => r.label).join(", ")}.`] : []),
    "",
  ];
  return { title, body: lines.join("\n") };
}

// ── In force ─────────────────────────────────────────────────────────────────

export type AlignmentState = "pending" | "in-force" | "ended";

export interface StateInput {
  contentHash: string;
  /** Every party, required or not. */
  parties: ReadonlyArray<{ partyKey: string; required: boolean }>;
  alignments: ReadonlyArray<{ partyKey: string; contentHash: string }>;
  /** YYYY-MM-DD, or null for "from the start". */
  effectiveFrom: string | null;
  /** YYYY-MM-DD, or null for "no end written". */
  effectiveTo: string | null;
  /** Today in the village's calendar, YYYY-MM-DD. */
  today: string;
  /**
   * For seat terms: the seatings that carry the application's id. Null for a
   * subject with no seating behind it.
   */
  seatings: { open: number; total: number } | null;
  /** The subject closed before the terms could hold, in words, or null. */
  closed: string | null;
}

export interface DerivedState {
  state: AlignmentState;
  /** True when every required party aligned with the hash the text carries. */
  allAligned: boolean;
  /** The required parties still to align. */
  waitingOn: string[];
  /** Why it is pending or ended, in words. Null when in force. */
  why: string | null;
}

/**
 * Whether a text is in force, derived and never stored.
 *
 * In force when every required party has aligned with the hash the text
 * carries, today sits inside the effective window, and, for seat terms, at
 * least one seating carrying the application's id is open. That last rule is
 * why a seating ended by ANY door ends the terms, without every door having to
 * write a row about it.
 */
export function deriveAlignmentState(s: StateInput): DerivedState {
  const matched = new Set(s.alignments.filter((a) => a.contentHash === s.contentHash).map((a) => a.partyKey));
  const waitingOn = s.parties.filter((p) => p.required && !matched.has(p.partyKey)).map((p) => p.partyKey);
  const allAligned = waitingOn.length === 0;
  const out = (state: AlignmentState, why: string | null): DerivedState => ({ state, allAligned, waitingOn, why });

  if (s.closed) return out("ended", s.closed);
  if (s.effectiveTo && s.today > s.effectiveTo) return out("ended", "The term these terms ran for has ended.");
  if (!allAligned) return out("pending", "Waiting for every party to align.");
  if (s.effectiveFrom && s.today < s.effectiveFrom) return out("pending", "Aligned, and waiting for the first day it names.");
  if (s.seatings) {
    if (s.seatings.open > 0) return out("in-force", null);
    if (s.seatings.total > 0) return out("ended", "The seating these terms were held on has ended.");
    return out("pending", "Aligned, and waiting for the seats to be taken up.");
  }
  return out("in-force", null);
}

/** The state as a member reads it. Keyed by the union, so a new state cannot render blank. */
export const STATE_WORDS: Record<AlignmentState, string> = {
  pending: ALIGN_WORDS.pending,
  "in-force": ALIGN_WORDS.inForce,
  ended: ALIGN_WORDS.ended,
};

/** "9 Oct 2026", from an instant or a date. */
export function alignedOnWords(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
