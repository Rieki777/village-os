import { Trans, useLingui } from "@lingui/react/macro";
import { Globe, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { autonym, LOCALES, type LocaleTier } from "@shared/i18nLocales";
import { directionOf } from "@shared/i18nDirection";
import { useLocale } from "./LocaleProvider";

/**
 * The language selector in the top banner (internal spec i18n, US2; §8 R31,
 * R37, R38; mock approved by Rye 2026-11-06).
 *
 * A button showing the current language's code (its own name from `xl`), with
 * a globe that drops below 375 px, opening a searchable list: "Use my
 * browser's language" first, then the current language, the village default
 * and the browser's languages, then the rest by their own names. Every option
 * is written in its own language and carries `lang` and `dir`, so a screen
 * reader pronounces it right. ARIA 1.2 combobox: typing filters, arrows move,
 * Enter chooses, Escape closes; focus returns to the button and a polite
 * status line announces the new language.
 */
const MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const fold = (s: string) => s.normalize("NFD").replace(MARKS, "").toLowerCase();

function englishName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function shortCode(tag: string): string {
  return tag.split("-")[0].toUpperCase();
}

type Option = { value: string | null; label: string; tier?: LocaleTier; search: string };

/**
 * The trigger's look. `onDark` is the approved banner button (white on the
 * teal header). `onLight` is the same button for the pages with no teal
 * header (the 404, the consent page, change requests, Admin's night look),
 * where white text would be invisible.
 *
 * `onSheet` paints with the sheet tokens instead of fixed colours, for a
 * header that follows a night sheet (Admin's header since 2026-11-09). There
 * `onLight` drew stone-800 text on the night card and the button vanished.
 */
export type PickerTone = "onDark" | "onLight" | "onSheet";
const TRIGGER_TONE: Record<PickerTone, string> = {
  onSheet: "border border-border bg-card hover:bg-muted text-card-foreground",
  onDark: "bg-white/10 hover:bg-white/20 text-white",
  onLight: "border border-stone-300 bg-white hover:bg-stone-100 text-stone-800",
};

export function LanguagePicker({ villageDefault = null, className = "", tone = "onDark" }: { villageDefault?: string | null; className?: string; tone?: PickerTone }) {
  const { t } = useLingui();
  const { locale, setLocale, supported } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [announced, setAnnounced] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const listId = useId();

  const current = autonym(locale);
  const code = shortCode(locale);

  const options = useMemo<Option[]>(() => {
    const browser = typeof navigator !== "undefined" ? [...(navigator.languages ?? [])].map((l) => l.split("-")[0]) : [];
    const rank = (tag: string) =>
      tag === locale ? 0 : tag === villageDefault ? 1 : browser.includes(tag.split("-")[0]) ? 2 : LOCALES.find((l) => l.tag === tag)?.tier === "reviewed" ? 3 : 4;
    const collator = new Intl.Collator("und");
    const langs = supported
      .filter((tag) => LOCALES.some((l) => l.tag === tag))
      .map((tag) => ({ value: tag, label: autonym(tag), tier: LOCALES.find((l) => l.tag === tag)?.tier, search: fold(`${autonym(tag)} ${englishName(tag)} ${tag}`) }))
      .sort((a, b) => rank(a.value) - rank(b.value) || collator.compare(a.label, b.label));
    const browserOption: Option = {
      value: null,
      label: t({ message: "Use my browser's language", context: "language picker" }),
      search: "",
    };
    return [browserOption, ...langs];
  }, [supported, locale, villageDefault, t]);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q ? options.filter((o) => o.value !== null && o.search.includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(-1);
    trigger.current?.focus();
  };

  const choose = (o: Option) => {
    setLocale(o.value);
    setAnnounced(o.value ? autonym(o.value) : o.label);
    close();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && active >= 0 && shown[active]) {
      e.preventDefault();
      choose(shown[active]);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t({ message: `Language: ${current} (${code})`, context: "language picker" })}
        className={`inline-flex items-center justify-center gap-1 min-w-11 min-h-11 px-1.5 rounded-[10px] ${TRIGGER_TONE[tone]} text-xs font-semibold tracking-wide transition-colors`}
      >
        <Globe className="w-5 h-5 max-[374px]:hidden" aria-hidden="true" />
        <span className="xl:hidden">{code}</span>
        <span className="hidden xl:inline text-sm font-medium" lang={locale}>{current}</span>
      </button>

      <span role="status" aria-live="polite" className="sr-only">
        {announced ? <Trans context="language picker">Now in {announced}</Trans> : null}
      </span>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-white text-foreground flex flex-col lg:absolute lg:inset-auto lg:top-full lg:end-0 lg:mt-2 lg:w-72 lg:max-h-[70vh] lg:rounded-xl lg:shadow-xl"
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
        >
          <div className="p-3 border-b border-gray-100 flex items-center gap-2">
            <input
              ref={box}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? optionId(active) : undefined}
              aria-label={t({ message: "Search languages", context: "language picker" })}
              placeholder={t({ message: "Search languages", context: "language picker" })}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
              onKeyDown={onKey}
              className="w-full min-h-11 px-3 rounded-lg border border-gray-300 text-sm"
            />
            {/* On a phone the list fills the screen, so touch needs a way out that does not choose. */}
            <button
              type="button"
              onClick={close}
              aria-label={t({ message: "Close", context: "language picker" })}
              className="lg:hidden inline-flex items-center justify-center min-w-11 min-h-11 rounded-lg hover:bg-gray-100"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <ul id={listId} role="listbox" aria-label={t({ message: "Choose a language", context: "language picker" })} className="overflow-y-auto py-1 flex-1">
            {shown.map((o, i) => {
              const selected = o.value === null ? false : o.value === locale;
              return (
                <li
                  key={o.value ?? "browser"}
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  lang={o.value ?? undefined}
                  dir={o.value ? directionOf(o.value) : undefined}
                  onClick={() => choose(o)}
                  className={`min-h-11 px-4 py-2.5 text-start text-sm cursor-pointer flex items-center justify-between gap-3 ${i === active ? "bg-gray-100" : "hover:bg-gray-50"} ${selected ? "font-semibold" : ""} ${o.value === null ? "border-b border-gray-100 text-muted-foreground" : ""}`}
                >
                  <bdi>{o.label}</bdi>
                  {o.tier === "machine" && (
                    <span className="text-[11px] text-muted-foreground" lang={locale}>
                      <Trans context="language picker">Translated automatically</Trans>
                    </span>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && (
              <li role="presentation" className="px-4 py-3 text-sm text-muted-foreground">
                <Trans context="language picker">No language matches</Trans>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
