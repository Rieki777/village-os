/**
 * THIS SEASON, on /sessions (shared/sessionPulse.ts): how a circle has been
 * doing this season, in counts its sessions already wrote down. For somebody
 * who may keep at least one circle (its members by standing, and admins), one
 * circle at a time, their own first.
 *
 * One sentence ("The Garden circle met 5 times this spring: 12 decisions by
 * consent, 9 of 14 actions done.") and the numbers under it: times met,
 * people who came, decided by consent, tensions named, where the actions
 * stand, and how the room arrived. A pulse that did not load can be tried
 * again, and the chosen circle follows the circles the viewer may keep.
 */
import { useEffect, useState } from "react";
import { PULSE_COPY, circlePulseUrl, type CirclePulse as Pulse } from "@shared/sessionPulse";
import { gameFetch } from "@/lib/gameApi";
import { BTN_QUIET, HINT, INPUT, LABEL, PANEL } from "./roomUi";

async function readPulse(circleId: string): Promise<{ ok: true; pulse: Pulse } | { ok: false; error: string }> {
  try {
    const res = await gameFetch(circlePulseUrl(circleId), { method: "GET" });
    const out = (await res.json().catch(() => null)) as (Pulse & { error?: unknown }) | null;
    // An answer without the counts (an older server, a proxy's page) says it didn't load, and never takes the page down.
    if (res.ok && out && typeof out.sessions === "number" && out.actions) return { ok: true, pulse: out };
    const text = typeof out?.error === "string" ? out.error.trim() : "";
    return { ok: false, error: /\s/.test(text) ? text : PULSE_COPY.loadFailed };
  } catch {
    return { ok: false, error: PULSE_COPY.loadFailed };
  }
}

export default function CirclePulse({
  circles,
  keepCircleIds,
  myCircleIds,
  lede,
}: {
  circles: { id: string; name: string }[];
  keepCircleIds: string[];
  myCircleIds: string[];
  /** The words under the heading, for a page that shows one circle (its card); /sessions keeps its own. */
  lede?: string;
}) {
  const keepable = circles
    .filter((c) => keepCircleIds.includes(c.id))
    .sort((a, b) => Number(myCircleIds.includes(b.id)) - Number(myCircleIds.includes(a.id)));
  const keepableIds = keepable.map((c) => c.id).join(" ");
  const [circleId, setCircleId] = useState(keepable[0]?.id ?? "");
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ids = keepableIds ? keepableIds.split(" ") : [];
    if (!ids.includes(circleId)) setCircleId(ids[0] ?? "");
  }, [keepableIds, circleId]);

  useEffect(() => {
    if (!circleId) return;
    let live = true;
    setPulse(null);
    setError(null);
    void readPulse(circleId).then((out) => {
      if (!live) return;
      if (out.ok) setPulse(out.pulse);
      else setError(out.error);
    });
    return () => {
      live = false;
    };
  }, [circleId, tries]);

  if (!keepable.length) return null;
  const circleName = keepable.find((c) => c.id === circleId)?.name ?? "";
  const N = PULSE_COPY.numbers;
  const numbers: [string, string][] = pulse
    ? [
        [N.sessions, String(pulse.sessions)],
        [N.people, String(pulse.people)],
        [N.decisions, String(pulse.decisions)],
        [N.tensions, String(pulse.tensions)],
        [N.actionsDone, String(pulse.actions.done)],
        [N.actionsOpen, String(pulse.actions.open)],
        [N.actionsLetGo, String(pulse.actions.letGo)],
        [N.arrival, pulse.arrival == null ? PULSE_COPY.noArrival : PULSE_COPY.arrivalOf(pulse.arrival)],
      ]
    : [];

  return (
    <section aria-labelledby="sessions-pulse-heading">
      <h2 id="sessions-pulse-heading" className="font-display text-2xl text-foreground">
        {PULSE_COPY.sectionTitle}
      </h2>
      <p className={`${HINT} mt-1 max-w-2xl`}>{lede ?? PULSE_COPY.lede}</p>
      <div className={`mt-4 ${PANEL}`}>
        {keepable.length > 1 && (
          <div className="mb-4 max-w-sm">
            <label htmlFor="pulse-circle" className={LABEL}>
              {PULSE_COPY.circleLabel}
            </label>
            <select id="pulse-circle" className={`mt-1 ${INPUT}`} value={circleId} onChange={(e) => setCircleId(e.target.value)}>
              {keepable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
            <button type="button" className={BTN_QUIET} onClick={() => setTries((n) => n + 1)}>
              {PULSE_COPY.retry}
            </button>
          </div>
        )}
        {!pulse && !error && <p className={HINT}>{PULSE_COPY.loading}</p>}
        {pulse && (
          <>
            <p className="font-semibold text-foreground">{PULSE_COPY.line(circleName, pulse)}</p>
            {pulse.sessions > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {numbers.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border bg-card px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-display text-xl text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </div>
    </section>
  );
}
