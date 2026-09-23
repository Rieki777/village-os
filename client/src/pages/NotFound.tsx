/**
 * The soft 404. Copy pass R5, group 5: the one page that had no village
 * voice (census 2.12, worst offender 9) now speaks it - plainly first, the
 * land metaphor second, and a short way home. The semantics are unchanged:
 * this renders wherever an unknown route lands, no redirect, no server 404.
 */
import { Compass, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-b from-teal-deep/10 to-background px-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-lg p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-amber/15 flex items-center justify-center">
            <Compass className="w-8 h-8 text-teal-deep" aria-hidden="true" />
          </div>
        </div>

        <p className="text-sm font-semibold tracking-widest text-muted-foreground mb-2">404</p>

        <h1 className="font-display text-3xl font-bold text-foreground mb-4">
          Off the trail
        </h1>

        <p className="text-muted-foreground mb-8 leading-relaxed">
          There is no page at this address. It may have moved, or it may never
          have existed. The land is still here, and the way home is short.
        </p>

        <button
          onClick={() => setLocation("/")}
          className="inline-flex items-center gap-2 min-h-[44px] px-6 rounded-lg bg-teal-deep text-white font-semibold hover:bg-teal-deep-dark"
        >
          <Home className="w-4 h-4" aria-hidden="true" />
          Back to the village
        </button>
      </div>
    </div>
  );
}
