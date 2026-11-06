/**
 * A REWARD MOMENT EACH TIME SOMETHING LANDS (0294).
 *
 * Rye, 2026-10-30, earnings idea 1. When a member opens the app after tokens,
 * Voice or a cash payment arrived for them, this names what came in and what
 * it was for, once. The server decides what is new and remembers what was
 * shown (server/lib/rewardMoment.ts), so a phone and a laptop never both
 * play it.
 *
 * ONE MOMENT, NEVER A QUEUE. Everything that landed since the last look comes
 * back as one payload and is shown as one card, a line per piece of work.
 *
 * THE SAME GLOW AS A STAGE REACHED. The approved profile design draws the
 * stage ceremony on a dark forest ground with a gold halo and gold sparks;
 * this card is that ceremony at the size of a dialog. Every colour is a
 * `var(--reward-*, fallback)`, so a village can retone it and the theme guard
 * reads it as the token pattern it is.
 *
 * STILL FORM AND A LIVE REGION, as every celebration has. `Celebration` draws
 * its settled composition under reduce-motion, and it announces every line
 * through its own status region. The words on the card carry the same news,
 * so the moment lands whether or not anyone sees the drawing.
 *
 * `moment` INTENSITY, which is rationed. This is the end of a piece of work
 * (docs/modules/natural-interface.md has it in the ration's table), and it
 * fires at most once per arrival, ever.
 *
 * A MEMBER WHO TURNED CELEBRATIONS OFF on their profile sees nothing: the
 * arrivals are marked seen in silence, and the bell still holds the news.
 */
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import Celebration from "@/components/natural/Celebration";
import { authToken } from "@/lib/gameApi";
import { holdFloor } from "@/lib/onceDialogs";
import { formatMoney } from "@shared/money";
import type { RewardMomentView } from "@shared/rewardMoment";
import { rewardAnnouncement, rewardHeadline, rewardSentence } from "@/lib/rewardMoment";

const GOLD = "var(--reward-gold, #f3d891)";
const GOLD_INK = "var(--reward-gold-ink, #e3c26f)";
const CREAM = "var(--reward-cream, #efe8d6)";
const MIST = "var(--reward-mist, #d6dcd3)";
const PANEL = "var(--reward-panel, #15221c)";
const PANEL_EDGE = "var(--reward-panel-edge, #8a7334)";
const GROUND =
  "radial-gradient(circle at 50% 30%, var(--reward-ground-1, #2a3a22) 0%, var(--reward-ground-2, #0e1814) 55%, var(--reward-ground-3, #070d0a) 100%)";

/* The approved design's sparks, scattered by the same arithmetic so the card
   reads as the same night sky. Decorative and still. */
const SPARKS = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 41) % 96}%`,
  top: `${(i * 29) % 92}%`,
  size: i % 5 === 0 ? 5 : 3,
  opacity: 0.2 + (i % 5) * 0.14,
}));

async function send(path: string, init?: RequestInit): Promise<any> {
  const token = authToken();
  if (!token) return null;
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  return res.ok ? res.json() : null;
}

export default function RewardMoment() {
  const [view, setView] = useState<RewardMomentView | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Pay goes first: the floor is held from the first look until the moment
  // turns out empty or is closed, so no other once dialog opens over it.
  const release = useRef<() => void>(() => undefined);
  const shown = useRef(false);

  useEffect(() => {
    let alive = true;
    release.current = holdFloor("reward");
    (async () => {
      try {
        const moment: RewardMomentView | null = await send("/api/me/reward-moment");
        if (!alive || !moment?.lines?.length) return;
        const prefs = await send("/api/profile/prefs").catch(() => null);
        if (!alive) return;
        // Shown is seen, on every device, from the moment it is on screen.
        void send("/api/me/reward-moment/seen", { method: "POST", body: JSON.stringify({ keys: moment.keys }) }).catch(() => null);
        if (prefs?.notify?.celebrations === "off") return;
        shown.current = true;
        setView(moment);
      } catch {
        // A moment that cannot load is a moment that did not happen. The bell still has the news.
      }
    })().then(() => {
      if (alive && !shown.current) release.current();
    });
    return () => {
      alive = false;
      release.current();
    };
  }, []);

  // Closed: the next once dialog may have the floor.
  useEffect(() => {
    if (!view && shown.current) release.current();
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [view]);

  if (!view) return null;
  const close = () => setView(null);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "var(--reward-scrim, rgba(7, 13, 10, 0.72))" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md overflow-hidden rounded-3xl px-6 pb-6 pt-8 text-center"
        style={{ background: GROUND, color: CREAM, boxShadow: "0 0 60px var(--reward-glow-soft, rgba(243, 216, 145, 0.18))" }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {SPARKS.map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{ left: s.left, top: s.top, width: s.size, height: s.size, opacity: s.opacity, background: GOLD, boxShadow: `0 0 8px ${GOLD}` }}
            />
          ))}
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-2 top-2 rounded-full p-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          style={{ color: MIST }}
        >
          <X className="h-4 w-4" />
        </button>

        <p className="relative text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: GOLD_INK }}>
          Just landed
        </p>

        <div
          className="relative mx-auto mt-4 flex h-32 w-32 items-center justify-center rounded-full p-1.5"
          style={{ background: GOLD, boxShadow: "0 0 60px var(--reward-glow, rgba(243, 216, 145, 0.55))" }}
        >
          <span
            className="flex h-full w-full items-center justify-center rounded-full"
            style={{ background: "radial-gradient(circle at 50% 35%, var(--reward-core-1, #1f3326), var(--reward-core-2, #0e1814))" }}
          >
            <Celebration kind="seeds" intensity="moment" size={92} seed={view.keys.length} message={rewardAnnouncement(view)} />
          </span>
        </div>

        <h2 id={titleId} className="relative mt-5 font-display text-2xl font-semibold leading-snug">
          {rewardHeadline(view)}
        </h2>

        {view.lines.length > 1 && (
          <ul className="relative mt-4 space-y-2 text-left">
            {view.lines.map((line, i) => (
              <li
                key={i}
                className="rounded-2xl border px-4 py-3 text-sm"
                style={{ background: PANEL, borderColor: PANEL_EDGE, boxShadow: "0 0 30px var(--reward-glow-faint, rgba(217, 180, 90, 0.15))" }}
              >
                {rewardSentence(line)}.
                {line.kind === "cash_paid" && (
                  <span className="mt-0.5 block text-xs" style={{ color: GOLD_INK }}>
                    {formatMoney(line.amountMinor, line.currency)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {view.lines.length === 1 && view.lines[0].kind === "cash_paid" && (
          <p className="relative mt-2 text-sm" style={{ color: GOLD_INK }}>
            {formatMoney(view.lines[0].amountMinor, view.lines[0].currency)}
          </p>
        )}

        <button
          type="button"
          onClick={close}
          className="relative mt-6 min-h-11 rounded-2xl px-7 text-base font-semibold"
          style={{ background: "var(--reward-button, #d9b45a)", color: "var(--reward-button-ink, #1a1408)" }}
        >
          Thank you
        </button>
      </div>
    </div>
  );
}
