/**
 * Village Health (S49-S51): per-lunation snapshots, the land's regeneration
 * ledger, governance reads, and the season's goals — honest above all.
 * Trends render only once enough lunations exist ("N of 3 collected");
 * before that the page shows points and says why. Absolute counts, never
 * leaderboards, never percentiles — and an objection rate falling toward
 * zero would be shown as a WARNING, not a win.
 */
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useEffect, useState } from "react";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { authToken } from "@/lib/gameApi";
/**
 * The doughnut's outer-label geometry lives outside this page so it can be
 * checked without a browser. Three of the five labels were being painted
 * outside the old `0 0 720 720` viewBox and read "ed", "He" and "0 t" on
 * screen while the DOM held the full names, so every text assertion in the
 * repository passed on them. `doughnutLayout.test.ts` puts the real metric
 * names through the same arithmetic and fails on the old viewBox.
 */
import { DOUGHNUT, DOUGHNUT_VIEWBOX, TAU, outerLabelPlacement } from "@/lib/doughnutLayout";
import { SNAPSHOT_METRICS, snapshotTileLabel } from "@shared/healthMetrics";
import { Activity, CheckCircle2, Circle, Leaf, Moon, Sprout, Users } from "lucide-react";
import { ExampleChip, ExamplesBanner } from "@/components/ExamplesBanner";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/**
 * H3: the tiles come from the SHARED registry, not a local copy. The old
 * hardcoded map meant every new metric had to be added in two places, and
 * the one that got forgotten was always the display — a metric collected
 * for months and shown to nobody. Cards still render only where a value
 * exists, so a village without the library module sees no library tile.
 */
const SNAPSHOT_LABELS: Record<string, string> = Object.fromEntries(
  SNAPSHOT_METRICS.map((m) => [m.key, m.label]),
);

/**
 * "1 seat" / "12 seats". This page is read by members, and "0 decision(s)
 * opened by 0 member(s)" is a form field talking, not a village. The count
 * is already known when the sentence is built, so there is nothing to hedge.
 */
