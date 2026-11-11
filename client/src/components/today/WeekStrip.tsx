/**
 * THE WEEK, on Profile Today (Phase B, the lead's decision 1, 11 Nov 2026):
 * residents and players see their path and their week. Someone newly seated
 * sees their first fourteen days instead, so a screen holds one strip of time.
 *
 * What lands on a day already exists for this member (weekDays.ts): the next
 * meeting of each circle they sit in, the gatherings the calendar shows them,
 * and the day their nearest task is due. The new and full moon are the real
 * sky. Nothing counts down and nothing nags: an empty week says so once and
 * offers the calendar.
 *
 * PHONE AND DESKTOP, each at its best.
 *   - A phone: seven day stones across, each a 44px target, and the chosen
 *     day's list under them, one thing at a time.
 *   - A desktop: the week as seven columns with each day's items written in
 *     them, so the whole week is read at once and nothing has to be opened.
 *     Hovering a day names its items; the keyboard walks the days.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { MoonPhase } from "@/components/journey/nature";
import { CARD, EYEBROW, H2, HINT, LINK, TILE } from "@/components/journey/look";
import { authToken, gameFetch } from "@/lib/gameApi";
import { quietWeek, weekDays, type WeekItem } from "./weekDays";

export interface WeekStripProps {
  meetings: Array<{ circle: string; title: string | null; at: string; href: string }> | null;
  /** The nearest due date of a task waiting on this member, a bare date or an instant. */
  taskDue: string | null;
  /** Whether the calendar is open in this village; off, no gathering is asked for. */
  eventsOn: boolean;
  /** For tests: the day to stand on. */
  now?: Date;
}

/** The gatherings the calendar shows this member for the next seven days. Null until read, [] when closed or failed. */
function useWeekGatherings(on: boolean, now: Date): WeekItem[] | null {
  const [rows, setRows] = useState<WeekItem[] | null>(null);
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
  useEffect(() => {
    if (!on || !authToken()) {
      setRows([]);
      return;
    }
    let live = true;
    gameFetch(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { events?: Array<{ title?: string; startsAt?: string; allDay?: boolean; link?: string | null; status?: string }> } | null) => {
        if (!live) return;
        const list = Array.isArray(d?.events) ? d!.events : [];
        setRows(
          list
            .filter((e) => typeof e.title === "string" && typeof e.startsAt === "string" && e.status !== "cancelled")
            .map((e) => ({ kind: "gathering" as const, title: String(e.title), at: e.allDay ? String(e.startsAt).slice(0, 10) : String(e.startsAt), href: e.link && e.link.startsWith("/") ? e.link : "/events" })),
        );
      })
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [on, from, to]);
  return rows;
}

