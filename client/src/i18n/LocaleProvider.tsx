import { I18nProvider } from "@lingui/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { offeredLocaleTags } from "@shared/i18nLocales";
import { removeStored, storedText, writeStored } from "@/lib/safeStorage";
import { fetchCatalog as fetchCatalogFromServer, type CatalogResponse } from "./catalog";
import { activateLocale, i18n } from "./i18n";
import { resolveLocale, SOURCE_LOCALE } from "./resolveLocale";

/**
 * Picks the language, loads its catalog, and lets anyone change it
 * (internal spec i18n, US1 and US2; §8 R16, R32).
 *
 * The saved choice lives in localStorage AND a cookie of the same name: the
 * cookie lets the server put the right `<html lang>` in the very first byte it
 * sends (spliceMeta), the localStorage copy survives a cookie purge. A
 * member's saved choice (their profile) is passed in as `sources.saved` and
 * wins over both.
 */
export const LOCALE_STORAGE_KEY = "vos_locale";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

export type LocaleSources = {
  /** The signed-in member's saved choice, when there is one. */
  saved?: string | null;
  /** `navigator.languages`, in order. */
  browser?: readonly string[];
  /** The village's default language. */
  villageDefault?: string | null;
};

type LocaleContextValue = {
  locale: string;
  /** null forgets the saved choice and follows the browser again. */
  setLocale: (tag: string | null) => void;
  supported: readonly string[];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale outside <LocaleProvider>");
  return ctx;
}

function browserLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const list = Array.isArray(navigator.languages) ? navigator.languages.filter(Boolean) : [];
  return list.length > 0 ? [...list] : navigator.language ? [navigator.language] : [];
}

function rememberChoice(tag: string | null): void {
  if (tag) {
    writeStored("local", LOCALE_STORAGE_KEY, tag);
    document.cookie = `${LOCALE_STORAGE_KEY}=${encodeURIComponent(tag)}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
  } else {
    removeStored("local", LOCALE_STORAGE_KEY);
    document.cookie = `${LOCALE_STORAGE_KEY}=; path=/; max-age=0; samesite=lax`;
  }
}

export function LocaleProvider({
  children,
  sources = {},
  fetchCatalog = fetchCatalogFromServer,
  timeoutMs = 1500,
  fallback = null,
}: {
  children: ReactNode;
  sources?: LocaleSources;
  fetchCatalog?: (locale: string) => Promise<CatalogResponse>;
  timeoutMs?: number;
  /** Shown while the first catalog loads, up to `timeoutMs` (never English text: R32). */
  fallback?: ReactNode;
}) {
  const supported = useMemo(() => offeredLocaleTags(import.meta.env.DEV), []);
  const browser = useMemo(() => sources.browser ?? browserLanguages(), [sources.browser]);
  const [locale, setActive] = useState(SOURCE_LOCALE);
  const [ready, setReady] = useState(false);
  const loadSeq = useRef(0);
  const touched = useRef(false);

  const choose = useCallback(
    (saved: string | null | undefined) =>
      resolveLocale({ supported, saved, browser, villageDefault: sources.villageDefault }),
    [supported, browser, sources.villageDefault],
  );

  const show = useCallback(
    (tag: string, messages: Record<string, unknown>) => {
      activateLocale(tag, messages, browser[0]);
      setActive(tag);
      setReady(true);
    },
    [browser],
  );

  /**
   * Load `tag`. On the first load a slow catalog falls back to English after
   * `timeoutMs`; it is still applied when it lands, unless the visitor has
   * started using the page by then (never flip mid-task).
   */
  const load = useCallback(
    (tag: string, firstLoad: boolean) => {
      const seq = ++loadSeq.current;
      if (tag === SOURCE_LOCALE) {
        show(SOURCE_LOCALE, {});
        return;
      }
      let timedOut = false;
      const timer = firstLoad
        ? setTimeout(() => {
            if (seq !== loadSeq.current) return;
            timedOut = true;
            show(SOURCE_LOCALE, {});
          }, timeoutMs)
        : undefined;
      fetchCatalog(tag).then(
        (res) => {
          clearTimeout(timer);
          if (seq !== loadSeq.current) return;
          if (timedOut && touched.current) return;
          show(tag, res.messages ?? {});
        },
        () => {
          clearTimeout(timer);
          if (seq !== loadSeq.current) return;
          if (!timedOut) show(SOURCE_LOCALE, {});
        },
      );
    },
    [fetchCatalog, show, timeoutMs],
  );

  useEffect(() => {
    load(choose(sources.saved ?? storedText("local", LOCALE_STORAGE_KEY)), true);
    // A member's saved choice arriving after sign-in re-runs this.
  }, [choose, load, sources.saved]);

  useEffect(() => {
    if (!ready) return;
    const mark = () => { touched.current = true; };
    window.addEventListener("pointerdown", mark, { once: true });
    window.addEventListener("keydown", mark, { once: true });
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, [ready]);

  const setLocale = useCallback(
    (tag: string | null) => {
      rememberChoice(tag);
      load(choose(tag), false);
    },
    [choose, load],
  );

  const value = useMemo(() => ({ locale, setLocale, supported }), [locale, setLocale, supported]);

  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider i18n={i18n}>{ready ? children : fallback}</I18nProvider>
    </LocaleContext.Provider>
  );
}
