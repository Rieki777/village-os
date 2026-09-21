/**
 * The who-is-here band (§5 item 11, L5b): a slim row above the week that
 * says who is on the land, who arrives which day, and who has moved on.
 *
 * The TIER decision is the server's: below map.viewPeople the payload holds
 * counts and nothing else, and this band renders exactly what it is handed.
 * When the stays module is off the endpoint answers 404 and the band renders
 * nothing at all, which is the module posture everywhere.
 */
import { useEffect, useState } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
import type { CivilDay } from "./calendarTime";

interface DayEntry {
  date: string;
  count: number;
  names?: string[];
}

interface Payload {
  here: { count: number; names?: string[] };
  arrivals: DayEntry[];
  departures: DayEntry[];
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export default function WhoIsHereBand({ days }: { days: CivilDay[] }) {
  const [data, setData] = useState<Payload | null>(null);
  const from = days[0]?.key;
  const to = days[days.length - 1]?.key;

  // Events is optional; loading it when off is a 404. Only mounted inside the events page today, so this is quiet insurance for a future mount. See useModuleOn.
  const eventsOn = useModuleOn("events");
  useEffect(() => {
    if (!eventsOn || !from || !to) return;
    let alive = true;
    fetch(`/api/events/who-is-here?from=${from}&to=${to}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [eventsOn, from, to]);

  if (!data) return null;
  const byDate = (list: DayEntry[]) => new Map(list.map((e) => [e.date, e]));
  const arrivals = byDate(data.arrivals ?? []);
  const departures = byDate(data.departures ?? []);
  const quiet = data.here.count === 0 && arrivals.size === 0 && departures.size === 0;
  if (quiet) return null;

  const who = (e: DayEntry | undefined, word: string) => {
    if (!e || e.count === 0) return null;
    const text = e.names?.length ? e.names.join(", ") : `${e.count}`;
    return (
      <span className="block truncate" title={e.names?.length ? `${word}: ${e.names.join(", ")}` : undefined}>
        {word} {text}
      </span>
    );
  };

  return (
    <div className="print-hide mb-2 rounded-lg border border-border bg-card px-2 py-1.5" aria-label="Who is here this week">
      <div className="text-[11px] text-muted-foreground mb-1">
        On the land now: <span className="font-medium text-foreground">{data.here.names?.length ? data.here.names.join(", ") : data.here.count}</span>
      </div>
      {(arrivals.size > 0 || departures.size > 0) && (
        <div className="grid grid-cols-7 gap-1 sm:gap-2 text-[10px] text-muted-foreground">
          {days.map((d) => (
            <div key={d.key} className="min-w-0">
              {who(arrivals.get(d.key), "in:")}
              {who(departures.get(d.key), "out:")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
