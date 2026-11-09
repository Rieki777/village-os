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

/**
 * ENGLISH THE BUILD MOVED OUT OF THE CHUNKS (copySplit.ts), kept for the life
 * of the page. A lazy chunk awaits its part before it runs; a boot chunk
 * pushes its English inline. Either way it lands here, and it is merged
 * UNDER whatever language is active, now and on every switch: Lingui 6 has no
 * fallback chain, so a message the active catalog lacks would otherwise
 * render as its id. A translation always wins over the English beneath it.
 */
const movedEnglish: CompiledCatalog = {};

function mergeEnglishUnder(messages: CompiledCatalog): void {
  const active = i18n.messages as CompiledCatalog;
  const missing: CompiledCatalog = {};
  let any = false;
  for (const [id, compiled] of Object.entries(messages)) {
    if (Object.prototype.hasOwnProperty.call(active, id)) continue;
    missing[id] = compiled;
    any = true;
  }
  if (any) i18n.load(i18n.locale, missing as never);
}

export function registerEnglish(messages: CompiledCatalog): void {
  Object.assign(movedEnglish, messages);
  mergeEnglishUnder(messages);
}

type PartFetcher = (part: string) => Promise<{ messages: CompiledCatalog }>;

/** Same-origin and default credentials, which is what route-preload.js's `as=fetch` link asks for, so it is reused. */
const fetchPart: PartFetcher = async (part) => {
  const res = await fetch(`/api/i18n/catalog/en/part/${encodeURIComponent(part)}`);
  if (!res.ok) throw new Error(`copy part ${part}: ${res.status}`);
  return (await res.json()) as { messages: CompiledCatalog };
};

const parts = new Map<string, Promise<void>>();

/**
 * Load one part of the moved English, once, however many chunks await it.
 * One retry, then the promise rejects, so the chunk's import fails the way a
 * missing chunk does and the error boundary takes it: an id is never shown.
 */
export function loadCopy(part: string, fetcher: PartFetcher = fetchPart): Promise<void> {
  let pending = parts.get(part);
  if (!pending) {
    pending = fetcher(part)
      .catch(() => fetcher(part))
      .then((body) => registerEnglish(body.messages));
    pending.catch(() => parts.delete(part));
    parts.set(part, pending);
  }
  return pending;
}

type InlineQueue = { push: (messages: CompiledCatalog) => unknown };

/** Register what boot chunks queued, and take every later push straight in. */
export function drainInlineCopy(): void {
  const g = globalThis as { __villageCopyInline?: InlineQueue | CompiledCatalog[] };
  const queued = Array.isArray(g.__villageCopyInline) ? g.__villageCopyInline : [];
  g.__villageCopyInline = {
    push: (messages: CompiledCatalog) => {
      registerEnglish(messages);
      return 0;
    },
  };
  for (const messages of queued) registerEnglish(messages);
}

(globalThis as { __villageCopyLoad?: (part: string) => Promise<void> }).__villageCopyLoad = (part) => loadCopy(part);
drainInlineCopy();

/** Switch the whole app to `locale`, with `catalog` already fetched (empty for English). */
export function activateLocale(locale: string, catalog: CompiledCatalog, formatting?: string): void {
  formattingLocale = formatting && sameLanguage(formatting, locale) ? formatting : locale;
  // The moved English first, the language's own catalog over it.
  i18n.loadAndActivate({ locale, messages: { ...movedEnglish, ...catalog } as never, locales: [formattingLocale, locale] });
  applyDocumentLocale(locale);
}

function sameLanguage(a: string, b: string): boolean {
  try {
    return new Intl.Locale(a).language === new Intl.Locale(b).language;
  } catch {
    return false;
  }
}
