/**
 * The month grid with two stacked headers of equal height (0085): the
 * Gregorian month over the lunar month, or, with the Months|Moons switch
 * flipped, the lunar month laid out by lunar day (new moon at day 1) over
 * the Gregorian dates it spans. Every cell carries the other system's day
 * and a phase glyph, so neither calendar is ever the footnote.
 */
import type { CalendarItem } from "@shared/gatherings";
import type { YearAnchor } from "@shared/lunar";
import { LayerChips, layerPillLabel, useLayerFilter } from "./LayerChips";
import MoonGlyph from "./MoonGlyph";
import PrintButton from "./PrintButton";
import {
  gregorianWeeks,
  itemsByDay,
  kindColour,
  lunarDayInfo,
  lunarWeeks,
  moonDayLine,
  moonHeading,
  moonLabel,
  zoneNote,
  type CivilDay,
  type EventsPayload,
} from "./calendarTime";

export type GridMode = "months" | "moons";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface MonthViewProps {
  mode: GridMode;
  /** The day the view is centred on; the grid shows its month or its moon. */
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

/** Two stacked headers, same height, so both calendars carry equal weight. */
export function StackedHeaders({ top, bottom, pill }: { top: string; bottom: string; pill?: string | null }) {
  return (
    <div className="grid grid-rows-2 rounded-xl border border-border overflow-hidden mb-3" role="group" aria-label="Month and moon">
      <div className="min-h-[44px] flex items-center justify-center px-3 bg-teal-deep text-white font-display text-lg font-semibold text-center">
        {top}
      </div>
      <div className="min-h-[44px] flex items-center justify-center gap-2 px-3 bg-card text-foreground font-display text-lg font-semibold text-center">
        <span>{bottom}</span>
        {pill && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
            {pill}
          </span>
        )}
      </div>
    </div>
  );
}

function CellItems({ list }: { list: CalendarItem[] }) {
  const shown = list.filter((i) => i.kind !== "sky").slice(0, 3);
  const more = list.filter((i) => i.kind !== "sky").length - shown.length;
  return (
    <ul className="mt-0.5 space-y-0.5 overflow-hidden">
      {shown.map((i) => (
        <li key={`${i.id}:${i.occurrenceKey}`} className="flex items-center gap-1 min-w-0" title={`${i.title}${layerPillLabel(i.layer) ? ` (${layerPillLabel(i.layer)})` : ""}`}>
          <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ background: kindColour(i) }} aria-hidden="true" />
          <span className={`truncate text-[10px] leading-tight hidden sm:inline ${i.status === "cancelled" ? "line-through opacity-60" : ""}`}>{i.title}</span>
          {layerPillLabel(i.layer) && (
            <span className="hidden sm:inline text-[9px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 shrink-0">
              {layerPillLabel(i.layer)}
            </span>
          )}
        </li>
      ))}
      {more > 0 && <li className="text-[10px] text-muted-foreground">+{more}</li>}
    </ul>
  );
}

