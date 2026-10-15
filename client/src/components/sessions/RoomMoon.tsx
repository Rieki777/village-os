/**
 * The session's moon and season, as one line: the drawn moon at the phase the
 * session opened under, then the words. The drawing is the same MoonGlyph the
 * village calendar uses, coloured from the theme's tones and sized to the text
 * around it, so it reads the same on every phone and in every brand.
 *
 * The words carry the meaning, so the drawing is hidden from screen readers
 * and the moon's name is read out instead. A stamp kept before the phase was
 * stored has no phase to draw, and then the line is the words alone.
 *
 * The season is printed as the stamp gives it: a village can name its own
 * seasons, so any word can arrive, and none is mapped to a picture.
 */
import { ROOM_COPY, type SessionStamp } from "@shared/sessions";
import MoonGlyph from "@/components/calendar/MoonGlyph";

/** "Moon 4 · Waxing gibbous · Green", leaving out whatever the stamp does not hold. */
export function skyLine(stamp: Pick<SessionStamp, "moonOrdinal" | "moonName" | "season">): string {
  return [stamp.moonOrdinal != null ? ROOM_COPY.moonOrdinal(stamp.moonOrdinal) : null, stamp.moonName, stamp.season?.trim() || null]
    .filter(Boolean)
    .join(" · ");
}

export default function RoomMoon({ stamp, className = "" }: { stamp: SessionStamp; className?: string }) {
  const line = skyLine(stamp);
  if (!line) return null;
  const phase = typeof stamp.moonPhase === "number" && Number.isFinite(stamp.moonPhase) ? stamp.moonPhase : null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {phase != null && (
        <MoonGlyph phase={phase} hemisphere={stamp.hemisphere ?? "north"} className="h-[1.15em] w-[1.15em] shrink-0" />
      )}
      <span>{line}</span>
    </span>
  );
}
