/**
 * THE ROLE CARD'S FOUNDING SECTIONS (phase A, lane A3, build list 4.1 to 4.8).
 *
 * A role card is its words and its listing details (shared/roleParameters.ts).
 * A role the village hires for as a paid, founding role also says who it hopes
 * for and how its pay is shaped. These sections are village DATA, written in
 * the role editor by a holder of the power to decide the structure, and kept
 * per role in one `app_config` document (server/lib/roleCardSections.ts):
 *
 *   idealBackground   "Ideal background": lines, written openly ("ideally...")
 *   qualities         "Qualities we're looking for": lines
 *   aiSupport         "AI support": one or two sentences on the companion that
 *                     saves the role time
 *   aiCompanion       the companion's animal, one or two words ("Heron")
 *   paid              true draws "This is a paid role" at the top of the card
 *   payShape          the SHAPE of the pay, never an amount: each share a label
 *                     and a percent ("Cash 40", "Equity 55", "Credits 5")
 *   payNote           the line under the shape (indicative, under review)
 *   payCeiling        the most the role pays in all, as one figure and a period
 *                     ({ amount, currency, per }), drawn "Total compensation up
 *                     to $9,000 a month". A ceiling only: a range and a minimum
 *                     never live here (lead, 11 Nov evening)
 *   paySplitNote      the words after the split ("To be decided in the
 *                     onboarding process.")
 *
 * NO RANGE AND NO MINIMUM EVER LIVE HERE. The one figure is the ceiling, in its
 * own typed field; a share is a percent of the whole, and an amount written
 * into any line of words is refused, so a range cannot ride in through a note. Payment details are refused everywhere, as on every card field.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { looksLikePaymentDetails } from "./seatSettings";

export interface PayShare {
  label: string;
  /** A whole percent of the whole, 0 to 100. */
  pct: number;
}

export interface RoleCardSections {
  idealBackground: string[];
  qualities: string[];
  aiSupport: string;
  aiCompanion: string;
  paid: boolean;
  payShape: PayShare[];
  payNote: string;
  payCeiling: PayCeiling | null;
  paySplitNote: string;
}

export const CEILING_PERIODS = ["month", "moon", "year"] as const;
export type CeilingPeriod = (typeof CEILING_PERIODS)[number];

/** The most a role pays in all: whole currency units, a currency code and a period. Never a range. */
export interface PayCeiling {
  amount: number;
  currency: string;
  per: CeilingPeriod;
}

/** Who last saved the sections and when, kept beside them. */
export interface SectionsEdit {
  by: string | null;
  at: string;
}

export const SECTION_LIMITS = {
  lines: 8,
  lineChars: 200,
  aiSupportChars: 400,
  companionChars: 40,
  shares: 5,
  shareLabelChars: 40,
  payNoteChars: 300,
} as const;

