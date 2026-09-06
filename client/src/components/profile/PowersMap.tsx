/**
 * POWERS: every capability this village runs, and the rung that opens each.
 *
 * ── WHAT CHANGED, AND WHY IT IS THE WHOLE POINT ─────────────────────────────
 *
 * The profile used to paint `progression.capabilities` as a row of chips. That
 * is a wall of identical pills with no direction in it: a member reads eleven
 * things they can do and learns nothing about what climbing is FOR, because
 * the closed keys were never on the wire at all.
 *
 * `capabilityCatalogue` sends all of them now, each with `opens`, so this can
 * be a MAP instead of an inventory: what is open, what the very next rung
 * opens, what waits further up, and what no amount of climbing reaches.
 *
 * ── THE GROUPS ARE DERIVED, NEVER TYPED ─────────────────────────────────────
 *
 * The prototype grouped these five ways ("Voice", "The Land", "Governance",
 * "Exchange", "Gathering"). Nothing in `shared/` carries that grouping, so
 * shipping it would mean a hand-kept `Record<string, Domain>` beside a union
 * of twenty-nine keys: exactly the shape CLAUDE.md names as a promise nobody
 * checks, where the thirtieth capability renders nothing and says nothing.
 * These groups come out of `opens` and `held`, which are on the payload, so a
 * capability added upstream lands in the right bucket with no edit here.
 *
 * ── THE RUNG THAT IS "NEXT" IS NOT stageIndex + 1 ───────────────────────────
 *
 * Several rungs open no capability at all. Pointing at one of those would
 * promise a reward this village's config does not hold. "Next" is the LOWEST
 * rung above the member that opens at least one closed key.
 *
 * ── A CLOSED KEY AT OR BELOW YOUR OWN RUNG ──────────────────────────────────
 *
 * The gate is `admin -> badgeDenies -> role -> badgeCapabilities -> stage`, so
 * a deny outranks the ladder and a member can stand above a rung with the key
 * still closed. Filing those under "opens further along" would print "Opens at
 * Guest" to somebody who passed Guest months ago. They get their own group,
 * which says the true thing and claims no mechanism this payload cannot see.
 *
 * ── COLOUR ──────────────────────────────────────────────────────────────────
 *
 * Surface and text migrate together to the semantic tokens. The old chip was
 * `bg-teal-deep/10 text-teal-deep`, which composites to 4.21:1 and fails AA.
 * `GameDashboard` fixed its twin by moving to `text-sage` at 5.21:1, and that
 * fix is only valid because the surface under it is a hardcoded `bg-white`:
 * `--color-sage` is defined once in `@theme` and never redefined under
 * `.dark`, so on a `bg-card` it measures 2.89:1 at night, measured against the
 * compiled stylesheet. Nothing here uses a frozen ink on a themed surface.
 */
