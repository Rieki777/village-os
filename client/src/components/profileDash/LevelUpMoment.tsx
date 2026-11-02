/**
 * THE LEVEL-UP MOMENT: the approved design's full-screen "Stage reached"
 * (LevelUp board, Rye, 2026-10-30).
 *
 * It plays once per crossing. GameDashboard already claims the moment through
 * `claimMoment` (lib/celebrated.ts), keyed on the rung and the time it turned,
 * and hands the advance up here, so a reload never replays it and a second
 * tab never doubles it. Everything it says comes off `lastAdvance`, which is
 * `recordStageEvent`'s own diff: the abilities named are the keys that rung
 * actually opened, never a list typed here.
 *
 * A dialog, so focus moves into it and Escape closes it. Reduced motion keeps
 * the words and drops the sparks' glow pulse.
 */
import { useEffect, useRef, useState } from "react";
import { capabilityLabel } from "@shared/capabilities";
import { playMoment } from "@/lib/sound";
import type { StageAdvance } from "@/components/StageAdvanced";
import { DEFAULT_LADDER_TITLE } from "@shared/villagePaths";

const SPARKS = Array.from({ length: 46 }, (_, i) => ({
  left: `${(i * 41) % 98}%`,
  top: `${(i * 29) % 94}%`,
  size: i % 5 === 0 ? 5 : 3,
  opacity: 0.2 + (i % 5) * 0.14,
}));

const countWord = (n: number) =>
  (["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n] ?? String(n));

export default function LevelUpMoment({
  advance,
  stages,
  name,
  portrait,
  onClose,
  ladderTitle,
}: {
  advance: StageAdvance;
  stages: ReadonlyArray<{ id: string; name: string }>;
  /** The member's first name, for the line under the stage. */
  name: string;
  /** The fronted character's art, or null for the initial. */
  portrait: { src: string | null; label: string } | null;
  onClose: () => void;
  /** The ladder's name in this village's words (Admin, Paths & Stages). Absent reads as the platform's. */
  ladderTitle?: string;
}) {
  const reached = stages.find((s) => s.id === advance.toStage)?.name ?? advance.toStage;
  const gifts = advance.unlocked.map((key) => capabilityLabel(key));
  const closeRef = useRef<HTMLButtonElement>(null);
  const [said, setSaid] = useState("");
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
  const line =
    gifts.length > 0
      ? `${first}, the village saw what you carried. ${countWord(gifts.length)} new ${gifts.length === 1 ? "ability is" : "abilities are"} yours.`
      : `${first}, the village saw what you carried.`;

  const share = async () => {
    const text = `I reached ${reached} on our ${ladderTitle?.trim() || DEFAULT_LADDER_TITLE}.`;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ text });
        setSaid("Shared.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setSaid("Copied. Paste it wherever the village talks.");
    } catch {
      setSaid("That didn't go through. Try again.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="levelup-h"
      className="sheet-night fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-[radial-gradient(circle_at_50%_42%,var(--sheet-dash-glow,#2a3a22)_0%,var(--background)_45%,var(--sheet-dash-deep,#070d0a)_100%)] px-4 py-10 text-foreground"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {SPARKS.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-dash-gold-lit shadow-[0_0_8px_var(--color-dash-gold-lit)]"
            style={{ left: s.left, top: s.top, width: s.size, height: s.size, opacity: s.opacity }}
          />
        ))}
      </div>

      <p className="relative m-0 text-sm uppercase tracking-[0.4em] text-dash-gold-lit">Stage reached</p>

      <div className="relative h-56 w-56 rounded-full bg-dash-gold-lit p-2 shadow-[0_0_90px_color-mix(in_srgb,var(--color-dash-gold-lit)_55%,transparent)] sm:h-72 sm:w-72">
        <div className="flex h-full w-full items-end justify-center overflow-hidden rounded-full border-[5px] border-background bg-muted">
          {portrait?.src && !broken ? (
            <img src={portrait.src} alt={portrait.label} onError={() => setBroken(true)} className="h-full w-full object-cover object-top" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-6xl text-foreground">
              {(portrait?.label ?? name).replace(/^The\s+/i, "").slice(0, 1)}
            </span>
          )}
        </div>
      </div>

      <h1 id="levelup-h" className="relative m-0 text-center font-display text-6xl leading-none sm:text-7xl lg:text-[84px]">
        {reached}
      </h1>
      <p className="relative m-0 max-w-xl text-center text-lg text-muted-foreground">{line}</p>

      {gifts.length > 0 ? (
        <ul className="relative m-0 flex list-none flex-wrap justify-center gap-4 p-0">
          {gifts.map((g) => (
            <li
              key={g}
              className="flex w-56 flex-col gap-1.5 rounded-2xl border border-dash-gold-edge bg-card p-4 shadow-[0_0_30px_color-mix(in_srgb,var(--color-dash-gold)_15%,transparent)]"
            >
              <span className="text-[11px] uppercase tracking-[0.2em] text-dash-gold-lit">New ability</span>
              <span className="text-[17px] font-medium">{g}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative mt-1 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={share}
          className="min-h-[52px] rounded-2xl bg-dash-gold px-7 text-base font-semibold text-dash-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Share with the village
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="min-h-[52px] rounded-2xl border border-border px-6 text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Back to my sheet
        </button>
      </div>
      <p aria-live="polite" className="relative m-0 min-h-5 text-sm text-muted-foreground">
        {said}
      </p>
    </div>
  );
}
