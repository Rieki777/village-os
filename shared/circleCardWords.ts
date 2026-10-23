/**
 * THE CIRCLE CARD'S WORDS: every fixed string the circle-level card prints,
 * and the CCOS term each plain heading stands for.
 *
 * Kept apart from `shared/circleCard.ts` so the voice gate reads all of the
 * copy in one file. The rules this copy keeps, each one a ruling:
 *   - Plain-word headings, with the CCOS term shown on hover or tap
 *     (Rye, 2026-10-22). A village that does not use CCOS turns the terms off
 *     (`org.ccos_terms`), and the headings stay as they are.
 *   - "role" is the noun for a sociocratic role everywhere a member reads it.
 *   - No copy names a person. A role is named by its full title, and the
 *     adoption record names a vote or a decision, never who pressed a button.
 *   - Time promises are "2 business days", never a count of hours.
 *   - Headings on the circle's own words speak as the circle: "What we look after".
 */

/** The framework the hover terms come from. */
export const FRAMEWORK_NAME = "CCOS";

/** Every heading on the card, by section key, in the order the card reads them. */
export const CIRCLE_SECTION_KEYS = [
  "purpose",
  "accountabilities",
  "domains",
  "authorities",
  "responsibilities",
  "roles",
  "stewardship",
  "checks",
  "succession",
  "values",
  "livingAgreement",
  "tools",
  "adoption",
] as const;
export type CircleSectionKey = (typeof CIRCLE_SECTION_KEYS)[number];

export const CIRCLE_HEADINGS: Record<CircleSectionKey, string> = {
  purpose: "Why this circle exists",
  accountabilities: "What you can count on us for",
  domains: "What we look after",
  authorities: "What we can decide on our own",
  responsibilities: "What we do regularly",
  roles: "Roles in this circle",
  stewardship: "How we give back more than we take",
  checks: "How we keep power in balance",
  succession: "When a role changes hands",
  values: "What we value",
  livingAgreement: "How we agree to be together",
  tools: "Tools we rely on",
  adoption: "Who agreed to this, and when",
};

/** The matching heading in the CCOS Circle Charter, shown as "CCOS: <term>". */
export const CCOS_TERMS: Record<CircleSectionKey | "existsWhile", string> = {
  existsWhile: "Purpose, while the circle is needed",
  purpose: "Purpose",
  accountabilities: "Accountabilities / Outcomes",
  domains: "Domains",
  authorities: "Authorities",
  responsibilities: "Responsibilities / Actions",
  roles: "Role Structure Overview",
  stewardship: "Regenerative Stewardship",
  checks: "Checks & Balances",
  succession: "Succession Planning",
  values: "Alignment with Core Values",
  livingAgreement: "Living Agreement",
  tools: "Tools and Resources",
  adoption: "Signatures",
};

/** "CCOS: Domains", the words a hover or a tap shows. */
export const termLabel = (term: string): string => `${FRAMEWORK_NAME}: ${term}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const CIRCLE_CARD_WORDS = {
  // Header
  eyebrow: "Circle",
  partOf: "Part of",
  existsWhile: "This circle exists while",
  existsWhileEmpty: "not written yet",
  status: { forming: "Forming", dormant: "Resting" } as Record<string, string>,
  termsKey: "Underlined headings show the matching CCOS term when you hover or tap them.",
  backToCircles: "All circles",

  // Empty states
  notWritten: "Not written yet",
  noPurpose: "No purpose written yet",
  accountabilitiesShort: (n: number) => `${plural(n, "line", "lines")} written. A circle answers for 3 to 6 things.`,

  // Roles
  noRoles: "No roles in this circle yet",
  roleFilled: "Filled",
  roleOpen: "Open",
  rolePartly: (n: number, of: number) => `${n} of ${of} filled`,
  roleForming: "Forming",
  roleExpired: "Term ended",
  seeCard: "See their card",
  seeCardOf: (role: string, i: number, of: number) =>
    of > 1 ? `See the card of holder ${i} of ${role}` : `See the card of the holder of ${role}`,
  roleDetails: "About this role",
  apply: "Apply for this role",
  holdersPrivate: "Sign in to open the holders' cards.",

  // Values
  valueLine: (value: string, practice: string) => `${value}: ${practice}`,

  // Adoption
  noAdoption: "No words for this circle have been adopted by consent yet.",
  adoptedByVote: (day: string) => `Adopted by a village vote on ${day}`,
  adoptedDirectly: (day: string) => `Adopted by a direct decision on ${day}`,
  adoptionCount: (n: number, first: string) => `${plural(n, "change", "changes")} adopted since ${first}`,
  createdLine: "The circle was created",
  wordsLine: "New words for the circle",

  // Loading
  failed: "This circle card did not load.",
  retry: "Retry",
  notFound: "There is no circle here.",
} as const;
