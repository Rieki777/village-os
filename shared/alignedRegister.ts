/**
 * THE ALIGNED REGISTER, THE PART EVERY SIDE AGREES ON (seat settings PR6).
 *
 * `/aligned` lists every text the village holds in the alignment store, every
 * version, for a member holding `terms.read`. This file names the KINDS of
 * text the register shows and the shape of one row.
 *
 * ── KINDS ──────────────────────────────────────────────────────────────────
 *
 * One kind ships today: "Seat terms", the words a member aligns with when they
 * apply to hold seats. Two more have their places kept and are not built:
 *
 *   "Membership letter"   seat settings PR9, subject type `membership`
 *   "Village agreement"   after the held agreements lane lands, subject `agreement`
 *
 * A kind joins the register by gaining an entry in REGISTER_KINDS, with the
 * capability that opens it. The route reads only the kinds the viewer holds
 * the capability for, so a kind that opens at another rung needs no new door.
 *
 * ── WHAT A ROW CARRIES ─────────────────────────────────────────────────────
 *
 * The title, the words, every party by display name and capacity, the state
 * (derived, never stored), the day it came fully aligned in the village's own
 * time zone, and how the village aligned: the ballot that adopted it, or the
 * holder who aligned for the village. The content hash rides only to a party
 * (red team S5): a member who is not a party reads the words, never the hash.
 */
import type { AlignmentState } from "./alignments";
import type { Capability } from "./capabilities";

export interface RegisterKind {
  /** The `subject_type` its texts are stored under. */
  id: string;
  /** The heading and the eyebrow on its rows. */
  label: string;
  /** The capability that opens it. */
  capability: Capability;
}

/**
 * The kinds the register shows, in the order a reader meets them. Add one
 * here, with its capability, when its subject ships. Never remove one: a
 * village's record of what it aligned with does not shrink.
 */
export const REGISTER_KINDS: readonly RegisterKind[] = [
  { id: "seat_terms", label: "Seat terms", capability: "terms.read" },
  // Seat settings PR9: { id: "membership", label: "Membership letter", capability: "terms.read" },
  // After the agreements lane lands: { id: "agreement", label: "Village agreement", capability: "terms.read" },
];

export const kindLabel = (id: string): string => REGISTER_KINDS.find((k) => k.id === id)?.label ?? "Terms";

/** One page of the register. The page asks for more by offset; there is no count. */
export const REGISTER_PAGE = 50;
export const REGISTER_PAGE_MAX = 100;
/** How many of the newest texts one search reads, and how many hits it answers with. */
export const REGISTER_SEARCH_READS = 1000;
export const REGISTER_SEARCH_HITS = 50;
/** A search is at most this long. */
export const REGISTER_QUERY_MAX = 200;

export interface RegisterParty {
  partyKey: string;
  /** A display name, "The village", or "A former member". Never an id. */
  label: string;
  /** "individually", "for the village". */
  capacity: string;
  required: boolean;
  aligned: boolean;
  /** The day they aligned, YYYY-MM-DD in the village's zone. */
  alignedOn: string | null;
}

/** How the village came to align. */
export type VillageAligned =
  | { by: "ballot"; ballotId: string; href: string }
  | { by: "holder"; name: string }
  | null;

export interface RegisterRow {
  textId: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  version: number;
  seatNames: string[];
  state: AlignmentState;
  why: string | null;
  sealed: boolean;
  money: boolean;
  parties: RegisterParty[];
  /** The day the last required party aligned, YYYY-MM-DD in the village's zone. Null while waiting. */
  alignedOn: string | null;
  /** The day the words were written, YYYY-MM-DD in the village's zone. */
  writtenOn: string | null;
  /** The year this row is filed under: the year it was written, in the village's zone. */
  year: string;
  village: VillageAligned;
  /** The application the words belong to. */
  href: string | null;
  /** Only to a party. Null for everybody else. */
  contentHash: string | null;
}

export interface RegisterPage {
  kinds: Array<{ id: string; label: string }>;
  rows: RegisterRow[];
  /** A full page came back, so there may be more. Never a count. */
  more: boolean;
  /** The search this page answers, or null for the record in order. */
  query: string | null;
}

export const ALIGNED_WORDS = {
  menu: "Aligned",
  eyebrow: "The village's record",
  title: "Aligned",
  lede: "Every set of terms members have aligned with, every version, and how the village aligned with each. Open to every member.",
  membersOnly: "Members read what the village has aligned with.",
  membersOnlyLine: "The register carries seat terms, money included, so it opens at the member rung.",
  kinds: "Kinds",
  everyKind: "Every kind",
  searchLabel: "Search the register",
  searchPlaceholder: "A seat, a person, a word in the terms",
  search: "Search",
  clear: "Show the whole register",
  results: (q: string) => `Terms that match "${q}"`,
  noResults: "Nothing in the register matches that.",
  empty: "Nothing has been aligned with yet. When a member applies for a seat on terms, the words land here.",
  loading: "Reading the register",
  more: "Show earlier terms",
  readingMore: "Reading earlier terms…",
  moreLine: "The register goes back as far as the village does.",
  version: (n: number) => `Version ${n}`,
  alignedOn: (day: string) => `Aligned on ${day}`,
  writtenOn: (day: string) => `Written on ${day}`,
  readWords: "Read the words",
  byBallot: "Adopted by the village's vote",
  readVote: "Read the vote",
  byHolder: (name: string) => `Aligned for the village by ${name}`,
  readApplication: "Read the application",
  parties: "Parties",
  aligned: "aligned",
  waiting: "not yet",
  money: "Recorded here. Paid outside the platform.",
  /** The door from a member's own profile. */
  profileDoor: "Read the village's register",
} as const;
