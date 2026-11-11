/**
 * THE FOUNDING-TEAM APPLICATION'S VILLAGE WORDS (the lead, 11 Nov 2026; Phase A, lane A1).
 *
 * The application at /propose-a-role is six steps: Get to know us, About you,
 * Your value, The terms, Your first day, Review & submit. Everything on it that
 * belongs to one village, and not to the platform, is a village setting read
 * here: the ways to get to know us, the shape of the compensation, the words
 * beside it, and the first cycle. A new village sees plain defaults with no
 * village's name, and a share nobody has set reads "N%".
 *
 * The compensation shape is DATA and never anyone's pay (build list 7.1, 7.4):
 * three shares a village may set while its pay ranges stay hidden, the words
 * for each part, and the footer. Nothing here is a price, a cap or an amount.
 *
 * PURE: the server reads the variables and hands them in as `get`, and the page
 * reads the result from the form's answer, so both read one spelling.
 */
import { KNOW_US_MAX, KNOW_US_TEXT_MAX } from "./openProposals";

/** The settings, by what they hold. Each is registered in shared/gameVariables.ts under "The founding team". */
export const FOUNDING_KEYS = {
  knowUs: "org.founding_know_us",
  knowUsNote: "org.founding_know_us_note",
  cashPct: "org.founding_comp_cash_pct",
  equityPct: "org.founding_comp_equity_pct",
  creditsPct: "org.founding_comp_credits_pct",
  cashWords: "org.founding_comp_cash_words",
  equityWords: "org.founding_comp_equity_words",
  creditsWords: "org.founding_comp_credits_words",
  compNotes: "org.founding_comp_notes",
  atRisk: "org.founding_comp_at_risk",
  footer: "org.founding_comp_footer",
  firstCycle: "org.founding_first_cycle",
  firstConversations: "org.founding_first_conversations",
} as const;

export type FoundingKey = (typeof FOUNDING_KEYS)[keyof typeof FOUNDING_KEYS];

/** The three parts of the compensation shape, in the order they are shown. */
export const SHARE_PARTS = ["cash", "equity", "credits"] as const;
export type SharePart = (typeof SHARE_PARTS)[number];

export interface FoundingSetup {
  /** The ways to get to know the village, each one a tick on step 1. */
  knowUs: string[];
  /** The note step 1 shows while a way is not ticked: it encourages, and never locks (build list 1.12). */
  knowUsNote: string;
  /** Each part's share in whole percent, or null where the village has not set one (shown as "N%"). */
  shares: Record<SharePart, number | null>;
  /** What each part is, in the village's words. */
  shareWords: Record<SharePart, string>;
  /** Further lines under the shape (tokens, a tools allowance, AI support), one per line. */
  compNotes: string[];
  /** Plain words that the equity, credits and tokens are at risk (traceability T68). Shown beside the footer. */
  atRisk: string;
  /** The footer under the shape (build list 7.5). */
  footer: string;
  /** What the first cycle looks like. */
  firstCycle: string;
  /** The first conversations after the hire, one per line. */
  firstConversations: string[];
}

/** Lines of a long setting: one per line, trimmed, blank lines dropped. */
export function linesOf(raw: unknown, max = 12, each = 300): string[] {
  return String(typeof raw === "string" ? raw : "")
    .split(/\r?\n/)
    .map((l) => l.trim().slice(0, each))
    .filter(Boolean)
    .slice(0, max);
}

/** A share as a village wrote it: a whole percent from 0 to 100, or null for blank or anything else. */
export function shareOf(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

const words = (raw: unknown, max = 1200): string => String(typeof raw === "string" ? raw : "").trim().slice(0, max);

/** The setup from the village's settings, read through `get` (the setting's current value, its default when unset). */
export function foundingSetupFrom(get: (key: FoundingKey) => string): FoundingSetup {
  return {
    knowUs: linesOf(get(FOUNDING_KEYS.knowUs), KNOW_US_MAX, KNOW_US_TEXT_MAX),
    knowUsNote: words(get(FOUNDING_KEYS.knowUsNote)),
    shares: { cash: shareOf(get(FOUNDING_KEYS.cashPct)), equity: shareOf(get(FOUNDING_KEYS.equityPct)), credits: shareOf(get(FOUNDING_KEYS.creditsPct)) },
    shareWords: { cash: words(get(FOUNDING_KEYS.cashWords), 600), equity: words(get(FOUNDING_KEYS.equityWords), 600), credits: words(get(FOUNDING_KEYS.creditsWords), 600) },
    compNotes: linesOf(get(FOUNDING_KEYS.compNotes)),
    atRisk: words(get(FOUNDING_KEYS.atRisk)),
    footer: words(get(FOUNDING_KEYS.footer), 300),
    firstCycle: words(get(FOUNDING_KEYS.firstCycle)),
    firstConversations: linesOf(get(FOUNDING_KEYS.firstConversations)),
  };
}

/** The setup as the form's answer carries it, read back safely: anything missing is empty, nothing throws. */
export function foundingSetupOf(raw: unknown): FoundingSetup {
  const o = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const lines = (v: unknown) => (Array.isArray(v) ? linesOf(v.filter((x) => typeof x === "string").join("\n")) : []);
  return {
    knowUs: Array.isArray(o.knowUs) ? linesOf(o.knowUs.filter((x: unknown) => typeof x === "string").join("\n"), KNOW_US_MAX, KNOW_US_TEXT_MAX) : [],
    knowUsNote: words(o.knowUsNote),
    shares: { cash: shareOf(o.shares?.cash), equity: shareOf(o.shares?.equity), credits: shareOf(o.shares?.credits) },
    shareWords: { cash: words(o.shareWords?.cash, 600), equity: words(o.shareWords?.equity, 600), credits: words(o.shareWords?.credits, 600) },
    compNotes: lines(o.compNotes),
    atRisk: words(o.atRisk),
    footer: words(o.footer, 300),
    firstCycle: words(o.firstCycle),
    firstConversations: lines(o.firstConversations),
  };
}

/** A share as the page shows it: "40%", or "N%" where the village has not set it. */
export function shareWords(n: number | null): string {
  return n === null ? "N%" : `${n}%`;
}
