// Rye, 2026-10-30: "name the role AND the person (if there is one) so it's always naming the
// role as primacy, just the first name of the person in parenthesis". This amends the
// 2026-10-22 ruling "name the role, never the person" for LIVE display to signed-in members:
// the holder's first name is read from the roster when the view renders, never stored in copy,
// and never sent to public pages or vendors (Saberra gets role ids and code names only).
//
//   roleWithHolders("Treasurer", [])                        -> "Treasurer"
//   roleWithHolders("Treasurer", ["Rick Moss"])             -> "Treasurer (Rick)"
//   roleWithHolders("Steward", ["Rye Cordon", "Jessica"])   -> "Steward (Rye, Jessica)"
//   roleWithHolders("Steward", five names)                  -> "Steward (A, B, C +2)"

/** How many first names a label prints before it folds the rest into "+N". */
export const ROLE_HOLDER_NAME_CAP = 3;

/** First word of a display name; the local part of an email-shaped name. "" when nothing usable. */
export function holderFirstName(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.includes("@") ? (first.split("@")[0] ?? "") : first;
}

/** The parenthesis alone ("Rick", "Rye, Jessica", "A, B, C +2"), or "" for a vacant role. */
export function holderNames(holders: readonly (string | null | undefined)[] | null | undefined, cap = ROLE_HOLDER_NAME_CAP): string {
  const names = (holders ?? []).map(holderFirstName).filter((n) => n.length > 0);
  if (names.length === 0) return "";
  const max = Math.max(1, Math.floor(cap));
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** The role, then its current holders' first names in parentheses when the role is filled. */
export function roleWithHolders(role: string, holders: readonly (string | null | undefined)[] | null | undefined, cap = ROLE_HOLDER_NAME_CAP): string {
  const title = String(role ?? "").trim();
  const names = holderNames(holders, cap);
  if (!title) return names;
  return names ? `${title} (${names})` : title;
}
