/**
 * THE SETTINGS DRAWER: a seat's terms, read, tucked under the live card.
 *
 * SeatTradingCard has carried an empty `settings` slot since it was built,
 * drawn as a tray under the card's bottom edge in the night look. This is
 * what goes in it. The card itself is not edited, its face never shows a
 * term, and the R55 scan over the card's view model stays exactly as it was:
 * the words here come from `settingsWords` (shared/seatSettings.ts), a
 * separate model the card never imports.
 *
 * WHO SEES IT. A host passes this only to a viewer allowed to read terms
 * (PR3 wires `terms.read`). Passed nothing, it renders nothing: no trigger,
 * no empty tray, nothing that tells a stranger there are terms to read.
 *
 * THE SHAPE. One trigger, a full-width button at least 48px tall carrying
 * aria-expanded and aria-controls. Under it, a stat sheet: one row per group
 * that is set, in season-card order, each a headline with a small icon. A row
 * opens on tap to its lines, the preset it started from and a "customised"
 * mark. Quests a moon show as pips. Every money row says, always visible,
 * that it is recorded here and paid outside the platform. Groups that are not
 * set are named once, together, at the end.
 *
 * It fetches nothing and imports nothing from `@/lib/gameApi`, for the same
 * reason the card does not: the /review tests mock that module down.
 */
import { useId, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Clock,
  Coins,
  DoorOpen,
  Gauge,
  Gem,
  ListChecks,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { settingsWords, type SeatSettings, type SettingsGroup, type SettingsRow } from "@shared/seatSettings";
import { isCustomised, presetFor, type SeatPreset } from "@shared/seatPresets";

const GROUP_ICONS: Record<SettingsGroup, LucideIcon> = {
  term: CalendarClock,
  clocks: Clock,
  rhythm: CalendarDays,
  pay: Coins,
  allowance: Wallet,
  bonus: Gem,
  quests: ListChecks,
  scoreboard: Gauge,
  ending: DoorOpen,
};

export const DRAWER_WORDS = {
  trigger: "Settings",
  triggerSub: "Terms for whoever holds this seat",
  notSetLead: "Not set yet",
  customised: "customised",
  fromPreset: "Started from",
  unreadable: "Some of these terms need fixing before they show here.",
  adoptedByVote: "Adopted by vote",
  adoptedBy: "Adopted by",
} as const;

export interface DrawerAdoption {
  how: "vote" | "holder";
  /** The holder who adopted for the village, when `how` is holder. */
  holderName?: string | null;
  /** YYYY-MM-DD. */
  on: string;
  href?: string | null;
}

function Pips({ filled, outlined }: { filled: number; outlined: number }) {
  return (
    <span aria-hidden="true" className="flex flex-wrap items-center gap-1">
      {Array.from({ length: filled }, (_, i) => (
        <span key={`f${i}`} className="size-2.5 rounded-full bg-notice" />
      ))}
      {Array.from({ length: outlined }, (_, i) => (
        <span key={`o${i}`} className="size-2.5 rounded-full ring-1 ring-inset ring-notice/70" />
      ))}
    </span>
  );
}

function adoptedWords(a: DrawerAdoption): string {
  const d = new Date(`${a.on}T00:00:00Z`);
  const when = Number.isNaN(d.getTime())
    ? a.on
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  if (a.how === "holder" && a.holderName) return `${DRAWER_WORDS.adoptedBy} ${a.holderName}, ${when}`;
  return `${DRAWER_WORDS.adoptedByVote}, ${when}`;
}

function Row({
  row,
  settings,
  villagePresets,
  bodyId,
}: {
  row: SettingsRow;
  settings: SeatSettings;
  villagePresets: readonly SeatPreset[];
  bodyId: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = GROUP_ICONS[row.group];
  const preset = presetFor(settings, row.group, villagePresets);
  const customised = isCustomised(settings, row.group, villagePresets);
  const hasMore = row.lines.length > 0 || !!preset;
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        aria-expanded={hasMore ? open : undefined}
        aria-controls={hasMore ? bodyId : undefined}
        disabled={!hasMore}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full items-start gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-notice" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{row.label}</span>
          <span className="mt-0.5 block text-[13.5px] leading-snug text-foreground">{row.headline}</span>
          {row.pips && (
            <span className="mt-1 block">
              <Pips filled={row.pips.filled} outlined={row.pips.outlined} />
            </span>
          )}
          {row.moneyLine && <span className="mt-0.5 block text-xs text-muted-foreground">{row.moneyLine}</span>}
        </span>
        {hasMore && (
          <ChevronDown
            className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>
      {hasMore && (
        <div id={bodyId} hidden={!open} className="pb-2.5 pl-7">
          {row.lines.length > 0 && (
            <ul className="space-y-1 text-[13px] leading-snug text-foreground">
              {row.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {preset && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {DRAWER_WORDS.fromPreset} {preset.label}
              {customised && (
                <span className="ml-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-notice">
                  {DRAWER_WORDS.customised}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function SeatTermsDrawer({
  settings,
  villagePresets = [],
  defaultOpen = false,
  unreadable = false,
  adopted = null,
}: {
  /** Parsed settings (`parseSeatSettings`). Absent: nothing renders. */
  settings?: SeatSettings | null;
  /** The village's own presets, so a row can name the one it started from. */
  villagePresets?: readonly SeatPreset[];
  /** The wizard's preview opens it; the live card starts it shut. */
  defaultOpen?: boolean;
  /** The host had terms it could not parse. Says so instead of guessing. */
  unreadable?: boolean;
  adopted?: DrawerAdoption | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const bodyId = `${uid}-terms`;
  if (!settings && !unreadable) return null;

  const rows = settings ? settingsWords(settings) : [];
  const set = rows.filter((r) => r.set);
  const unset = rows.filter((r) => !r.set);

  return (
    <div data-seat-terms="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <SlidersHorizontal className="size-4 shrink-0 text-notice" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{DRAWER_WORDS.trigger}</span>
          <span className="block text-xs text-muted-foreground">{DRAWER_WORDS.triggerSub}</span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={bodyId} hidden={!open} className="mt-1 border-t border-border/50 pt-1">
        {unreadable && !settings ? (
          <p className="py-2 text-xs text-muted-foreground">{DRAWER_WORDS.unreadable}</p>
        ) : (
          <>
            {set.length > 0 && (
              <ul>
                {set.map((row) => (
                  <Row
                    key={row.group}
                    row={row}
                    settings={settings!}
                    villagePresets={villagePresets}
                    bodyId={`${bodyId}-${row.group}`}
                  />
                ))}
              </ul>
            )}
            {unset.length > 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                {DRAWER_WORDS.notSetLead}: {unset.map((r) => r.label).join(", ")}
              </p>
            )}
          </>
        )}
        {adopted && (
          <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
            {adopted.href ? (
              <a href={adopted.href} className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
                {adoptedWords(adopted)}
              </a>
            ) : (
              adoptedWords(adopted)
            )}
          </p>
        )}
      </div>
    </div>
  );
}
