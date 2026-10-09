/**
 * A VILLAGE AGREEMENT: a shared understanding the village adopts by its own
 * vote, with a review date (defect 9 of the canvas plan; Wave 4, 2026-09-28).
 *
 * The proposal wizard's "Write an agreement" (client/src/components/
 * governance/wizardConfig.ts) has always posted to `POST /api/governance/
 * agreements`, and until this lane nothing answered there. The ballot engine
 * was already capable of it: `ballots.subject_type` was named `agreement` in
 * 0089's own comment. What was missing was somewhere for the words to live
 * and a closer to adopt them, and both are built on existing machinery:
 *
 *   the vote      `openBallot` (server/lib/ballots.ts), the village's own
 *                 method and dials, the frozen electorate, the roll told
 *   the words     one `app_config` document per agreement
 *                 (server/lib/agreements.ts), written when the vote opens
 *   the adoption  a `SUBJECT_CLOSERS` entry (server/lib/agreementCloser.ts):
 *                 a carried vote marks the agreement active when it lands,
 *                 after the veto window like every Game change
 *
 * No migration and no new table. Isomorphic, like shared/governanceCanvas.ts,
 * so the wizard and the route refuse the same mistake in the same words.
 */

/** The ballot subject, and the wizard type's id. One string, three places. */
export const AGREEMENT = "agreement";

/** The domains the wizard offers. The empty choice is "not tied to one domain", stored as null. */
export const AGREEMENT_DOMAINS = ["money", "people", "space_land", "rules"] as const;
export type AgreementDomain = (typeof AGREEMENT_DOMAINS)[number];

export const AGREEMENT_DOMAIN_WORDS: Record<AgreementDomain, string> = {
  money: "Money",
  people: "People",
  space_land: "Space and land",
  rules: "Rules",
};

/** The wizard's own floors and ceilings, repeated here so the route holds to them too. */
export const AGREEMENT_LIMITS = { titleMin: 8, titleMax: 200, bodyMin: 60, bodyMax: 20000 } as const;

/**
 * Where an agreement stands.
 *
 *   voting       its vote is open, or carried and waiting for its landing
 *   active       the village carried it and it landed: it binds, until its review date
 *   not-adopted  the vote failed, missed its quorum, or was stopped inside its window
 *   withdrawn    the vote was called off before it closed
 */
export const AGREEMENT_STATUSES = ["voting", "active", "not-adopted", "withdrawn"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export interface AgreementInput {
  title: string;
  body: string;
  domain: AgreementDomain | null;
  circleId: string | null;
  /** `YYYY-MM-DD`, after today, or null for open-ended. */
  reviewAt: string | null;
}

export interface StoredAgreement extends AgreementInput {
  id: string;
  status: AgreementStatus;
  ballotId: string;
  proposedBy: string;
  proposedAt: string;
  /** When it was adopted, or when it stopped being in play. Null while voting. */
  decidedAt: string | null;
}

/** A real calendar date written `YYYY-MM-DD`. 2026-02-30 is not one. */
export function isAgreementDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * THE ONE VALIDATOR, for the route and the wizard. Returns the agreement
 * ready to store, or the sentence that refuses it.
 *
 * `today` is the village's own date, `YYYY-MM-DD`: a review date has to be
 * after it, because a review that is already due is a date nobody can keep.
 * `circleIds` are the circles the village has; a circle it does not have is
 * refused rather than stored as a dangling name.
 */
export function parseAgreement(
  raw: unknown,
  opts: { today: string; circleIds: readonly string[] },
): { ok: true; agreement: AgreementInput } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < AGREEMENT_LIMITS.titleMin) {
    return { ok: false, error: `A title needs at least ${AGREEMENT_LIMITS.titleMin} characters so the village can weigh it` };
  }
  if (title.length > AGREEMENT_LIMITS.titleMax) {
    return { ok: false, error: `Keep the title to ${AGREEMENT_LIMITS.titleMax} characters` };
  }
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (body.length < AGREEMENT_LIMITS.bodyMin) {
    return { ok: false, error: `An agreement needs at least ${AGREEMENT_LIMITS.bodyMin} characters so the village can weigh it` };
  }
  if (body.length > AGREEMENT_LIMITS.bodyMax) {
    return { ok: false, error: `Keep the agreement to ${AGREEMENT_LIMITS.bodyMax} characters` };
  }
  const rawDomain = b.domain === undefined || b.domain === null ? "" : String(b.domain).trim();
  if (rawDomain && !(AGREEMENT_DOMAINS as readonly string[]).includes(rawDomain)) {
    return { ok: false, error: "The domain is money, people, space and land, rules, or none" };
  }
  const rawCircle = b.circleId === undefined || b.circleId === null ? "" : String(b.circleId).trim();
  if (rawCircle && !opts.circleIds.includes(rawCircle)) {
    return { ok: false, error: "That circle is not one of this village's circles" };
  }
  const rawReview = b.reviewAt === undefined || b.reviewAt === null ? "" : String(b.reviewAt).trim();
  if (rawReview && !isAgreementDate(rawReview)) {
    return { ok: false, error: "A review date is a calendar date, or leave it blank for open-ended" };
  }
  if (rawReview && rawReview <= opts.today) {
    return { ok: false, error: "The review date has to be after today, so the village can keep it" };
  }
  return {
    ok: true,
    agreement: {
      title,
      body,
      domain: rawDomain ? (rawDomain as AgreementDomain) : null,
      circleId: rawCircle || null,
      reviewAt: rawReview || null,
    },
  };
}

/**
 * The document the village reads while it votes. What is adopted is exactly
 * the words under "The agreement". The closer never reads this back: the
 * words it marks active are the stored ones (server/lib/agreements.ts).
 */
export function agreementDoc(a: AgreementInput, extra: { askedBy: string; on: string; circleName: string | null }): string {
  return [
    `# ${a.title}`,
    "",
    "## The agreement",
    "",
    a.body,
    "",
    "## Scope and review",
    "",
    `Domain: ${a.domain ? AGREEMENT_DOMAIN_WORDS[a.domain] : "not tied to one domain"}.`,
    `Circle: ${extra.circleName ?? "the whole village"}.`,
    a.reviewAt ? `The village looks at it again on ${a.reviewAt}.` : "It is open-ended: no review date is set.",
    "",
    "## What changes if this carries",
    "",
    "It becomes an active agreement of the village, exactly as written above, once the vote lands. Nothing else changes on its own.",
    "",
    `Asked by ${extra.askedBy} on ${extra.on}.`,
    "",
  ].join("\n");
}
