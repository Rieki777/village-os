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
 *   3. The member's display name and handle are scrubbed out of free text:
 *      the words and settings of every alignment text, the words inside an
 *      application's stored terms (a pay note, a measure), the seats' terms
 *      on offer, and the village's `seat-presets` document. Each becomes "a
 *      former member". A text whose words changed is stamped `redacted_at`.
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
import { applicationsMentioning, offersMentioning, rewriteApplicationSettings, rewriteTermsOffer } from "../repos/seatApplications";
import { dbDocument } from "../repos/store-db";

/** What a departed member's name becomes in words other people still hold. */
export const FORMER_MEMBER = "a former member";

/** A name too short to scrub safely: "Al" would eat "Allowance". */
const MIN_NAME = 3;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every phrase that names the member, longest first so "Ana Q" goes before "Ana". */
export function namesToScrub(who: { name?: string | null; handle?: string | null }): string[] {
  const out = new Set<string>();
  const name = String(who.name ?? "").trim();
  const handle = String(who.handle ?? "").trim().replace(/^@/, "");
  if (name.length >= MIN_NAME) out.add(name);
  if (handle.length >= MIN_NAME) {
    out.add(`@${handle}`);
    out.add(handle);
  }
  return Array.from(out).sort((a, b) => b.length - a.length);
}

/** Replace every whole-word, case-insensitive mention. */
export function scrubText(text: string, names: readonly string[]): string {
  let out = text;
  for (const n of names) {
    const lead = /^\w/.test(n) ? "\\b" : "";
    const trail = /\w$/.test(n) ? "\\b" : "";
    out = out.replace(new RegExp(`${lead}${escape(n)}${trail}`, "gi"), FORMER_MEMBER);
  }
  return out;
}

/** Every string inside a JSON value, scrubbed; everything else as it was. */
export function scrubDeep<T>(value: T, names: readonly string[]): T {
  const walk = (v: any): any => {
    if (typeof v === "string") return scrubText(v, names);
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
}

/**
 * Scrub a departed member's name and handle out of the alignment texts, the
 * terms on offer and the village presets. Step 3 of spec section 5.
 */
export async function eraseFromAlignments(
  pool: Pool,
  who: { id: string; name?: string | null; handle?: string | null },
): Promise<AlignmentErasureReport> {
  const names = namesToScrub(who);
  const report: AlignmentErasureReport = { textsRedacted: 0, applicationsScrubbed: 0, offersScrubbed: 0, presetsScrubbed: false };
  if (names.length === 0) return report;

  // The texts they are a party to, and any other text whose words name them.
  const texts = new Map<string, StoredText>();
  for (const t of await textsForParty(pool, who.id)) texts.set(t.id, t);
  for (const n of names) for (const t of await textsMentioning(pool, n)) texts.set(t.id, t);
  for (const t of Array.from(texts.values())) {
    const body = scrubText(t.body, names);
    const settings = t.settings ? scrubDeep(t.settings, names) : null;
    if (body === t.body && JSON.stringify(settings) === JSON.stringify(t.settings)) continue;
    await pool.query( // module-review-ok: the alignment store's one mutation site (spec section 5); kept out of server/repos/alignments.ts so that repo stays insert-only and the grep test names exactly one exempt file
      "UPDATE alignment_texts SET body = ?, settings_json = ?, redacted_at = UTC_TIMESTAMP() WHERE id = ?",
      [body, settings === null ? null : JSON.stringify(settings), t.id],
    );
    report.textsRedacted += 1;
  }

  // The words inside applications' stored terms (a pay note, a measure). Step 1 already took the note and deliverables.
  const apps = new Map<string, unknown>();
  for (const n of names) for (const a of await applicationsMentioning(pool, n)) apps.set(a.id, a.settings);
  for (const [id, settings] of Array.from(apps.entries())) {
    const next = scrubDeep(settings, names);
    if (JSON.stringify(next) === JSON.stringify(settings)) continue;
    await rewriteApplicationSettings(pool, id, next);
    report.applicationsScrubbed += 1;
  }

  // The seats' terms on offer.
  const offers = new Map<string, unknown>();
  for (const n of names) for (const o of await offersMentioning(pool, n)) offers.set(o.id, o.termsOffer);
  for (const [id, offer] of Array.from(offers.entries())) {
    const next = scrubDeep(offer, names);
    if (JSON.stringify(next) === JSON.stringify(offer)) continue;
    await rewriteTermsOffer(pool, id, next);
    report.offersScrubbed += 1;
  }

  // The village's presets document. Retired rows are kept and scrubbed too.
  const doc = dbDocument<Record<string, any>>(pool, SEAT_PRESETS_DOC, { presets: [] });
  await doc.load();
  if (doc.exists()) {
    const before = doc.get();
    const after = scrubDeep(before, names);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      await doc.put(after);
      report.presetsScrubbed = true;
    }
  }
  return report;
}
