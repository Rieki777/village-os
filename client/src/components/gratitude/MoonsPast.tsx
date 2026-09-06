/**
 * MOONS PAST: what every closed lunation settled to.
 *
 * `/api/game/cycle/distributions` has been a public endpoint this whole time
 * and nothing rendered it. It is the largest piece of finished drama in this
 * module: closed cycles only, each with who was named, how much reached them,
 * how many distinct people named them, and what the value pool credited. The
 * wall was a list of quotes; with this under it, it is a chronicle.
 *
 * ── IT SHOWS WHAT HAPPENED, NEVER WHAT MIGHT ─────────────────────────────
 *
 * Only `status === "closed"` cycles reach this payload, which is the property
 * that makes it safe to render. Settlement releases real value and is a human
 * act, never a job, so an OPEN moon has no answer yet and this says nothing
 * about one. There is no projection here and there is deliberately no "you are
 * on track for": the pool splits pro-rata and every send anybody makes moves
 * it, so a forecast would be wrong nearly every time it was read.
 *
 * ── THE SPLIT IS KEPT, BECAUSE THE SERVER KEEPS IT ───────────────────────
 *
 * `receivedHearts` and `receivedAcks` are separate fields on purpose: S27 says
 * a tap and a written appreciation are different signals and the report the
 * founders carry to Hypha must never blend them. So this does not add them
 * together either. It shows the total the way the server does and names the
 * written half, which is the half this page is about.
 *
 * ── A CLOSED MOON THAT PAID NOTHING IS STILL A MOON ──────────────────────
 *
 * `credited` is absent or zero on cycles closed before the pool existed and on
 * villages running with the pool off. That is not a gap to hide: the moon
 * happened, people thanked each other, and no value was released. It renders
 * the recognition and simply says nothing about a payout, rather than printing
 * a zero that reads as a failure.
 */
import { useEffect, useState } from "react";

import { moonCountLabel } from "@shared/villageMoon";

interface Total {
  name: string;
  received: number;
  receivedHearts?: number;
  receivedAcks?: number;
  distinctSenders: number;
  credited?: number;
  poolToken?: string | null;
}

interface ClosedCycle {
  id: string;
  cycleNumber: number;
  startsAt?: string;
  endsAt?: string;
  totals?: Total[];
}

/** How many moons are drawn before the section stops. A chronicle is read from
 *  the near end; a village three years in does not want thirty-six blocks. */
const MOONS_SHOWN = 6;

export default function MoonsPast({ currency }: { currency: string }) {
  const [cycles, setCycles] = useState<ClosedCycle[] | null>(null);
  const [moonOne, setMoonOne] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/game/cycle/distributions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && Array.isArray(d)) setCycles(d as ClosedCycle[]); })
      .catch(() => { /* the section stays away */ });
    // The village's own moon count, so a moon is named the way the rest of the
    // build names it rather than by its raw lunation number.
    fetch("/api/events")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.moonOneCycle === "number") setMoonOne(d.moonOneCycle); })
      .catch(() => { /* an unanchored village gets the plain label */ });
    return () => { alive = false; };
  }, []);

  // Null means the read has not landed or failed. An empty ARRAY means the
  // village has never closed a moon, which is true of every new village and is
  // not something to apologise for on this page.
  if (!cycles || cycles.length === 0) return null;

  return (
    <section aria-labelledby="moons-h" className="mt-12">
      <h2 id="moons-h" className="font-display text-2xl font-bold text-foreground">
        Moons past
      </h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Every moon this village has closed, and what it settled to. A moon is closed by a
        person, never by a clock, so a moon appears here once somebody has closed it.
      </p>

      <div className="mt-6 space-y-4">
        {cycles.slice(0, MOONS_SHOWN).map((c) => {
          const totals = (c.totals ?? []).slice().sort((a, b) => b.received - a.received);
          const label = moonCountLabel(c.cycleNumber, moonOne) || `Moon ${c.cycleNumber}`;
          const pool = totals.find((t) => (t.credited ?? 0) > 0);
          return (
            <article key={c.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="font-display text-lg text-card-foreground">{label}</h3>
                <p className="text-xs text-muted-foreground">
                  {totals.length} {totals.length === 1 ? "person was named" : "people were named"}
                </p>
              </div>

              {totals.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nobody was named this moon.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {totals.map((t) => (
                    <li key={t.name} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-semibold text-notice">{t.name}</span>
                      <span className="text-muted-foreground">
                        {t.received} {currency.toLowerCase()}
                      </span>
                      <span className="text-muted-foreground">
                        from {t.distinctSenders}{" "}
                        {t.distinctSenders === 1 ? "person" : "people"}
                      </span>
                      {(t.credited ?? 0) > 0 && (
                        <span className="text-open">
                          {t.credited} {t.poolToken ?? ""} released
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Said once per moon rather than once per line, and only where
                  a pool actually paid. A village with the pool off reads a
                  chronicle of recognition and is told nothing about value. */}
              {pool && (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  The value pool settled this moon, split by the recognition each person
                  received from members whose sends counted.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
