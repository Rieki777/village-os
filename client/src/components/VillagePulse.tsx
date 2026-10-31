import { useEffect, useState } from "react";
import { Activity, Heart, Sparkles, UserPlus, Sun, TrendingUp } from "lucide-react";

interface PulseEvent {
  id: string;
  type: string;
  text: string;
  at: string;
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  join: UserPlus,
  quest: Sparkles,
  gratitude: Heart,
  stage: TrendingUp,
  season: Sun,
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * How many happenings show before "Show more". The feed itself reaches as far
 * back as Village Pulse length says (Admin, Variables, `village.pulse_max_entries`):
 * the server sends that many, and this used to cut every answer at eight, so
 * the setting changed nothing a visitor could see (audit item 28).
 */
const FIRST_SCREEN = 8;

export default function VillagePulse() {
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/game/pulse")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) { setEvents(Array.isArray(d) ? d : []); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  if (!loaded || events.length === 0) return null;

  return (
    <section className="bg-white py-16 border-t border-stone-100">
      <div className="container max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-teal-deep font-semibold mb-2">
            <Activity className="w-4 h-4" /> Village Pulse
          </span>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-teal-deep">
            The village is alive
          </h2>
        </div>
        <ul className="space-y-2">
          {(all ? events : events.slice(0, FIRST_SCREEN)).map((e) => {
            const Icon = TYPE_ICON[e.type] ?? Sparkles;
            return (
              <li
                key={e.id}
                className="flex items-center gap-3 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5"
              >
                <span className="shrink-0 w-8 h-8 rounded-full bg-teal-deep/10 text-teal-deep flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </span>
                {/* min-w-0 and break-words together, and both are load-bearing.
                    A flex child defaults to min-width:auto, so it refuses to
                    shrink below its content's min-content width — and an event
                    text carrying a bare URL ("tokens.base_rpc_url is now
                    https://...") has no break opportunity, so min-content is the
                    whole URL. On a 393px phone that pushed the document to 558px
                    and gave the entire page a horizontal scroll. */}
                <span className="min-w-0 flex-1 break-words text-sm text-stone-700">{e.text}</span>
                <span className="shrink-0 text-xs text-stone-500">{timeAgo(e.at)}</span>
              </li>
            );
          })}
        </ul>
        {!all && events.length > FIRST_SCREEN && (
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="text-sm font-medium text-teal-deep underline underline-offset-2 hover:no-underline"
            >
              Show more
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
