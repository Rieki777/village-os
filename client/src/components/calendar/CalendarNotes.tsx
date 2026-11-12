/**
 * THE CALENDAR'S TWO QUIET LINES: which clock the times are in, and the door
 * to the Seasonal Festivals page.
 *
 * ON A PHONE, IN THE MOON VIEW, THEY SIT UNDER THE MOON (batch 157, C3 Q3).
 * The moon is what a phone opens on, and two lines of small print above it
 * pushed the spiral below the fold. Everywhere else (a wide screen, or any
 * other view) they stay under the page's lede. The lines are drawn in ONE
 * place at a time, chosen by `notesUnderMoon`, so the page never carries
 * them twice and a screen reader never hears them twice.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trans } from "@lingui/react/macro";

/** Below Tailwind's `sm`: the width the phone layout is drawn at. */
const PHONE = "(max-width: 639px)";

/** True on a phone-width screen. False where the browser cannot say. */
export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(PHONE);
    const on = () => setPhone(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return phone;
}

/** Whether the two lines go under the moon view: a phone, on the moon view, with a moon drawn. */
export function notesUnderMoon(phone: boolean, tab: string, moonDrawn: boolean): boolean {
  return phone && tab === "moon" && moonDrawn;
}

export default function CalendarNotes({ zoneLine, className = "" }: { zoneLine: string | null; className?: string }) {
  return (
    <div className={className} data-testid="calendar-notes">
      {zoneLine ? <p className="mt-2 text-xs text-muted-foreground">{zoneLine}</p> : null}
      {/* The season page is what this calendar sits inside, and it is
          ungated core content, so this link is safe on every fork. It is
          also the second door onto /seasonal-festivals, which lived behind
          one menu entry. */}
      <p className="mt-2 text-xs text-muted-foreground">
        <Trans context="calendar page: the door to the Seasonal Festivals page">
          The turnings that shape this year are on the{" "}
          <Link href="/seasonal-festivals" className="text-notice font-medium underline underline-offset-2 hover:text-foreground">
            Seasonal Festivals
          </Link>{" "}
          page.
        </Trans>
      </p>
    </div>
  );
}
