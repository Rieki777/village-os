/**
 * THE COUNTER-OFFER, THE WORK (joining lane PR 4). Words and rules are shared/counterOffer.ts.
 *
 * One subject shape reads both doors: an open proposal (`op-`, the counter-offer in its JSON body)
 * and a member's application (`sa-`, in its answers). Every write locks the row, checks the
 * revision the editor read, appends, and writes the whole object back, so two editors never
 * overwrite each other and a retried save is refused instead of repeated.
 *
 * WHO MAY EDIT is decided by the doors, with the gate that adopts (`adoptRefusal` over `org.seat`).
 * This file holds no gate of its own.
 */
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  baseWordsOf,
  counterOfferOf,
  currentCommitment,
  currentWords,
  editOffer,
  offerForCandidate,
  OFFER_WORDS,
  openTalks,
  replyToOffer,
  stateOf,
  changedIn,
  OFFER_KEYS,
  OFFER_LABELS,
  type CounterOffer,
  type OfferEdit,
  type OfferKey,
  type OfferRevision,
} from "../../shared/counterOffer";
import { kindOfRef } from "../../shared/applicationReview";
import { publicTermsOf } from "../../shared/seatTermsOffer";
import type { TermAnswers, TermsWords } from "../../shared/termsWords";
import { inTransaction } from "../repos/liveSessions";
import * as proposals from "../repos/openProposals";
import * as apps from "../repos/seatApplications";

type Db = Pool | PoolConnection;

export interface OfferSubject {
  kind: "open" | "member";
  id: string;
  roleIds: string[];
  answers: TermAnswers;
  theirs: number | null;
  co: CounterOffer | null;
  /** Still waiting for its deciders: the only time terms may change. */
  open: boolean;
  /** The member door's candidate, to tell. */
  candidateUserId: string | null;
}

/** The subject behind a ref, or null. */
export async function loadSubject(db: Db, ref: string, lock = false): Promise<OfferSubject | null> {
  const kind = kindOfRef(ref);
  if (kind === "open") {
    const p = await proposals.readOpenProposal(db, ref, lock);
    if (!p || p.status === "unconfirmed") return null;
    return { kind, id: p.id, roleIds: p.body.roles.map((r) => r.roleId), answers: p.body.card?.terms?.answers ?? {}, theirs: p.body.card?.commitmentPct ?? null, co: p.body.counterOffer ?? null, open: p.status === "confirmed", candidateUserId: null };
  }
  if (kind === "member") {
    const a = await apps.readApplication(db, ref, lock);
    if (!a) return null;
    return { kind, id: a.id, roleIds: a.seatIds, answers: a.answers?.terms?.answers ?? {}, theirs: a.answers?.terms?.commitmentPct ?? null, co: a.answers?.counterOffer ?? null, open: a.status === "awaiting-holder", candidateUserId: a.candidateUserId };
  }
  return null;
}

async function writeSubject(db: Db, s: OfferSubject, co: CounterOffer): Promise<boolean> {
  return s.kind === "open" ? proposals.setCounterOffer(db, s.id, co) : apps.setApplicationCounterOffer(db, s.id, co);
}

/** The role's suggestion for this proposal, from the roles it names. */
export async function baseOf(db: Db, roleIds: readonly string[]): Promise<{ words: TermsWords; commitmentPct: number | null }> {
  const offers = (await apps.termsOffersOf(db, roleIds)).map((o) => publicTermsOf(o));
  return { words: baseWordsOf(offers), commitmentPct: offers.find((o) => o.commitmentPct != null)?.commitmentPct ?? null };
}

export interface DeciderOffer {
  revision: number;
  rows: Array<{
    key: OfferKey;
    label: string;
    suggested: string | null;
    current: string | null;
    theirs: { choice: "accept" | "talk"; note: string } | null;
    state: "accept" | "talk" | "waiting";
    changed: boolean;
  }>;
  theirCommitment: number | null;
  roleCommitment: number | null;
  ourCommitment: number | null;
  /** Newest first, for the deciders only. */
  history: Array<OfferRevision & { changes: Array<{ key: OfferKey; label: string; from: string | null; to: string | null }> }>;
  /** Settings still open at adoption, by label. */
  openTalks: string[];
}

