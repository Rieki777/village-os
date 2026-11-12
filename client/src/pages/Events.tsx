/**
 * The village calendar at `/events` (0059, grown in 0085).
 *
 * One table, one read: `GET /api/events` answers with every dated thing the
 * viewer may see, in the window asked, plus the village's zone, the moon of
 * the day and the month names. This page draws it four ways: the two-ring
 * year wheel, the month grid (Months or Moons, remembered), the week, and
 * the flat list it always had. Every date prints in village time with the
 * zone named; the viewer's own clock is a second line only when it differs.
 *
 * This page does no filtering of its own beyond hiding the sky's rows from
 * the flat list: a client that receives a draft and is trusted to hide it is
 * one bug away from showing it, and the server never sends one.
 *
 * The module ships off, so an absent module renders NotFound exactly as every
 * other module page does. Existence is hidden, not merely unlinked.
 *
 * THE MOON FIRST (Phase C, decision 3). The page opens on the moon: this
 * moon's days on a golden spiral for the glance, a strip of days the thumb
 * swipes along under it on a phone, and the chosen day beside it on a desktop
 * with the moon's turnings. The month grid, the week, the year wheel and the
 * list stay one click away on the same row of tabs. The page stands in the
 * sheet's night world (docs/DESIGN_RULE.md).
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { storedText, writeStored } from "@/lib/safeStorage";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin, Users, Video } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { CARD_FEATURED, EYEBROW, H1, H2, HINT, WORLD } from "@/components/journey/look";
import type { CalendarItem, RsvpStatus } from "@shared/gatherings";
import { civilDate, lunarYearOf, type YearAnchor } from "@shared/lunar";
import { moonCountLabel } from "@shared/villageMoon";
import InfoTip from "@/components/InfoTip";
import YearWheel from "@/components/calendar/YearWheel";
import MonthView, { type GridMode } from "@/components/calendar/MonthView";
import WeekView from "@/components/calendar/WeekView";
import MoonGlyph from "@/components/calendar/MoonGlyph";
import CalendarFeedCard from "@/components/calendar/CalendarFeedCard";
import MoonSpiral from "@/components/calendar/MoonSpiral";
import DayStrip from "@/components/calendar/DayStrip";
import MoonTurnings from "@/components/calendar/MoonTurnings";
import { moonDays } from "@/components/calendar/moonSpiral";
import GatheringEmailSettings from "@/components/comms/GatheringEmailSettings";
// Village Comms (5.8, 5.9): a visitor's guest door, and the host's recap after it begins.
import GuestRsvpForm from "@/components/comms/GuestRsvpForm";
import HostRecapPanel, { hostToolsFor, recapLinkIn } from "@/components/comms/HostRecapPanel";
import TimePollPanel from "@/components/comms/TimePollPanel";
import {
  DEFAULT_ANCHOR,
  addDays,
  civilDayFor,
  itemsByDay,
  kindColour,
  kindLabel,
  localSecondLine,
  lunarDayInfo,
  moonHeading,
  moonLabel,
  todayIn,
  villageClock,
  villageDateLine,
  zoneNote,
  type CivilDay,
  type EventsPayload,
} from "@/components/calendar/calendarTime";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

type Tab = "moon" | "month" | "week" | "wheel" | "list";
/** The moon leads; the month is the next tab along, one click away. */
const TAB_IDS: readonly Tab[] = ["moon", "month", "week", "wheel", "list"];
const MODE_KEY = "calendar.gridMode";
const TAB_KEY = "calendar.tab";

const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const v = storedText("local", key);
  return allowed.includes(v as T) ? (v as T) : fallback;
};
const remember = (key: string, value: string) => { writeStored("local", key, value); };

