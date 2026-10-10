/**
 * THE ONE MUTATION SITE OF THE ALIGNMENT STORE: ERASURE (seat settings PR5, spec section 5).
 *
 * The four alignment tables (0242) are insert only, everywhere but here. A
 * grep test (server/lib/alignments.store.test.ts) fails on any other file
 * that names one of them beside an UPDATE, a DELETE, a TRUNCATE, a REPLACE or
 * an upsert.
 *
 * WHAT ERASURE DOES TO THE RECORD, under Rye's decision 2 (2026-10-09): the
 * words STAY, with the person de-attributed. Counsel has not said otherwise,
 * the village is a party, and its only copy of what it agreed to is the
 * stored words.
 *
 *   1. The member's own words on their applications (`note`, `deliverables`)
 *      go. That is the step erasure.ts already runs before this one
 *      (`eraseApplicationWords`).
 *   2. Alignment and party rows keep their `user_id`. The user row itself is
 *      tombstoned in place (erasure.ts), so every row that names the id now
 *      names "A departed member", and nothing is remapped.
 *   3. The member's name is scrubbed out of free text, and each mention
 *      becomes "a former member". WHERE, and by which spelling, is the part the
 *      red team (D3, S4) corrected: the first build searched every text in
 *      the village, case-blind, for the name, so a member called "May" turned
 *      another member's "31 May 2027" into "31 a former member 2027".
 *
 *        WORDS THE MEMBER IS A PARTY TO, OR WROTE: the texts they are a party
 *        to, their own applications' terms, the terms on offer they
 *        published. Their full display name, their @handle, and their first
 *        name on its own.
 *        EVERYBODY ELSE'S WORDS: other members' alignment texts, notes,
 *        deliverables and season-plan aims and commitments, every other
 *        seat's terms on offer, and the presets document. Only the full
 *        display name and the @handle, never a first name.
 *
 *      Always CASE-SENSITIVE, on word boundaries, and never next to a number:
 *      "31 May 2027" and "May 2027" are dates whoever is called May. A string
 *      that is a machine token (a lowercase key, an enum, a date like
 *      2027-05-31) inside the stored settings is never touched. A text whose
 *      words changed is stamped `redacted_at`.
 *
 *      A NAME SHORTER THAN THREE CHARACTERS IS NEVER SCRUBBED, full name,
 *      first name or handle: "Al" would eat "Allowance" on a looser match and
 *      matches far too much ordinary text on this one. A member named in two
 *      letters keeps their name in other people's words; the tombstone still
 *      de-attributes every row that names their id.
 *
 * WHAT IT NEVER TOUCHES: the hash, the salt, the parties, the alignments and
 * the seal. The receipt is signed over the hash and the party list and never
 * the words, so a scrubbed text's seal still verifies, and the other party's
 * own downloaded copy of the words still hashes to the hash they aligned with.
 *
 * Option C of decision 2 (replace an ended text's words with "Removed at the
 * request of a party") is NOT built: Rye chose to keep the words.
 *
 * It runs AFTER the tombstone, as the journal step does, and is handed the
 * name and handle the member had before it: by then the user row holds the
 * tombstone's. A resumed erasure that only has the tombstone's name scrubs
 * nothing new, which is the honest outcome of a step that already ran.
 */
import type { Pool } from "mysql2/promise";
import { SEAT_PRESETS_DOC } from "../../shared/seatTermsOffer";
import { textsForParty, textsMentioning, type StoredText } from "../repos/alignments";
import {
  applicationsMentioning,
  applicationWordsOf,
  offersBy,
  offersMentioning,
  rewriteApplicationSettings,
  rewriteApplicationWords,
  rewriteTermsOffer,
} from "../repos/seatApplications";
import { plansMentioning, rewritePlanWords } from "../repos/seasonPlans";
import { dbDocument } from "../repos/store-db";

/** What a departed member's name becomes in words other people still hold. */
export const FORMER_MEMBER = "a former member";

/** A name too short to scrub safely. See the header: this holds for every spelling. */
const MIN_NAME = 3;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ScrubNames {
  /** For words the member is a party to or wrote: full name, @handle, first name. */
  own: string[];
  /** For everybody else's words: full name and @handle only. */
  others: string[];
}

/** Every spelling that names the member, longest first so "Ana Q" goes before "Ana". */
export function namesToScrub(who: { name?: string | null; handle?: string | null }): ScrubNames {
  const name = String(who.name ?? "").trim();
  const handle = String(who.handle ?? "").trim().replace(/^@/, "");
  const others = new Set<string>();
  if (name.length >= MIN_NAME) others.add(name);
  if (handle.length >= MIN_NAME) others.add(`@${handle}`);
  const own = new Set(others);
  const first = name.split(/\s+/)[0] ?? "";
  if (first.length >= MIN_NAME && first !== name) own.add(first);
  const longestFirst = (set: Set<string>) => Array.from(set).sort((a, b) => b.length - a.length);
  return { own: longestFirst(own), others: longestFirst(others) };
}

/**
 * Replace every whole-word, CASE-SENSITIVE mention that is not part of a
 * date: a mention with a number right before or after it ("31 May", "May
 * 2027") is left alone.
 */
export function scrubText(text: string, names: readonly string[]): string {
  let out = text;
  for (const n of names) {
    const re = new RegExp(`(?<![\\w@])(?<!\\d[ ,.]?)${escape(n)}(?!\\w)(?![ ,.]?\\d)`, "g");
    out = out.replace(re, FORMER_MEMBER);
  }
  return out;
}

/** A string that is a key, an enum value or a date, never prose: left alone inside stored settings. */
const MACHINE_TOKEN = /^[a-z0-9:_.\-]+$/;