export const SECTION_KEYS = ["idealBackground", "qualities", "aiSupport", "aiCompanion", "paid", "payShape", "payNote", "payCeiling", "paySplitNote"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** The card's own headings and lines for these sections. Plain words, the village's "we". */
export const SECTION_WORDS = {
  idealBackground: "Ideal background",
  qualities: "Qualities we're looking for",
  aiSupport: "AI support",
  aiCompanionLabel: "Companion",
  paid: "This is a paid role",
  payShape: "How pay works",
  editorHeading: "Who we hope for, and how pay works",
  editorLede: "Shown on the full card to everyone. We're transparent about all compensation and how value in (contributions) equals value out (rewards).",
  paidToggle: "Say on the card that this is a paid role",
  shareLabel: "Share",
  sharePct: "Percent",
  addShare: "Add a share",
  payNoteLabel: "The line under the pay shape",
  ceilingLabel: "Total compensation up to (one figure, never a range)",
  splitNoteLabel: "The words after the split",
  splitLead: "Default split:",
  lastEdited: (who: string | null, day: string) => (who ? `Last edited by ${who} on ${day}` : `Last edited on ${day}`),
} as const;

export const SECTION_PROBLEMS = {
  notAList: (what: string) => `${what} is a list of lines.`,
  tooMany: (what: string, max: number) => `${what}: at most ${max} lines.`,
  tooLong: (what: string, max: number) => `${what}: keep each line to ${max} characters.`,
  payment: "Keep bank, card and account numbers out of a role card.",
  amount: "Write the pay as shares of the whole. Amounts and ranges stay off the card.",
  pct: "Each share is a whole percent from 0 to 100.",
  total: "The shares add up to more than 100 percent.",
  shareLabel: "Each share has a short name, like Cash.",
  tooManyShares: `At most ${SECTION_LIMITS.shares} shares.`,
  ceiling: "Write one amount above zero, a currency like USD, and month, moon or year.",
  notSections: "The founding sections arrive as a set of fields.",
} as const;

export const EMPTY_SECTIONS: RoleCardSections = {
  idealBackground: [],
  qualities: [],
  aiSupport: "",
  aiCompanion: "",
  paid: false,
  payShape: [],
  payNote: "",
  payCeiling: null,
  paySplitNote: "",
};

export type SectionsRead = { ok: true; value: RoleCardSections } | { ok: false; problem: string; field: string };

/** A figure that reads as money: a currency sign or code beside a number, or a number with thousands. */
const AMOUNT = /(?:[$€£¥₡]\s*\d)|(?:\d[\d.,]*\s*(?:usd|eur|crc|gbp|k\b|per month|a month|\/mo))|(?:\b\d{1,3}(?:,\d{3})+\b)/i;

function lineList(raw: unknown, what: string): { ok: true; value: string[] } | { ok: false; problem: string } {
  if (raw === null || raw === undefined) return { ok: true, value: [] };
  const list = typeof raw === "string" ? raw.split(/\r?\n/) : Array.isArray(raw) ? raw : null;
  if (!list) return { ok: false, problem: SECTION_PROBLEMS.notAList(what) };
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") return { ok: false, problem: SECTION_PROBLEMS.notAList(what) };
    const t = item.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim();
    if (!t) continue;
    if (t.length > SECTION_LIMITS.lineChars) return { ok: false, problem: SECTION_PROBLEMS.tooLong(what, SECTION_LIMITS.lineChars) };
    if (looksLikePaymentDetails(t)) return { ok: false, problem: SECTION_PROBLEMS.payment };
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > SECTION_LIMITS.lines) return { ok: false, problem: SECTION_PROBLEMS.tooMany(what, SECTION_LIMITS.lines) };
  return { ok: true, value: out };
}

function text(raw: unknown, max: number, what: string): { ok: true; value: string } | { ok: false; problem: string } {
  if (raw === null || raw === undefined) return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, problem: `${what} is text.` };
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length > max) return { ok: false, problem: SECTION_PROBLEMS.tooLong(what, max) };
  if (looksLikePaymentDetails(t)) return { ok: false, problem: SECTION_PROBLEMS.payment };
  return { ok: true, value: t };
}

/** The ceiling: one whole figure, a currency and a period, or nothing. A range or a minimum is refused. */
export function readPayCeiling(raw: unknown): { ok: true; value: PayCeiling | null } | { ok: false; problem: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problem: SECTION_PROBLEMS.ceiling };
  const o = raw as Record<string, unknown>;
  if ("min" in o || "minMinor" in o || "max" in o || "maxMinor" in o) return { ok: false, problem: SECTION_PROBLEMS.ceiling };
  const amountRaw = o.amount;
  if ((amountRaw === "" || amountRaw === null || amountRaw === undefined) && !o.currency) return { ok: true, value: null };
  const amount = typeof amountRaw === "number" ? amountRaw : typeof amountRaw === "string" && /^\s*\d{1,9}\s*$/.test(amountRaw) ? Number(amountRaw) : NaN;
  const currency = typeof o.currency === "string" ? o.currency.trim().toUpperCase() : "";
  const per = typeof o.per === "string" ? o.per.trim().toLowerCase() : "month";
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) return { ok: false, problem: SECTION_PROBLEMS.ceiling };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, problem: SECTION_PROBLEMS.ceiling };
  if (!(CEILING_PERIODS as readonly string[]).includes(per)) return { ok: false, problem: SECTION_PROBLEMS.ceiling };
  return { ok: true, value: { amount, currency, per: per as CeilingPeriod } };
}