/** "Today", "Tomorrow", "in 4 days", "3 days ago". */
function whenLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `in ${days} days`;
  if (days === -1) return "Yesterday";
  return `${Math.abs(days)} days ago`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Events() {
  const { t, i18n } = useLingui();
  const modules = useModules();
  const eventsModule = useModule("events");
  const [payload, setPayload] = useState<EventsPayload | null>(null);
  const [span, setSpan] = useState<CalendarItem[]>([]);
  const [spanYear, setSpanYear] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(() => remembered(TAB_KEY, TAB_IDS, "moon"));
  const [mode, setMode] = useState<GridMode>(() => remembered(MODE_KEY, ["months", "moons"] as const, "months"));
  const [cursor, setCursor] = useState<CivilDay | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** 0092: what a seat fee just did. Value moving deserves its own line. */
  const [notice, setNotice] = useState<string | null>(null);
  const recapLink = useMemo(() => recapLinkIn(typeof window === "undefined" ? "" : window.location.search), []);

  const timezone = payload?.timezone ?? "UTC";
  const anchor = payload?.anchor ?? DEFAULT_ANCHOR;
  const hemisphere = payload?.hemisphere ?? "north";
  const monthNames = payload?.monthNames ?? [];
  /* ONE MOON NUMBER FOR THE WHOLE PAGE. The wheel, the grid, the roll and the
     day heading all count from this lunation, so a member reads the same
     number for the same moon wherever they meet it. Null until the payload
     lands, and null for good in a village that has set no first moon: the
     surfaces then print windows and names with no number on them. */
  const moonOneCycle = payload?.moonOneCycle ?? null;
  const today = useMemo(() => todayIn(timezone), [timezone]);

  const load = useCallback(() => {
    fetch("/api/events", { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: EventsPayload) => setPayload({ ...d, events: d.events ?? [] }))
      .catch(() => setPayload((p) => p ?? { events: [], rsvpEnabled: true, timezone: "UTC", window: { from: "", to: "" }, lunar: null, anchor: DEFAULT_ANCHOR, hemisphere: "north", monthNames: [], moonOneCycle: null }));
  }, []);

  /** The wheel, month and week read a whole year around the cursor. */
  const loadSpan = useCallback((year: number, tz: string) => {
    const from = civilDayFor(year - 1, 12, 1, tz).startsAt.toISOString();
    const to = civilDayFor(year + 1, 2, 1, tz).startsAt.toISOString();
    fetch(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: EventsPayload) => { setSpan(d.events ?? []); setSpanYear(year); })
      .catch(() => { setSpan([]); setSpanYear(year); });
  }, []);

  useEffect(() => { if (eventsModule) load(); }, [eventsModule?.id, load]);
  useEffect(() => {
    if (!payload) return;
    if (!cursor) { const t = todayIn(payload.timezone); setCursor(t); setSelectedKey(t.key); }
  }, [payload, cursor]);
  useEffect(() => {
    if (!payload || !cursor) return;
    if (spanYear !== cursor.year) loadSpan(cursor.year, payload.timezone);
  }, [payload, cursor, spanYear, loadSpan]);

  const reload = () => { load(); if (cursor) loadSpan(cursor.year, timezone); };

  const answer = async (item: CalendarItem, status: RsvpStatus) => {
    const key = `${item.id}:${item.occurrenceKey}`;
    setBusy(key);
    setProblem(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/events/${item.id}/rsvp`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ status, occurrenceKey: item.occurrenceKey || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      // The server owns capacity, so its refusal is the truth. Showing the
      // reason beats a button that silently does nothing.
      if (!res.ok) setProblem(body?.error ?? "That didn't go through. Try again.");
      else {
        // 0092: say what moved. A seat fee taken with no word about it is the
        // one thing a member would find out later, in their ledger.
        if (body?.charged > 0) setNotice(`${body.charged} ${body.tokenName} held for your place.`);
        reload();
      }
    } catch { setProblem("That didn't go through. Try again."); }
    setBusy(null);
  };

  const pickTab = (t: Tab) => { setTab(t); remember(TAB_KEY, t); };
  const pickMode = (m: GridMode) => { setMode(m); remember(MODE_KEY, m); };

  const step = (dir: -1 | 1) => {
    if (!cursor) return;
    if (tab === "week") { const n = addDays(cursor, 7 * dir, timezone); setCursor(n); setSelectedKey(n.key); return; }
    if (tab === "wheel") { setCursor(civilDayFor(cursor.year + dir, 1, 1, timezone)); return; }
    if (tab === "moon" || mode === "moons") {
      const info = lunarDayInfo(cursor, anchor, timezone);
      if (!info) return;
      // Day 1 of the next moon, or a day inside the previous one.
      const n = dir > 0 ? addDays(cursor, info.length - info.day + 1, timezone) : addDays(cursor, -info.day, timezone);
      const first = addDays(n, -((lunarDayInfo(n, anchor, timezone)?.day ?? 1) - 1), timezone);
      setCursor(first); setSelectedKey(first.key);
      return;
    }
    const m = cursor.month + dir;
    const y = cursor.year + (m < 1 ? -1 : m > 12 ? 1 : 0);
    const mm = ((m - 1 + 12) % 12) + 1;
    const n = civilDayFor(y, mm, 1, timezone);
    setCursor(n); setSelectedKey(n.key);
  };
  const goToday = () => { const t = todayIn(timezone); setCursor(t); setSelectedKey(t.key); };

  const selectDay = (d: CivilDay) => { setSelectedKey(d.key); setCursor(d); };

  const byDay = useMemo(() => itemsByDay(span, timezone), [span, timezone]);
  const selectedItems = selectedKey ? byDay.get(selectedKey) ?? [] : [];
  const listItems = (payload?.events ?? []).filter((i) => i.kind !== "sky");
  const moon = useMemo(
    () => (payload && cursor ? moonDays(cursor, today, anchor, timezone, byDay) : null),
    [payload, cursor, today, anchor, timezone, byDay],
  );

  /** Dates on the moon view, in the reader's language and the village's zone. */
  const fmt = (d: CivilDay, opts: Intl.DateTimeFormatOptions): string => {
    try { return new Intl.DateTimeFormat(i18n.locale, { ...opts, timeZone: timezone }).format(d.noon); }
    catch { return new Intl.DateTimeFormat(undefined, opts).format(d.noon); }
  };
  const dayName = (d: CivilDay) => fmt(d, { weekday: "long", day: "numeric", month: "long" });
  const weekdayShort = (d: CivilDay) => fmt(d, { weekday: "short" });
  const shortDate = (d: CivilDay) => fmt(d, { day: "numeric", month: "short" });
  const dayFor = (key: string): CivilDay => {
    const [y, m, d] = key.split("-").map(Number);
    return civilDayFor(y, m, d, timezone);
  };
  const tabLabel = (id: Tab): string => {
    switch (id) {
      case "moon": return t({ message: "Moon", context: "calendar view tab" });
      case "month": return t({ message: "Month", context: "calendar view tab" });
      case "week": return t({ message: "Week", context: "calendar view tab" });
      case "wheel": return t({ message: "Year", context: "calendar view tab" });
      case "list": return t({ message: "List", context: "calendar view tab" });
    }
  };

  if (modules.loaded && !eventsModule) return <ModuleGate moduleId="events" name="Village Calendar" />;

  const rsvpEnabled = payload?.rsvpEnabled !== false;
  const lunar = payload?.lunar ?? null;

  const rsvpButtons = (g: CalendarItem) => {
    if (!rsvpEnabled) return null;
    if (!(g.kind === "gathering" || g.kind === "festival" || g.kind === "external")) return null;
    if (!(g.status === "scheduled" || g.status === "postponed")) return null;
    const key = `${g.id}:${g.occurrenceKey}`;
    return (
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {/* 0092: what a place costs, beside the button that takes it. A price
            a member reads only after the charge is a surprise charge. */}
        {(g.seatPrice ?? 0) > 0 && (
          <span className="text-xs font-medium text-notice border border-notice/50 rounded-lg px-2 py-1">
            {g.seatPrice} {g.seatTokenName ?? g.seatToken}
          </span>
        )}
        {(["going", "maybe", "declined"] as RsvpStatus[]).map((s) => {
          const mine = g.myRsvp === s;
          // A full gathering still accepts maybe and declined: only a new
          // "going" needs a seat.
          const blocked = s === "going" && g.spotsLeft === 0 && !mine;
          return (
            <button
              key={s}
              type="button"
              onClick={() => answer(g, s)}
              disabled={busy === key || blocked}
              aria-pressed={mine}
              className={`jw-btn min-h-11 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors disabled:opacity-40 ${
                mine ? "bg-notice text-background border-notice" : "bg-background text-foreground border-border hover:bg-muted"
              }`}
            >
              {s === "going" ? "I'm coming" : s === "maybe" ? "Maybe" : "Can't make it"}
            </button>
          );
        })}
        <InfoTip tip="A full gathering only blocks a new I'm coming. Maybe and can't make it always go through, and a freed place goes to whoever has waited longest." label="How answering works" />
        {(g.seatPrice ?? 0) > 0 && (
          <InfoTip tip="A place here costs credits, held from the moment you take it. Change your answer, leave the queue, or see the gathering come off the calendar, and every one of them gives it straight back." label="How the seat fee works" />
        )}
      </div>
    );
  };

  const itemCard = (g: CalendarItem, showWhen: boolean, surface: "card" | "muted" = "card") => {
    const second = localSecondLine(g, timezone);
    const key = `${g.id}:${g.occurrenceKey}`;
    return (
      <li key={key} className={`border border-border rounded-xl p-4 sm:p-5 ${surface === "muted" ? "bg-muted" : "bg-card"}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-lg text-foreground flex items-center gap-2 flex-wrap">
              <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: kindColour(g) }} aria-hidden="true" />
              <span className={g.status === "cancelled" ? "line-through opacity-70" : ""}>{g.title}</span>
              {g.kind !== "gathering" && (
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground border border-border rounded-lg px-1.5 py-0.5">
                  {kindLabel(g.kind)}
                </span>
              )}
              {g.status === "cancelled" && (
                <span className="text-xs font-medium text-destructive bg-destructive/10 border border-destructive/40 rounded-lg px-1.5 py-0.5">Cancelled</span>
              )}
              {g.status === "postponed" && (
                <span className="text-xs font-medium text-notice border border-notice/50 rounded-lg px-1.5 py-0.5">Postponed</span>
              )}
              {g.isExample && (
                <span className="text-xs font-medium uppercase tracking-widest text-notice border border-notice/50 rounded-lg px-1.5 py-0.5">example</span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{villageDateLine(g, timezone)}</span>
              {showWhen && <span className="text-foreground/60">({whenLabel(g.daysUntil)})</span>}
            </p>
            {second && <p className="text-xs text-muted-foreground/80 mt-0.5 ml-5">{second}</p>}
            {g.locationText && (
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {g.locationText}
              </p>
            )}
            {g.onlineUrl && g.attendanceMode !== "offline" && (
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <a href={g.onlineUrl} className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noopener noreferrer">Join online</a>
              </p>
            )}
            {g.link && (
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <a href={g.link} className="underline underline-offset-2 hover:text-foreground">Open</a>
              </p>
            )}
          </div>
          {(g.kind === "gathering" || g.kind === "festival" || g.kind === "external") && (
            <div className="text-right shrink-0">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 justify-end">
                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/* The real number, always. A capacity of 0 is a real answer
                    and must not read as "no limit". */}
                {g.capacity === null ? `${g.goingCount} going` : `${g.goingCount} of ${g.capacity} going`}
              </p>
              {g.spotsLeft === 0 && <p className="text-xs text-notice mt-0.5">Full</p>}
            </div>
          )}
        </div>
        {g.description && <p className="text-sm text-muted-foreground mt-3 whitespace-pre-line">{g.description}</p>}
        {g.timePoll && <TimePollPanel item={g} onChanged={reload} />}
        {rsvpButtons(g)}
        {/* Village Comms: shown only to people who manage gatherings. */}
        {(g.kind === "gathering" || g.kind === "festival") && <GatheringEmailSettings eventId={g.id} />}
        {authToken() ? hostToolsFor(g) && <HostRecapPanel eventId={g.id} occurrenceKey={g.occurrenceKey} /> : <GuestRsvpForm gathering={g} />}
      </li>
    );
  };

  const selectedDay = cursor && selectedKey ? (selectedKey === cursor.key ? cursor : (() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    return civilDayFor(y, m, d, timezone);
  })()) : null;
  const selectedLunar = selectedDay ? lunarDayInfo(selectedDay, anchor, timezone) : null;
  const selectedMoonName = selectedLunar ? moonLabel(selectedLunar.monthIndex, selectedLunar.cycleNumber, moonOneCycle, monthNames) : null;
  const skyToday = selectedItems.filter((i) => i.kind === "sky");
  const dayItems = selectedItems.filter((i) => i.kind !== "sky");

  const moonName = moon ? moonLabel(moon.info.monthIndex, moon.info.cycleNumber, moonOneCycle, monthNames) : null;
  const moonTitle = moonName && (moonName.title || moonName.name)
    ? [moonName.title, moonName.name].filter(Boolean).join(", ")
    : t({ message: "This moon", context: "calendar moon view heading, a village with no moon count or names" });
  const chosen = moon && selectedKey ? moon.days.find((d) => d.day.key === selectedKey) ?? null : null;
  const segBtn = (on: boolean) =>
    `jw-btn inline-flex min-h-11 items-center justify-center px-3 py-1.5 text-sm rounded-lg transition-colors ${on ? "bg-notice text-background font-semibold" : "text-foreground hover:bg-muted"}`;

  return (
    <Layout>
      <div className={WORLD}>
      <section className="pt-8 pb-4 sm:pt-10">
        <div className={`container ${tab === "moon" ? "max-w-6xl" : "max-w-4xl"}`}>
          <p className={EYEBROW}>{t({ message: "Calendar", context: "calendar page eyebrow" })}</p>
          <h1 className={`${H1} mt-2`}>{t({ message: "Village calendar", context: "calendar page title" })}</h1>
          {/* R47: the Trail line leads, the tooltip defines the moons, and
              the two clocks line is the Lore, last and quiet. */}
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {t({ message: "Pick a day to see what is on. The village keeps two clocks: the twelve months everyone shares, and the moons the land turns by.", context: "calendar page lede" })}{" "}
            <InfoTip tip="The moons are the lunar months the land turns by. The wheel and the grid show them beside the civil calendar, and the village's cycles close when the moon does." label={t({ message: "About the moons", context: "calendar page: tip about moons" })} />
          </p>
          {lunar && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-foreground bg-card border border-border rounded-full px-3 py-1.5">
              <MoonGlyph phase={lunar.phase} size={16} hemisphere={hemisphere} title={lunar.phaseName} />
              <span>
                {(() => {
                  // The village's own count and the moon's name, with whichever
                  // of the two this village has. A village that has not set a
                  // first moon reads the name alone, and never a Moon 0.
                  const lunarDay = lunar.day;
                  const moonLength = lunar.length;
                  const said = [moonCountLabel(lunar.cycleNumber, moonOneCycle), lunar.name].filter(Boolean).join(", ");
                  return said
                    ? t({ message: `Today is day ${lunarDay} of ${moonLength} in ${said}`, context: "calendar page: today's place in the moon, with the moon's name" })
                    : t({ message: `Today is day ${lunarDay} of ${moonLength}`, context: "calendar page: today's place in the moon" });
                })()}
                {lunar.name && lunar.isExampleName ? ` ${t({ message: "(example name)", context: "calendar page: the moon's name is an example" })}` : ""}
              </span>
            </p>
          )}
          {payload && <p className="mt-2 text-xs text-muted-foreground">{zoneNote(timezone)}</p>}
          {/* The season page is what this calendar sits inside, and it is
              ungated core content, so this link is safe on every fork. It is
              also the second door onto /seasonal-festivals, which lived behind
              one menu entry. */}
          <p className="mt-2 text-xs text-muted-foreground">
            The turnings that shape this year are on the{" "}
            <Link href="/seasonal-festivals" className="text-notice font-medium underline underline-offset-2 hover:text-foreground">
              Seasonal Festivals
            </Link>{" "}
            page.
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className={`container ${tab === "moon" ? "max-w-6xl" : "max-w-4xl"}`}>
          {notice && (
            <p role="status" className="mb-4 text-sm text-open bg-card border border-open/40 rounded-lg px-3 py-2">{notice}</p>
          )}
          {problem && (
            <p role="alert" className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/40 rounded-lg px-3 py-2">{problem}</p>
          )}
          {/* The host nudge's link opens the composer here (recapComposerPath). */}
          {authToken() && recapLink && <HostRecapPanel eventId={recapLink.eventId} occurrenceKey={recapLink.occurrenceKey} startOpen withTitle />}

          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <div role="tablist" aria-label={t({ message: "Calendar views", context: "calendar view tabs" })} className="inline-flex flex-wrap rounded-xl border border-border bg-card p-0.5">
              {TAB_IDS.map((id) => (
                <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => pickTab(id)} className={segBtn(tab === id)}>
                  {tabLabel(id)}
                </button>
              ))}
            </div>
            {tab === "month" && (
              <div role="radiogroup" aria-label="Grid by months or by moons" className="inline-flex rounded-xl border border-border bg-card p-0.5">
                {(["months", "moons"] as GridMode[]).map((m) => (
                  <button key={m} role="radio" type="button" aria-checked={mode === m} onClick={() => pickMode(m)} className={segBtn(mode === m)}>
                    {m === "months" ? "Months" : "Moons"}
                  </button>
                ))}
              </div>
            )}
            {tab !== "list" && (
              <div className="inline-flex items-center gap-1">
                <button type="button" onClick={() => step(-1)} aria-label={tab === "moon" ? t({ message: "The moon before", context: "calendar: step back one moon" }) : "Earlier"} className="jw-btn inline-flex size-11 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={goToday} className="jw-btn min-h-11 px-3 py-1.5 text-sm rounded-lg border border-border bg-card hover:bg-muted">{t({ message: "Today", context: "calendar: go to today" })}</button>
                <button type="button" onClick={() => step(1)} aria-label={tab === "moon" ? t({ message: "The moon after", context: "calendar: step on one moon" }) : "Later"} className="jw-btn inline-flex size-11 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {payload === null && <p className="text-center text-muted-foreground py-16">{t({ message: "Opening the calendar", context: "calendar loading" })}</p>}

          {payload && cursor && tab === "moon" && moon && (
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-8" data-testid="moon-view">
              <div className="min-w-0">
                <p className={EYEBROW}>{t({ message: "This moon", context: "calendar moon view eyebrow" })}</p>
                <h2 className="mt-1 font-display text-3xl leading-tight text-foreground sm:text-4xl">{moonTitle}</h2>
                <p className={`${HINT} mt-1`}>
                  {(() => {
                    const firstDay = dayName(moon.days[0].day);
                    const lastDay = dayName(moon.days[moon.days.length - 1].day);
                    return t({ message: `${firstDay} to ${lastDay}. The new moon is at the centre, and each day is a seed further out.`, context: "calendar moon view: the moon's window" });
                  })()}
                </p>
                <p className="mt-1 hidden text-sm text-muted-foreground lg:block">
                  {t({ message: "The arrow keys walk the days. Home and End go to the first and last day of the moon.", context: "calendar moon view: keyboard hint, desktop" })}
                </p>
                <div className="-mx-4 mt-4 border-y border-border/60 bg-card/40 sm:mx-0 sm:rounded-2xl sm:border lg:p-2">
                  <MoonSpiral
                    moon={moon}
                    selectedKey={selectedKey}
                    onSelect={selectDay}
                    timezone={timezone}
                    hemisphere={hemisphere}
                    dayName={dayName}
                    shortDate={shortDate}
                  />
                  <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 pb-3 text-xs text-muted-foreground" aria-label={t({ message: "What the marks mean", context: "calendar moon view legend" })}>
                    <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-notice" />{t({ message: "today", context: "calendar legend" })}</li>
                    <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full border-2 border-notice" />{t({ message: "a gathering", context: "calendar legend" })}</li>
                    <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-1.5 rounded-full bg-notice" />{t({ message: "something else on", context: "calendar legend" })}</li>
                    <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full bg-open/60" />{t({ message: "days walked", context: "calendar legend" })}</li>
                  </ul>
                </div>
                <DayStrip
                  className="lg:hidden"
                  days={moon.days}
                  selectedKey={selectedKey}
                  onSelect={selectDay}
                  weekdayShort={weekdayShort}
                  dayName={dayName}
                />
              </div>
              <div className="mt-2 space-y-4 lg:sticky lg:top-24 lg:mt-0">
                {selectedDay && (
                  <section className={CARD_FEATURED} aria-labelledby="moon-day-h" data-testid="moon-day">
                    <p className={EYEBROW}>
                      {[
                        chosen?.today ? t({ message: "Today", context: "calendar day panel eyebrow" }) : "",
                        dayName(selectedDay),
                        selectedLunar ? (() => {
                          const lunarDay = selectedLunar.day;
                          const moonLength = selectedLunar.length;
                          return t({ message: `day ${lunarDay} of ${moonLength}`, context: "calendar day panel: place in the moon" });
                        })() : "",
                      ].filter(Boolean).join(" · ")}
                    </p>
                    <h3 id="moon-day-h" className={`${H2} mt-1 font-normal`}>{t({ message: "What is on this day", context: "calendar day panel heading" })}</h3>
                    {skyToday.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {skyToday.map((s) => `${s.title} at ${villageClock(new Date(s.startsAt), timezone)}`).join(", ")}
                      </p>
                    )}
                    {dayItems.length === 0 && <p className={`${HINT} mt-3`}>{t({ message: "Nothing is on this day yet.", context: "calendar day panel: empty day" })}</p>}
                    <ul className="space-y-3 mt-3">{dayItems.map((g) => itemCard(g, false, "muted"))}</ul>
                  </section>
                )}
                <MoonTurnings moon={moon} dayFor={dayFor} onSelect={selectDay} dayName={dayName} />
              </div>
            </div>
          )}

          {payload && cursor && tab === "wheel" && (
            <div>
              <YearWheel
                year={cursor.year}
                timezone={timezone}
                anchor={anchor}
                hemisphere={hemisphere}
                monthNames={monthNames}
                moonOneCycle={moonOneCycle}
                items={span}
                onPickMonth={(y, m) => { const d = civilDayFor(y, m, 1, timezone); setCursor(d); setSelectedKey(d.key); pickMode("months"); pickTab("month"); }}
                onPickMoon={(startsAt) => {
                  const c = civilDate(startsAt, timezone);
                  const d = civilDayFor(c.year, c.month, c.day, timezone);
                  setCursor(d); setSelectedKey(d.key); pickMode("moons"); pickTab("month");
                }}
              />
              <p className="text-center text-xs text-muted-foreground mt-2">
                Tap a month on the outer ring or a moon on the inner ring to open it.
              </p>
              <MoonRoll year={cursor.year} anchor={anchor} timezone={timezone} monthNames={monthNames} moonOneCycle={moonOneCycle} onPick={(d) => { setCursor(d); setSelectedKey(d.key); pickMode("moons"); pickTab("month"); }} />
            </div>
          )}

          {payload && cursor && tab === "month" && (
            <MonthView mode={mode} cursor={cursor} today={today} selectedKey={selectedKey} timezone={timezone}
              anchor={anchor} hemisphere={hemisphere} monthNames={monthNames} moonOneCycle={moonOneCycle} items={span} onSelectDay={selectDay} />
          )}

          {payload && cursor && tab === "week" && (
            <WeekView cursor={cursor} today={today} selectedKey={selectedKey} timezone={timezone}
              anchor={anchor} hemisphere={hemisphere} monthNames={monthNames} moonOneCycle={moonOneCycle} items={span} onSelectDay={selectDay} />
          )}

          {payload && (tab === "month" || tab === "week") && selectedDay && (
            <div className="mt-5">
              <h2 className="font-display text-xl text-foreground flex items-center gap-2 flex-wrap">
                <span>{villageDateLine({ startsAt: selectedDay.noon.toISOString(), endsAt: null, allDay: true }, timezone)}</span>
                {selectedLunar && selectedMoonName && (
                  <span className="text-sm font-normal text-muted-foreground inline-flex items-center gap-1.5">
                    <MoonGlyph phase={selectedLunar.phase} size={14} hemisphere={hemisphere} />
                    {moonHeading(selectedMoonName)}, day {selectedLunar.day} of {selectedLunar.length}
                  </span>
                )}
              </h2>
              {skyToday.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {skyToday.map((s) => `${s.title} at ${villageClock(new Date(s.startsAt), timezone)}`).join(", ")}
                </p>
              )}
              {dayItems.length === 0 && <p className="text-sm text-muted-foreground mt-3">Nothing on this day.</p>}
              <ul className="space-y-3 mt-3">{dayItems.map((g) => itemCard(g, false))}</ul>
            </div>
          )}

          {payload && tab === "list" && (
            <div>
              {listItems.length === 0 && (
                <p className="text-center text-muted-foreground py-16">Nothing is on the calendar yet.</p>
              )}
              <ul className="space-y-4">{listItems.map((g) => itemCard(g, true))}</ul>
            </div>
          )}

          {payload && <CalendarFeedCard signedIn={Boolean(authToken())} />}
        </div>
      </section>
      </div>
    </Layout>
  );
}

