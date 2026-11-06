/**
 * STAGE REACHED: the abilities this rung opened, the Path of Growth, and the
 * one next step (approved design, 2026-10-30).
 *
 * The next step is the server's own `nextAction` (server/lib/nextAction.ts),
 * the same one GameDashboard used to print as a banner, so there is still one
 * answer to "what now" on the page. The steps count only when the next rung
 * has steps to count (dashModel.nextRungProgress); otherwise the rung says
 * what opens it in words.
 *
 * Dismissing it hides it until the member reaches the next stage. The choice
 * is kept in this browser per stage, so a new rung brings it back.
 */
import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { readStored, writeStored } from "@/lib/safeStorage";
import { rungStates, type RungState } from "./dashModel";
import { BTN_GOLD, CHIP, KICKER, LINK } from "./dashUi";
import { DEFAULT_LADDER_TITLE } from "@shared/villagePaths";

const RUNG_FILL: Record<RungState, string> = {
  reached: "bg-dash-gold",
  current: "bg-dash-gold shadow-[0_0_10px_color-mix(in_srgb,var(--color-dash-gold-lit)_70%,transparent)]",
  next: "bg-dash-warm-edge",
  ahead: "bg-dash-edge",
};
const RUNG_TEXT: Record<RungState, string> = {
  reached: "text-muted-foreground",
  current: "text-dash-gold-lit",
  next: "text-muted-foreground",
  ahead: "text-muted-foreground",
};

const DISMISS_KEY = "profile.stagePanel.dismissed";

export default function StagePanel({
  stages,
  stageIndex,
  abilities,
  nextAction,
  progress,
  progressUnit,
  nextRuleWords,
  ladderTitle,
}: {
  stages: ReadonlyArray<{ id: string; name: string }>;
  stageIndex: number;
  abilities: string[];
  nextAction: { label: string; href: string } | null;
  progress: { done: number; total: number } | null;
  /** "lessons" or "quests consented", for the line under the next step. */
  progressUnit: string;
  /** What opens the next rung when there are no steps to count. */
  nextRuleWords: string | null;
  /** The ladder's name in this village's words (Admin, Paths & Stages). Absent reads as the platform's. */
  ladderTitle?: string;
}) {
  const ladder = ladderTitle?.trim() || DEFAULT_LADDER_TITLE;
  const here = stages[stageIndex];
  const next = stages[stageIndex + 1] ?? null;
  const headingId = useId();
  const [dismissed, setDismissed] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  useEffect(() => {
    const got = readStored("local", DISMISS_KEY);
    setDismissed(got.status === "value" && got.value === here?.id);
  }, [here?.id]);

  if (!here || dismissed) return null;

  const dismiss = () => {
    writeStored("local", DISMISS_KEY, here.id);
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="relative flex flex-wrap items-center gap-7 rounded-[18px] border border-dash-warm-edge bg-dash-warm p-4 shadow-[inset_0_0_60px_color-mix(in_srgb,var(--color-dash-gold)_8%,transparent)] sm:rounded-[22px] sm:px-7 sm:py-6"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide until my next stage"
        className="absolute right-3 top-3 hidden h-11 w-11 items-center justify-center rounded-lg text-2xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
      >
        <span aria-hidden="true">×</span>
      </button>

      <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-3">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="hidden h-[52px] w-[52px] shrink-0 rounded-full border-2 border-dash-gold bg-[linear-gradient(90deg,var(--foreground)_50%,var(--color-dash-track)_50%)] sm:block"
          />
          <div>
            <p className={KICKER}>Stage reached</p>
            <h2 id={headingId} className="m-0 font-display text-[26px] leading-tight sm:text-[32px]">
              You are a {here.name}
            </h2>
          </div>
        </div>

        {abilities.length > 0 ? (
          <>
            <p className="m-0 text-[13px] text-muted-foreground sm:hidden">
              {abilities.length} {abilities.length === 1 ? "ability" : "abilities"} unlocked ·{" "}
              <button type="button" onClick={() => setPhoneOpen((o) => !o)} aria-expanded={phoneOpen} className={`${LINK} min-h-11`}>
                {phoneOpen ? "hide them" : "see them"}
              </button>
            </p>
            <p className="m-0 hidden text-[13px] uppercase tracking-[0.15em] text-muted-foreground sm:block">Abilities unlocked</p>
            <ul className={`${phoneOpen ? "flex" : "hidden"} m-0 list-none flex-wrap gap-2 p-0 sm:flex`}>
              {abilities.map((a) => (
                <li key={a} className={CHIP}>
                  {a}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="m-0 mt-1.5 hidden text-[13px] uppercase tracking-[0.15em] text-muted-foreground sm:block">{ladder}</p>
        <ol
          aria-label={`${ladder}, stage ${stageIndex + 1} of ${stages.length}`}
          className="m-0 hidden list-none gap-1 p-0 sm:grid"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
        >
          {rungStates(stages, stageIndex).map((r) => (
            <li key={r.id} aria-current={r.state === "current" ? "step" : undefined} className="flex flex-col items-center gap-1.5">
              <span className={`h-2 w-full rounded ${RUNG_FILL[r.state]}`} />
              <span className={`w-full text-center text-[9px] leading-tight tracking-tight [overflow-wrap:anywhere] ${RUNG_TEXT[r.state]}`}>{r.name}</span>
            </li>
          ))}
        </ol>
      </div>

      {nextAction ? (
        <div className="flex w-full flex-[1_1_300px] items-center gap-3 rounded-[14px] border border-dash-gold-edge bg-dash-next p-3.5 sm:flex-col sm:items-stretch sm:gap-2.5 sm:rounded-[18px] sm:p-5">
          <div className="min-w-0 flex-1">
            <p className={KICKER}>
              <span className="sm:hidden">Next step</span>
              <span className="hidden sm:inline">{next ? `Your next step to ${next.name}` : "Your next step"}</span>
            </p>
            <p className="m-0 mt-0.5 text-base font-medium sm:font-display sm:text-[26px] sm:leading-tight">{nextAction.label}</p>
            {progress ? (
              <p className="m-0 mt-1 hidden text-[13px] text-muted-foreground sm:block">
                {progress.done} of {progress.total} {progressUnit} done
              </p>
            ) : nextRuleWords ? (
              <p className="m-0 mt-1 hidden text-[13px] text-muted-foreground sm:block">{nextRuleWords}</p>
            ) : null}
          </div>
          <Link href={nextAction.href} className={`${BTN_GOLD} shrink-0 self-center sm:self-start`}>
            Go <span aria-hidden="true">→</span>
          </Link>
          <p className="m-0 mt-1 hidden text-[13px] text-muted-foreground sm:block">
            Other ways forward:{" "}
            <Link href="/propose-quest" className={LINK}>
              Propose a quest
            </Link>{" "}
            ·{" "}
            <Link href="/roles" className={LINK}>
              Raise your hand for an open role
            </Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