const count = (n: number, one: string, many: string = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export default function VillageHealth() {
  const modules = useModules();
  const healthModule = useModule("health");
  const [data, setData] = useState<any>(null);
  const [season, setSeason] = useState<any>(null);

  useEffect(() => {
    if (!healthModule) return;
    fetch("/api/health/summary", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
    fetch("/api/season")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSeason)
      .catch(() => {});
  }, [healthModule?.id]);

  if (modules.loaded && !healthModule) return <ModuleGate moduleId="health" name="Village Health" />;

  const latestOf = (key: string) => {
    const points = data?.series?.[key] ?? [];
    return points.length ? points[points.length - 1] : null;
  };
  const goals: any[] = season?.current?.goals ?? [];

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Village Health</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            The village's vital signs, frozen each lunar cycle, and the land's
            own ledger of regeneration.
          </p>
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-3xl space-y-6">
          {/* The doughnut: the social foundation inside, the land's ledger
              outside, the safe and just space between. */}
          {data?.doughnut && <DoughnutCard doughnut={data.doughnut} />}

          {/* Season goals overlay */}
          {season?.current && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <p className="font-semibold text-foreground text-sm">
                  {season.current.name}
                  {season.current.theme ? <span className="text-muted-foreground font-normal">: {season.current.theme}</span> : null}
                </p>
                {/*
                  `daysLeft` is null whenever the current season has no end
                  date (server/index.ts: `current?.endsOn ? ... : null`), and
                  this line rendered it either way. Before the plural fix that
                  showed as " day(s) left" with a hole where the number goes;
                  with the fix it would have said "null days left" out loud,
                  which is a value reaching a sentence. A season with no end
                  date has no days left to state, so the line is simply not
                  there. Found by auditing this file after its gates went
                  green, not by a gate.
                */}
                {season.daysLeft != null && (
                  <span className="text-xs text-muted-foreground">{count(season.daysLeft, "day")} left</span>
                )}
              </div>
              {goals.length > 0 ? (
                <div className="space-y-1.5">
                  {goals.map((g: any, i: number) => (
                    <p key={i} className="text-sm flex items-center gap-2">
                      {g.done ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-muted-foreground/40" />}
                      <span className={g.done ? "text-muted-foreground line-through" : "text-foreground"}>{g.text ?? String(g)}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">This season has no posted goals yet.</p>
              )}
            </div>
          )}

          {/* Regen impact tiles — the land's ledger */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Leaf className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm">Regeneration ledger</p>
            </div>
            {/* The banner belongs to THIS card, not to the page hero. Health's
                only seeded content is regen entries, and they are correctly
                outside the totals, so over the hero the banner claimed the
                whole page was examples while the headline surface right under
                it said "Nothing recorded yet". Everything else here (vital
                signs, governance reads, season goals) is the village's own. */}
            <ExamplesBanner moduleId="health" noun="measurement" layout="mb-3 text-left" />
            {Object.keys(data?.regen?.totals ?? {}).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Sprout className="w-4 h-4 inline mr-1 text-teal-deep/60" />
                Nothing recorded yet. The stewards log plantings, water and
                restoration as they happen.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(data.regen.metrics ?? []).filter((m: any) => data.regen.totals[m.key]).map((m: any) => (
                  <div key={m.key} className="border border-border rounded-lg px-3 py-2.5">
                    <p className="text-xl font-bold text-teal-deep">
                      {Number(data.regen.totals[m.key].total).toLocaleString()}
                      <span className="text-xs font-normal text-muted-foreground ml-1">{data.regen.totals[m.key].unit}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                  </div>
                ))}
              </div>
            )}
            {(data?.regen?.latest ?? []).length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-muted-foreground cursor-pointer">Recent entries</summary>
                <div className="mt-2 space-y-1">
                  {data.regen.latest.map((e: any) => (
                    <p key={e.id} className="text-xs text-muted-foreground">
                      {new Date(e.recordedAt).toLocaleDateString()}: {e.value} {e.unit}{e.note ? ` · ${e.note}` : ""}
                      {/* This list is the ONE place an example entry shows: the
                          totals above exclude it on purpose, so without a
                          marker the disclosure is where the platform's fiction
                          hides behind the village's own readings. */}
                      {e.isExample && <ExampleChip className="ml-1.5 align-middle" />}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Snapshot vitals */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Moon className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm">Lunation snapshots</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Frozen at each cycle close, never recomputed.{" "}
              {data && !data.trendsUnlocked && (
                <span className="text-amber-600">
                  {data.lunationsCollected} of {data.trendMinLunations} lunations collected, trends unlock at {data.trendMinLunations}.
                </span>
              )}
            </p>
            {data && data.lunationsCollected === 0 ? (
              <p className="text-sm text-muted-foreground">The first snapshot lands when the current lunar cycle closes.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(SNAPSHOT_LABELS).map(([key, label]) => {
                  const latest = latestOf(key);
                  if (!latest) return null;
                  const points = data.series[key];
                  return (
                    <div key={key} className="border border-border rounded-lg px-3 py-2.5">
                      <p className="text-xl font-bold text-foreground">{latest.value}</p>
                      <p className="text-xs text-muted-foreground">{snapshotTileLabel(key, label, latest.meta)}</p>
                      {data.trendsUnlocked && points.length >= 2 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {points.slice(-data.trendMinLunations).map((p: any) => p.value).join(" → ")} over recent cycles
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Governance reads, framed honestly */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm">Governance health</p>
            </div>
            <p className="text-sm text-foreground">
              {count(data?.governance?.decisionsAllTime ?? 0, "decision")} opened by{" "}
              {count(data?.governance?.distinctAuthors ?? 0, "member")}
              {data?.governance?.authorshipConcentration != null && (
                <>, and the most frequent author opened {Math.round(data.governance.authorshipConcentration * 100)}%</>
              )}
              .
            </p>
            <p className="text-xs text-muted-foreground mt-1">{data?.governance?.note}</p>
          </div>

          {/*
            Role hoarding, kept off the scoreboard.

            The headline is a count of SEATS, not of people, so the fragility
            reads without naming anybody. Names appear only for a viewer the
            server already trusted with map.viewPeople, and even then the list
            is sole-held seats and not a standing. Nobody is ahead of anybody.
          */}
          {data?.structure?.seatingsLive > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-teal-deep" />
                <p className="font-semibold text-foreground text-sm">What the village depends on</p>
              </div>
              <p className="text-sm text-foreground">
                {data.structure.soleHeldSeats} of {count(data.structure.seatingsLive, "filled role")}{" "}
                {data.structure.soleHeldSeats === 1 ? "has" : "have"} no second holder
                {data.structure.soleHeldCritical > 0 && (
                  <>, {data.structure.soleHeldCritical} of them marked critical</>
                )}
                {data.structure.soleHeldWithCover > 0 && (
                  <>, and {data.structure.soleHeldWithCover} of them have somebody named to carry it</>
                )}
                {data.structure.unheldSeats > 0 && (
                  <>
                    , and {count(data.structure.unheldSeats, "role")}{" "}
                    {data.structure.unheldSeats === 1 ? "has" : "have"} nobody in{" "}
                    {data.structure.unheldSeats === 1 ? "it" : "them"} at all
                  </>
                )}
                .
              </p>
              {data.structure.holders?.some((h: any) => h.soleHeld > 0) && (
                <ul className="mt-2 space-y-1">
                  {data.structure.holders
                    .filter((h: any) => h.soleHeld > 0)
                    .map((h: any) => (
                      <li key={h.holderKey} className="text-xs text-foreground">
                        <span className="font-medium">{h.name}</span> is the only holder of{" "}
                        {h.soleHeldNames.join(", ")}
                      </li>
                    ))}
                </ul>
              )}
              {data.structure.possibleDuplicates?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {data.structure.possibleDuplicates.map((d: any) => d.name).join(", ")} appears both as a
                  member and as a name written on a card, so the load above is split across two entries and
                  reads lighter than it is. Claiming the role joins them.
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">{data.structure.note}</p>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            Absolute counts only. No leaderboards, no ranks. The village is not a scoreboard.
          </p>
        </div>
      </section>
    </Layout>
  );
}

// ── The doughnut (S71) ───────────────────────────────────────────────────────
//
// Two rings around a safe and just space, after Raworth. The INNER ring is
// the social foundation: each wedge is the share of the village the last
// lunation reached, and a red mark points inward where the share sits under
// the floor the village set. The red points at what the village agreed
// matters, never at a person. The OUTER ring is the land's ledger: this
// platform measures what a village gives back, so wedges grow OUTWARD with
// each metric's current lunation against the village's own best. Villages
// that meter extraction can wire true ceilings later; a CO2 wedge with no
// data source would be decoration wearing the costume of measurement.

/** An annular sector path between radii r0..r1 across [a0..a1] (radians). */
function ring(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${p(r1, a0)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}`,
    `L ${p(r0, a1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}`,
    "Z",
  ].join(" ");
}

function DoughnutCard({ doughnut }: { doughnut: any }) {
  const C = DOUGHNUT.C;
  const F_OUT = 188;   // foundation wedges grow inward from here
  const F_DEPTH = 96;  // a full share reaches this far in
  const RING_F = [188, 210] as const;
  const SAFE = [210, 248] as const;
  const RING_R = [248, DOUGHNUT.RING_R_OUT] as const;
  const R_GROW = DOUGHNUT.R_GROW;   // a best-lunation regen wedge reaches this far out

  const foundation: any[] = doughnut.foundation ?? [];
  const regen: any[] = doughnut.regen ?? [];
  const GAP = 0.035;

  const fSeg = (i: number) => {
    const span = TAU / Math.max(1, foundation.length);
    return [-Math.PI / 2 + i * span + GAP, -Math.PI / 2 + (i + 1) * span - GAP] as const;
  };
  const rSeg = (i: number) => {
    const span = TAU / Math.max(1, regen.length);
    return [-Math.PI / 2 + i * span + GAP, -Math.PI / 2 + (i + 1) * span - GAP] as const;
  };
  const mid = (seg: readonly [number, number]) => (seg[0] + seg[1]) / 2;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Circle className="w-4 h-4 text-teal-deep" />
        <p className="font-semibold text-foreground text-sm">The doughnut</p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        The social foundation inside, the land's ledger outside, the safe and
        just space between. Red marks point at what the village agreed
        matters, never at a person.
      </p>

      {/* The viewBox carries the label band as well as the rings. It used to
          be `0 0 720 720`, which stopped exactly at the centre plus 360 while
          the outer labels are anchored at 362 and then run outward, so the
          left, right and bottom names were painted outside the picture and
          clipped by the svg's default overflow. The numbers are derived in
          `@/lib/doughnutLayout` and checked there. */}
      <svg viewBox={DOUGHNUT_VIEWBOX} className="w-full max-h-[76vh]" role="group" aria-label="The village doughnut">
        <defs>
          <path id="ring-f-label" d={`M ${C - RING_F[0] - 11} ${C} A ${RING_F[0] + 11} ${RING_F[0] + 11} 0 1 1 ${C + RING_F[0] + 11} ${C}`} />
          <path id="ring-r-label" d={`M ${C - RING_R[0] - 11} ${C} A ${RING_R[0] + 11} ${RING_R[0] + 11} 0 1 1 ${C + RING_R[0] + 11} ${C}`} />
        </defs>

        {/* The safe and just space */}
        <path d={ring(C, C, SAFE[0], SAFE[1], 0, TAU - 0.0001)}
          style={{ fill: "var(--color-sage)", fillOpacity: 0.07 }} />

        {/* Foundation band */}
        <path d={ring(C, C, RING_F[0], RING_F[1], 0, TAU - 0.0001)}
          style={{ fill: "var(--color-sage)", fillOpacity: 0.85 }} />
        <text style={{ fontSize: 13, letterSpacing: 3, fill: "white", fontWeight: 600 }}>
          <textPath href="#ring-f-label" startOffset="25%" textAnchor="middle">SOCIAL FOUNDATION</textPath>
        </text>

        {/* Outer band */}
        <path d={ring(C, C, RING_R[0], RING_R[1], 0, TAU - 0.0001)}
          style={{ fill: "var(--color-teal-deep)", fillOpacity: 0.9 }} />
        <text style={{ fontSize: 13, letterSpacing: 3, fill: "white", fontWeight: 600 }}>
          <textPath href="#ring-r-label" startOffset="25%" textAnchor="middle">THE LAND'S LEDGER</textPath>
        </text>

        {/* Foundation wedges: share grows inward; shortfall is the red gap
            between where the wedge reached and the floor. */}
        {foundation.map((w, i) => {
          const [a0, a1] = fSeg(i);
          const track = ring(C, C, F_OUT - F_DEPTH, F_OUT, a0, a1);
          const share = w.share == null ? 0 : w.share;
          const reach = ring(C, C, F_OUT - share * F_DEPTH, F_OUT, a0, a1);
          const label = w.share == null ? "no reading yet" : `${Math.round(w.share * 100)}% of the village, floor ${Math.round(w.floor * 100)}%`;
          return (
            <g key={w.key}>
              <path d={track} style={{ fill: "var(--color-sage)", fillOpacity: 0.06 }} />
              {w.share != null && (
                <path d={reach} style={{ fill: "var(--color-sage)", fillOpacity: 0.5 }}>
                  <title>{`${w.label}: ${label}`}</title>
                </path>
              )}
              {w.shortfall && (
                <path
                  d={ring(C, C, F_OUT - w.floor * F_DEPTH, F_OUT - share * F_DEPTH, a0, a1)}
                  style={{ fill: "var(--color-destructive)", fillOpacity: 0.55 }}
                >
                  <title>{`${w.label}: under the ${Math.round(w.floor * 100)}% floor`}</title>
                </path>
              )}
              <text
                x={C + 128 * Math.cos(mid(fSeg(i)))}
                y={C + 128 * Math.sin(mid(fSeg(i)))}
                textAnchor="middle"
                className="fill-foreground"
                style={{ fontSize: 11.5, fontWeight: 500 }}
              >
                {w.label.length > 18 ? (
                  <>
                    <tspan x={C + 128 * Math.cos(mid(fSeg(i)))} dy="-0.35em">{w.label.slice(0, w.label.lastIndexOf(" ", 18))}</tspan>
                    <tspan x={C + 128 * Math.cos(mid(fSeg(i)))} dy="1.15em">{w.label.slice(w.label.lastIndexOf(" ", 18) + 1)}</tspan>
                  </>
                ) : w.label}
              </text>
              <text
                x={C + 168 * Math.cos(mid(fSeg(i)))}
                y={C + 168 * Math.sin(mid(fSeg(i)))}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 10.5 }}
              >
                {w.share == null ? "…" : `${Math.round(w.share * 100)}%`}
              </text>
            </g>
          );
        })}

        {/* Regen wedges: this lunation against the village's own best,
            growing outward. Quiet is visible, never shameful. */}
        {regen.map((w, i) => {
          const [a0, a1] = rSeg(i);
          const track = ring(C, C, RING_R[1], RING_R[1] + R_GROW, a0, a1);
          const grow = ring(C, C, RING_R[1], RING_R[1] + Math.max(0.02, w.fill) * R_GROW, a0, a1);
          // One source for where a label sits, shared with the check that
          // proves it lands inside the viewBox.
          const place = outerLabelPlacement(regen.length, i);
          const lx = place.x;
          const ly = place.y;
          return (
            <g key={w.key}>
              <path d={track} style={{ fill: "var(--color-teal)", fillOpacity: 0.06 }} />
              <path d={grow} style={{ fill: "var(--color-teal)", fillOpacity: 0.55 }}>
                <title>{`${w.label}: ${w.thisLunation.toLocaleString()} ${w.unit} this lunation, best lunation ${w.bestLunation.toLocaleString()}`}</title>
              </path>
              <text
                x={lx} y={ly}
                textAnchor={place.anchor}
                className="fill-foreground"
                style={{ fontSize: 11.5, fontWeight: 500 }}
              >
                {w.label}
              </text>
              <text
                x={lx} y={ly + 13}
                textAnchor={place.anchor}
                className="fill-muted-foreground"
                style={{ fontSize: 10.5 }}
              >
                {w.total.toLocaleString()} {w.unit} to date
              </text>
            </g>
          );
        })}

        {!doughnut.collected && (
          <text x={C} y={C} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 13 }}>
            <tspan x={C} dy="-0.5em">The doughnut draws itself from lunation snapshots.</tspan>
            <tspan x={C} dy="1.3em">The first lands when the current lunar cycle closes.</tspan>
          </text>
        )}
      </svg>

      {/* The same numbers as text: the SVG is a picture of this list. */}
      <details className="mt-2">
        <summary className="text-xs text-muted-foreground cursor-pointer">The numbers behind the rings</summary>
        <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
          {foundation.map((w) => (
            <p key={w.key} className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{w.label}:</span>{" "}
              {w.share == null
                ? "no reading yet"
                : `${w.value?.toLocaleString?.() ?? w.value} of ${w.denomValue?.toLocaleString?.() ?? w.denomValue} (${Math.round(w.share * 100)}%, floor ${Math.round(w.floor * 100)}%)`}
              {w.shortfall && <span className="text-red-600"> · under the floor</span>}
            </p>
          ))}
          {regen.map((w) => (
            <p key={w.key} className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">{w.label}:</span>{" "}
              {w.thisLunation.toLocaleString()} {w.unit} this lunation, {w.total.toLocaleString()} to date
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}
