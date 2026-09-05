/**
 * THE MOON IN THE CORNER, and the calendar behind it.
 *
 * Rye's ask, in his words: "having the moon phase on a corner of the page that
 * follows you around and clicking on it exposes a lunar based calendar showing
 * events". So it is fixed rather than scrolled, it draws the real phase, and
 * the panel it opens is this village's own moon: its window, its count, and
 * the gatherings that fall inside it.
 *
 * ── IT READS THE CALENDAR'S OWN ENDPOINT, AND ADDS NOTHING ───────────────
 *
 * `GET /api/events` already answers with the lunar summary, the anchor, the
 * village's `moonOneCycle` and the events window. Every number this dock
 * prints comes from there, so the dock and the Events page can never disagree
 * about which moon it is. A new endpoint would have been a second opinion.
 *
 * ── IT DISAPPEARS RATHER THAN GUESSES ────────────────────────────────────
 *
 * A village with the events module off gets a refusal from that endpoint, and
 * this renders nothing at all. Same for a village that has not anchored its
 * count: `moonCountLabel` answers with an empty string on purpose, and the
 * dock prints the phase and the window with no number rather than inventing a
 * "Moon 0". Deciding to render nothing is the whole failure path here; there
 * is no error state, because a corner ornament that shouts about a fetch is
 * worse than a corner with nothing in it.
 *
 * ── MOTION, AND WHO ASKED FOR IT ─────────────────────────────────────────
 *
 * The moon breathes: a slow scale, twenty seconds a cycle. A member who asked
 * for reduced motion gets the same moon, still. Not the same animation at 1ms,
 * which lands on an arbitrary frame; the composition without the motion.
 *
 * ── WHERE IT SITS, AND WHY THAT DIFFERS ON A PHONE ───────────────────────
 *
 * Bottom right on a wide screen. On a phone that corner is already taken: the
 * shortcuts FAB is there, and the tab bar owns the bottom edge. A QA pass at a
 * real 390px viewport showed the dock hidden entirely below `sm`, which made
 * the whole feature desktop-only for the members most likely to want a glance
 * at the moon.
 *
 * So on a phone it moves to the bottom LEFT and lifts clear of the tab bar,
 * and the panel opens from that side. Same control, same name, one corner
 * over, and the same SIZE as the FAB so the two read as a pair.
 *
 * The offset is copied from MobileFab deliberately, expression and all:
 * `max(calc(env(safe-area-inset-bottom, 0px) + 3.5rem), 3.5rem)`. A plain
 * `bottom-20` measured right on the test device and would have drifted into
 * the tab bar on a notched phone, because the bar grows by the inset and a
 * fixed rem does not. Sharing the expression means the safe area cancels on
 * both and they stay level on every device.
 *
 * ── REACHABLE WITHOUT A MOUSE ────────────────────────────────────────────
 *
 * The dock is a `<button>` with an accessible name that says the phase and the
 * moon, the panel is a labelled dialog, Escape closes it, and focus returns to
 * the button that opened it. A pointer-only ornament in a fixed corner is the
 * easiest thing in a page to leave unreachable, so it is tested rather than
 * assumed (`MoonDock.test.tsx`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, X } from "lucide-react";

import MoonGlyph from "@/components/calendar/MoonGlyph";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { gameFetch } from "@/lib/gameApi";
import type { CalendarItem, LunarSummary } from "@shared/gatherings";
import { formatMoonWindow, moonCountLabel } from "@shared/villageMoon";

interface EventsAnswer {
  events?: CalendarItem[];
  lunar?: LunarSummary | null;
  timezone?: string;
  hemisphere?: "north" | "south";
  moonOneCycle?: number | null;
}

/** Events inside this lunation, soonest first. */
function thisMoon(events: CalendarItem[], lunar: LunarSummary): CalendarItem[] {
  const from = new Date(lunar.monthStartsAt).getTime();
  const to = new Date(lunar.monthEndsAt).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  return events
    .filter((e) => {
      const at = new Date(e.startsAt).getTime();
      return Number.isFinite(at) && at >= from && at < to;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export default function MoonDock() {
  const [answer, setAnswer] = useState<EventsAnswer | null>(null);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await gameFetch("/api/events");
        if (!res.ok) return; // module off, or not open to this member: show nothing
        const body = (await res.json()) as EventsAnswer;
        if (alive) setAnswer(body);
      } catch {
        /* the corner stays empty */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, close]);

  const lunar = answer?.lunar ?? null;
  if (!lunar) return null;

  const count = moonCountLabel(lunar.cycleNumber, answer?.moonOneCycle ?? null);
  const window_ = formatMoonWindow(lunar.monthStartsAt, lunar.monthEndsAt);
  const upcoming = thisMoon(answer?.events ?? [], lunar);
  // The number goes first when the village has one, because that is the thing
  // a member is orienting by; the phase carries the rest.
  const name = [count, lunar.phaseName].filter(Boolean).join(", ");

  const dateOf = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: answer?.timezone || undefined,
      }).format(new Date(iso));
    } catch {
      return "";
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden={false}>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-label={`${name}. This moon's calendar.`}
          style={{ bottom: "max(calc(env(safe-area-inset-bottom, 0px) + 9rem), 9rem)" }}
          className="pointer-events-auto absolute left-4 right-4 max-h-[55vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl sm:left-auto sm:right-6 sm:w-80"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-lg font-bold text-card-foreground">{count || lunar.phaseName}</p>
              {window_ && <p className="text-xs text-muted-foreground">{window_}</p>}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close the moon calendar"
              className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-card-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            {lunar.phaseName}, day {lunar.day} of {lunar.length}.
          </p>

          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing is on the calendar this moon yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-notice" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-card-foreground">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{dateOf(e.startsAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <motion.button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${name}. ${open ? "Hide" : "Show"} this moon's calendar.`}
        // The breath, and the still version for anyone who asked for one.
        animate={reduced ? undefined : { scale: [1, 1.045, 1] }}
        transition={reduced ? undefined : { duration: 20, repeat: Infinity, ease: "easeInOut" }}
        style={{ bottom: "max(calc(env(safe-area-inset-bottom, 0px) + 3.5rem), 3.5rem)" }}
        className="pointer-events-auto absolute left-4 inline-flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card shadow-lg hover:border-notice sm:left-auto sm:right-6 sm:h-16 sm:w-16"
      >
        <MoonGlyph phase={lunar.phase} size={38} hemisphere={answer?.hemisphere ?? "north"} />
      </motion.button>
    </div>
  );
}
