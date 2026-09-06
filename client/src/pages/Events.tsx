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
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin, Users, Video } from "lucide-react";
import type { CalendarItem, RsvpStatus } from "@shared/gatherings";
import { civilDate, lunarYearOf, type YearAnchor } from "@shared/lunar";
import { moonCountLabel } from "@shared/villageMoon";
import InfoTip from "@/components/InfoTip";
import YearWheel from "@/components/calendar/YearWheel";
import MonthView, { type GridMode } from "@/components/calendar/MonthView";
import WeekView from "@/components/calendar/WeekView";
import MoonGlyph from "@/components/calendar/MoonGlyph";
import CalendarFeedCard from "@/components/calendar/CalendarFeedCard";
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

type Tab = "wheel" | "month" | "week" | "list";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "wheel", label: "Year" },
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "list", label: "List" },
];
const MODE_KEY = "calendar.gridMode";
const TAB_KEY = "calendar.tab";

const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = window.localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch { return fallback; }
};
const remember = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private mode */ } };

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
  const modules = useModules();
  const eventsModule = useModule("events");
  const [payload, setPayload] = useState<EventsPayload | null>(null);
  const [span, setSpan] = useState<CalendarItem[]>([]);
  const [spanYear, setSpanYear] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(() => remembered(TAB_KEY, TABS.map((t) => t.id), "month"));
  const [mode, setMode] = useState<GridMode>(() => remembered(MODE_KEY, ["months", "moons"] as const, "months"));
  const [cursor, setCursor] = useState<CivilDay | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** 0092: what a seat fee just did. Value moving deserves its own line. */
  const [notice, setNotice] = useState<string | null>(null);

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
      if (!res.ok) setProblem(body?.error ?? "That did not work");
      else {
        // 0092: say what moved. A seat fee taken with no word about it is the
        // one thing a member would find out later, in their ledger.
        if (body?.charged > 0) setNotice(`${body.charged} ${body.tokenName} held for your place.`);
        reload();
      }
    } catch { setProblem("That did not work"); }
    setBusy(null);
  };

  const pickTab = (t: Tab) => { setTab(t); remember(TAB_KEY, t); };
  const pickMode = (m: GridMode) => { setMode(m); remember(MODE_KEY, m); };

  const step = (dir: -1 | 1) => {
    if (!cursor) return;
    if (tab === "week") { const n = addDays(cursor, 7 * dir, timezone); setCursor(n); setSelectedKey(n.key); return; }
    if (tab === "wheel") { setCursor(civilDayFor(cursor.year + dir, 1, 1, timezone)); return; }
    if (mode === "moons") {
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
          <span className="text-xs font-medium text-teal-deep bg-teal-deep/10 rounded-lg px-2 py-1">
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
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 ${
                mine ? "bg-teal-deep text-white border-teal-deep" : "bg-background text-foreground border-border hover:bg-muted"
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

  const itemCard = (g: CalendarItem, showWhen: boolean) => {
    const second = localSecondLine(g, timezone);
    const key = `${g.id}:${g.occurrenceKey}`;
    return (
      <li key={key} className="border border-border rounded-xl p-4 sm:p-5 bg-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-lg text-foreground flex items-center gap-2 flex-wrap">
              <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: kindColour(g) }} aria-hidden="true" />
              <span className={g.status === "cancelled" ? "line-through opacity-70" : ""}>{g.title}</span>
              {g.kind !== "gathering" && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
                  {kindLabel(g.kind)}
                </span>
              )}
              {g.status === "cancelled" && (
                <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-0.5">Cancelled</span>
              )}
              {g.status === "postponed" && (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">Postponed</span>
              )}
              {g.isExample && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">example</span>
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
              {g.spotsLeft === 0 && <p className="text-xs text-amber-700 mt-0.5">Full</p>}
            </div>
          )}
        </div>
        {g.description && <p className="text-sm text-muted-foreground mt-3 whitespace-pre-line">{g.description}</p>}
        {rsvpButtons(g)}
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

  return (
    <Layout>
      <section className="py-10 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Village Calendar</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            The village keeps two clocks: the twelve months everyone shares,
            and the{" "}
            <InfoTip tip="The moons are the lunar months the land turns by. The wheel and the grid show them beside the civil calendar, and the village's cycles close when the moon does.">moons</InfoTip>{" "}
            the land turns by. Everything dated lives here, side by side.
          </p>
          {lunar && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-foreground bg-card border border-border rounded-full px-3 py-1.5">
              <MoonGlyph phase={lunar.phase} size={16} hemisphere={hemisphere} title={lunar.phaseName} />
              <span>
                Today is day {lunar.day} of {lunar.length}
                {(() => {
                  // The village's own count and the moon's name, with whichever
                  // of the two this village has. A village that has not set a
                  // first moon reads the name alone, and never a Moon 0.
                  const said = [moonCountLabel(lunar.cycleNumber, moonOneCycle), lunar.name].filter(Boolean).join(", ");
                  return said ? ` in ${said}` : "";
                })()}
                {lunar.name && lunar.isExampleName ? " (example name)" : ""}
              </span>
            </p>
          )}
          {payload && <p className="mt-2 text-xs text-muted-foreground">{zoneNote(timezone)}</p>}
          {/* The season page is what this calendar sits inside, and it is
              ungated core content, so this link is safe on every fork. It is
              also the second door onto /seasonal-festivals, which lived behind
              one menu entry. */}
          <p className="mt-3 text-xs text-muted-foreground">
            The turnings that shape this year are on the{" "}
            <Link href="/seasonal-festivals" className="text-teal-deep font-medium hover:underline">
              Seasonal Festivals
            </Link>{" "}
            page.
          </p>
        </div>
      </section>

      <section className="py-6 bg-background">
        <div className="container max-w-4xl">
          {notice && (
            <p role="status" className="mb-4 text-sm text-teal-deep bg-teal-deep/10 border border-teal-deep/20 rounded-lg px-3 py-2">{notice}</p>
          )}
          {problem && (
            <p role="alert" className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{problem}</p>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <div role="tablist" aria-label="Calendar views" className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {TABS.map((t) => (
                <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => pickTab(t.id)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === t.id ? "bg-teal-deep text-white" : "text-foreground hover:bg-muted"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "month" && (
              <div role="radiogroup" aria-label="Grid by months or by moons" className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {(["months", "moons"] as GridMode[]).map((m) => (
                  <button key={m} role="radio" type="button" aria-checked={mode === m} onClick={() => pickMode(m)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === m ? "bg-teal-deep text-white" : "text-foreground hover:bg-muted"}`}>
                    {m === "months" ? "Months" : "Moons"}
                  </button>
                ))}
              </div>
            )}
            {tab !== "list" && (
              <div className="inline-flex items-center gap-1">
                <button type="button" onClick={() => step(-1)} aria-label="Earlier" className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={goToday} className="px-3 py-1.5 text-sm rounded-lg border border-border bg-card hover:bg-muted">Today</button>
                <button type="button" onClick={() => step(1)} aria-label="Later" className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {payload === null && <p className="text-center text-muted-foreground py-16">Loading...</p>}

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
              <h2 className="font-display text-xl font-semibold text-foreground flex items-center gap-2 flex-wrap">
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
                {label.isExample && <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-800">example</span>}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{fmt(r.startsAt)} to {fmt(new Date(r.endsAt.getTime() - 60_000))}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
