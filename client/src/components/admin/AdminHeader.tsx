/**
 * The admin header: which page you are on, what it is for, and your own
 * settings in one corner.
 *
 * Left: the village and its address in small type, the open page's name, and
 * its one-line purpose (the same words as "What is this?", from adminAreas).
 * A page that draws its own filters gets a link that lands in them.
 *
 * Right, together: the Sera board shortcut for a steward, the language
 * selector at every width (spec i18n US2), and one "you" menu holding the
 * per-device Night look, today's handled count, and sign out (Rye,
 * 2026-11-09: "put these settings neatly in the corner").
 *
 * The header paints with the sheet tokens, so it stays light by ruling and
 * follows the profile's night sheet when Night look is on. The count never
 * leaves the browser, and Night look is remembered on this device only.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogOut, MessageCircle } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { HANDLED_EVENT, readHandledCount } from "./handledToday";
import { whatIsThis } from "./adminWords";
import { ADMIN_FILTERS_ID, focusAdminFilters, tabHasFilters } from "./adminFilters";
import { ADMIN_HEADER_ID } from "./AdminHelperHost";
import "./adminNight.css";

export default function AdminHeader({
  villageName,
  siteUrl,
  tab,
  userName = "",
  night,
  onNight,
  onSignOut,
  extra,
  defaultLocale = null,
  onHelper,
}: {
  villageName: string;
  siteUrl: string;
  /** The open admin tab, whose name and purpose the header carries. */
  tab: string;
  userName?: string;
  night: boolean;
  onNight: (next: boolean) => void;
  onSignOut: () => void;
  extra?: ReactNode;
  /** The village default language, for the selector's ordering (dial `village.default_locale`). */
  defaultLocale?: string | null;
  /** Opens the Admin helper (the village guide's panel). Absent, the menu has no helper row. */
  onHelper?: () => void;
}) {
  const { t } = useLingui();
  const host = siteUrl.replace(/^https?:\/\//, "");
  const page = whatIsThis(tab);
  const village = villageName.trim();
  const eyebrow = village
    ? t({ message: `${village} admin`, context: "admin header" })
    : t({ message: "Admin", context: "admin header" });

  return (
    <header id={ADMIN_HEADER_ID} className="sticky top-0 z-30 border-b border-border bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {eyebrow}
            {host && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="normal-case tracking-normal">{host}</span>
              </>
            )}
          </p>
          <h1 className="truncate font-display text-xl font-semibold leading-tight text-foreground sm:text-2xl">{page.name}</h1>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
            <p className="min-w-0 max-w-full truncate text-muted-foreground">{page.help}</p>
            {tabHasFilters(tab) && (
              <a
                href={`#${ADMIN_FILTERS_ID}`}
                onClick={(e) => {
                  if (focusAdminFilters()) e.preventDefault();
                }}
                className="-my-3 inline-flex min-h-11 shrink-0 items-center whitespace-nowrap font-medium text-foreground underline underline-offset-2"
              >
                <Trans context="admin header, jumps to the page's own filters">Change the filters</Trans>
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden sm:contents">{extra}</div>
          <LanguagePicker tone="onSheet" villageDefault={defaultLocale} />
          <YouMenu userName={userName} night={night} onNight={onNight} onSignOut={onSignOut} onHelper={onHelper} />
        </div>
      </div>
    </header>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

function useHandledToday(): number {
  const [handled, setHandled] = useState(() => readHandledCount(new Date()));
  useEffect(() => {
    const sync = () => setHandled(readHandledCount(new Date()));
    window.addEventListener(HANDLED_EVENT, sync);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener(HANDLED_EVENT, sync);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, []);
  return handled;
}

/** One button in the corner; the personal and device settings open under it. */
function YouMenu({
  userName,
  night,
  onNight,
  onSignOut,
  onHelper,
}: {
  userName: string;
  night: boolean;
  onNight: (next: boolean) => void;
  onSignOut: () => void;
  onHelper?: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const handled = useHandledToday();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = userName.trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  const initials = initialsOf(name);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={name
          ? t({ message: `Your settings, ${name}`, context: "admin header, menu button" })
          : t({ message: "Your settings", context: "admin header, menu button" })}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card pl-1 pr-2 text-sm font-medium text-card-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-deep text-xs font-semibold text-white">
          {initials || "·"}
        </span>
        {firstName && <span className="hidden max-w-[8rem] truncate md:inline">{firstName}</span>}
        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={t({ message: "Your settings", context: "admin header, menu button" })}
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-2 text-card-foreground shadow-lg"
        >
          {name && (
            <div className="px-3 pb-2 pt-1">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <p className="text-xs text-muted-foreground"><Trans context="admin header">Signed in to admin</Trans></p>
            </div>
          )}
          {onHelper && (
            <div className="border-t border-border py-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onHelper();
                }}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-card-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span className="flex-1"><Trans context="admin header, opens the village guide's helper panel">Ask your guide</Trans></span>
                <kbd className="rounded border border-border px-1.5 text-xs text-muted-foreground">{t({ message: "Ctrl /", context: "admin header, keyboard shortcut for the helper" })}</kbd>
              </button>
            </div>
          )}
          <div className="border-t border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p id={`${panelId}-night`} className="text-sm font-medium text-foreground"><Trans context="admin header, per-device dark colours">Night look</Trans></p>
                <p className="text-xs text-muted-foreground"><Trans>This device only. Admin stays light for everyone else.</Trans></p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={night}
                aria-labelledby={`${panelId}-night`}
                onClick={() => onNight(!night)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${night ? "border-teal-deep bg-teal-deep" : "border-border bg-muted"}`}
              >
                <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${night ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
              <Trans>Handled today on this device: {handled}</Trans>
            </p>
          </div>
          <div className="border-t border-border pt-1">
            <button
              type="button"
              onClick={onSignOut}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-card-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <Trans context="admin header">Sign out</Trans>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