/** Every prose string inside a JSON value, scrubbed; everything else as it was. */
export function scrubDeep<T>(value: T, names: readonly string[]): T {
  const walk = (v: any): any => {
    if (typeof v === "string") return MACHINE_TOKEN.test(v) ? v : scrubText(v, names);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

export interface AlignmentErasureReport {
  textsRedacted: number;
  applicationsScrubbed: number;
  offersScrubbed: number;
  presetsScrubbed: boolean;
  /** Other members' application words and season-plan words that named them (S4). */
  othersWordsScrubbed: number;
}

/**
 * Scrub a departed member's name out of the alignment texts, the
 * applications, the season plans, the terms on offer and the village presets.
 * Step 3 of spec section 5, with the rules in the header.
 */
export async function eraseFromAlignments(
  pool: Pool,
  who: { id: string; name?: string | null; handle?: string | null },
): Promise<AlignmentErasureReport> {
  const names = namesToScrub(who);
  const report: AlignmentErasureReport = { textsRedacted: 0, applicationsScrubbed: 0, offersScrubbed: 0, presetsScrubbed: false, othersWordsScrubbed: 0 };
  if (names.others.length === 0 && names.own.length === 0) return report;

  // The texts: their own with every spelling, everybody else's with the full name and handle only.
  const texts = new Map<string, { t: StoredText; names: readonly string[] }>();
  for (const n of names.others) for (const t of await textsMentioning(pool, n)) texts.set(t.id, { t, names: names.others });
  for (const t of await textsForParty(pool, who.id)) texts.set(t.id, { t, names: names.own });
  for (const { t, names: spell } of Array.from(texts.values())) {
    const body = scrubText(t.body, spell);
    const settings = t.settings ? scrubDeep(t.settings, spell) : null;
    if (body === t.body && JSON.stringify(settings) === JSON.stringify(t.settings)) continue;
    await pool.query( // module-review-ok: the alignment store's one mutation site (spec section 5); kept out of server/repos/alignments.ts so that repo stays insert-only and the grep test names exactly one exempt file
      "UPDATE alignment_texts SET body = ?, settings_json = ?, redacted_at = UTC_TIMESTAMP() WHERE id = ?",
      [body, settings === null ? null : JSON.stringify(settings), t.id],
    );
    report.textsRedacted += 1;
  }

  // Applications. Their own: the terms (step 1 already took the note and deliverables).
  for (const a of await applicationWordsOf(pool, who.id)) {
    const next = scrubDeep(a.settings, names.own);
    if (JSON.stringify(next) === JSON.stringify(a.settings)) continue;
    await rewriteApplicationSettings(pool, a.id, next);
    report.applicationsScrubbed += 1;
  }
  // Everybody else's: their words and their terms, by full name and handle.
  const others = new Map<string, Awaited<ReturnType<typeof applicationsMentioning>>[number]>();
  for (const n of names.others) for (const a of await applicationsMentioning(pool, n)) if (a.candidateUserId !== who.id) others.set(a.id, a);
  for (const a of Array.from(others.values())) {
    const settings = scrubDeep(a.settings, names.others);
    const note = a.note === null ? null : scrubText(a.note, names.others);
    const deliverables = a.deliverables === null ? null : scrubText(a.deliverables, names.others);
    if (JSON.stringify(settings) !== JSON.stringify(a.settings)) {
      await rewriteApplicationSettings(pool, a.id, settings);
      report.applicationsScrubbed += 1;
    }
    if (note !== a.note || deliverables !== a.deliverables) {
      await rewriteApplicationWords(pool, a.id, note, deliverables);
      report.othersWordsScrubbed += 1;
    }
  }

  // Everybody else's season plans (their own words went in the season-plan step).
  const plans = new Map<string, Awaited<ReturnType<typeof plansMentioning>>[number]>();
  for (const n of names.others) for (const pl of await plansMentioning(pool, n)) if (pl.userId !== who.id) plans.set(pl.id, pl);
  for (const pl of Array.from(plans.values())) {
    const aim = pl.aim === null ? null : scrubText(pl.aim, names.others);
    const commitments = pl.commitments === null ? null : scrubDeep(pl.commitments, names.others);
    if (aim === pl.aim && JSON.stringify(commitments) === JSON.stringify(pl.commitments)) continue;
    await rewritePlanWords(pool, pl.id, aim, commitments);
    report.othersWordsScrubbed += 1;
  }

  // The seats' terms on offer: theirs with every spelling, the rest by full name and handle.
  const offers = new Map<string, { termsOffer: unknown; names: readonly string[] }>();
  for (const n of names.others) for (const o of await offersMentioning(pool, n)) offers.set(o.id, { termsOffer: o.termsOffer, names: names.others });
  for (const o of await offersBy(pool, who.id)) offers.set(o.id, { termsOffer: o.termsOffer, names: names.own });
  for (const [id, o] of Array.from(offers.entries())) {
    const next = scrubDeep(o.termsOffer, o.names);
    if (JSON.stringify(next) === JSON.stringify(o.termsOffer)) continue;
    await rewriteTermsOffer(pool, id, next);
    report.offersScrubbed += 1;
  }

  // The village's presets document, everybody's words. Retired rows are kept and scrubbed too.
  const doc = dbDocument<Record<string, any>>(pool, SEAT_PRESETS_DOC, { presets: [] });
  await doc.load();
  if (doc.exists()) {
    const before = doc.get();
    const after = scrubDeep(before, names.others);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      await doc.put(after);
      report.presetsScrubbed = true;
    }
  }
  return report;
}
