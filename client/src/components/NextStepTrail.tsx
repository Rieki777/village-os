/**
 * The Trail (R47): a member's one next step, under the header on every page.
 *
 * The server already works the step out (`nextActions` in
 * shared/gameConfig.ts, served as `me.nextAction`), and until now only the
 * profile showed it, so a member had to go looking for the thing whose whole
 * job is to tell them where to go. The games this model is drawn from keep the
 * objective on screen at all times; this is that line.
 *
 * QUIET WHERE IT WOULD REPEAT ITSELF. It stays away from the profile, which
 * draws the same step as a full card, from the doors (sign in, join, set a
 * password), from the team's own rooms, and from the page the step points at:
 * a "Go" that goes nowhere is noise.
 *
 * ONE READ PER HALF MINUTE. Every page mounts its own Layout, so without the
 * cache each click would ask `/api/game/me` again. A profile change (a quest
 * turned in, a stage reached) clears it, because that is exactly when the
 * next step moves.
 *
 * Hiding is per step and per tab: a member who closes "Sign the Love Letter"
 * still sees "Claim your first quest" when that becomes the step.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Compass, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchGameMe } from "@/lib/gameApi";
import { onProfileRefresh } from "@/lib/profileRefresh";

type Step = { label: string; href: string };

const TTL_MS = 30_000;
let cache: { at: number; step: Step | null } | null = null;

/** Exported for tests, so one test's cached step never leaks into the next. */
export function clearTrailCache(): void {
  cache = null;
}

const HIDDEN_KEY = "village.trail.hidden";

const QUIET_EXACT = new Set(["/profile", "/login", "/register", "/forgot-password", "/set-password"]);
const QUIET_PREFIX = ["/admin", "/project-history", "/journey-to-launch", "/claim"];

export function isQuietPath(path: string, stepHref?: string): boolean {
  const bare = path.split(/[?#]/)[0] || "/";
  if (QUIET_EXACT.has(bare)) return true;
  if (QUIET_PREFIX.some((p) => bare === p || bare.startsWith(`${p}/`))) return true;
  if (stepHref && stepHref.split(/[?#]/)[0] === bare) return true;
  return false;
}

function readHidden(): string | null {
  try {
    return window.sessionStorage.getItem(HIDDEN_KEY);
  } catch {
    return null;
  }
}

function writeHidden(label: string): void {
  try {
    window.sessionStorage.setItem(HIDDEN_KEY, label);
  } catch {
    /* private browsing: closing simply lasts until the next page */
  }
}

export default function NextStepTrail() {
  const { user } = useAuth();
  const [location] = useLocation();
  const [step, setStep] = useState<Step | null>(() =>
    cache && Date.now() - cache.at < TTL_MS ? cache.step : null,
  );
  const [hidden, setHidden] = useState<string | null>(() => readHidden());

  useEffect(() => {
    if (!user) return;
    let live = true;
    const load = (force: boolean) => {
      if (!force && cache && Date.now() - cache.at < TTL_MS) {
        setStep(cache.step);
        return;
      }
      fetchGameMe().then((me) => {
        const next = me?.nextAction ? { label: me.nextAction.label, href: me.nextAction.href } : null;
        cache = { at: Date.now(), step: next };
        if (live) setStep(next);
      });
    };
    load(false);
    const off = onProfileRefresh(() => {
      cache = null;
      load(true);
    });
    return () => {
      live = false;
      off();
    };
  }, [user]);

  if (!user || !step || hidden === step.label || isQuietPath(location, step.href)) return null;

  return (
    <aside aria-label="Your next step" className="border-b border-notice/30 bg-notice/10">
      <div className="container flex items-center gap-3 py-2">
        <Compass className="h-4 w-4 shrink-0 text-notice" aria-hidden="true" />
        <p className="shrink-0 text-xs font-semibold uppercase tracking-widest text-foreground">Next</p>
        <Link
          href={step.href}
          className="group flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm font-medium text-foreground md:min-h-0"
        >
          <span className="min-w-0 group-hover:underline">{step.label}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-notice transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={() => {
            writeHidden(step.label);
            setHidden(step.label);
          }}
          aria-label="Hide your next step"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground md:min-h-0 md:min-w-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
