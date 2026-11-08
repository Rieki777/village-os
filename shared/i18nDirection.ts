/**
 * Text direction for a locale, for `<html dir>` (spec US2.4).
 *
 * `Intl.Locale#getTextInfo` (or the older `textInfo` getter) answers this
 * where the engine has it; the static list covers engines that do not.
 *
 */
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug", "syr", "ku-Arab"]);

export type Direction = "ltr" | "rtl";

export function directionOf(tag: string): Direction {
  const raw = String(tag ?? "").trim();
  if (!raw) return "ltr";
  try {
    const loc = new Intl.Locale(raw) as Intl.Locale & {
      getTextInfo?: () => { direction?: string };
      textInfo?: { direction?: string };
    };
    const info = typeof loc.getTextInfo === "function" ? loc.getTextInfo() : loc.textInfo;
    if (info?.direction === "rtl" || info?.direction === "ltr") return info.direction;
    return RTL_LANGUAGES.has(loc.language) ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}
