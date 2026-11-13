/**
 * WHERE SOURCE CODE IS OFFERED (AGPL-3.0-or-later, section 13).
 *
 * Anyone who runs a changed version of this software for other people must
 * offer those people the source. Every village's footer therefore carries TWO
 * links:
 *
 *   1. "Village OS source": the upstream repository. A platform constant that
 *      ships with every village and is NOT a village setting. When the project
 *      moves to the ReGen Civics organisation this is the one line that
 *      changes.
 *   2. "<Village name>'s source": the village's own repository, from the
 *      village setting `village.source_url` (Admin, Game Mechanics). Shown only
 *      when set. A village that runs modified code sets it.
 *
 * ONE PLACE. The constant and the rule for what counts as a usable address live
 * here, and the server and the footer both read through
 * `servedVillageSourceUrl`, so a bad value in the setting can never become a
 * broken or hostile link.
 */
export const UPSTREAM_SOURCE_URL = "https://github.com/ReGen-Civics/village-os"; // brand-ok: the upstream platform's own repository or image address, never a village's brand

/** The village's own setting in the game-variable registry (shared/gameVariables.ts). */
export const VILLAGE_SOURCE_URL_KEY = "village.source_url";

/**
 * The village's own address, or "" when there is none to show. Only https is
 * served: an http, `javascript:` or `data:` address typed into the setting is
 * refused, and so is anything that is not an address at all. Blank means "this
 * village has not set one", and the footer then shows no second link.
 */
export function servedVillageSourceUrl(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  try {
    const u = new URL(text);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}
