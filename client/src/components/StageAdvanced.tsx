/**
 * A DOOR OPENED, INLINE: the fallback for a page that does not play the
 * full-screen moment (profileDash/LevelUpMoment.tsx is the one the profile
 * plays). It used to read "New stage: Member" with a moon easing up the
 * ladder and "Next on your Path of Growth"; the prune (waves 1 and 2, display
 * only) names the door instead, because nothing scores or ranks a person.
 *
 * THE BELL IS NOT OURS. The notification says it happened; this says what it
 * means. `unlocked` is a list of raw capability keys, read through
 * `CAPABILITY_LABELS`. A crossing that opened nothing says so kindly.
 */
import { useEffect } from "react";
import { Sunrise, X } from "lucide-react";
import Celebration from "@/components/natural/Celebration";
import { useMomentWindow } from "@/components/natural/moments";
import { capabilityLabel } from "@shared/capabilities";
import { youCanNow } from "@shared/doorsOpened";
import { playMoment } from "@/lib/sound";

export interface StageAdvance {
  fromStage: string;
  toStage: string;
  unlocked: string[];
  at: string;
}

export interface StageAdvancedProps {
  advance: StageAdvance;
  /** Dismiss. The member closing this is the only way it leaves for good. */
  onClose: () => void;
}

export default function StageAdvanced({ advance, onClose }: StageAdvancedProps) {
  const doors = advance.unlocked.map((cap) => youCanNow(capabilityLabel(cap))).filter(Boolean);
  const showing = useMomentWindow(true);

  useEffect(() => {
    playMoment("stage_advance", "arrive");
  }, []);

  return (
    <div className="relative rounded-2xl border border-border bg-card px-5 py-4 mb-5 shadow-sm">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2 right-2 p-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sunrise className="w-4 h-4 text-notice" />
            {doors.length > 0 ? "A door opened" : "A new step on your walk"}
          </p>
        </div>
        {showing && (
          <span className="ml-auto shrink-0">
            <Celebration kind="dawn" intensity="moment" size={72} seed={1} message={doors[0] ? `${doors[0]}.` : "A new step on your walk."} />
          </span>
        )}
      </div>

      {doors.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {doors.map((d) => (
            <li key={d} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-notice shrink-0" />
              {d}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
