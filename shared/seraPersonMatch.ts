/**
 * Keyed-hash person matching with Sera: pure parts.
 * See docs/modules/sera-person-links.md. The raw email never leaves the
 * village; only HMAC-SHA256(secret, lowercased trimmed verified email) is sent.
 */
export const MATCH_TOOL = "match_person_by_email_hash";

/** What the hash is computed over. */
export function normalizeEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export type MatchOutcome =
  | { kind: "link"; owner: string }
  | { kind: "review"; outcome: "none" | "several"; matches: number };

/** Read Sera's answer; never auto-pick among several. */
export function readMatch(value: unknown, validId: (s: string) => boolean): MatchOutcome {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const ids = Array.isArray(v.owner_ids) ? Array.from(new Set(v.owner_ids.map((x) => String(x ?? "").trim()).filter(validId))) : [];
  if (ids.length === 1) return { kind: "link", owner: ids[0] };
  return { kind: "review", outcome: ids.length === 0 ? "none" : "several", matches: ids.length };
}

export const MATCH_WORDS = {
  none: "Sera found no person for this member's verified email. Link them by hand.",
  several: "Sera found more than one person for this member's verified email. Pick the right one and link them by hand.",
  off: "Automatic matching is off. Turn it on with SABERRA_PERSON_MATCH=on once Sera offers the match tool and the shared secret is set.",
};

export interface BackfillCounts {
  dryRun: boolean;
  /** Members with a verified email and no link yet. */
  candidates: number;
  linked: number;
  review: number;
  failed: number;
  /** Why nothing ran, in plain words, when nothing did. */
  note?: string;
}
