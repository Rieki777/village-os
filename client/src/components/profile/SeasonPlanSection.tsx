/**
 * THE `season` SECTION OF A PROFILE (season plans RC1), in the "now" band.
 *
 * On your own profile: where your season stands, and the door to plan it.
 * On another member's: their filed plan, as the village page draws it, for a
 * reader holding terms.read. Anybody else is answered 401 by the server, and
 * this section then renders nothing at all: an absent plan says nothing.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarDays } from "lucide-react";
import PlanCard from "@/components/seasonPlans/PlanCard";
import { fetchMine, fetchVillage, type MinePayload, type PlanCard as PlanCardData } from "@/components/seasonPlans/seasonPlansApi";
import { civilDayWords } from "@shared/seasonPlans";

export const SEASON_SECTION_WORDS = {
  heading: "Your season",
  theirs: "Their season",
  plan: "Plan your season",
  read: "Read your season",
  filedOn: (on: string) => `Filed on ${civilDayWords(on)}.`,
  notFiled: "Not filed yet.",
  openUntil: (on: string) => `Planning is open until ${civilDayWords(on)}.`,
} as const;

function Own() {
  const [mine, setMine] = useState<MinePayload | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchMine().then((a) => {
      if (alive && a.ok && a.data && typeof a.data === "object") setMine(a.data);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!mine?.season) return null;
  const filed = mine.filed?.filedOn ?? null;
  return (
    <section aria-labelledby="sheet-season-h" className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold text-teal-deep">{mine.season.name}</p>
      <h2 id="sheet-season-h" className="mt-1 font-display text-2xl font-bold text-card-foreground">
        {SEASON_SECTION_WORDS.heading}
      </h2>
      <p className="mt-2 text-foreground">
        {filed ? SEASON_SECTION_WORDS.filedOn(filed) : SEASON_SECTION_WORDS.notFiled}
        {!filed && mine.window?.state === "open" ? ` ${SEASON_SECTION_WORDS.openUntil(mine.window.closesOn)}` : ""}
      </p>
      {mine.plan?.aim && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{mine.plan.aim}</p>}
      <Link
        href="/season-plans/mine"
        className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        {filed ? SEASON_SECTION_WORDS.read : SEASON_SECTION_WORDS.plan}
      </Link>
    </section>
  );
}

function Theirs({ handle }: { handle: string }) {
  const [card, setCard] = useState<PlanCardData | null>(null);
  useEffect(() => {
    let alive = true;
    setCard(null);
    void fetchVillage(handle).then((a) => {
      // Only a roster answer draws: anything else, or nobody in it, is nothing to say.
      if (alive && a.ok) setCard(Array.isArray(a.data?.people) ? (a.data.people[0] ?? null) : null);
    });
    return () => {
      alive = false;
    };
  }, [handle]);
  if (!card) return null;
  return (
    <section aria-label={SEASON_SECTION_WORDS.theirs}>
      <PlanCard card={card} headingLevel={2} />
    </section>
  );
}

/** `handle` names another member; without it, the section is the reader's own. */
export default function SeasonPlanSection({ handle }: { handle?: string | null }) {
  return handle ? <Theirs handle={handle} /> : <Own />;
}
