/**
 * CROSSING A RUNG ON THE PATH OF GROWTH.
 *
 * This is the second of the two rationed `moment` celebrations, and until now
 * it arrived as one line in a notification bell, indistinguishable from a
 * forum reply. The server has always known more than it showed:
 * `recordStageEvent` computes the exact set of capabilities the advance
 * opened, and `notify.ts` files the event as "celebratory, never urgent",
 * which is a description of a moment nobody had built.
 *
 * THE BELL IS NOT OURS. A parallel lane owns the notification surface, so
 * this is the in-page celebration only and duplicates none of its copy. The
 * two answer different questions: the bell says it happened, this says what
 * it means.
 *
 * THE LADDER MOVES ONE RUNG. The moon starts at the stage the member left and
 * eases to the one they reached, which is the only motion here and the only
 * one that carries information: the shape of the advance, at the size of the
 * whole path. `MoonProgress` already transitions its terminator, and already
 * drops that transition under reduce-motion and lands on the value, so the
 * still state is the new position stated plainly.
 *
 * "YOU CAN NOW" IS THE POINT. `unlocked` is a list of raw capability keys and
 * `CAPABILITY_LABELS` is what turns `map.contact` into something a member can
 * act on. An advance that opened nothing says so and does not pretend.
 */
import { useEffect, useState } from "react";
import { Sunrise, X } from "lucide-react";
import Celebration from "@/components/natural/Celebration";
import MoonProgress from "@/components/natural/MoonProgress";
import { useMomentWindow } from "@/components/natural/moments";
import { capabilityLabel } from "@shared/capabilities";
import { playMoment } from "@/lib/sound";

export interface StageAdvance {
  fromStage: string;
  toStage: string;
  unlocked: string[];
  at: string;
}

export interface StageAdvancedProps {
  advance: StageAdvance;
  /** The ladder, in order, as `/api/game/me` serves it. */
  stages: Array<{ id: string; name: string }>;
  /** Dismiss. The member closing this is the only way it leaves for good. */
  onClose: () => void;
}

export default function StageAdvanced({ advance, stages, onClose }: StageAdvancedProps) {
  const last = Math.max(1, stages.length - 1);
  const fromIndex = stages.findIndex((s) => s.id === advance.fromStage);
  const toIndex = stages.findIndex((s) => s.id === advance.toStage);
  const reached = stages[toIndex]?.name ?? advance.toStage;
  // R47: a finish names the next step. The stage after this one, or null on
  // the last rung the village has named.
  const next = toIndex >= 0 ? stages[toIndex + 1]?.name ?? null : null;

  // The rung climbs on mount. Starting at the old value and setting the new
  // one in an effect is what gives the terminator something to ease between;
  // rendering the new value directly would draw the destination and no
  // journey.
  const [value, setValue] = useState(() => (fromIndex >= 0 ? fromIndex / last : 0));
  const showing = useMomentWindow(true);

  useEffect(() => {
    playMoment("stage_advance", "arrive");
    const t = window.setTimeout(() => setValue(toIndex >= 0 ? toIndex / last : 1), 60);
    return () => window.clearTimeout(t);
  }, [toIndex, last]);

  return (
    <div className="relative rounded-2xl border border-amber/40 bg-amber/5 px-5 py-4 mb-5">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2 right-2 p-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-4">
        <MoonProgress
          value={value}
          size={56}
          label="Path of Growth"
          showNumber={false}
        />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sunrise className="w-4 h-4 text-amber" />
            New stage: {reached}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {next ? `Next on your Path of Growth: ${next}.` : "You stand on the last stage this village has named."}
          </p>
        </div>
        {showing && (
          <span className="ml-auto shrink-0">
            <Celebration
              kind="dawn"
              intensity="moment"
              size={72}
              seed={toIndex}
              message={`New stage: ${reached}.`}
            />
          </span>
        )}
      </div>

      {advance.unlocked.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You can now</p>
          <ul className="mt-1.5 space-y-1">
            {advance.unlocked.map((cap) => (
              <li key={cap} className="flex items-start gap-2 text-sm text-foreground">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber shrink-0" />
                {capabilityLabel(cap)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
