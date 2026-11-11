/**
 * THE EIGHT SETTINGS A PROPOSAL'S TERMS STEP SHOWS, and the candidate's answer to each.
 *
 * A role card can hold a suggested wording for each: Term, Clocks, Rhythm, Allowance, Bonus,
 * Goals, Scoreboard, Ending (stored as `words` in the role's terms on offer,
 * `shared/seatSettings.ts`). The candidate marks each "I accept" or "let's talk", with an
 * optional note. A setting the role has not written reads "We'll set this together." and asks
 * for no answer. The form refuses to send until every written setting is answered.
 *
 * COMMITMENT lives with Clocks. It is how much of a person's energy and attention the role gets
 * in a week, 0 to 100 in steps of 10, with NO default: the person chooses. 100 is full
 * commitment and each person manages their own workload. It is a planning signal. It is stored
 * and shown to the people deciding, and no pay or valuation code reads it
 * (`shared/termsWords.boundary.test.ts` holds that line).
 *
 * Pure and dependency-free, so the form, the open-proposal route and the member-door route judge
 * with one set of words.
 */

/** The eight, in the order the terms step reads them. `goals` is the role's goals each moon. */
export const TERM_KEYS = ["term", "clocks", "rhythm", "allowance", "bonus", "goals", "scoreboard", "ending"] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export const TERM_LABELS: Record<TermKey, string> = {
  term: "Term",
  clocks: "Clocks",
  rhythm: "Rhythm",
  allowance: "Allowance",
  bonus: "Bonus",
  goals: "Goals",
  scoreboard: "Scoreboard",
  ending: "Ending",
};

/** The role's suggested wording, one line or a few sentences per setting. A missing key is "not written". */
export type TermsWords = Partial<Record<TermKey, string>>;

export const SET_TOGETHER = "We'll set this together.";
export const TERMS_HINT = "Mark anything you'd like to talk through. Nothing is final until we agree together.";
export const COMMITMENT_HINT = "This is about energy and attention, never hours. You can change it later.";

/** 0 to 100 in steps of ten. No default: a person picks. */
export const COMMITMENT_CHOICES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
export const isCommitment = (v: unknown): v is number => typeof v === "number" && (COMMITMENT_CHOICES as readonly number[]).includes(v);
export const commitmentWords = (pct: number): string => `Commitment: ${pct}%`;

export const TERM_NOTE_MAX = 300;

export interface TermAnswer {
  choice: "accept" | "talk";
  note: string;
}
export type TermAnswers = Partial<Record<TermKey, TermAnswer>>;

/** What the candidate sent for the terms step: each setting's answer and their own commitment. */
export interface TermsStep {
  answers: TermAnswers;
  commitmentPct: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The settings a role has written, plus Clocks when it asks a commitment: the ones that need an answer. */
export function writtenKeys(offers: ReadonlyArray<{ words?: TermsWords | null; commitmentPct?: number | null } | null | undefined>): TermKey[] {
  return TERM_KEYS.filter((k) => offers.some((o) => !!o?.words?.[k]?.trim() || (k === "clocks" && o?.commitmentPct != null)));
}

/**
 * Judge the terms step. `written` is every setting some picked role has written: each needs an
 * answer. Answers for a setting nobody wrote are kept if well formed (the candidate may have
 * changed roles). Commitment is always required.
 */
export function judgeTermsStep(raw: unknown, written: readonly TermKey[]): { ok: true; value: TermsStep } | { ok: false; error: string; key?: TermKey | "commitment" } {
  const o = isObj(raw) ? raw : {};
  const given = isObj(o.answers) ? o.answers : {};
  const answers: TermAnswers = {};
  for (const k of TERM_KEYS) {
    const a = given[k];
    if (a === undefined || a === null) continue;
    if (!isObj(a) || (a.choice !== "accept" && a.choice !== "talk")) return { ok: false, error: `Say whether you accept or would like to talk about ${TERM_LABELS[k]}.`, key: k };
    const note = typeof a.note === "string" ? a.note.trim() : "";
    if (note.length > TERM_NOTE_MAX) return { ok: false, error: `Keep your note on ${TERM_LABELS[k]} to ${TERM_NOTE_MAX} characters.`, key: k };
    answers[k] = { choice: a.choice, note };
  }
  for (const k of written) {
    if (!answers[k]) return { ok: false, error: `Say whether you accept or would like to talk about ${TERM_LABELS[k]}.`, key: k };
  }
  if (!isCommitment(o.commitmentPct)) return { ok: false, error: "Choose your commitment, from 0 to 100 in steps of 10.", key: "commitment" };
  return { ok: true, value: { answers, commitmentPct: o.commitmentPct } };
}

/** The whole step read back from storage: tolerant, never throws, null when nothing is there (a proposal sent before it). */
export function termsStepOf(raw: unknown): TermsStep | null {
  const j = judgeTermsStep(raw, []);
  if (!j.ok) return null;
  return j.value;
}

/** The overall choice the older readers know: "talk" when any setting is, else "accept". */
export function overallChoice(a: TermAnswers): "accept" | "talk" {
  return Object.values(a).some((x) => x?.choice === "talk") ? "talk" : "accept";
}

/** The notes as one line each, for the places that read one note (`card.terms.note`). */
export function notesAsText(a: TermAnswers): string {
  return TERM_KEYS.filter((k) => a[k]?.choice === "talk")
    .map((k) => `${TERM_LABELS[k]}: ${a[k]?.note || "let's talk"}`)
    .join("\n");
}

/** The settings group each of the eight wordings belongs to in a seat's settings (`shared/seatSettings.ts`). Goals are the `quests` group. */
export const WORD_GROUP: Record<TermKey, string> = {
  term: "term",
  clocks: "clocks",
  rhythm: "rhythm",
  allowance: "allowance",
  bonus: "bonus",
  goals: "quests",
  scoreboard: "scoreboard",
  ending: "ending",
};

/**
 * THE AGREED WORDS INTO THE ROWS A HOLDER ALIGNS WITH (audit B2, 11 Nov 2026). The rows are the
 * settings' own (`settingsWords`), which read only the structured groups, so a setting agreed in
 * words read "We'll fill this together" and the commitment under Clocks read "Not set". Each
 * group with agreed words becomes set: its wording is the headline when the group had none, or
 * its first line otherwise, and the commitment rides under Clocks. Pure; the rows are copied.
 */
export function withAgreedWords<R extends { group: string; set: boolean; headline: string; lines: string[] }>(
  rows: readonly R[],
  words: TermsWords | null | undefined,
  commitmentPct: number | null | undefined,
  notSet: string,
): R[] {
  return rows.map((row) => {
    const key = TERM_KEYS.find((k) => WORD_GROUP[k] === row.group);
    const said = key ? words?.[key]?.trim() : "";
    const pct = row.group === "clocks" && isCommitment(commitmentPct) ? commitmentWords(commitmentPct) : "";
    const extra = [said, pct].filter((x): x is string => !!x);
    if (!extra.length) return row;
    const lines = [...extra, ...(row.set ? row.lines : [])];
    const keep = row.set && row.headline !== notSet;
    return { ...row, set: true, headline: keep ? row.headline : (lines.shift() as string), lines };
  });
}