import { useState } from "react";
import { Lock, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import type { GameStagePublic, ProgressionCapability } from "@/lib/gameApi";

interface Group {
  key: string;
  title: string;
  note: string;
  icon: typeof ShieldCheck;
  rows: ProgressionCapability[];
  /** Open groups stay visible when a member hides what is closed. */
  open: boolean;
}

/**
 * Sort the catalogue into groups a member can act on.
 *
 * Pure, and separated from the render so the bucketing is readable on its own.
 * `stages` supplies the ORDER of the rungs; a rung id the ladder does not name
 * sorts last and still renders, the same posture `capabilityLabel` takes with
 * a key it cannot resolve.
 */
function groupPowers(
  catalogue: ProgressionCapability[],
  stages: GameStagePublic[],
  stageIndex: number,
): Group[] {
  const order = new Map(stages.map((s, i) => [s.id, i]));
  const nameOf = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
  const rungOf = (row: ProgressionCapability): number =>
    row.opens.via === "stage" ? (order.get(row.opens.stage) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

  const held = catalogue.filter((c) => c.held);
  const closed = catalogue.filter((c) => !c.held);
  const byAppointment = closed.filter((c) => c.opens.via === "appointment");
  const byRung = closed.filter((c) => c.opens.via === "stage");

  // The lowest rung ABOVE this member that opens anything still closed.
  const aheadRungs = byRung.map(rungOf).filter((i) => i > stageIndex);
  const nextRung = aheadRungs.length > 0 ? Math.min(...aheadRungs) : null;

  const nextRows = nextRung === null ? [] : byRung.filter((c) => rungOf(c) === nextRung);
  const laterRows = byRung
    .filter((c) => rungOf(c) > stageIndex && rungOf(c) !== nextRung)
    .sort((a, b) => rungOf(a) - rungOf(b));
  const deniedRows = byRung.filter((c) => rungOf(c) <= stageIndex);

  const groups: Group[] = [
    {
      key: "open",
      title: "Open to you",
      note: "You can do these today.",
      icon: ShieldCheck,
      rows: held,
      open: true,
    },
    {
      key: "next",
      title: nextRung === null ? "Next to open" : `Opens at ${nameOf(stages[nextRung]?.id ?? "")}`,
      note: "The very next rung opens these.",
      icon: Sparkles,
      rows: nextRows,
      open: false,
    },
    {
      key: "later",
      title: "Further up the ladder",
      note: "These open at rungs above the next one.",
      icon: Lock,
      rows: laterRows,
      open: false,
    },
    {
      key: "appointed",
      title: "The village appoints these",
      note: "A role or a badge opens them. No amount of climbing reaches them.",
      icon: UserCheck,
      rows: byAppointment,
      open: false,
    },
    {
      key: "denied",
      title: "Closed on your account",
      note: "Your standing reaches these and they are closed anyway.",
      icon: Lock,
      rows: deniedRows,
      open: false,
    },
  ];

  return groups.filter((g) => g.rows.length > 0);
}

/**
 * What one row's state is, in words.
 *
 * Lifted out of the JSX because narrowing `opens` inside a `.find` callback is
 * not something the compiler carries: `row.opens.stage` read from inside the
 * closure is checked against the whole union again. Resolving the union once,
 * here, is both what the compiler wants and what makes the three states
 * readable in one place.
 */
function standingOf(row: ProgressionCapability, stages: GameStagePublic[]): string {
  if (row.held) return "Open";
  if (row.opens.via === "appointment") return "Appointed";
  const rung = row.opens.stage;
  return `At ${stages.find((s) => s.id === rung)?.name ?? rung}`;
}

export default function PowersMap({
  catalogue,
  stages,
  stageIndex,
}: {
  catalogue: ProgressionCapability[];
  stages: GameStagePublic[];
  stageIndex: number;
}) {
  const [showClosed, setShowClosed] = useState(true);

  if (catalogue.length === 0) return null;

  const groups = groupPowers(catalogue, stages, stageIndex);
  const openCount = catalogue.filter((c) => c.held).length;
  const shown = showClosed ? groups : groups.filter((g) => g.open);

  return (
    <section aria-labelledby="powers-h" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="powers-h" className="font-display text-2xl font-bold text-card-foreground">
            Powers
          </h2>
          {/* Both figures come off the payload. `catalogue.length` is what this
              village RUNS, which is smaller than the platform's full set
              whenever a module is off, because an off module's keys are left
              out entirely. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {catalogue.length} powers exist in this village.{" "}
            <span className="font-semibold text-foreground">{openCount}</span> are open to you now.
          </p>
        </div>
        <button
          type="button"
          aria-pressed={showClosed}
          onClick={() => setShowClosed((v) => !v)}
          className="min-h-11 shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          {showClosed ? "Hide what is closed" : "Show what is closed"}
        </button>
      </div>

      {/* The page had no `aria-live` anywhere, so every async change and every
          toggle on it was silent. This one sentence is what a screen reader
          hears when the button above changes the list underneath it. */}
      <p aria-live="polite" className="sr-only">
        {showClosed
          ? `Showing all ${catalogue.length} powers.`
          : `Showing the ${openCount} powers open to you.`}
      </p>

      <div className="mt-6 space-y-6">
        {shown.map((group) => {
          const Icon = group.icon;
          return (
            <div key={group.key}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h3 className="font-semibold text-card-foreground">{group.title}</h3>
                <span className="text-sm text-muted-foreground">{group.rows.length}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{group.note}</p>
              <ul className="mt-3 space-y-1.5">
                {group.rows.map((row) => (
                  <li
                    key={row.key}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2"
                  >
                    {/* The label is the words a member reads. The key stays as
                        the title, for the one reader who wants it, the same
                        way the roles chip carries its id. */}
                    <span title={row.key} className="text-sm text-foreground">
                      {row.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{standingOf(row, stages)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
