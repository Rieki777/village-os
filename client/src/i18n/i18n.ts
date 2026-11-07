import { i18n } from "@lingui/core";
import { directionOf, type Direction } from "@shared/i18nDirection";
import { SOURCE_LOCALE } from "./resolveLocale";

/**
 * The one Lingui instance, and the only place that switches language.
 *
 * English is the source language and is never downloaded: each `<Trans>` keeps
 * its English message in the chunk that renders it, compiled at build time
 * (precompileEnglish.ts), and catalogs from the server arrive compiled. So no
 * ICU compiler ships to the browser.
 */
i18n.loadAndActivate({ locale: SOURCE_LOCALE, messages: {} });

export { i18n };

export type CompiledCatalog = Record<string, unknown>;

/**
 * The locale every `Intl` formatter uses. It can be fuller than the catalog
 * locale: a member whose browser says es-CR reads the `es` catalog with Costa
 * Rican number and date conventions.
 */
let formattingLocale = SOURCE_LOCALE;
export function getFormattingLocale(): string {
  return formattingLocale;
}

/** Apply `lang` and `dir` to the document, so text, fonts and layout follow. */
export function applyDocumentLocale(locale: string, doc: Document | undefined = globalThis.document): Direction {
  const dir = directionOf(locale);
  if (doc?.documentElement) {
    doc.documentElement.lang = locale;
    doc.documentElement.dir = dir;
  }
  return dir;
}

/** Switch the whole app to `locale`, with `catalog` already fetched (empty for English). */
export function activateLocale(locale: string, catalog: CompiledCatalog, formatting?: string): void {
  formattingLocale = formatting && sameLanguage(formatting, locale) ? formatting : locale;
  i18n.loadAndActivate({ locale, messages: catalog as never, locales: [formattingLocale, locale] });
  applyDocumentLocale(locale);
}

function sameLanguage(a: string, b: string): boolean {
  try {
    return new Intl.Locale(a).language === new Intl.Locale(b).language;
  } catch {
    return false;
  }
}
