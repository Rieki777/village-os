/**
 * HOW THIS CULTURE SEES CONFLICT, said before its repair steps (lead, 12 Nov 2026).
 *
 * `org.conflict_intro` is a village setting: Admin edits it and a member may
 * propose a change to it like any other. The platform's own words are below.
 * The client says them through the catalogue when the setting still holds
 * them word for word, so a Spanish reader reads them in Spanish, and prints a
 * village's own words as written. Set to empty, the page draws no intro.
 */
export const CONFLICT_INTRO_KEY = "org.conflict_intro";

export const CONFLICT_INTRO_DEFAULT =
  "Conflict helps us evolve. As a culture, we meet it as an opportunity for growth, so everyone in it can take something good from it. Together we seek to understand what each conflict teaches us, so that every one helps us grow stronger.";

/** The intro as an answer carries it: the setting's words trimmed, or "" for none (absent, empty or not a string). */
export function conflictIntroOf(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 1200) : "";
}
