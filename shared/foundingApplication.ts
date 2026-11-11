/**
 * THE FOUNDING-TEAM APPLICATION'S VILLAGE WORDS (the lead, 11 Nov 2026; Phase A, lane A1).
 *
 * The application at /propose-a-role is six steps: Get to know us, About you,
 * Your value, The terms, Your first day, Review & submit. Everything on it that
 * belongs to one village, and not to the platform, is a village setting read
 * here: the ways to get to know us, the shape of the compensation with the
 * words beside it, and the first cycle. A new village sees plain defaults with
 * no village's name, and a shape nobody has written reads "N%".
 *
 * The compensation shape is DATA and never anyone's pay (build list 7.1, 7.4):
 * shares of the whole, never a range, a minimum or a budget figure.
 *
 * PURE: the server reads the variables and hands them in as `get`, and the page
 * reads the result from the form's answer, so both read one spelling.
 */
import { KNOW_US_MAX, KNOW_US_TEXT_MAX } from "./openProposals";

/** The application's own settings, each registered in shared/gameVariables.ts under "The founding team". */
export const FOUNDING_KEYS = {
  knowUs: "org.founding_know_us",
  knowUsNote: "org.founding_know_us_note",
  firstCycle: "org.founding_first_cycle",
  firstConversations: "org.founding_first_conversations",
} as const;

/**
 * THE PAY SHAPE IS LANE A3's (Phase A coordination, 11 Nov 2026): one village
 * setting shown on every role card and here alike, so the two never disagree.
 * `org.pay_shape` ("Cash 40, Equity 55, Credits 5"), `org.pay_shape_at_risk`
 * and `org.pay_shape_note`. They are registered by A3's branch; until it lands
 * the server reads them as empty (`foundingSetupFrom` is handed "" for a key
 * the registry does not know), and the page shows the placeholder shape.
 */
export const PAY_SHAPE_KEYS = {
  shape: "org.pay_shape",
  atRisk: "org.pay_shape_at_risk",
  note: "org.pay_shape_note",
} as const;

export type FoundingKey = (typeof FOUNDING_KEYS)[keyof typeof FOUNDING_KEYS] | (typeof PAY_SHAPE_KEYS)[keyof typeof PAY_SHAPE_KEYS];

/** One share of the whole: its name and percent. Never an amount. */
export interface PayShare {
  label: string;
  pct: number;
}

/** The placeholder the page shows while the village has written no shape: "N%" for each (build list 7.1). */
export const PLACEHOLDER_PARTS = ["Cash", "Equity", "Credits"] as const;

export interface FoundingSetup {
  /** The ways to get to know the village, each one a tick on step 1. */
  knowUs: string[];
  /** The note step 1 shows while a way is not ticked: it encourages, and never locks (build list 1.12). */
  knowUsNote: string;
  /** The village's pay shape (A3's `org.pay_shape`), or none: the page then shows the placeholder with N%. */
  shares: PayShare[];
  /** Plain words that the equity, credits and tokens are at risk (traceability T68), shown beside the footer. */
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

/**
 * One share as written ("Cash 40", "Equity: 55%", "Credits=5"): its label and
 * its 1 to 3 digit percent, with a space, colon or equals sign between. Read
 * from the end by hand, with no backtracking pattern, so a long run of spaces
 * or tabs in a setting costs linear time (CodeQL, polynomial regex, batch 155).
 */
function splitShare(part: string): { label: string; pct: string } | null {
  let end = part.length;
  if (end && part[end - 1] === "%") end--;
  while (end && /\s/.test(part[end - 1])) end--;
  let start = end;
  while (start > 0 && end - start < 4 && part[start - 1] >= "0" && part[start - 1] <= "9") start--;
  const pct = part.slice(start, end);
  if (!pct || pct.length > 3) return null;
  let cut = start;
  while (cut > 0 && /[\s:=]/.test(part[cut - 1])) cut--;
  if (cut === start) return null;
  return { label: part.slice(0, cut), pct };
}

/**
 * The shape as the setting is written: "Cash 40, Equity 55, Credits 5" (commas,
 * semicolons or new lines between shares, a percent sign optional). Anything
 * that does not read cleanly, or adds up past 100, reads as no shape, so a
 * typo never shows half a breakdown. A3's `readVillagePayShape` reads the same
 * spelling for the cards.
 */
export function payShapeOf(setting: unknown): PayShare[] {
  const parts = String(typeof setting === "string" ? setting : "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const out: PayShare[] = [];
  for (const p of parts) {
    const m = splitShare(p);
    const label = m?.label.trim().slice(0, 40) ?? "";
    const pct = m ? Number(m.pct) : NaN;
    if (!label || !(pct >= 0 && pct <= 100)) return [];
    out.push({ label, pct });
  }
  return out.slice(0, 6).reduce((n, s) => n + s.pct, 0) > 100 ? [] : out.slice(0, 6);
}

const words = (raw: unknown, max = 1200): string => String(typeof raw === "string" ? raw : "").trim().slice(0, max);

/** The setup from the village's settings, read through `get` (the setting's current value; "" for one the registry does not know). */
export function foundingSetupFrom(get: (key: FoundingKey) => string): FoundingSetup {
  return {
    knowUs: linesOf(get(FOUNDING_KEYS.knowUs), KNOW_US_MAX, KNOW_US_TEXT_MAX),
    knowUsNote: words(get(FOUNDING_KEYS.knowUsNote)),
    shares: payShapeOf(get(PAY_SHAPE_KEYS.shape)),
    atRisk: words(get(PAY_SHAPE_KEYS.atRisk), 600),
    footer: words(get(PAY_SHAPE_KEYS.note), 300),
    firstCycle: words(get(FOUNDING_KEYS.firstCycle)),
    firstConversations: linesOf(get(FOUNDING_KEYS.firstConversations)),
  };
}

/** The setup as the form's answer carries it, read back safely: anything missing is empty, nothing throws. */
export function foundingSetupOf(raw: unknown): FoundingSetup {
  const o = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const lines = (v: unknown, max = 12, each = 300) => (Array.isArray(v) ? linesOf(v.filter((x) => typeof x === "string").join("\n"), max, each) : []);
  const shares = Array.isArray(o.shares) ? payShapeOf(o.shares.filter((x: any) => x && typeof x.label === "string" && typeof x.pct === "number").map((x: any) => `${x.label} ${x.pct}`).join(", ")) : [];
  return {
    knowUs: lines(o.knowUs, KNOW_US_MAX, KNOW_US_TEXT_MAX),
    knowUsNote: words(o.knowUsNote),
    shares,
    atRisk: words(o.atRisk, 600),
    footer: words(o.footer, 300),
    firstCycle: words(o.firstCycle),
    firstConversations: lines(o.firstConversations),
  };
}

/** A share as the page shows it: "40%", or "N%" where the village has written none. */
export function shareWords(n: number | null): string {
  return n === null ? "N%" : `${n}%`;
}
