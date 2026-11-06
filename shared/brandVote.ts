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
 *   - the currency code. It is locked at launch (Rye, 2026-11-05), and whether
 *     the new rule reopens it is a question held for Rye.
 *   - anything that is not already a plain text field of one of the sections
 *     below. A vote changes a value the village can read; it does not invent
 *     a key, and it does not write nested structure such as the map skin,
 *     which has its own sanitiser.
 *
 * PURE, so the validator and the executor read one rule.
 */

/** The sections of the brand document a vote may write a text field in. */
export const BRAND_VOTE_SECTIONS = ["project", "currency", "images", "theme", "identityPack"] as const;
export type BrandVoteSection = (typeof BRAND_VOTE_SECTIONS)[number];

/** Fields a vote may not move, with the reason a member reads. */
export const BRAND_VOTE_LOCKED: Readonly<Record<string, string>> = {
  "project.fiatCurrency": "The currency is set at launch, and everything already paid and owed is counted in it",
};

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
  const locked = BRAND_VOTE_LOCKED[field.trim()];
  if (locked) return locked;
  if (brandFieldValue(brand, field) === null) return "There is no text field by that name in the village's brand";
  const value = String(to ?? "");
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
