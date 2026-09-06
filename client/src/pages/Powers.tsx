/**
 * THE POWERS THIS VILLAGE HAS, AND WHO LOOKS AFTER EACH ONE (0098).
 *
 * R54: these villages are meant to be taken over by their electorate, so the
 * admin panel is scaffolding to be dismantled. A member could never see what
 * the scaffolding was holding. The one explainer that existed answered "can
 * this person moderate?" to an admin, for one member at a time, and there was
 * no way at all to ask "who moderates here?".
 *
 * ── THE RULES FOR THIS SURFACE, WHICH ARE NOT NEGOTIABLE (R55) ─────────────
 *
 * The handover is a journey to celebrate and never a scorecard to fail. A
 * village holding two powers is young, and a village holding all of them is
 * older. This page has to feel good to both, so:
 *
 *  - No fraction, no denominator, no total, no percentage, no progress bar.
 *  - No count of anything, anywhere, including a quiet "3 powers held".
 *  - NEVER sorted or grouped by held and unheld. That single choice draws a
 *    completion bar out of a plain list, and it is one careless afternoon
 *    away at all times. The order comes from the server's registry and it is
 *    the same order for every village on earth.
 *  - No phase label computed from how many are held. Seed, sprout and rooted
 *    tree may describe ONE power's journey; a village's aggregate phase is
 *    percentage-incomplete with nicer nouns.
 *  - No date on a crossing. A crossing has a date and it belongs on the
 *    decision's own record, where it is a story. Here it would be the only
 *    number on the page, and a column of dates is a timeline somebody reads
 *    as a pace.
 *
 * The layout renders identically for a village holding none of these and a
 * village holding every one. Same cards, same order, same tone, different
 * sentence in one place.
 *
 * `client/src/lib/powersCopy.test.ts` reads this file and asserts it carries
 * no percent sign, no "N of M", and no progress component, so a later
 * afternoon cannot quietly add one. The sentences themselves live in
 * `powersCopy.ts` so they are testable without a browser (this repo's client
 * tests are pure logic; there is no jsdom).
 */
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken, useCatalyst } from "@/lib/gameApi";
import { KeyRound } from "lucide-react";
import { holderSentence, type PowerRow } from "@/lib/powersCopy";

export default function Powers() {
  const { user } = useAuth();
  // The word only. Reaching past a power the village holds is still the same
  // act by the same people, and it still writes the same line on the feed.
  const catalyst = useCatalyst();
  const [powers, setPowers] = useState<PowerRow[] | null>(null);

  useEffect(() => {
    const token = authToken();
    if (!token) return;
    fetch("/api/village/powers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPowers(d?.powers ?? []))
      .catch(() => setPowers([]));
  }, [user?.id]);

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">
            What this village looks after
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Every power here has a place it lives. Some of them sit with the admin
            panel, which is how a village starts. Some of them the village has taken
            on. This page says which is which, and who to ask.
          </p>
        </div>
      </section>

      <section className="py-10">
        <div className="container max-w-3xl">
          {!user && (
            <p className="text-muted-foreground">
              Sign in to see who looks after what here.
            </p>
          )}

          {user && powers === null && (
            <p className="text-muted-foreground">Reading the village's own record.</p>
          )}

          {user && powers !== null && (
            <ul className="space-y-4" data-testid="powers-list">
              {powers.map((p) => (
                <li
                  key={p.capability}
                  className="rounded-xl border border-border bg-card p-5"
                  data-testid={`power-${p.capability}`}
                >
                  <div className="flex items-start gap-3">
                    <KeyRound className="h-5 w-5 mt-1 text-muted-foreground shrink-0" aria-hidden />
                    <div>
                      <h2 className="font-display text-lg font-semibold text-foreground">{p.title}</h2>
                      <p className="text-sm text-muted-foreground mt-1">{p.surface}.</p>
                      <p className="text-sm text-foreground mt-2">
                        Whoever holds this can {p.consequence}.
                      </p>
                      <p className="text-sm text-foreground/80 mt-2">{holderSentence(p)}</p>
                      {p.heldBy?.byBallot && (
                        <p className="text-sm text-teal-deep mt-1">The village voted this one across.</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {user && powers !== null && (
            <div className="mt-10 rounded-xl border border-border bg-muted/30 p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">How a power moves</h2>
              <p className="text-sm text-muted-foreground mt-2">
                A power moves in two steps, and the order matters. First a role is
                given the power, so there is somebody who can act. Then the village
                takes it on, and from that day the admin panel stops being the
                answer: whoever sits in that role acts on their own account.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {catalyst.aNameCap} can still reach past a power the village holds, on a day
                something has gone wrong. Doing it writes a line on the village's own
                feed naming the power and the person, and it tells whoever holds it.
                That is the whole of the arrangement: the way back exists, and the
                village sees it used.
              </p>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