export default function MonthView(p: MonthViewProps) {
  // 0088: chips are a screen filter only; visibility was the server's call.
  const { filtered, present, off, toggle } = useLayerFilter(p.items);
  const byDay = itemsByDay(filtered, p.timezone);
  const cursorLunar = lunarDayInfo(p.cursor, p.anchor, p.timezone);
  const cursorLabel = cursorLunar ? moonLabel(cursorLunar.monthIndex, cursorLunar.cycleNumber, p.moonOneCycle, p.monthNames) : null;
  // The paper's own header (print.css shows it): zone and both month names.
  const printHeader = (
    <div className="print-header">
      {MONTHS[p.cursor.month - 1]} {p.cursor.year}
      {cursorLunar && cursorLabel ? `, ${moonHeading(cursorLabel)}` : ""}
      <span className="print-header-sub">{zoneNote(p.timezone)}</span>
    </div>
  );

  const cell = (day: CivilDay, primary: string, secondary: string, dim: boolean, key: string) => {
    const info = lunarDayInfo(day, p.anchor, p.timezone);
    const list = byDay.get(day.key) ?? [];
    const isToday = day.key === p.today.key;
    const selected = day.key === p.selectedKey;
    return (
      <button
        key={key}
        type="button"
        onClick={() => p.onSelectDay(day)}
        aria-pressed={selected}
        aria-label={`${day.key}, ${info ? moonDayLine(info, p.moonOneCycle) : ""}${list.length ? `, ${list.length} item${list.length === 1 ? "" : "s"}` : ""}`}
        className={`flex flex-col justify-start text-left min-h-[56px] sm:min-h-[76px] p-1 sm:p-1.5 border-t border-l border-border transition-colors ${
          selected ? "bg-teal-deep/10 ring-2 ring-inset ring-teal-deep" : "hover:bg-muted/60"
        } ${dim ? "opacity-45" : ""}`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className={`text-sm font-semibold leading-none ${isToday ? "rounded-full bg-teal-deep text-white px-1.5 py-0.5" : "text-foreground"}`}>
            {primary}
          </span>
          {info && <MoonGlyph phase={info.phase} size={12} hemisphere={p.hemisphere} />}
        </div>
        <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          {secondary}
          {info?.newMoon && <span className="ml-1 font-medium text-foreground">new moon</span>}
        </div>
        <CellItems list={list} />
      </button>
    );
  };

  if (p.mode === "moons") {
    const lw = lunarWeeks(p.cursor, p.anchor, p.timezone);
    if (!lw) return <p className="text-sm text-muted-foreground">The lunar table does not cover this date.</p>;
    const label = moonLabel(lw.info.monthIndex, lw.info.cycleNumber, p.moonOneCycle, p.monthNames);
    const first = lw.days[0][0].day;
    const last = lw.days[lw.days.length - 1].slice(-1)[0].day;
    const span = first.month === last.month
      ? `${first.day} to ${last.day} ${MONTHS[first.month - 1]} ${first.year}`
      : `${first.day} ${MONTHS[first.month - 1]} to ${last.day} ${MONTHS[last.month - 1]} ${last.year}`;
    return (
      <div className="calendar-print">
        {printHeader}
        <StackedHeaders
          top={moonHeading(label)}
          bottom={span}
          pill={label.isExample ? "example name" : null}
        />
        <div className="flex items-start justify-between gap-2">
          <LayerChips present={present} off={off} toggle={toggle} />
          <span className="ml-auto mb-2"><PrintButton label="Print this moon" /></span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-1 text-center">Laid out by lunar day: the new moon is day 1, the full moon near day 15.</p>
        <div className="grid grid-cols-7 border-r border-b border-border rounded-lg overflow-hidden bg-card">
          {lw.days.flatMap((week) => week.map(({ day, lunarDay }) => cell(day, String(lunarDay), `${WEEKDAYS[day.weekday]} ${day.day} ${MONTHS[day.month - 1].slice(0, 3)}`, false, day.key)))}
          {/* pad the last row so the border grid stays square */}
          {Array.from({ length: (7 - (lw.days.flat().length % 7)) % 7 }, (_, i) => <div key={`pad-${i}`} className="border-t border-l border-border bg-muted/30" />)}
        </div>
      </div>
    );
  }

  const weeks = gregorianWeeks(p.cursor.year, p.cursor.month, p.timezone);
  const label = cursorLunar ? moonLabel(cursorLunar.monthIndex, cursorLunar.cycleNumber, p.moonOneCycle, p.monthNames) : null;
  return (
    <div className="calendar-print">
      {printHeader}
      <StackedHeaders
        top={`${MONTHS[p.cursor.month - 1]} ${p.cursor.year}`}
        bottom={cursorLunar && label
          ? `${moonHeading(label)}, day ${cursorLunar.day} of ${cursorLunar.length}`
          : "Outside the lunar table"}
        pill={label?.isExample ? "example name" : null}
      />
      <div className="flex items-start justify-between gap-2">
        <LayerChips present={present} off={off} toggle={toggle} />
        <span className="ml-auto mb-2"><PrintButton label="Print this month" /></span>
      </div>
      <div className="grid grid-cols-7 text-[10px] text-muted-foreground mb-1">
        {WEEKDAYS.map((w) => <div key={w} className="text-center">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 border-r border-b border-border rounded-lg overflow-hidden bg-card">
        {weeks.flatMap((week) => week.map((day) => {
          const info = lunarDayInfo(day, p.anchor, p.timezone);
          return cell(day, String(day.day), info ? moonDayLine(info, p.moonOneCycle) : "", day.month !== p.cursor.month, day.key);
        }))}
      </div>
    </div>
  );
}