export default function WeekStrip({ meetings, taskDue, eventsOn, now: nowProp }: WeekStripProps) {
  const { t, i18n } = useLingui();
  const [now] = useState(() => nowProp ?? new Date());
  const gatherings = useWeekGatherings(eventsOn, now);
  const [chosen, setChosen] = useState(0);
  const locale = i18n.locale || "en";

  const items: WeekItem[] = [
    ...(meetings ?? []).map((m) => ({ kind: "meeting" as const, title: m.title ? `${m.circle}: ${m.title}` : m.circle, at: m.at, href: m.href })),
    ...(gatherings ?? []),
    ...(taskDue ? [{ kind: "task" as const, title: t({ message: `A task from your sessions is due`, context: "week strip, a task due on a day" }), at: taskDue.length > 10 ? taskDue : taskDue.slice(0, 10), href: "/profile#my-tasks" }] : []),
  ];
  // Nothing read yet: draw nothing, so a week never flashes empty and then fills.
  if (gatherings === null) return null;
  const days = weekDays(now, items);
  const day = days[chosen] ?? days[0];

  const time = (it: WeekItem) => (/^\d{4}-\d{2}-\d{2}$/.test(it.at) ? "" : new Date(it.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
  const moonWord = (m: "new" | "full" | null) =>
    m === "new" ? t({ message: `New moon`, context: "week strip, the new moon on a day" }) : m === "full" ? t({ message: `Full moon`, context: "week strip, the full moon on a day" }) : "";
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = e.key === "ArrowRight" ? chosen + 1 : e.key === "ArrowLeft" ? chosen - 1 : e.key === "Home" ? 0 : e.key === "End" ? 6 : null;
    if (to === null) return;
    e.preventDefault();
    const at = Math.min(6, Math.max(0, to));
    setChosen(at);
    (e.currentTarget.querySelector(`[data-week-day="${at}"]`) as HTMLButtonElement | null)?.focus();
  };
  const row = (it: WeekItem, i: number) => (
    <li key={`${it.kind}-${i}`} data-week-item={it.kind}>
      <Link href={it.href} className="flex min-h-11 flex-col justify-center rounded-lg px-2 py-1 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
        <span className="text-sm font-medium">{it.title}</span>
        {time(it) ? <span className="text-xs text-muted-foreground">{time(it)}</span> : null}
      </Link>
    </li>
  );

  return (
    <section aria-labelledby="week-h" data-week-strip="" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className={EYEBROW}>{t({ message: `Your week`, context: "week strip, eyebrow" })}</p>
          <h2 id="week-h" className={`${H2} mt-1`}>
            {t({ message: `The next seven days`, context: "week strip, heading" })}
          </h2>
        </div>
        <MoonPhase date={now} size="sm" showName />
      </div>

      {quietWeek(days) ? (
        <p className={`${HINT} mt-3`}>
          {t({ message: `Nothing is on the calendar for you this week.`, context: "week strip, an empty week" })}{" "}
          {eventsOn ? (
            <Link href="/events" className={LINK}>
              {t({ message: `Open the calendar`, context: "week strip, the door when the week is empty" })}
            </Link>
          ) : null}
        </p>
      ) : null}

      <div
        role="group"
        aria-label={t({ message: `The seven days`, context: "week strip, the days as a group" })}
        onKeyDown={onKey}
        className="mt-5 grid grid-cols-7 gap-0.5 max-sm:-mx-3 sm:gap-2 lg:items-stretch"
      >
        {days.map((d, i) => {
          const weekday = d.date.toLocaleDateString(locale, { weekday: "short" });
          const full = d.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
          const names = d.items.map((x) => x.title).join(". ");
          return (
            <div key={d.key} className="flex min-w-0 flex-col gap-2">
              <button
                type="button"
                data-week-day={i}
                data-today={d.today ? "" : undefined}
                aria-pressed={i === chosen}
                aria-label={[full, d.today ? t({ message: `today`, context: "week strip, the day that is today" }) : "", moonWord(d.moon), names].filter(Boolean).join(", ")}
                title={names || undefined}
                tabIndex={i === chosen ? 0 : -1}
                onClick={() => setChosen(i)}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border py-1.5 text-foreground hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-16 ${
                  i === chosen ? "border-notice bg-muted" : d.today ? "border-notice/70" : "border-border"
                }`}
              >
                <span className="text-xs uppercase tracking-widest text-muted-foreground">{weekday}</span>
                <span className={`font-display text-lg leading-none ${d.today ? "text-notice" : ""}`}>{d.date.getDate()}</span>
                <span aria-hidden="true" className="flex h-2 items-center gap-0.5">
                  {d.moon ? <span className={`size-1.5 rounded-full ${d.moon === "full" ? "bg-foreground" : "border border-foreground"}`} /> : null}
                  {d.items.slice(0, 3).map((x, k) => (
                    <span key={k} className="size-1.5 rounded-full bg-open" />
                  ))}
                </span>
              </button>
              {/* A desktop reads every day at once: the items sit in their own column. */}
              <ul className="hidden min-w-0 flex-col gap-1 lg:flex">
                {d.moon ? <li className="px-2 text-xs text-muted-foreground">{moonWord(d.moon)}</li> : null}
                {d.items.map((it, k) => (
                  <li key={k} className="min-w-0">
                    <Link href={it.href} title={it.title} className="flex min-h-11 min-w-0 flex-col justify-center rounded-lg px-2 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="line-clamp-2 break-words">{it.title}</span>
                      {time(it) ? <span className="text-muted-foreground">{time(it)}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* The chosen day, under the thumb on a phone and any screen narrower than the columns. */}
      <div className={`${TILE} mt-4 lg:hidden`} aria-live="polite" data-week-chosen={chosen}>
        <p className="font-display text-lg font-bold text-card-foreground">
          {day.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
          {day.moon ? <span className="ml-2 text-sm font-normal text-muted-foreground">{moonWord(day.moon)}</span> : null}
        </p>
        {day.items.length === 0 ? (
          <p className={`${HINT} mt-1`}>{t({ message: `Nothing on this day.`, context: "week strip, an empty day" })}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">{day.items.map(row)}</ul>
        )}
      </div>
    </section>
  );
}
