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

// ── Endings (PR8) ────────────────────────────────────────────────────────────

/** How a text stops being in force (0251). Insert only: a withdrawal is its own row. */
export const ENDING_KINDS = ["notice", "notice_withdrawn", "superseded", "mutual", "term_end", "party_left"] as const;
export type EndingKind = (typeof ENDING_KINDS)[number];

/** An ending id: `ae-` and sixteen hex characters. */
export const ENDING_ID = /^ae-[0-9a-f]{16}$/;

/**
 * The notice a party gives when the terms name none, in days. Two weeks, the
 * figure every platform term preset and the ending preset carry
 * (shared/seatPresets.ts), so terms written without an ending group read the
 * same as the presets a member most likely started from.
 */
export const DEFAULT_NOTICE_DAYS = 14;

/**
 * The notice these terms ask for: the ending group's days, else the term
 * group's, else the default. `from` says which, so the page can say it.
 */
export function noticeDaysOf(settings: SeatSettings | null | undefined): { days: number; from: "ending" | "term" | "default" } {
  const ending = settings?.ending?.noticeDays;
  if (typeof ending === "number" && Number.isFinite(ending) && ending >= 0) return { days: Math.floor(ending), from: "ending" };
  const term = settings?.term?.noticeDays;
  if (typeof term === "number" && Number.isFinite(term) && term >= 0) return { days: Math.floor(term), from: "term" };
  return { days: DEFAULT_NOTICE_DAYS, from: "default" };
}

/** One ending row, as the derivation reads it. `effectiveAt` and `at` are ISO instants. */
export interface EndingInput {
  id: string;
  kind: EndingKind;
  refersTo: string | null;
  partyKey: string | null;
  effectiveAt: string;
}

/** The ending that ended a text, or the one running toward it. */
export interface DerivedEnding {
  kind: Exclude<EndingKind, "notice_withdrawn">;
  /** When it took or takes effect, ISO. */
  at: string;
  /** The party who gave it, for a notice; null for a fact the sweep wrote. */
  partyKey: string | null;
  /** For superseded, the text that superseded it. */
  refersTo: string | null;
}

/** A notice or an ask to end by agreement that has not taken effect and was not taken back. */
export interface OpenAsk {
  id: string;
  partyKey: string;
  /** For a notice, when it takes effect. For an ask, when it was made. ISO. */
  at: string;
}

/**
 * Read the endings: which one (if any) has ended the text by `now`, the
 * notices still running, and the asks to end by agreement still open.
 *
 * A NOTICE OR AN ASK TAKEN BACK ENDS NOTHING: a `notice_withdrawn` row names
 * it in `refers_to`. A notice ends the text at its `effective_at`. An ask to
 * end by agreement ends it once EVERY required party has one open, at the
 * moment the last of them asked. Superseded, term_end and party_left end it at
 * their own instant. The earliest ending that has taken effect wins.
 */
export function readEndings(
  endings: readonly EndingInput[],
  requiredParties: readonly string[],
  now: string,
): { ended: DerivedEnding | null; notices: OpenAsk[]; asks: OpenAsk[] } {
  const withdrawn = new Set(endings.filter((e) => e.kind === "notice_withdrawn" && e.refersTo).map((e) => e.refersTo as string));
  const live = endings.filter((e) => e.kind !== "notice_withdrawn" && !withdrawn.has(e.id));
  const taken: DerivedEnding[] = [];
  const notices: OpenAsk[] = [];
  for (const e of live) {
    if (e.kind === "mutual") continue;
    if (e.effectiveAt <= now) taken.push({ kind: e.kind as DerivedEnding["kind"], at: e.effectiveAt, partyKey: e.partyKey, refersTo: e.refersTo });
    else if (e.kind === "notice" && e.partyKey) notices.push({ id: e.id, partyKey: e.partyKey, at: e.effectiveAt });
  }
  // One open ask per party: the earliest that was not taken back.
  const asks: OpenAsk[] = [];
  for (const e of [...live].filter((x) => x.kind === "mutual" && x.partyKey).sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : 1))) {
    if (!asks.some((a) => a.partyKey === e.partyKey)) asks.push({ id: e.id, partyKey: e.partyKey as string, at: e.effectiveAt });
  }
  const agreed = requiredParties.length > 0 && requiredParties.every((p) => asks.some((a) => a.partyKey === p));
  if (agreed) {
    const last = asks.filter((a) => requiredParties.includes(a.partyKey)).reduce((m, a) => (a.at > m ? a.at : m), "");
    if (last <= now) taken.push({ kind: "mutual", at: last, partyKey: null, refersTo: null });
  }
  taken.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const ended = taken[0] ?? null;
  return { ended, notices: ended ? [] : notices, asks: ended || agreed ? [] : asks };
}

/**
 * One line about how the terms are ending or ended, as every surface prints
 * it: the drawer, the profile, the application page and /aligned. `on` is a
 * day already in words, in the village's zone. Keyed by the kind, so a new
 * kind cannot print blank.
 */
