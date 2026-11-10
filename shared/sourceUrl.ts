/**
 * WHERE A VILLAGE OFFERS ITS SOURCE CODE (AGPL-3.0-or-later, section 13).
 *
 * Anyone who runs a changed version of this software for other people must
 * offer those people the source. Every village's footer therefore carries a
 * "Source code" link. It points at the village setting `platform.source_url`,
 * which defaults to the public Village OS repository and which a village that
 * runs modified code points at its own copy.
 *
 * ONE PLACE. The default and the rule for what counts as a usable address live
 * here, and the server and the footer both read through `servedSourceUrl`, so
 * a bad value in the setting can never become a broken or hostile link: it
 * falls back to the default.
 */
export const DEFAULT_SOURCE_URL = "https://github.com/Rieki777/village-os";

/** The setting's key in the game-variable registry (shared/gameVariables.ts). */
export const SOURCE_URL_KEY = "platform.source_url";

/**
 * The address to link to. Only http and https are served: a `javascript:` or
 * `data:` address typed into the setting is dropped, and so is anything that
 * is not an address at all. Blank means "the default".
 */
export function servedSourceUrl(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return DEFAULT_SOURCE_URL;
  try {
    const u = new URL(text);
    if (u.protocol !== "https:" && u.protocol !== "http:") return DEFAULT_SOURCE_URL;
    return u.toString();
  } catch {
    return DEFAULT_SOURCE_URL;
  }
}
