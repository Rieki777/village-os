/**
 * The week, seven columns, with the same two stacked headers as the month
 * (0085): "August 2026" over "Moon 8, Sturgeon Moon, day 12 of 30" for the
 * selected day, phase glyph and lunar day in every column, items listed
 * under each day in village time. This is where the RSVP work happens on a
 * phone, so it stays plain: tap a day to see its items in full below.
 */
import type { CalendarItem } from "@shared/gatherings";
import type { YearAnchor } from "@shared/lunar";
import { LayerChips, layerPillLabel, useLayerFilter } from "./LayerChips";
import MoonGlyph from "./MoonGlyph";
import { StackedHeaders } from "./MonthView";
import WhoIsHereBand from "./WhoIsHereBand";
import {
  itemsByDay,
  kindColour,
  lunarDayInfo,
  moonDayLine,
  moonHeading,
  moonLabel,
  villageClock,
  weekOf,
  type CivilDay,
  type EventsPayload,
} from "./calendarTime";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface WeekViewProps {
  cursor: CivilDay;
  today: CivilDay;
  selectedKey: string | null;
  timezone: string;
  anchor: YearAnchor;
  hemisphere: "north" | "south";
  monthNames: EventsPayload["monthNames"];
  /** The lunation this village calls Moon 1; null while it has none. */
  moonOneCycle: number | null;
  items: CalendarItem[];
  onSelectDay: (day: CivilDay) => void;
}

export default function WeekView(p: WeekViewProps) {
  const days = weekOf(p.cursor, p.timezone);
  // 0088: the chips hide layers on screen; the server already decided what
  // this viewer may see at all.
  const { filtered, present, off, toggle } = useLayerFilter(p.items);
  const byDay = itemsByDay(filtered, p.timezone);
  const focus = days.find((d) => d.key === p.selectedKey) ?? p.cursor;
  const info = lunarDayInfo(focus, p.anchor, p.timezone);
  const label = info ? moonLabel(info.monthIndex, info.cycleNumber, p.moonOneCycle, p.monthNames) : null;
  const first = days[0];
  const last = days[6];
  const top = first.month === last.month
    ? `${MONTHS[first.month - 1]} ${first.year}`
    : `${MONTHS[first.month - 1].slice(0, 3)} to ${MONTHS[last.month - 1].slice(0, 3)} ${last.year}`;

  return (
    <div>
      <StackedHeaders
        top={top}
        bottom={info && label ? `${moonHeading(label)}, day ${info.day} of ${info.length}` : "Outside the lunar table"}
        pill={label?.isExample ? "example name" : null}
      />
      <LayerChips present={present} off={off} toggle={toggle} />
      {/* 0088: who is on the land this week, from stays. Renders nothing
          while stays is off or the week is quiet. */}
      <WhoIsHereBand days={days} />
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {days.map((day) => {
          const li = lunarDayInfo(day, p.anchor, p.timezone);
          const list = (byDay.get(day.key) ?? []).filter((i) => i.kind !== "sky");
          const isToday = day.key === p.today.key;
          const selected = day.key === p.selectedKey;
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => p.onSelectDay(day)}
              aria-pressed={selected}
              aria-label={`${WEEKDAYS[day.weekday]} ${day.day} ${MONTHS[day.month - 1]}${li ? `, ${moonDayLine(li, p.moonOneCycle)}` : ""}, ${list.length} item${list.length === 1 ? "" : "s"}`}
              className={`flex flex-col justify-start text-left rounded-lg border p-1 sm:p-2 min-h-[120px] transition-colors ${
                selected ? "border-teal-deep bg-teal-deep/10" : "border-border bg-card hover:bg-muted/60"
              }`}
            >
              <div className="text-[10px] text-muted-foreground">{WEEKDAYS[day.weekday]}</div>
              <div className="flex items-center justify-between gap-1">
                <span className={`text-base font-semibold leading-none ${isToday ? "rounded-full bg-teal-deep text-white px-1.5 py-0.5" : ""}`}>{day.day}</span>
                {li && <MoonGlyph phase={li.phase} size={14} hemisphere={p.hemisphere} />}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {li ? moonDayLine(li, p.moonOneCycle) : ""}
                {li?.newMoon && <span className="ml-1 font-medium text-foreground">new</span>}
              </div>
              <ul className="mt-1 space-y-1">
                {list.slice(0, 4).map((i) => (
                  <li key={`${i.id}:${i.occurrenceKey}`} className="min-w-0" title={i.title}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle" style={{ background: kindColour(i) }} aria-hidden="true" />
                    <span className={`text-[10px] leading-tight ${i.status === "cancelled" ? "line-through opacity-60" : ""}`}>
                      <span className="hidden sm:inline">{i.allDay ? "" : `${villageClock(new Date(i.startsAt), p.timezone)} `}</span>
                      <span className="hidden sm:inline">{i.title}</span>
                      {layerPillLabel(i.layer) && (
                        <span className="hidden sm:inline ml-1 text-[9px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1">
                          {layerPillLabel(i.layer)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {list.length > 4 && <li className="text-[10px] text-muted-foreground">+{list.length - 4}</li>}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}