export const ENDING_WORDS: Record<DerivedEnding["kind"], (on: string, version: number) => string> = {
  notice: (on) => `Ended by notice on ${on}`,
  mutual: (on) => `Ended by agreement on ${on}`,
  superseded: (_on, version) => `Superseded by version ${version}`,
  term_end: (on) => `The term ended on ${on}`,
  party_left: (on) => `Ended on ${on}, when a party left the village`,
};

export const ENDINGS_WORDS = {
  noticeRunning: (on: string) => `Notice given, ends ${on}`,
  asked: (who: string) => `${who} asked to end by agreement`,
  giveNotice: "Give notice",
  giveNoticeFor: "Give notice for the village",
  noticeLine: (days: number) =>
    `Giving notice ends these terms ${days === 0 ? "at once" : `in ${days} ${days === 1 ? "day" : "days"}`}. Nothing unseats anybody: the seat ends through the village's own doors. You can take it back until it takes effect.`,
  confirmNotice: "Give notice now",
  takeBackNotice: "Take back the notice",
  endByAgreement: "End by agreement",
  endByAgreementFor: "End by agreement for the village",
  agreementLine: "The terms end once every party asks. Until then you can take your ask back.",
  takeBackAsk: "Take back the ask",
  cancel: "Keep the terms",
  yourNotice: (on: string) => `Your notice runs until ${on}.`,
  villageNotice: (on: string) => `The village's notice runs until ${on}.`,
  youAsked: "You asked to end these terms by agreement.",
  villageAsked: "The village asked to end these terms by agreement.",
  forTheVillage: "For the village",
  /** On the way out: the member reads which terms their leaving ends. */
  leavingEnds: "Leaving ends these terms you have aligned with:",
  leavingNeverWaits: "Leaving never waits on terms. Each one is recorded as ended when a party left the village.",
  leftEnded: "These terms ended when you left:",
} as const;

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
  /** The text's endings (PR8). Absent reads as none. */
  endings?: readonly EndingInput[];
  /** Now, ISO. Endings take effect against it. Absent: the start of `today`'s day after, so only the day counts. */
  now?: string;
  /** The instant the term ends, ISO, so a term's end and an ending can be put in order. */
  termEndAt?: string | null;
}

export interface DerivedState {
  state: AlignmentState;
  /** True when every required party aligned with the hash the text carries. */
  allAligned: boolean;
  /** The required parties still to align. */
  waitingOn: string[];
  /** Why it is pending or ended, in words. Null when in force. */
  why: string | null;
  /** What ended it (PR8): an ending row, the term, the seating, or the application closing. Null while not ended. */
  endedBy: "ending" | "term" | "seating" | "closed" | null;
  /** The ending that ended it, when `endedBy` is "ending", or the term's end when "term". */
  ending: DerivedEnding | null;
  /** Notices given and still running. Empty once ended. */
  notices: OpenAsk[];
  /** Open asks to end by agreement. Empty once ended. */
  asks: OpenAsk[];
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
  const required = s.parties.filter((p) => p.required).map((p) => p.partyKey);
  const waitingOn = required.filter((p) => !matched.has(p));
  const allAligned = waitingOn.length === 0;
  // With no instant handed in, an ending counts once its day has begun after today.
  const now = s.now ?? `${s.today}T23:59:59.999Z`;
  const read = readEndings(s.endings ?? [], required, now);
  const out = (state: AlignmentState, why: string | null, endedBy: DerivedState["endedBy"] = null, ending: DerivedEnding | null = null): DerivedState => ({
    state,
    allAligned,
    waitingOn,
    why,
    endedBy,
    ending,
    notices: state === "ended" ? [] : read.notices,
    asks: state === "ended" ? [] : read.asks,
  });

  if (s.closed) return out("ended", s.closed, "closed");
  /*
   * AN ENDING AND THE TERM'S END, IN ORDER (PR8). A non-withdrawn ending whose
   * moment has passed ends the text; so does the term. When both have, the
   * earlier one is what ended it, so a notice that ran out before the term
   * reads as notice and a notice running past the term reads as the term.
   */
  const termOver = !!s.effectiveTo && s.today > s.effectiveTo;
  const termAt = termOver ? (s.termEndAt ?? "") : null;
  if (read.ended && (termAt === null || read.ended.at < termAt)) return out("ended", null, "ending", read.ended);
  if (termOver) {
    return out("ended", "The term these terms ran for has ended.", "term", { kind: "term_end", at: termAt ?? "", partyKey: null, refersTo: null });
  }
  if (!allAligned) return out("pending", "Waiting for every party to align.");
  if (s.effectiveFrom && s.today < s.effectiveFrom) return out("pending", "Aligned, and waiting for the first day it names.");
  if (s.seatings) {
    if (s.seatings.open > 0) return out("in-force", null);
    if (s.seatings.total > 0) return out("ended", "The seating these terms were held on has ended.", "seating");
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
export function alignedOnWords(iso: string, timeZone?: string | null): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  // A civil date reads as written; an instant reads in the village's zone (red team U6).
  const zone = iso.length === 10 || !timeZone ? "UTC" : timeZone;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: zone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  }
}
