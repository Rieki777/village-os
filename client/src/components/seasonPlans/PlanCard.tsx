/**
 * One member's season plan, as the village reads it (season plans RC1).
 *
 * Drawn on the village page and on a member's profile. It carries what the
 * server sends and nothing else: seat names, where each application stands
 * (linking its own page, where members read its terms), the member's aim, the
 * goal they serve, this moon's quest pips and their measures in words. No
 * money and no terms ever reach this card.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { civilDayWords, questPipsWords } from "@shared/seasonPlans";
import type { PlanApplication, PlanCard as PlanCardData } from "./seasonPlansApi";

export const PLAN_CARD_WORDS = {
  filed: "Filed",
  notFiled: "Not filed yet",
  changed: "Has changes not filed yet",
  holds: "Holds",
  handsBack: "Hands back",
  applied: "Asked the village",
  aim: "Aim",
  serves: "Serves",
  thisMoon: "This moon",
  measures: "Measures",
  noSeats: "No seats yet.",
} as const;

/** Quest pips: filled to the quests done, outlined to the most agreed. */
export function QuestPips({ done, min, max }: { done: number; min: number | null; max: number | null }) {
  const goal = max ?? min ?? 0;
  const count = Math.min(12, Math.max(goal, done));
  if (count === 0) return <span className="text-sm text-stone-600">{questPipsWords(done, min, max)}</span>;
  return (
    <span role="img" aria-label={questPipsWords(done, min, max)} className="inline-flex flex-wrap items-center gap-1">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`inline-block h-3 w-3 rounded-full border-2 ${i < done ? "border-teal-deep bg-teal-deep" : "border-stone-400 bg-white"}`}
        />
      ))}
    </span>
  );
}

/** An application's chip: its seats and where it stands, linking its page. */
export function ApplicationChip({ app }: { app: PlanApplication }) {
  return (
    <Link
      href={app.href}
      className="inline-flex min-h-[32px] items-center rounded-full border border-teal-deep/40 bg-teal-deep/5 px-3 text-sm font-medium text-teal-deep hover:bg-teal-deep/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
    >
      {app.seats.map((s) => s.name).join(", ")}: {app.statusWords}
    </Link>
  );
}

function Chip({ children, tone = "stone" }: { children: ReactNode; tone?: "stone" | "amber" }) {
  return (
    <span
      className={`inline-flex min-h-[28px] items-center rounded-full px-3 text-sm ${tone === "amber" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-300" : "bg-stone-100 text-stone-800"}`}
    >
      {children}
    </span>
  );
}

export default function PlanCard({ card, headingLevel = 3 }: { card: PlanCardData; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm" aria-labelledby={`plan-${card.userId}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <H id={`plan-${card.userId}`} className="font-display text-lg font-bold text-stone-900">
          {card.handle ? (
            <Link href={`/profile/${encodeURIComponent(card.handle)}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep">
              {card.name}
            </Link>
          ) : (
            card.name
          )}
        </H>
        <span className={`text-sm font-semibold ${card.filed ? "text-teal-deep" : "text-stone-600"}`}>
          {card.filed ? `${PLAN_CARD_WORDS.filed}${card.filedOn ? ` ${civilDayWords(card.filedOn)}` : ""}` : PLAN_CARD_WORDS.notFiled}
        </span>
      </header>

      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.holds}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {card.seats.length ? card.seats.map((s) => <Chip key={s.id}>{s.name}</Chip>) : <span className="text-stone-600">{PLAN_CARD_WORDS.noSeats}</span>}
          </dd>
        </div>
        {card.handingBack.length > 0 && (
          <div>
            <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.handsBack}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {card.handingBack.map((s) => (
                <Chip key={s.id} tone="amber">
                  {s.name}
                </Chip>
              ))}
            </dd>
          </div>
        )}
        {card.applications.length > 0 && (
          <div>
            <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.applied}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {card.applications.map((a) => (
                <ApplicationChip key={a.id} app={a} />
              ))}
            </dd>
          </div>
        )}
        {card.aim && (
          <div>
            <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.aim}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-base text-stone-900">{card.aim}</dd>
          </div>
        )}
        {card.servesGoal && (
          <div>
            <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.serves}</dt>
            <dd className="mt-0.5 text-stone-900">{card.servesGoal}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.thisMoon}</dt>
          <dd className="mt-1">
            <QuestPips done={card.questsThisMoon.done} min={card.questsThisMoon.min} max={card.questsThisMoon.max} />
          </dd>
        </div>
        {card.measures.length > 0 && (
          <div>
            <dt className="font-semibold text-stone-700">{PLAN_CARD_WORDS.measures}</dt>
            <dd>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-stone-900">
                {card.measures.map((m, i) => (
                  <li key={i}>
                    {m.measure}
                    {m.target ? <span className="text-stone-600">: {m.target}</span> : null}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {card.changedSinceFiling && <p className="mt-3 text-xs text-stone-600">{PLAN_CARD_WORDS.changed}</p>}
    </article>
  );
}
