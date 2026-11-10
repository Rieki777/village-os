/**
 * THE ADMIN HELPER, the pure half (2026-11-09).
 *
 * The village's guide (Maia, Sera, or whatever the village named it) in a
 * panel beside Admin. It answers "how do I", finds the right page or setting,
 * explains what a control does, and proposes ONE change at a time for the
 * admin to apply. The server half is server/routes/adminHelper.ts; the panel
 * is client/src/components/admin/AdminHelperPanel.tsx.
 *
 * Shared because both sides read it: the client sends the Admin map it is
 * showing (the tabs this admin can actually open), and the server ranks that
 * map and the game dials against the question. Pure: no I/O, no clock.
 *
 * WHAT IT MAY READ (the coordinator's guardrail, 2026-11-09, from Rye's
 * role-journey rule "no AI in selection"). Settings, help text and the SHAPE
 * of the org chart. Never role applications or open proposals (their words,
 * contact details, time zones), interview scores, role terms or pay, and no
 * person's details. The server's tool layer refuses those reads by name
 * (`DENIED_READS`, server/routes/adminHelper.ts), and the dial search below
 * leaves out every money and selection dial, so the guide never sees them.
 *
 * WHAT IT MAY PROPOSE. A game dial (shared/gameVariables.ts), and only one
 * that is not about money. Money actions stay manual (the brief, 2026-11-09:
 * role.pay, cash.pay, budgets, exchange, redemption), so a dial in a money
 * category, or whose key names pay, price, cash, budget, mint, exchange,
 * redemption or a fee, is refused here before a card is ever drawn. So is a
 * dial whose value moved into the sealed secrets. The Apply button then goes
 * through `PUT /api/admin/variables/:key`, the dial's own route, with every
 * guard it already has (who may act, the founder override, the ledger). The
 * model never writes.
 */
import { VARIABLES_BY_KEY, validateVariable, withheldFromPublic, type VariableDef } from "./gameVariables";

/** One page of Admin as the panel saw it in the nav. */
export interface HelperTab {
  key: string;
  label: string;
  /** The nav group it sits under ("Who runs this village"). */
  group: string;
  /** Its one-line purpose, the same words as "What is this?". */
  help: string;
}

/** A dial as the helper reads it: what it is, and what it is set to now. */
export interface HelperDial {
  key: string;
  label: string;
  category: string;
  description: string;
  type: string;
  value: string;
  isDefault: boolean;
  min?: number;
  max?: number;
  choices?: Array<{ value: string; label: string }>;
  unit?: string;
}

/** The card the panel draws for a proposed change. */
export interface HelperProposal {
  key: string;
  label: string;
  category: string;
  from: string;
  to: string;
  why: string;
  /** The admin route the Apply button calls, so the card says where it goes. */
  applyPath: string;
}

/** The ask route's answer. */
export interface HelperAnswer {
  reply: string;
  /** A page to open, from the tabs the panel sent. */
  open: { key: string; label: string } | null;
  proposal: HelperProposal | null;
  /** Why a proposed change was not drawn as a card, in plain words. */
  refused: string | null;
  /** Which readers the guide opened, for the transparency line. */
  consulted: string[];
}

/**
 * Who answers. `anthropic` is the village's own Anthropic key, and wins when
 * it is set. `sera` is the org memory service's agent, reached through the
 * village's Saberra connection, used when there is no Anthropic key.
 */
export type HelperProvider = "anthropic" | "sera";

/**
 * The status route's answer. `on` needs the village's switch (the dial
 * `platform.admin_helper`, ON by default) and an AI to answer: the village's
 * own Anthropic key, or a working Sera connection. `off` says which is
 * missing, switch first, so the panel names the right step; the Admin
 * banner asks for the key.
 */
export interface HelperStatus {
  on: boolean;
  guide: string;
  off: "switch" | "key" | null;
  provider: HelperProvider | null;
  /**
   * Every provider that could answer right now, default first. Two entries
   * means the admin may choose (Rye, 2026-11-09: "When both the anthropic key
   * and sera are set we should be able to choose between them").
   */
  available: HelperProvider[];
  /** The name each provider answers under. */
  names: Partial<Record<HelperProvider, string>>;
}

/** The provider a request asked for, when it is one that could answer; else the default. */
export function chooseProvider(asked: unknown, available: readonly HelperProvider[]): HelperProvider | null {
  return available.find((p) => p === asked) ?? available[0] ?? null;
}

/** The village's own switch for the helper. Ships on; a village may turn it off. */
export const HELPER_SWITCH = "platform.admin_helper";

// ── The map the panel sends ─────────────────────────────────────────────────

export const MAX_TABS = 200;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * The tabs the client sent, bounded and stripped to plain strings. A key is
 * the shape every Admin tab key has (lowercase words and dashes), so nothing
 * odd can ride a key into an "open this page" link.
 */
export function cleanTabs(incoming: unknown): HelperTab[] {
  if (!Array.isArray(incoming)) return [];
  const out: HelperTab[] = [];
  const seen = new Set<string>();
  for (const t of incoming.slice(0, MAX_TABS)) {
    const key = clip((t as any)?.key, 60);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key) || seen.has(key)) continue;
    const label = clip((t as any)?.label, 60);
    if (!label) continue;
    seen.add(key);
    out.push({ key, label, group: clip((t as any)?.group, 60), help: clip((t as any)?.help, 200) });
  }
  return out;
}

// ── Money stays manual ──────────────────────────────────────────────────────

/** Dial categories that are about money, value or pay. */
export const HANDS_OFF_CATEGORIES: readonly string[] = [
  "Ledger",
  "The Mint",
  "Tokens",
  "Payments",
  "Exchange",
  "Gratitude",
  "Exit",
  "Stays",
];

