/**
 * Which language to show (spec US1). Pure, so the order of the sources is a
 * table test and not a browser experiment.
 *
 * The order is Rye's (2026-11-06): the member's saved choice, then the
 * browser's own list (`navigator.languages`, which is what Accept-Language is
 * built from), then the village's default, then English. Never the IP address
 * or country: a country is not a language, and a VPN moves people.
 */

/**
 * Macrolanguage tags a catalog is not filed under. `Intl.getCanonicalLocales`
 * already turns the deprecated codes (iw, in, ji, mo, tl) into he, id, yi,
 * ro and fil; it leaves `no` alone, and Norwegian catalogs are Bokmål.
 */
const LEGACY: Record<string, string> = { no: "nb" };

type Parsed = { language: string; script?: string; region?: string; maxScript?: string };

function parse(tag: string): Parsed | null {
  const raw = String(tag ?? "").trim().replace(/_/g, "-");
  if (!raw) return null;
  let canonical: string;
  try {
    [canonical] = Intl.getCanonicalLocales(raw);
  } catch {
    return null;
  }
  if (!canonical) return null;
  let loc: Intl.Locale;
  try {
    loc = new Intl.Locale(canonical);
  } catch {
    return null;
  }
  const language = LEGACY[loc.language] ?? loc.language;
  if (!language || language === "und" || language === "root") return null;
  let maxScript: string | undefined;
  try {
    maxScript = new Intl.Locale(language, { script: loc.script, region: loc.region }).maximize().script;
  } catch {
    maxScript = loc.script;
  }
  return { language, script: loc.script, region: loc.region, maxScript };
}

/**
 * Match one preferred tag against the supported set: exact tag; then the same
 * language and script (zh-TW -> zh-Hant); then the bare language (es-CR -> es);
 * then the CLDR parent for Portuguese outside Brazil (pt-AO -> pt-PT); then the
 * first supported tag of the same language (pt -> pt-BR). Null when nothing fits.
 */
export function matchLocale(preferred: string, supported: readonly string[]): string | null {
  const want = parse(preferred);
  if (!want) return null;
  const options = supported
    .map((tag) => ({ tag, p: parse(tag) }))
    .filter((o): o is { tag: string; p: Parsed } => o.p !== null && o.p.language === want.language);
  if (options.length === 0) return null;

  const wantTag = [want.language, want.script, want.region].filter(Boolean).join("-").toLowerCase();
  const exact = options.find((o) => o.tag.toLowerCase() === wantTag);
  if (exact) return exact.tag;

  const scripted = options.filter((o) => o.p.script);
  if (scripted.length > 0) {
    const byScript = scripted.find((o) => o.p.script === want.maxScript);
    if (byScript) return byScript.tag;
  }

  const regionMatch = options.find((o) => o.p.region && o.p.region === want.region);
  if (regionMatch) return regionMatch.tag;

  const bare = options.find((o) => !o.p.script && !o.p.region);
  if (bare) return bare.tag;

  if (want.language === "pt" && want.region && want.region !== "BR") {
    const european = options.find((o) => o.p.region === "PT");
    if (european) return european.tag;
  }
  return options[0].tag;
}

export type LocaleSources = {
  supported: readonly string[];
  /** The member's saved choice, or this browser's saved choice for a visitor. */
  saved: string | null | undefined;
  /** `navigator.languages`, in the browser's order. */
  browser: readonly string[];
  /** The village's default language (dial `village.default_locale`). */
  villageDefault: string | null | undefined;
};

export const SOURCE_LOCALE = "en";

export function resolveLocale(src: LocaleSources): string {
  const candidates = [src.saved, ...src.browser, src.villageDefault];
  for (const c of candidates) {
    if (!c) continue;
    const hit = matchLocale(c, src.supported);
    if (hit) return hit;
  }
  return SOURCE_LOCALE;
}
