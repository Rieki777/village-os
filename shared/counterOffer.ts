/**
 * THE COUNTER-OFFER (joining lane PR 4): the people who seat a role may word the
 * eight settings, and the commitment, differently for ONE proposal. The candidate
 * sees each changed setting beside what they answered and accepts it or asks to talk
 * again. Pure and dependency-free: the open proposal's body and the member door's
 * answers both keep one `counterOffer` object, and every reader and writer goes
 * through here.
 *
 * REVISIONS ARE APPENDED, NEVER OVERWRITTEN. Each save is one revision: who made it,
 * when, and for each setting that changed, the wording from and to. The current
 * wording of a setting is its latest `to`, or the role's suggestion when nobody
 * has changed it. Replies are kept per setting with the revision they answered, so a
 * setting changed AGAIN asks again.
 *
 * The history is for the people who decide. The candidate gets `offerForCandidate`,
 * which carries the current offer and never the log.
 *
 * Commitment is a planning signal and nothing here, or anywhere that reads it,
 * computes pay (`shared/termsWords.boundary.test.ts`).
 */
import { isCommitment, TERM_KEYS, TERM_LABELS, TERM_NOTE_MAX, type TermAnswers, type TermKey, type TermsWords } from "./termsWords";

export type OfferKey = TermKey | "commitment";
export const OFFER_KEYS: readonly OfferKey[] = [...TERM_KEYS, "commitment"];
export const OFFER_LABELS: Record<OfferKey, string> = { ...TERM_LABELS, commitment: "Commitment" };

export const OFFER_WORD_MAX = 600;
export const OFFER_REVISIONS_MAX = 50;

export interface OfferChange {
  key: OfferKey;
  /** The wording before, or null when there was none. A commitment is its number as text. */
  from: string | null;
  to: string | null;
}

export interface OfferRevision {
  n: number;
  at: string;
  byId: string;
  by: string;
  changes: OfferChange[];
}

export interface OfferReply {
  choice: "accept" | "talk";
  note: string;
  /** The revision this answered: a later change to the same setting asks again. */
  rev: number;
  at: string;
}