/** The moons of the year as a list under the wheel: the village's count, the name and the dates. */
function MoonRoll({ year, anchor, timezone, monthNames, moonOneCycle, onPick }: { year: number; anchor: YearAnchor; timezone: string; monthNames: EventsPayload["monthNames"]; moonOneCycle: number | null; onPick: (d: CivilDay) => void }) {
  const rows: Array<{ key: string; index: number; cycleNumber: number; startsAt: Date; endsAt: Date }> = [];
  // Every moon that begins in this Gregorian year, from whichever lunar year it belongs to.
  for (const anchorYear of [year - 2, year - 1, year]) {
    const ly = lunarYearOf(anchorYear, anchor);
    if (!ly) continue;
    for (const m of ly.months) {
      if (civilDate(m.startsAt, timezone).year !== year) continue;
      rows.push({ key: `${anchorYear}-${m.index}`, index: m.index, cycleNumber: m.cycleNumber, startsAt: m.startsAt, endsAt: m.endsAt });
    }
  }
  rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!rows.length) return null;
  const fmt = (d: Date) => { const c = civilDate(d, timezone); return `${c.day} ${MONTHS[c.month - 1].slice(0, 3)}`; };
  return (
    <ul className="mt-5 grid sm:grid-cols-2 gap-1.5 text-sm">
      {rows.map((r) => {
        const label = moonLabel(r.index, r.cycleNumber, moonOneCycle, monthNames);
        return (
          <li key={r.key}>
            <button type="button" onClick={() => { const c = civilDate(r.startsAt, timezone); onPick(civilDayFor(c.year, c.month, c.day, timezone)); }}
              className="w-full text-left flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1.5 hover:bg-muted">
              <span className="min-w-0 truncate">
                {/* THE VILLAGE'S COUNT, and no "of twelve" behind it: the count
                    since founding does not reset, so the size of the lunar year
                    says nothing about where this moon sits. A village that is
                    not counting yet reads the name and the dates. */}
                {label.title && <span className="font-semibold">{label.title}</span>}
                {label.name && <span className="text-muted-foreground">{label.title ? ", " : ""}{label.name}</span>}
                {label.isExample && <span className="ml-1 text-xs uppercase tracking-widest text-notice">example</span>}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{fmt(r.startsAt)} to {fmt(new Date(r.endsAt.getTime() - 60_000))}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
