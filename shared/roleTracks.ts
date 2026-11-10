/**
 * A ROLE'S TRACK: ONE LIST (guide v2, Rye 10 Nov 2026: "every role is a
 * contract").
 *
 * Two lists used to say what a role's `track` column holds. The role editor
 * (shared/roleParameters.ts) wrote "contractor", "volunteer", "employee" or
 * "ai"; the role card (shared/roleParams.ts) read "paid", "volunteer",
 * "local" or "ai". A track set in the editor read as no track on the card,
 * and a contractor role was not counted as paid. This is the one list, and
 * the two older words still read: "paid" as contractor, "local" as employee.
 *
 * The platform keeps every track for every village. A village says which a
 * role without one reads as (`org.default_track`, village data: a village
 * whose roles are all contracts sets "contractor").
 */
export const TRACKS = ["contractor", "volunteer", "employee", "ai"] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_WORDS: Record<Track, string> = {
  contractor: "Paid contractor",
  volunteer: "Volunteer",
  employee: "Local employee",
  ai: "AI",
};

/** Tracks that are paid, so a range must be on offer before the card is complete. */
export const PAID_TRACKS: readonly Track[] = ["contractor", "employee"];

/** The words the card used to store, read as the one list's. */
const OLDER: Record<string, Track> = { paid: "contractor", local: "employee" };

/** A stored or typed track as the one list's, or null. Reads the older words and each track's label. */
export function readTrack(raw: unknown): Track | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if ((TRACKS as readonly string[]).includes(v)) return v as Track;
  if (OLDER[v]) return OLDER[v];
  const byWords = (Object.entries(TRACK_WORDS) as Array<[Track, string]>).find(([, w]) => w.toLowerCase() === v);
  return byWords ? byWords[0] : null;
}

/** The track a role reads as: its own, else the village's default, else none. */
export function trackOf(own: unknown, villageDefault: unknown): Track | null {
  return readTrack(own) ?? readTrack(villageDefault);
}