export interface CounterOffer {
  revisions: OfferRevision[];
  replies: Partial<Record<OfferKey, OfferReply>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isKey = (v: unknown): v is OfferKey => typeof v === "string" && (OFFER_KEYS as readonly string[]).includes(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A stored counter-offer, tolerant, never throws; null when there is none. */
export function counterOfferOf(raw: unknown): CounterOffer | null {
  if (!isObj(raw) || !Array.isArray(raw.revisions)) return null;
  const revisions: OfferRevision[] = [];
  for (const r of raw.revisions.slice(0, OFFER_REVISIONS_MAX)) {
    if (!isObj(r) || !Array.isArray(r.changes)) continue;
    const changes: OfferChange[] = [];
    for (const c of r.changes) {
      if (isObj(c) && isKey(c.key)) changes.push({ key: c.key, from: strOrNull(c.from, OFFER_WORD_MAX), to: strOrNull(c.to, OFFER_WORD_MAX) });
    }
    if (!changes.length) continue;
    revisions.push({ n: revisions.length + 1, at: str(r.at, 40), byId: str(r.byId, 64), by: str(r.by, 120), changes });
  }
  if (!revisions.length) return null;
  const replies: CounterOffer["replies"] = {};
  if (isObj(raw.replies)) {
    for (const k of OFFER_KEYS) {
      const a = raw.replies[k];
      if (isObj(a) && (a.choice === "accept" || a.choice === "talk")) {
        replies[k] = { choice: a.choice, note: str(a.note, TERM_NOTE_MAX), rev: Math.max(0, Math.min(OFFER_REVISIONS_MAX, Number(a.rev) || 0)), at: str(a.at, 40) };
      }
    }
  }
  return { revisions, replies };
}

/** The revision number each setting was last changed in. */
export function changedIn(co: CounterOffer | null): Partial<Record<OfferKey, number>> {
  const out: Partial<Record<OfferKey, number>> = {};
  for (const r of co?.revisions ?? []) for (const c of r.changes) out[c.key] = r.n;
  return out;
}

/** The wording now: the latest change to each setting, else the role's suggestion. */
export function currentWords(base: TermsWords, co: CounterOffer | null): TermsWords {
  const out: TermsWords = { ...base };
  for (const r of co?.revisions ?? []) {
    for (const c of r.changes) {
      if (c.key === "commitment") continue;
      if (c.to) out[c.key] = c.to;
      else delete out[c.key];
    }
  }
  return out;
}

/** The commitment we would agree on: the latest change, else the candidate's own. */
export function currentCommitment(theirs: number | null, co: CounterOffer | null): number | null {
  let now = theirs;
  for (const r of co?.revisions ?? []) for (const c of r.changes) if (c.key === "commitment") now = c.to == null ? theirs : Number(c.to);
  return now;
}

export interface OfferEdit {
  words?: Partial<Record<TermKey, string>>;
  commitmentPct?: number | null;
}

export type Edited = { ok: true; co: CounterOffer; revision: OfferRevision } | { ok: false; error: string; key?: OfferKey };

export const OFFER_WORDS = {
  nothingChanged: "Nothing changed, so there is nothing to save.",
  tooMany: "This offer has been changed many times. Talk it through together instead.",
  tooLong: (label: string) => `Keep the wording for ${label} to ${OFFER_WORD_MAX} characters.`,
  badCommitment: "Choose a commitment from 0 to 100 in steps of 10.",
  moved: "The offer changed while you were editing. Read it again and save once more.",
  nothingToAnswer: "There is nothing here to answer.",
  stillTalking: (labels: readonly string[]) => `We have not agreed ${labels.join(", ")} yet. Adopting now records the terms as they stand. Adopt anyway?`,
  chooseOne: (label: string) => `Say whether you accept or would like to talk about ${label}.`,
} as const;

/**
 * Append one revision. `base` is the role's suggestion and `theirs` the candidate's own commitment.
 * A setting whose new wording equals the current one is not a change. An empty wording takes the
 * setting back to "we'll set this together".
 */
export function editOffer(p: {
  base: TermsWords;
  theirs: number | null;
  co: CounterOffer | null;
  edit: OfferEdit;
  by: { id: string; name: string };
  now: Date;
}): Edited {
  const co = p.co ?? { revisions: [], replies: {} };
  if (co.revisions.length >= OFFER_REVISIONS_MAX) return { ok: false, error: OFFER_WORDS.tooMany };
  const now = currentWords(p.base, p.co);
  const changes: OfferChange[] = [];
  for (const k of TERM_KEYS) {
    const given = p.edit.words?.[k];
    if (given === undefined) continue;
    if (typeof given !== "string") return { ok: false, error: OFFER_WORDS.tooLong(TERM_LABELS[k]), key: k };
    const to = given.trim();
    if (to.length > OFFER_WORD_MAX) return { ok: false, error: OFFER_WORDS.tooLong(TERM_LABELS[k]), key: k };
    if (to === (now[k] ?? "").trim()) continue;
    changes.push({ key: k, from: now[k]?.trim() || null, to: to || null });
  }
  if (p.edit.commitmentPct !== undefined && p.edit.commitmentPct !== null) {
    if (!isCommitment(p.edit.commitmentPct)) return { ok: false, error: OFFER_WORDS.badCommitment, key: "commitment" };
    const was = currentCommitment(p.theirs, p.co);
    if (p.edit.commitmentPct !== was) changes.push({ key: "commitment", from: was == null ? null : String(was), to: String(p.edit.commitmentPct) });
  }
  if (!changes.length) return { ok: false, error: OFFER_WORDS.nothingChanged };
  const revision: OfferRevision = { n: co.revisions.length + 1, at: p.now.toISOString(), byId: p.by.id, by: p.by.name.slice(0, 120), changes };
  return { ok: true, co: { revisions: [...co.revisions, revision], replies: co.replies }, revision };
}

export type OfferState = "accept" | "talk" | "waiting";

/** Where a changed setting stands: the candidate's reply to its latest change, or waiting for one. */
export function stateOf(key: OfferKey, co: CounterOffer): OfferState {
  const at = changedIn(co)[key];
  const r = co.replies[key];
  if (!at) return "accept";
  return r && r.rev >= at ? r.choice : "waiting";
}

export interface OfferRow {
  key: OfferKey;
  label: string;
  /** Our wording now, or the commitment as "60%". */
  ours: string;
  /** What they answered before: their choice and note, or their own commitment. */
  theirs: { choice: "accept" | "talk"; note: string } | null;
  theirCommitment: number | null;
  state: OfferState;
  reply: { choice: "accept" | "talk"; note: string } | null;
}

/** The changed settings only, for the candidate: no log, no who, no earlier wording. */
export function offerForCandidate(p: { base: TermsWords; answers: TermAnswers; theirs: number | null; co: CounterOffer | null }): { revision: number; rows: OfferRow[]; open: number } | null {
  const co = p.co;
  if (!co) return null;
  const at = changedIn(co);
  const words = currentWords(p.base, co);
  const rows: OfferRow[] = [];
  for (const k of OFFER_KEYS) {
    if (!at[k]) continue;
    const state = stateOf(k, co);
    const r = co.replies[k];
    rows.push({
      key: k,
      label: OFFER_LABELS[k],
      ours: k === "commitment" ? `${currentCommitment(p.theirs, co)}%` : (words[k] ?? "We'll set this together."),
      theirs: k === "commitment" ? null : (p.answers[k as TermKey] ?? null),
      theirCommitment: k === "commitment" ? p.theirs : null,
      state,
      reply: state === "waiting" || !r ? null : { choice: r.choice, note: r.note },
    });
  }
  return { revision: co.revisions.length, rows, open: rows.filter((r) => r.state === "waiting").length };
}

/**
 * The settings still open at adoption: a CHANGED setting the applicant has not accepted (still "let's talk", or
 * not yet answered). A setting nobody changed is as the applicant answered it at the start and is not in this list.
 */
export function openTalks(p: { answers: TermAnswers; co: CounterOffer | null }): OfferKey[] {
  const co = p.co;
  if (!co) return [];
  const at = changedIn(co);
  return OFFER_KEYS.filter((k) => !!at[k] && stateOf(k, co) !== "accept");
}

export type Replied = { ok: true; co: CounterOffer } | { ok: false; error: string; key?: OfferKey };

/** The candidate answers the changed settings. Only a setting that is changed can be answered; each answered one is judged. */
export function replyToOffer(co: CounterOffer | null, raw: unknown, now: Date): Replied {
  if (!co) return { ok: false, error: OFFER_WORDS.nothingToAnswer };
  const given = isObj(raw) ? raw : {};
  const at = changedIn(co);
  const replies = { ...co.replies };
  let any = false;
  for (const k of OFFER_KEYS) {
    const a = given[k];
    if (a === undefined || a === null) continue;
    if (!at[k]) return { ok: false, error: OFFER_WORDS.nothingToAnswer, key: k };
    if (!isObj(a) || (a.choice !== "accept" && a.choice !== "talk")) return { ok: false, error: OFFER_WORDS.chooseOne(OFFER_LABELS[k]), key: k };
    const note = typeof a.note === "string" ? a.note.trim() : "";
    if (note.length > TERM_NOTE_MAX) return { ok: false, error: `Keep your note on ${OFFER_LABELS[k]} to ${TERM_NOTE_MAX} characters.`, key: k };
    replies[k] = { choice: a.choice, note, rev: co.revisions.length, at: now.toISOString() };
    any = true;
  }
  if (!any) return { ok: false, error: OFFER_WORDS.nothingToAnswer };
  return { ok: true, co: { revisions: co.revisions, replies } };
}

/** The role's suggestion for the whole proposal: for each setting, the first picked role that wrote one. */
export function baseWordsOf(offers: ReadonlyArray<{ words?: TermsWords | null } | null | undefined>): TermsWords {
  const out: TermsWords = {};
  for (const k of TERM_KEYS) {
    const w = offers.map((o) => o?.words?.[k]?.trim()).find(Boolean);
    if (w) out[k] = w;
  }
  return out;
}
