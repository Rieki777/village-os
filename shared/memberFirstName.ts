/**
 * A MEMBER'S FIRST NAME, for a line that names them briefly.
 *
 * Erasure renames a member to `DEPARTED_MEMBER_NAME` (server/lib/erasure.ts
 * writes it to `users.name`), so history keeps somebody to point at. Taking
 * the first word of that placeholder printed "A" wherever a first name was
 * shown: "Recorded by A", forum authors, proposers, gratitude lines. The
 * placeholder is a whole phrase, so it is returned whole.
 */
export const DEPARTED_MEMBER_NAME = "A departed member";

export function memberFirstName(name: unknown, fallback = "Someone"): string {
  const trimmed = String(name ?? "").trim();
  if (trimmed === DEPARTED_MEMBER_NAME) return DEPARTED_MEMBER_NAME;
  return trimmed.split(/\s+/)[0] || fallback;
}
