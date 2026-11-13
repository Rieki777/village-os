/**
 * A DOOR OPENED: the full-screen moment when a crossing opens something.
 *
 * It plays once per crossing. GameDashboard already claims the moment through
 * `claimMoment` (lib/celebrated.ts), keyed on the rung and the time it turned,
 * and hands the advance up here, so a reload never replays it and a second
 * tab never doubles it. Everything it says comes off `lastAdvance`, which is
 * `recordStageEvent`'s own diff: the doors named are the keys that crossing
 * actually opened, never a list typed here.
 *
 * THE PRUNE (waves 1 and 2, display only, 11 Nov 2026). Nothing scores or
 * ranks a person, so this names the DOOR and never the rung: no stage name in
 * the heading, no "n of 12" seed, and no share line, because a crossing posted
 * to the village is rank published. A fern unfurls round the portrait once,
 * inside 1.6s, and reduced motion shows the open frond still. The stage ids,
 * the gate and every floor are untouched; this is drawing only.
 *
 * A dialog, so focus moves into it and Escape closes it.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import FramelessImg from "@/components/FramelessImg";
import { capabilityLabel } from "@shared/capabilities";
import { youCanNow } from "@shared/doorsOpened";
import { playMoment } from "@/lib/sound";
import type { StageAdvance } from "@/components/StageAdvanced";

const FernUnfurl = lazy(() => import("@/components/journey/nature/FernUnfurl"));

export default function LevelUpMoment({
  advance,
  name,
  portrait,
  onClose,
}: {
  advance: StageAdvance;
  /** The member's first name, for the line under the door. */
  name: string;
  /** The fronted character's art, or null for the initial. */
  portrait: { src: string | null; label: string } | null;
  onClose: () => void;
}) {
  const doors = advance.unlocked.map((key) => youCanNow(capabilityLabel(key))).filter(Boolean);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    playMoment("stage_advance", "arrive");
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const first = name.trim().split(/\s+/)[0] ?? name;
  const heading = doors[0] ? `${doors[0]}.` : `${first}, the village saw what you carried.`;
  const rest = doors.slice(1);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="levelup-h"
      className="sheet-night fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-[radial-gradient(circle_at_50%_42%,var(--sheet-dash-glow,#2a3a22)_0%,var(--background)_45%,var(--sheet-dash-deep,#070d0a)_100%)] px-4 py-10 text-foreground"
    >
      <p className="relative m-0 text-xs font-semibold uppercase tracking-widest text-notice">
        {doors.length > 0 ? (
          <Trans context="level-up moment eyebrow">A door opened</Trans>
        ) : (
          <Trans context="level-up moment eyebrow, nothing new opened">A new step on your walk</Trans>
        )}
      </p>

      <div className="relative grid size-64 place-items-center sm:size-80 lg:size-96" data-testid="door-fern">
        <div className="absolute inset-0 grid place-items-center opacity-80">
          <Suspense fallback={null}>
            <FernUnfurl size="lg" />
          </Suspense>
        </div>
        <div className="relative size-28 overflow-hidden rounded-full border-2 border-notice bg-muted sm:size-36 lg:size-44">
          {portrait?.src && !broken ? (
            <FramelessImg src={portrait.src} alt={portrait.label} onError={() => setBroken(true)} className="h-full w-full object-cover object-top" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-5xl text-foreground">
              {(portrait?.label ?? name).replace(/^The\s+/i, "").slice(0, 1)}
            </span>
          )}
        </div>
      </div>

      <h1 id="levelup-h" className="relative m-0 max-w-3xl text-balance text-center font-display text-4xl leading-tight sm:text-5xl lg:text-6xl">
        {heading}
      </h1>
      {doors.length > 0 ? (
        <p className="relative m-0 max-w-xl text-center text-lg text-muted-foreground">
          {first}, <Trans context="level-up moment, under the door">the village saw what you carried.</Trans>
        </p>
      ) : null}

      {rest.length > 0 ? (
        <ul className="relative m-0 flex list-none flex-col items-center gap-2 p-0">
          {rest.map((g) => (
            <li key={g} className="rounded-xl border border-border bg-card px-4 py-2 text-center text-base shadow-sm">
              {g}.
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative mt-1 flex flex-wrap justify-center gap-3">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="min-h-[52px] rounded-2xl bg-dash-gold px-7 text-base font-semibold text-dash-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Back to my sheet
        </button>
      </div>
    </div>
  );
}