/** "Total compensation up to $9,000 a month". The figure is the card's; the words are the line's frame. */
export function ceilingLine(c: PayCeiling, locale = "en-US"): string {
  let money: string;
  try {
    money = new Intl.NumberFormat(locale, { style: "currency", currency: c.currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(c.amount);
  } catch {
    money = `${c.amount.toLocaleString(locale)} ${c.currency}`;
  }
  return `Total compensation up to ${money} a ${c.per}`;
}

/** "Default split: 40% cash, 55% equity, 5% village credits." with the card's words after it. */
export function splitLine(shape: readonly PayShare[], note: string): string {
  const shares = shape.map((s) => `${s.pct}% ${s.label}`).join(", ");
  return `${SECTION_WORDS.splitLead} ${shares}.${note ? ` ${note}` : ""}`;
}

/** The pay shape: shares with a name and a whole percent, adding to no more than 100. */
export function readPayShape(raw: unknown): { ok: true; value: PayShare[] } | { ok: false; problem: string } {
  if (raw === null || raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, problem: SECTION_PROBLEMS.notAList("How pay works") };
  if (raw.length > SECTION_LIMITS.shares) return { ok: false, problem: SECTION_PROBLEMS.tooManyShares };
  const out: PayShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, problem: SECTION_PROBLEMS.shareLabel };
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.replace(/\s+/g, " ").trim() : "";
    const pctRaw = typeof o.pct === "number" ? o.pct : typeof o.pct === "string" && /^\s*\d{1,3}\s*%?\s*$/.test(o.pct) ? Number(o.pct.replace(/[%\s]/g, "")) : NaN;
    if (!label && (o.pct === "" || o.pct === undefined || o.pct === null)) continue;
    if (!label || label.length > SECTION_LIMITS.shareLabelChars) return { ok: false, problem: SECTION_PROBLEMS.shareLabel };
    if (AMOUNT.test(label)) return { ok: false, problem: SECTION_PROBLEMS.amount };
    if (!Number.isInteger(pctRaw) || pctRaw < 0 || pctRaw > 100) return { ok: false, problem: SECTION_PROBLEMS.pct };
    out.push({ label, pct: pctRaw });
  }
  if (out.reduce((n, s) => n + s.pct, 0) > 100) return { ok: false, problem: SECTION_PROBLEMS.total };
  return { ok: true, value: out };
}

/**
 * THE ONE READER of the sections, for the editor's save and for the stored
 * document alike. A key left out reads as empty: the editor always sends the
 * whole set, so leaving a field blank clears it.
 */
export function readSections(raw: unknown): SectionsRead {
  if (raw === null || raw === undefined) return { ok: true, value: { ...EMPTY_SECTIONS } };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problem: SECTION_PROBLEMS.notSections, field: "sections" };
  const o = raw as Record<string, unknown>;
  const bg = lineList(o.idealBackground, SECTION_WORDS.idealBackground);
  if (!bg.ok) return { ...bg, field: "sections.idealBackground" };
  const q = lineList(o.qualities, SECTION_WORDS.qualities);
  if (!q.ok) return { ...q, field: "sections.qualities" };
  const ai = text(o.aiSupport, SECTION_LIMITS.aiSupportChars, SECTION_WORDS.aiSupport);
  if (!ai.ok) return { ...ai, field: "sections.aiSupport" };
  const animal = text(o.aiCompanion, SECTION_LIMITS.companionChars, SECTION_WORDS.aiCompanionLabel);
  if (!animal.ok) return { ...animal, field: "sections.aiCompanion" };
  const shape = readPayShape(o.payShape);
  if (!shape.ok) return { ...shape, field: "sections.payShape" };
  const note = text(o.payNote, SECTION_LIMITS.payNoteChars, SECTION_WORDS.payNoteLabel);
  if (!note.ok) return { ...note, field: "sections.payNote" };
  if (AMOUNT.test(note.value)) return { ok: false, problem: SECTION_PROBLEMS.amount, field: "sections.payNote" };
  const ceiling = readPayCeiling(o.payCeiling);
  if (!ceiling.ok) return { ...ceiling, field: "sections.payCeiling" };
  const split = text(o.paySplitNote, SECTION_LIMITS.payNoteChars, SECTION_WORDS.splitNoteLabel);
  if (!split.ok) return { ...split, field: "sections.paySplitNote" };
  if (AMOUNT.test(split.value)) return { ok: false, problem: SECTION_PROBLEMS.amount, field: "sections.paySplitNote" };
  const paid = o.paid === true || o.paid === "true" || o.paid === 1;
  return {
    ok: true,
    value: { idealBackground: bg.value, qualities: q.value, aiSupport: ai.value, aiCompanion: animal.value, paid, payShape: shape.value, payNote: note.value, payCeiling: ceiling.value, paySplitNote: split.value },
  };
}

/** Whether a card has any of these sections written. */
export function hasSections(s: RoleCardSections | null | undefined): boolean {
  if (!s) return false;
  return s.paid || s.idealBackground.length > 0 || s.qualities.length > 0 || !!s.aiSupport || !!s.aiCompanion || s.payShape.length > 0 || !!s.payNote || !!s.payCeiling || !!s.paySplitNote;
}

/** "Cash 40%", one line per share, for the card. */
export function payShapeLines(shape: readonly PayShare[]): string[] {
  return shape.map((s) => `${s.label} ${s.pct}%`);
}

/** Two sets of sections are the same set. Order of lines matters; it is the order the card draws. */
export function sameSections(a: RoleCardSections, b: RoleCardSections): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The stored document's shape: one entry per role id. */
export interface SectionsDoc {
  roles: Record<string, { sections: RoleCardSections; edited?: SectionsEdit | null }>;
}

