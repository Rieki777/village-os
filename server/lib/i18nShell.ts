/**
 * The language of the first byte the server sends (internal spec i18n, US1;
 * §8 R16).
 *
 * The client decides the language for good, but a screen reader, a search
 * engine and the browser's own "translate this page?" offer all read
 * `<html lang>` before any script runs. So the shell already carries the best
 * guess: the choice saved in this browser (the `vos_locale` cookie, which the
 * client also writes for a signed-in member), then the browser's
 * Accept-Language, then the village default, then English. The same matching
 * rules as the client (shared/i18nResolve.ts). Never the address or a country
 * header: a country is not a language.
 */
import { offeredLocaleTags } from "../../shared/i18nLocales";
import { directionOf } from "../../shared/i18nDirection";
import { resolveLocale } from "../../shared/i18nResolve";

export const LOCALE_COOKIE = "vos_locale";

/** Accept-Language tags in preference order; q=0 and `*` dropped. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  const out: Array<{ tag: string; q: number; i: number }> = [];
  String(header ?? "")
    .split(",")
    .forEach((part, i) => {
      const [rawTag, ...params] = part.split(";").map((p) => p.trim());
      if (!rawTag || rawTag === "*") return;
      const qParam = params.find((p) => p.startsWith("q="));
      // A malformed q reads as 1, the header's own default; q=0 means "not this one".
      const parsed = qParam ? Number(qParam.slice(2)) : 1;
      const q = Number.isFinite(parsed) ? parsed : 1;
      if (q <= 0) return;
      out.push({ tag: rawTag, q, i });
    });
  return out.sort((a, b) => b.q - a.q || a.i - b.i).map((e) => e.tag);
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const pair of String(header ?? "").split(";")) {
    const [k, ...v] = pair.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("=")) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function shellLocale(input: { cookie: string | undefined; acceptLanguage: string | undefined; villageDefault: string | null | undefined }): string {
  return resolveLocale({
    supported: offeredLocaleTags(),
    saved: cookieValue(input.cookie, LOCALE_COOKIE),
    browser: parseAcceptLanguage(input.acceptLanguage),
    villageDefault: input.villageDefault,
  });
}

/** Set `lang` and `dir` on the shell's `<html>` element. */
export function setShellLang(shell: string, locale: string): string {
  return shell.replace(/<html\b[^>]*>/i, () => `<html lang="${locale.replace(/[^A-Za-z0-9-]/g, "")}" dir="${directionOf(locale)}">`);
}
