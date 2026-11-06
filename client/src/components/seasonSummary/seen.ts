/**
 * Whether a member has already been offered a season's summary, per browser.
 *
 * A convenience and never a record: storage can be empty (a private window, a
 * cleared browser) and the worst that costs is one more offer. Every read and
 * write is wrapped, because the accessor itself can throw.
 */
import type { SeasonSummary } from "@shared/seasonSummary";

const key = (userId: string, seasonId: string) => `season-summary-seen:${userId}:${seasonId}`;

export function seenSeason(userId: string, seasonId: string): boolean {
  try {
    return localStorage.getItem(key(userId, seasonId)) === "1";
  } catch {
    return false;
  }
}

export function markSeasonSeen(userId: string, seasonId: string): void {
  try {
    localStorage.setItem(key(userId, seasonId), "1");
  } catch {
    /* storage refused: the member may be offered it once more */
  }
}

/** How long after a turn the summary is still offered. */
export const OFFER_DAYS = 30;

/** Offer it: the season has closed, turned within the window, and was not offered before. */
export function shouldOffer(summary: SeasonSummary | null, userId: string, now: Date = new Date()): boolean {
  if (!summary?.season.closed || !summary.season.endedOn) return false;
  const turned = Date.parse(`${summary.season.endedOn}T00:00:00Z`);
  if (!Number.isFinite(turned) || now.getTime() - turned > OFFER_DAYS * 86_400_000) return false;
  return !seenSeason(userId, summary.season.id);
}
