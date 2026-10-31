/**
 * THE PROMPT AFTER A SEASON TURNS (idea 4).
 *
 * On a member's first visit after the turn, wherever they land, a small card
 * says the season has turned and opens their summary on the profile. Shown
 * once per season per browser (./seen.ts), and only within `OFFER_DAYS` of the
 * turn, so a member who comes back months later is not greeted with old news.
 *
 * It waits a moment before asking, so the page the member came for paints
 * first, and asks at most once per browser session. Never on the profile
 * itself, where the summary already sits.
 *
 * IT TAKES ITS TURN (../../lib/onceDialogs.ts). Pay landing goes first: while
 * the reward moment is deciding or open, this waits, and it opens a breath
 * after that one is closed. The one ask per session is spent only once the
 * card is actually on screen, so a reload while it waits brings it back.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Sparkles, X } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { useAuth } from "@/contexts/AuthContext";
import type { SeasonSummary } from "@shared/seasonSummary";
import { useFloorFree } from "@/lib/onceDialogs";
import { markSeasonSeen, shouldOffer } from "./seen";

const ASKED = "season-summary-asked";
const WAIT_MS = 2500;
/** The breath between one once dialog closing and this one opening. */
const GAP_MS = 600;

function markAsked(userId: string) {
  try {
    sessionStorage.setItem(ASKED, userId);
  } catch {
    /* ignore */
  }
}

export default function SeasonSummaryOffer() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [offer, setOffer] = useState<SeasonSummary | null>(null);
  const userId = user ? String(user.id) : "";
  const free = useFloorFree("season");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) return;
    try {
      if (sessionStorage.getItem(ASKED) === userId) return;
    } catch {
      /* no session storage: ask anyway */
    }
    let live = true;
    const timer = setTimeout(() => {
      const t = authToken();
      fetch("/api/me/season-summary", { headers: t ? { Authorization: `Bearer ${t}` } : {} })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const s: SeasonSummary | null = d?.summary ?? null;
          if (!live) return;
          if (shouldOffer(s, userId)) setOffer(s);
          else markAsked(userId);
        })
        .catch(() => undefined);
    }, WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [userId]);

  useEffect(() => {
    setReady(false);
    if (!offer || !free) return;
    const t = setTimeout(() => setReady(true), GAP_MS);
    return () => clearTimeout(t);
  }, [offer, free]);

  const visible = !!offer && free && ready && !location.startsWith("/profile");
  useEffect(() => {
    if (visible) markAsked(userId);
  }, [visible, userId]);

  if (!offer || !visible) return null;
  const done = () => {
    markSeasonSeen(userId, offer.season.id);
    setOffer(null);
  };

  return (
    <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm sm:right-6 sm:left-auto sm:mx-0">
      <div role="dialog" aria-labelledby="season-offer-title" className="sheet-night rounded-2xl border border-notice bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <p id="season-offer-title" className="font-display text-xl">{offer.season.name} has turned</p>
            <p className="text-sm text-muted-foreground">What you earned, what you carried and your badges, on one card you can share.</p>
          </div>
          <button type="button" onClick={done} aria-label="Not now" className="-m-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <Link
          href="/profile#season-summary"
          onClick={done}
          className="mt-4 flex min-h-11 items-center justify-center rounded-full bg-notice px-5 text-sm font-semibold text-background"
        >
          See my season
        </Link>
      </div>
    </div>
  );
}
