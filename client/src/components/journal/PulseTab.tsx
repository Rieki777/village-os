/**
 * PULSE: the member's own weeks, and the village's averages.
 *
 * Only numbers reach the village view, as averages with a count beside them;
 * the words a member writes in a pulse stay in their own journal. A cell the
 * server holds back (fewer answers than the village's floor) says so in a
 * sentence and shows nothing else. Signals are the server's gentle readings
 * of the averages, shown as invitations to talk.
 *
 * No chart library: a sparkline is one SVG path in the current text colour.
 */
import { useEffect, useState } from "react";
import { PULSE_METRICS, fillVillage, type PulseAggregate, type PulseAggregateCell } from "@shared/journal";
import { myPulse, problemText, pulseAggregate, type OwnPulseWeek } from "@/lib/journalApi";
import BreathingLoader from "@/components/natural/BreathingLoader";
import { CARD, HINT, metricName, signed } from "./ui";

const RECENT = 12;

/** "2026-W40" as [2026, 40], so weeks sort by number and never by spelling. */
function weekOrder(id: string): number {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(id);
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

export function suppressedSentence(floor: number): string {
  return `Not enough answers yet to show this without pointing at anyone (needs ${floor}).`;
}

function people(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

function Sparkline({ values, min, max }: { values: number[]; min: number; max: number }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 4) + 2;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-teal-deep" aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function VillageCell({
  latest,
  earlier,
  centred,
  floor,
}: {
  latest: { weekId: string; cell: PulseAggregateCell } | null;
  earlier: { weekId: string; cell: PulseAggregateCell } | null;
  centred: boolean;
  floor: number;
}) {
  if (!latest) return <p className={HINT}>No answers yet.</p>;
  if (latest.cell.suppressed || latest.cell.mean === null) {
    return (
      <div>
        <p className="text-sm text-foreground">{suppressedSentence(floor)}</p>
        {earlier && earlier.cell.mean !== null && (
          <p className={`${HINT} mt-1`}>
            Week {earlier.weekId}: {signed(earlier.cell.mean, centred)}
            {earlier.cell.n !== null ? `, from ${people(earlier.cell.n)}` : ""}
          </p>
        )}
      </div>
    );
  }
  return (
    <p className="text-foreground">
      <span className="text-2xl font-bold">{signed(latest.cell.mean, centred)}</span>
      <span className="ml-2 text-sm text-muted-foreground">
        {latest.cell.n !== null ? `average from ${people(latest.cell.n)}, ` : "average, "}week {latest.weekId}
      </span>
    </p>
  );
}

export default function PulseTab({ village }: { village: string }) {
  const [mine, setMine] = useState<OwnPulseWeek[] | null>(null);
  const [agg, setAgg] = useState<PulseAggregate | null>(null);
  const [mineProblem, setMineProblem] = useState<string | null>(null);
  const [aggProblem, setAggProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    myPulse()
      .then((w) => live && setMine(w))
      .catch((err) => {
        if (!live) return;
        setMine([]);
        setMineProblem(problemText(err, "Your weeks could not be read just now."));
      });
    pulseAggregate()
      .then((a) => live && setAgg(a))
      .catch((err) => {
        if (!live) return;
        setAggProblem(problemText(err, "The village's numbers could not be read just now."));
      });
    return () => {
      live = false;
    };
  }, []);

  const ownWeeks = [...(mine ?? [])].sort((a, b) => weekOrder(a.weekId) - weekOrder(b.weekId)).slice(-RECENT);
  const villageWeeks = [...(agg?.weeks ?? [])].sort((a, b) => weekOrder(b.weekId) - weekOrder(a.weekId));

  const villageFor = (key: string) => {
    let latest: { weekId: string; cell: PulseAggregateCell } | null = null;
    let earlier: { weekId: string; cell: PulseAggregateCell } | null = null;
    for (const w of villageWeeks) {
      const cell = w.cells.find((c) => c.metric === key);
      if (!cell) continue;
      if (!latest) {
        latest = { weekId: w.weekId, cell };
        if (!cell.suppressed && cell.mean !== null) break;
        continue;
      }
      if (!cell.suppressed && cell.mean !== null) {
        earlier = { weekId: w.weekId, cell };
        break;
      }
    }
    return { latest, earlier };
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="pulse-mine">
        <h2 id="pulse-mine" className="font-display text-xl font-bold text-foreground">
          Your weeks
        </h2>
        <p className={`${HINT} mt-1`}>Your own numbers from each weekly pulse, oldest on the left.</p>
        {mine === null ? (
          <div className="flex justify-center py-6">
            <BreathingLoader label="Reading your weeks" />
          </div>
        ) : mineProblem ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {mineProblem}
          </p>
        ) : ownWeeks.length === 0 ? (
          <p className={`${HINT} mt-3`}>No pulse yet. The weekly pulse on Today takes about two minutes.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {PULSE_METRICS.map((m) => {
              const values = ownWeeks.map((w) => w.scores[m.key]).filter((v): v is number => typeof v === "number");
              const last = values[values.length - 1];
              return (
                <li key={m.key} className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{metricName(m.key)}</p>
                    <p className="text-xs text-muted-foreground">{fillVillage(m.prompt, village)}</p>
                    <p className="mt-1 text-sm text-foreground">
                      {values.length ? values.map((v) => signed(v, m.min < 0)).join("  ") : "Not answered yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Sparkline values={values} min={m.min} max={m.max} />
                    {typeof last === "number" && (
                      <span className="text-2xl font-bold text-foreground">
                        <span className="sr-only">Latest: </span>
                        {signed(last, m.min < 0)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pulse-village">
        <h2 id="pulse-village" className="font-display text-xl font-bold text-foreground">
          The village
        </h2>
        <p className={`${HINT} mt-1`}>
          Averages of everyone who answered each week. The words you write in a pulse stay in your own journal.
        </p>
        {aggProblem ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {aggProblem}
          </p>
        ) : agg === null ? (
          <div className="flex justify-center py-6">
            <BreathingLoader label="Reading the village's numbers" />
          </div>
        ) : (
          <>
            {agg.signals.length > 0 && (
              <ul className="mt-3 space-y-2">
                {agg.signals.map((s) => (
                  <li key={s.key} className="rounded-xl border border-amber/60 bg-amber-light px-4 py-3 text-sm text-foreground">
                    {s.text}
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {PULSE_METRICS.map((m) => {
                const { latest, earlier } = villageFor(m.key);
                return (
                  <li key={m.key} className={CARD}>
                    <p className="font-semibold text-foreground">{metricName(m.key)}</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {m.ends[0]} to {m.ends[1]}
                    </p>
                    <VillageCell latest={latest} earlier={earlier} centred={m.min < 0} floor={agg.floor} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