/** What a decider reads: the suggestion, the answer, our wording, the state of each, and the log. */
export function deciderOffer(s: OfferSubject, base: { words: TermsWords; commitmentPct: number | null }): DeciderOffer {
  const words = currentWords(base.words, s.co);
  const at = changedIn(s.co);
  const rows = OFFER_KEYS.filter((k) => k !== "commitment").map((k) => ({
    key: k,
    label: OFFER_LABELS[k],
    suggested: base.words[k as keyof TermsWords] ?? null,
    current: words[k as keyof TermsWords] ?? null,
    theirs: s.answers[k as keyof TermAnswers] ?? null,
    state: s.co && at[k] ? stateOf(k, s.co) : s.answers[k as keyof TermAnswers]?.choice === "talk" ? ("talk" as const) : ("accept" as const),
    changed: !!at[k],
  }));
  return {
    revision: s.co?.revisions.length ?? 0,
    rows,
    theirCommitment: s.theirs,
    roleCommitment: base.commitmentPct,
    ourCommitment: currentCommitment(s.theirs, s.co),
    history: [...(s.co?.revisions ?? [])].reverse().map((r) => ({ ...r, changes: r.changes.map((c) => ({ ...c, label: OFFER_LABELS[c.key] })) })),
    openTalks: openTalks({ answers: s.answers, co: s.co }).map((k) => OFFER_LABELS[k]),
  };
}

export type Saved = { ok: true; revision: OfferRevision; subject: OfferSubject } | { ok: false; status: number; error: string; key?: OfferKey };

/** A decider saves a counter-offer: one new revision, or a refusal. The caller has already checked the gate. */
export async function saveOffer(pool: Pool, ref: string, p: { edit: OfferEdit; expectedRevision: unknown; by: { id: string; name: string }; now: Date }): Promise<Saved> {
  return inTransaction(pool, async (conn): Promise<Saved> => {
    const s = await loadSubject(conn, ref, true);
    if (!s) return { ok: false, status: 404, error: "There is nothing here." };
    if (!s.open) return { ok: false, status: 409, error: "This is decided, so its terms are closed." };
    if (Number(p.expectedRevision) !== (s.co?.revisions.length ?? 0)) return { ok: false, status: 409, error: OFFER_WORDS.moved };
    const base = await baseOf(conn, s.roleIds);
    const edited = editOffer({ base: base.words, theirs: s.theirs, co: s.co, edit: p.edit, by: p.by, now: p.now });
    if (!edited.ok) return { ok: false, status: 400, error: edited.error, key: edited.key };
    if (!(await writeSubject(conn, s, edited.co))) return { ok: false, status: 409, error: OFFER_WORDS.moved };
    return { ok: true, revision: edited.revision, subject: { ...s, co: edited.co } };
  });
}

export type Replied = { ok: true; subject: OfferSubject } | { ok: false; status: number; error: string; key?: OfferKey };

/** The applicant answers the changed settings. The caller has already proved who they are. */
export async function replyOffer(pool: Pool, ref: string, raw: unknown, now: Date): Promise<Replied> {
  return inTransaction(pool, async (conn): Promise<Replied> => {
    const s = await loadSubject(conn, ref, true);
    if (!s) return { ok: false, status: 404, error: "There is nothing here." };
    if (!s.open) return { ok: false, status: 409, error: "This is decided, so its terms are closed." };
    const r = replyToOffer(s.co, raw, now);
    if (!r.ok) return { ok: false, status: 400, error: r.error, key: r.key };
    if (!(await writeSubject(conn, s, r.co))) return { ok: false, status: 409, error: OFFER_WORDS.moved };
    return { ok: true, subject: { ...s, co: r.co } };
  });
}

/** What the applicant reads: the changed settings beside their answers. Never the log. */
export async function applicantOffer(db: Db, ref: string) {
  const s = await loadSubject(db, ref);
  if (!s || !s.co) return null;
  const base = await baseOf(db, s.roleIds);
  const offer = offerForCandidate({ base: base.words, answers: s.answers, theirs: s.theirs, co: s.co });
  return offer ? { ...offer, mayAnswer: s.open } : null;
}

/** The settings still open if this were adopted now, by label; empty when none. */
export async function openTalksOf(db: Db, ref: string): Promise<string[]> {
  const s = await loadSubject(db, ref);
  return s ? openTalks({ answers: s.answers, co: s.co }).map((k) => OFFER_LABELS[k]) : [];
}

