/**
 * Seasonal Festivals (MF11, Wave 1): the page two live surfaces already
 * linked to — the Journey tracker and the Tools hub — that never existed.
 * A dead link from your own onboarding content is a small broken promise;
 * this keeps it: the village's season calendar, live from /api/season,
 * with the rhythm each season carries.
 */
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useModule } from "@/modules/ModuleProvider";
import { CalendarDays, Sparkles } from "lucide-react";
import { useBrochurePages } from "@/lib/brochure";

export default function SeasonalFestivals() {
  const brochureOn = useBrochurePages() === true;
  const [season, setSeason] = useState<any>(null);
  /**
   * The calendar is the other half of this page: seasons say WHEN the year
   * turns, the calendar says what is dated inside them. Gated, because the
   * events module ships off and its page renders NotFound until a village
   * turns it on.
   */
  const eventsModule = useModule("events");

  useEffect(() => {
    fetch("/api/season").then((r) => (r.ok ? r.json() : null)).then(setSeason).catch(() => {});
  }, []);

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  /**
   * A season's dates. `endsOn` is allowed to be EMPTY, which means open-ended:
   * it runs until somebody starts the next one, which is what a founding
   * season does. Formatting that empty string produced "Invalid Date" on the
   * page, so say the true thing instead.
   */
  const span = (s: any) =>
    s.endsOn ? `${fmt(s.startsOn)} to ${fmt(s.endsOn)}` : `${fmt(s.startsOn)} onward, until the next season starts`;

  const currentGoals = ((season?.current?.goals ?? []) as any[]).filter((g) => String(g?.text ?? "").trim());

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Seasonal Festivals</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            The village moves in seasons, each with its own energy, and each
            turned with a gathering. Festivals are how a season is opened,
            honored, and handed to the next.
          </p>
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-2xl space-y-4">
          {season?.current && (
            <div className="bg-card border border-teal-deep/30 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-teal-deep" />
                <p className="text-xs font-semibold uppercase tracking-widest text-teal-deep">Now</p>
              </div>
              <p className="font-display text-xl font-bold text-foreground">{season.current.name}</p>
              {/*
                * `focus` is the season's description. This read `season.current.goal`
                * for its whole life, a key SeasonEntry has never had (the fields are
                * theme, focus, and goals[]), so the line silently never rendered. The
                * page types the payload as `any`, which is why tsc never said so.
                */}
              {season.current.focus && (
                <p className="text-sm text-muted-foreground mt-1">{season.current.focus}</p>
              )}
              {currentGoals.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {currentGoals.map((g: any, i: number) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      {g.done ? "Done: " : ""}{g.text}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground mt-2">{span(season.current)}</p>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-teal-deep" />
              <p className="font-semibold text-foreground text-sm">The year's turning</p>
            </div>
            {/*
              * Filtered on `startsOn` alone. Requiring `endsOn` too dropped every
              * open-ended season, which is exactly what a founding season is, so
              * the village that had only ever declared one was told its calendar
              * "hasn't been set yet".
              */}
            {(season?.seasons ?? []).filter((s: any) => s.startsOn).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The season calendar hasn't been set yet. It lives with the stewards.
              </p>
            ) : (
              <ul className="space-y-3">
                {(season?.seasons ?? [])
                  .filter((s: any) => s.startsOn)
                  .sort((a: any, b: any) => a.startsOn.localeCompare(b.startsOn))
                  .map((s: any) => (
                    <li key={s.id ?? s.name} className="border border-border rounded-lg px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{s.name}</p>
                      {s.focus && <p className="text-xs text-muted-foreground mt-0.5">{s.focus}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{span(s)}</p>
                    </li>
                  ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-4">
              Festival dates ride the season turnings above. To take part in
              shaping one, start at{" "}
              <Link href="/quests" className="text-teal-deep font-medium hover:underline">Quests</Link>
              {brochureOn ? (
                <>
                  {" "}or say hello through{" "}
                  <Link href="/work-with-us" className="text-teal-deep font-medium hover:underline">Work With Us</Link>
                </>
              ) : null}
              .
              {eventsModule && (
                <>
                  {" "}Everything already dated sits on the{" "}
                  <Link href="/events" className="text-teal-deep font-medium hover:underline">Village Calendar</Link>.
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
