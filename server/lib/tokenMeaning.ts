/**
 * WHAT A TOKEN MEANS, IN THE VILLAGE'S OWN WORDS (0283).
 *
 * Rye, 2026-10-23: "Village Tokens is the umbrella word, which should be able
 * to be set in admin to name each type of token and for what categories it's
 * issued and what it means." The name was already settable; this is the
 * meaning. It is the village's text and only the village's: platform copy
 * never says what a token does (Rye, 2026-10-22), so nothing here writes a
 * default, and an empty description is shown as none.
 */
import type { Pool } from "mysql2/promise";
import { writeTokenDescription } from "../repos/tokens";

/** The longest description the column holds (varchar 600). */
export const TOKEN_DESCRIPTION_MAX = 600;

/**
 * What is wrong with a description an admin sent, or null when it can be
 * saved. Judged before the route writes anything, so a refused description
 * never leaves a rename half done beside it.
 */
export function tokenDescriptionProblem(raw: unknown): string | null {
  if (raw !== null && raw !== undefined && typeof raw !== "string") return "A description is words, or empty to clear it";
  const length = String(raw ?? "").trim().length;
  if (length > TOKEN_DESCRIPTION_MAX) return `A description is at most ${TOKEN_DESCRIPTION_MAX} characters; this one is ${length}`;
  return null;
}

/**
 * Save a description `tokenDescriptionProblem` has passed. Blank clears it.
 * The caller reloads the registry afterwards, as it does for a rename.
 */
export async function saveTokenDescription(pool: Pool, slug: string, raw: unknown): Promise<void> {
  const text = String(raw ?? "").trim();
  await writeTokenDescription(pool, slug, text === "" ? null : text);
}
