/**
 * WHERE YOU STAND, WITH BREADTH FIRST.
 *
 * The order of these three figures is the whole argument. The obvious headline
 * is how much you have received, and it is the wrong one: it is the number an
 * alt farm can move, and leading with it teaches the village to chase a pile.
 *
 * `distinctAcknowledgers` is the one the economy actually pays on. The server's
 * own comment in `settleCycle` puts it better than this one can: ten
 * acknowledgments from one person is a friendship, ten from ten people is a
 * reputation. It is Sybil-filtered, it decides a share of the value pool at
 * settlement, and it is the figure the founders carry to Hypha. So it goes
 * first, at the largest size, and the totals sit beside it as context.
 *
 * ── NOTHING HERE IS A RANK ───────────────────────────────────────────────
 *
 * These are facts about the member reading them and nobody else. A live
 * leaderboard was considered for this surface and refused: ranking members by
 * recognition received turns a gift economy into a scoreboard and creates
 * exactly the farming incentive the Sybil filter exists to defeat. The filter
 * guards the arithmetic; nothing guards the culture but decisions like this
 * one. Per-moon settlement history is accountability and lives in `MoonsPast`.
 *
 * ── AND NOTHING HERE IS A FORECAST ───────────────────────────────────────
 *
 * There is deliberately no "your share is worth about N". The pool splits
 * pro-rata by eligible recognition and every send anybody makes moves it, so
 * that figure would be wrong almost every time it was read, and settlement
 * produces the honest version on its own. What happened is shown; what might
 * happen is not.
 *
 * ── UNKNOWN IS NOT ZERO ──────────────────────────────────────────────────
 *
 * Null until the read lands and null renders nothing. A zero standing shown to
 * a member who has been thanked forty times is a claim about them, not a gap.
 */
import { useEffect, useState } from "react";

import { gameFetch } from "@/lib/gameApi";

interface Flows {
  totals?: { received?: number; sent?: number; distinctAcknowledgers?: number };
}

export default function YourStanding({ currency }: { currency: string }) {
  const [flows, setFlows] = useState<Flows | null>(null);

  useEffect(() => {
    let alive = true;
    gameFetch("/api/game/gratitude/flows")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setFlows(d as Flows); })
      .catch(() => { /* the panel stays away rather than showing a zero */ });
    return () => { alive = false; };
  }, []);

  const t = flows?.totals;
  if (!t) return null;

  const people = Number(t.distinctAcknowledgers ?? 0);
  const received = Number(t.received ?? 0);
  const sent = Number(t.sent ?? 0);

  // A member with nothing in any direction gets no panel at all.
  if (people === 0 && received === 0 && sent === 0) return null;

  /**
   * A ZERO IS NOT A HEADLINE.
   *
   * Found by reading the real page: a member who had given generously and been
   * thanked by nobody yet met a 48px "0" followed by a sentence explaining what
   * a reputation is. Technically every figure was correct and the effect was to
   * lecture somebody about breadth at the exact moment they had none, on a page
   * about gratitude.
   *
   * So the zero case leads with what they have actually DONE. It is the same
   * data, and being told "you have thanked eleven people" is true, useful, and
   * not a scolding. The reputation sentence goes with the number it is about
   * and appears once that number exists.
   */
  const nobodyYet = people === 0;

  return (
    <section
      aria-labelledby="standing-h"
      className="mb-10 rounded-2xl border border-border bg-card p-6 shadow-sm"
    >
      <h2 id="standing-h" className="font-display text-xl font-bold text-card-foreground">
        Where you stand
      </h2>

      {nobodyYet ? (
        <p className="mt-4 max-w-prose text-muted-foreground">
          Nobody has named you on the wall yet. What you have given is below, and it
          counts for the people who received it whether or not it comes back.
        </p>
      ) : (
        <>
          <p className="mt-4 font-display text-4xl text-notice">
            <span className="sr-only">People who have thanked you: </span>
            {people}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {people === 1
              ? "person has thanked you. Ten thanks from one person is a friendship; ten from ten people is a reputation, and this is the number the village settles on."
              : "people have thanked you. Ten thanks from one person is a friendship; ten from ten people is a reputation, and this is the number the village settles on."}
          </p>
        </>
      )}

      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground">{currency} received</dt>
          <dd className="font-display text-lg text-card-foreground">{received}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Given to others</dt>
          <dd className="font-display text-lg text-card-foreground">{sent}</dd>
        </div>
      </dl>
    </section>
  );
}
