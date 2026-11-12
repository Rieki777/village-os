/**
 * THE COMMONS ON THE PUBLIC LANDING (Phase D, decision 2: "the public pulse
 * becomes the commons").
 *
 * This used to be the Village Pulse, a feed of happenings read from
 * `GET /api/game/pulse`: lines such as who joined or who finished a quest,
 * shown to anybody who opened the landing page. A visitor never sees a
 * member's name or a personal count, so the landing no longer reads that
 * feed at all. It draws this season's goals as circles where moss spreads
 * into each goal the village has reached, and the only number on it is the
 * village's own: how many of the season's goals we have reached.
 *
 * It reads the live season (`useSeason`, the one cached read every page
 * shares) and nothing else. No current season, or one with no goals, draws
 * nothing, the way the pulse drew nothing when it had nothing to say.
 *
 * Drawn in the night world: the landing's one window onto the sheet. Phone
 * and desktop are each laid out on purpose in CommonsPanel.
 */
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useSeason } from "@/lib/gameApi";
import { seasonView } from "@shared/seasonGoalsView";
import { BTN_SECONDARY, EYEBROW, HINT, LEDE } from "@/components/journey/look";
import CommonsPanel from "@/components/commons/CommonsPanel";

export default function VillagePulse() {
  const { t } = useLingui();
  const season = useSeason();
  const view = seasonView(season);
  if (!view || !view.goals.length) return null;
  const { name, dates, goals } = view;

  return (
    <section aria-labelledby="commons-h" className="sheet-night relative bg-background py-14 sm:py-20" data-testid="landing-commons">
      <div className="container mx-auto max-w-6xl px-4">
        <CommonsPanel
          goals={goals}
          head={
            <>
              <p className={EYEBROW}>{t({ message: "What we tend together", context: "landing commons eyebrow" })}</p>
              <h2 id="commons-h" className="mt-3 font-display text-3xl leading-tight text-foreground text-balance sm:text-4xl">
                {t({ message: "The commons", context: "landing commons heading" })}
              </h2>
              {(name || dates) && (
                <p className={`mt-2 ${HINT}`}>
                  {[name, dates].filter(Boolean).join(". ")}
                </p>
              )}
              <p className={`mt-4 ${LEDE}`}>
                {t({
                  message: "This season's goals, held by the whole village. Each circle is one goal, and moss spreads into it when we reach it together.",
                  context: "landing commons lede",
                })}
              </p>
            </>
          }
          door={
            <Link href="/roles" className={BTN_SECONDARY}>
              {t({ message: "See the roles that tend these goals", context: "landing commons door" })}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        />
      </div>
    </section>
  );
}
