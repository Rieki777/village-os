/**
 * WHAT A VILLAGE VOTE MAY CHANGE IN THE BRAND (Rye, 2026-11-06: "EVERYTHING
 * can change with the highest village vote").
 *
 * The brand overlay (names, words, images, theme) had one writer, the admin
 * route `PUT /api/admin/brand`, so a village with no admin could never rename
 * itself. A `brand_field` change set item is the vote's door onto the same
 * document, one field at a time.
 *
 * WHAT IT MAY NEVER TOUCH:
 *   - a secret. Integration secrets live in server/lib/secrets.ts, write-only
 *     and sealed, and never in this document. A field whose name reads like a
 *     credential is refused here as well, so a later lane that misfiles one
 *     cannot hand it to a ballot, whose payload every member reads.
 *   - anything that is not already a plain text field of one of the sections
 *     below. A vote changes a value the village can read; it does not invent
 *     a key, and it does not write nested structure such as the map skin,
 *     which has its own sanitiser.
 *
 * THE CURRENCY CODE MOVES ONLY AT THE HIGHEST TIER (Rye, 2026-11-06, relayed
 * by the master coordinator: the currency lock stays locked by default, and a
 * highest-tier village vote can change it). The admin route still refuses a
 * new code once the village has launched (server/routes/brand.ts), so the vote
 * is the one door after launch, and `brandFieldTier` prices it at the
 * constitutional tier whatever else the proposal carries. Constitutional is
 * the top of the ladder, so it is never below the tier a village has named its
 * highest (`governance.highest_tier`). Nothing already recorded is converted,
 * and `currencyChangeSentence` says what that means for stored amounts.
 *
 * PURE, so the validator and the executor read one rule.
 */

import type { Criticality } from "./governanceEngine";
import { exponentOf } from "./money";

/** The sections of the brand document a vote may write a text field in. */
export const BRAND_VOTE_SECTIONS = ["project", "currency", "images", "theme", "identityPack"] as const;
export type BrandVoteSection = (typeof BRAND_VOTE_SECTIONS)[number];

/** The currency code's field: every amount in the village is counted in it. */
export const BRAND_CURRENCY_FIELD = "project.fiatCurrency";

/**
 * Fields only a vote at the highest tier may move. Every other brand field is
 * routine, which is `CRITICALITY_FOR_ITEM_KIND.brand_field`.
 */
export const BRAND_VOTE_HIGHEST_TIER: readonly string[] = [BRAND_CURRENCY_FIELD];

/** The tier a vote on this field costs on its own. */
export function brandFieldTier(field: string): Criticality {
  return BRAND_VOTE_HIGHEST_TIER.includes(String(field ?? "").trim()) ? "constitutional" : "routine";
}

/**
 * What a currency change does, said in the change-set ledger every member reads.
 * `from` may be blank: a village that launched without naming one.
 *
 * Amounts live as minor units (shared/money.ts), so a stored 10000 is 100.00
 * in colones and 10000 in yen. A change between currencies with different
 * decimal places therefore moves every such amount by a power of ten, and the
 * sentence says by how much. An amount stored with a code of its own (a
 * module's price) keeps that code and is untouched.
 */
export function currencyChangeSentence(from: string, to: string): string {
  const was = from.trim();
  const head = `the village's currency changes ${was ? `from ${was} ` : ""}to ${to}. Nothing already recorded is converted: an amount stored without a currency of its own is read in ${to} from then on`;
  if (!was) return head;
  const shift = exponentOf(to) - exponentOf(was);
  if (shift === 0) return head;
  const places = (n: number) => (n === 1 ? "1 decimal place" : `${n} decimal places`);
  const factor = Math.pow(10, Math.abs(shift));
  return `${head}, and ${to} counts ${places(exponentOf(to))} where ${was} counts ${exponentOf(was)}, so each of those amounts reads ${factor} times ${shift > 0 ? "smaller" : "larger"}`;
}

/** A field name that reads like a credential. Refused whatever section it sits in. */
const SECRET_LIKE = /(secret|password|passwd|token|api_?key|private|credential|webhook|dsn|signing)/i;

/** The longest value a vote may write. */
export const BRAND_VOTE_MAX = 500;

/** The key a brand change is filed under on a proposal: `brand:<section>.<field>`. */
export const brandChangeKey = (field: string): string => `brand:${field}`;

/** Split `section.field`, or null when it is not that shape. */
export function parseBrandField(field: string): { section: BrandVoteSection; key: string } | null {
  const m = /^([A-Za-z]+)\.([A-Za-z][A-Za-z0-9]*)$/.exec(String(field ?? "").trim());
  if (!m) return null;
  if (!(BRAND_VOTE_SECTIONS as readonly string[]).includes(m[1])) return null;
  return { section: m[1] as BrandVoteSection, key: m[2] };
}

/** The value a field holds now, or null when the brand has no such text field. */
export function brandFieldValue(brand: unknown, field: string): string | null {
  const parsed = parseBrandField(field);
  if (!parsed) return null;
  const section = (brand as any)?.[parsed.section];
  if (!section || typeof section !== "object") return null;
  const value = section[parsed.key];
  return typeof value === "string" ? value : null;
}

/** Why a vote may not change this field to this value, or null when it may. */
export function brandVoteProblem(brand: unknown, field: string, to: string): string | null {
  const parsed = parseBrandField(field);
  if (!parsed) return `A vote can change a name, a word, an image or a colour in ${BRAND_VOTE_SECTIONS.join(", ")}, named as section.field`;
  if (SECRET_LIKE.test(parsed.key)) return "A vote never writes anything that reads like a credential: every member reads a ballot";
  const value = String(to ?? "");
  if (field.trim() === BRAND_CURRENCY_FIELD) {
    // Stored exactly as the admin route stores it (projectCurrencyToStore in
    // shared/money.ts), so the vote never writes a form the readers trim.
    if (!/^[A-Z]{3}$/.test(value)) return "A vote names the new currency as its three letter code in capitals, like CHF or CRC";
    return null;
  }
  if (brandFieldValue(brand, field) === null) return "There is no text field by that name in the village's brand";
  if (value.length > BRAND_VOTE_MAX) return `A brand field holds at most ${BRAND_VOTE_MAX} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "A brand field is one line of text";
  return null;
}

/** The brand with one field changed. The input is never mutated. */
export function withBrandField<T>(brand: T, field: string, to: string): T {
  const parsed = parseBrandField(field);
  if (!parsed) return brand;
  const current = (brand as any) ?? {};
  return { ...current, [parsed.section]: { ...(current[parsed.section] ?? {}), [parsed.key]: String(to) } } as T;
}