export const SECTIONS_DOC_KEY = "role-card-sections";

/** One role's sections from the stored document, read through the same reader so a bad row reads as empty. */
export function sectionsFromDoc(doc: unknown, roleId: string): { sections: RoleCardSections; edited: SectionsEdit | null } {
  const roles = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as { roles?: unknown }).roles : null;
  const entry = roles && typeof roles === "object" && !Array.isArray(roles) ? (roles as Record<string, unknown>)[roleId] : null;
  if (!entry || typeof entry !== "object") return { sections: { ...EMPTY_SECTIONS }, edited: null };
  const e = entry as { sections?: unknown; edited?: unknown };
  const read = readSections(e.sections);
  const ed = e.edited && typeof e.edited === "object" ? (e.edited as Record<string, unknown>) : null;
  const edited = ed && typeof ed.at === "string" ? { by: typeof ed.by === "string" ? ed.by : null, at: ed.at } : null;
  return { sections: read.ok ? read.value : { ...EMPTY_SECTIONS }, edited };
}

/** The newer of two edits, for "last edited by". */
export function newerEdit(a: SectionsEdit | null, b: SectionsEdit | null): SectionsEdit | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.at) > Date.parse(a.at) ? b : a;
}

// ── The village's pay shape (lead, 11 Nov evening) ─────────────────────────
//
// "The compensation breakdown shows on EVERY role card, not only the leads. It
// comes from the village setting, and a card may override it." So the shape is
// one village setting (`org.pay_shape`, with `org.pay_shape_at_risk` and
// `org.pay_shape_note`), and a card's own `payShape` replaces it for that card.
// Ranges stay hidden whatever the role data holds: nothing here carries one.

export interface VillagePay {
  shape: PayShare[];
  /** The at-risk line under the shares, in the village's words. */
  atRisk: string;
  /** The footer: indicative only, subject to review. */
  note: string;
}

export const NO_VILLAGE_PAY: VillagePay = { shape: [], atRisk: "", note: "" };

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
 * The village's shape as its setting is written: "Cash 40, Equity 55, Credits 5"
 * (commas, semicolons or new lines between shares, a percent sign optional).
 * A setting that does not read cleanly reads as no shape, so a typo never puts
 * half a breakdown on every card.
 */
export function readVillagePayShape(setting: string): PayShare[] {
  const parts = String(setting ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const raw: Array<{ label: string; pct: string }> = [];
  for (const p of parts) {
    const m = splitShare(p);
    if (!m || !m.label.trim()) return [];
    raw.push({ label: m.label.trim(), pct: m.pct });
  }
  const read = readPayShape(raw);
  return read.ok ? read.value : [];
}

/** The village's pay block from its three settings, each read cleanly or left out. */
export function villagePayFrom(settings: { shape: string; atRisk: string; note: string }): VillagePay {
  const clean = (t: string, max: number) => {
    const v = String(t ?? "").replace(/\s+/g, " ").trim();
    return v && v.length <= max && !AMOUNT.test(v) && !looksLikePaymentDetails(v) ? v : "";
  };
  return { shape: readVillagePayShape(settings.shape), atRisk: clean(settings.atRisk, SECTION_LIMITS.payNoteChars), note: clean(settings.note, SECTION_LIMITS.payNoteChars) };
}

/**
 * What a card shows under "How pay works" (lead, 11 Nov evening): up to two lines and the footer.
 *
 *   ceiling   "Total compensation up to $X a month", from the card's own ceiling; absent when unset.
 *   split     "Default split: ...", from the card's shares, or the village's when the card wrote none,
 *             with the card's words after it; absent when neither wrote shares.
 *   atRisk    the village's at-risk line, and `note` the footer (the card's own, else the village's).
 *
 * Null when there is neither a ceiling nor a split: the card then draws no pay block at all.
 */
export function cardPay(
  sections: RoleCardSections | null | undefined,
  village: VillagePay,
): { ceiling: string | null; split: string | null; shape: PayShare[]; atRisk: string; note: string; fromCard: boolean } | null {
  const own = !!sections && sections.payShape.length > 0;
  const shape = own ? sections!.payShape : village.shape;
  const ceiling = sections?.payCeiling ? ceilingLine(sections.payCeiling) : null;
  const split = shape.length ? splitLine(shape, sections?.paySplitNote ?? "") : null;
  if (!ceiling && !split) return null;
  return { ceiling, split, shape, atRisk: village.atRisk, note: (sections?.payNote || "") || village.note, fromCard: own };
}
