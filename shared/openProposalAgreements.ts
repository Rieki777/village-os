/**
 * THE AGREEMENTS ON A PUBLIC ROLE APPLICATION, their own file so one lane owns
 * them (role journey brief v2, PR-E; seams note 9 Nov 2026). The applicant's
 * card (shared/openProposalCard.ts) stores what this returns in `card.agreed`.
 *
 * Today: two required ticks, "I will align with the Love Letter" and "Once
 * approved, I will align with the confidentiality agreement". Rye's answer 8
 * (9 Nov) turns the first into a real, versioned membership alignment made at
 * application; that change lives here and in
 * client/src/components/openProposal/ApplicationAgreements.tsx.
 *
 * Aligning is the village's way of signing (Rye's answer 3).
 */

export interface ApplicationAgreed {
  loveLetter: boolean;
  nda: boolean;
}

export const AGREEMENT_WORDS = {
  needed: "Tick that you align with the Love Letter, and that you will align with the confidentiality agreement once approved.",
} as const;

/** The agreements as the form sent them. Both are required. */
export function parseAgreements(raw: unknown): { ok: true; agreed: ApplicationAgreed } | { ok: false; field: string; error: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (o.loveLetter !== true || o.nda !== true) return { ok: false, field: "agreed", error: AGREEMENT_WORDS.needed };
  return { ok: true, agreed: { loveLetter: true, nda: true } };
}

/** A stored `agreed`, read back safely. */
export function agreedOf(raw: unknown): ApplicationAgreed {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { loveLetter: o.loveLetter === true, nda: o.nda === true };
}