/** A dial key naming money, whatever category it sits in. */
const MONEY_KEY = /(pay|price|cash|budget|mint|exchange|redeem|redemption|fee|wage|reward|treasur|fund|loan|dues|token|credit|ledger)/i;

/** A dial about choosing people for roles: applications, interviews, terms. No AI in selection. */
const SELECTION = /(applica|applicant|candidate|interview|selection|shortlist|role_term|seat_term|term_length|term_months|term_days)/i;

/** Whether the guide may see this dial at all: never money, never selection, never a sealed secret. */
export function guideMaySee(def: Pick<VariableDef, "key" | "label" | "category" | "movedToSecret"> | undefined): boolean {
  if (!def || def.movedToSecret) return false;
  if (HANDS_OFF_CATEGORIES.includes(def.category) || MONEY_KEY.test(def.key)) return false;
  if (SELECTION.test(def.key) || SELECTION.test(def.label)) return false;
  return true;
}

/**
 * Why the helper may not propose a change to this dial, or null when it may.
 * The sentence lands in the panel, so it is written for the admin.
 */
export function proposalRefusal(def: VariableDef | undefined): string | null {
  if (!def) return "That is not a setting Admin knows.";
  if (def.movedToSecret) return `${def.label} lives in the sealed connections now, so change it under Integrations yourself.`;
  if (def.key === HELPER_SWITCH) return "The helper cannot switch itself on or off. That is the village's decision, made under Game Mechanics.";
  if (HANDS_OFF_CATEGORIES.includes(def.category) || MONEY_KEY.test(def.key)) {
    return `${def.label} is about money, and money settings stay in your own hands. Open ${def.category} under Game Mechanics to change it.`;
  }
  if (SELECTION.test(def.key) || SELECTION.test(def.label)) {
    return `${def.label} is about choosing people for roles, and the helper stays out of selection. Change it by hand under Game Mechanics.`;
  }
  return null;
}

/** Whether the helper may propose this dial. */
export function mayPropose(def: VariableDef | undefined): boolean {
  return proposalRefusal(def) === null;
}

/**
 * The card for one proposed change, or the plain reason there is none.
 * `current` is what the dial holds now; a proposal that changes nothing is
 * refused rather than drawn, because an Apply button that does nothing
 * teaches an admin the button is decoration.
 */
export function buildProposal(
  raw: unknown,
  current: (key: string) => string | undefined,
): { ok: true; proposal: HelperProposal } | { ok: false; error: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const key = clip((raw as any).key, 120);
  if (!key) return null;
  const def = VARIABLES_BY_KEY[key];
  const refusal = proposalRefusal(def);
  if (refusal) return { ok: false, error: refusal };
  const to = typeof (raw as any).value === "string" || typeof (raw as any).value === "number" || typeof (raw as any).value === "boolean"
    ? String((raw as any).value).trim()
    : "";
  const problem = validateVariable(def, to);
  if (problem) return { ok: false, error: `${def.label} cannot be set to that: ${problem}` };
  const from = current(key) ?? def.default;
  if (from === to) return { ok: false, error: `${def.label} is already set to that.` };
  return {
    ok: true,
    proposal: {
      key,
      label: def.label,
      category: def.category,
      from,
      to,
      why: clip((raw as any).why, 400),
      applyPath: `/api/admin/variables/${encodeURIComponent(key)}`,
    },
  };
}

// ── Finding things ──────────────────────────────────────────────────────────

const STOP = new Set([
  "the", "and", "for", "how", "what", "where", "when", "who", "why", "can", "does", "this", "that", "with",
  "from", "into", "our", "your", "you", "are", "was", "will", "would", "should", "could", "there", "here",
  "about", "change", "set", "find", "show", "turn", "make", "want", "need", "page", "setting", "settings",
  "admin", "village", "please", "help", "tell", "explain", "which", "have", "has", "its", "it's", "not",
]);

/** The words of a question worth matching on. */
export function queryWords(q: string): string[] {
  return Array.from(new Set(
    String(q ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)),
  ));
}

function score(words: string[], strong: string, medium: string, weak: string): number {
  let n = 0;
  const s = strong.toLowerCase(), m = medium.toLowerCase(), w = weak.toLowerCase();
  for (const word of words) {
    if (s.includes(word)) n += 3;
    if (m.includes(word)) n += 2;
    if (w.includes(word)) n += 1;
  }
  return n;
}

/**
 * Admin pages and dials ranked against the question, with every money and
 * selection dial left out before ranking. The value of a dial
 * that can carry a credential is withheld, the way the public mechanics feed
 * withholds it: this result goes to a model provider.
 */
export function searchAdmin(
  query: string,
  tabs: readonly HelperTab[],
  dials: readonly HelperDial[],
  limits = { tabs: 8, dials: 10 },
): { pages: Array<HelperTab>; settings: Array<HelperDial & { proposable: boolean }>; leftOut: string } {
  const words = queryWords(query);
  const pages = tabs
    .map((t) => ({ t, n: score(words, t.label, t.group, t.help) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limits.tabs)
    .map((x) => x.t);
  const settings = dials
    .filter((d) => guideMaySee(VARIABLES_BY_KEY[d.key]))
    .map((d) => ({ d, n: score(words, d.label, `${d.category} ${d.key}`, d.description) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limits.dials)
    .map(({ d }) => {
      const def = VARIABLES_BY_KEY[d.key];
      const hidden = def ? withheldFromPublic({ withheld: def.withheld, value: d.value }) : false;
      return {
        ...d,
        description: d.description.slice(0, 300),
        value: hidden ? "(withheld: it can carry a key)" : d.value,
        proposable: mayPropose(def),
      };
    });
  return { pages, settings, leftOut: "Money, role selection and sealed settings are never shown to the guide." };
}
