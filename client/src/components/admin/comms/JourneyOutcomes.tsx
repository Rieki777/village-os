/**
 * WHAT EACH STEP OF A JOURNEY DID (the comms build spec 5.12, outcomes), on
 * one journey's page: for every email, how many were sent, delivered and
 * bounced, how many said no after it, and what people did in the 7 days that
 * followed: said yes to a gathering, came to one, reached the journey's goal.
 * For a path or welcome journey it also says how many of the people an email
 * reached have taken the path's first step by now.
 *
 * Reads `GET /api/admin/comms/outcomes/:journeyKey`
 * (server/routes/commsLetters.ts). Opens are not tracked, so none are shown.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useEffect, useState } from "react";
import { STOP_LABELS } from "@shared/comms/journeySteps";
import { fetchOutcomes, type OutcomesAnswer } from "./lettersApi";

export default function JourneyOutcomes({ password, journeyKey, labels = {} }: { password: string; journeyKey: string; labels?: Record<string, string> }) {
  const [data, setData] = useState<OutcomesAnswer | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetchOutcomes(password, journeyKey).then((answer) => {
      if (!live) return;
      if (answer.ok) setData(answer.body);
      else setError(answer.error);
    });
    return () => {
      live = false;
    };
  }, [password, journeyKey]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return null;
  const any = data.steps.some((s) => s.sent > 0);
  const showNext = data.nextStepRule !== null;
  const showGoal = data.goals.length > 0;

  return (
    <section aria-label="What each email did">
      <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">What each email did</h4>
      {!any ? (
        <p className="text-sm text-gray-500">Nothing from this journey has been sent yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[36rem] text-left text-sm text-gray-700">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
                <th className="px-3 py-2 font-medium">Bounced</th>
                <th className="px-3 py-2 font-medium">Said no after</th>
                <th className="px-3 py-2 font-medium">Said yes to a gathering</th>
                <th className="px-3 py-2 font-medium">Came</th>
                {showNext && <th className="px-3 py-2 font-medium">Took the first step</th>}
                {showGoal && <th className="px-3 py-2 font-medium">Reached the goal</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.steps.map((s) => (
                <tr key={s.stepKey}>
                  <td className="px-3 py-2 font-medium text-gray-900">{labels[s.stepKey] ?? s.stepKey}</td>
                  <td className="px-3 py-2">{s.sent}</td>
                  <td className="px-3 py-2">{s.delivered}</td>
                  <td className="px-3 py-2">{s.bounced}</td>
                  <td className="px-3 py-2">{s.unsubscribed}</td>
                  <td className="px-3 py-2">{s.rsvpd}</td>
                  <td className="px-3 py-2">{s.came}</td>
                  {showNext && <td className="px-3 py-2">{s.tookNextStep === null ? (s.sent ? "Not measured" : "0") : s.tookNextStep}</td>}
                  {showGoal && <td className="px-3 py-2">{s.reachedGoal}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">
        Counted over the {data.windowDays} days after each email.
        {showGoal ? ` The goal: ${data.goals.map((g) => STOP_LABELS[g].toLowerCase()).join(", or ")}.` : ""}
        {showNext ? " The first step is counted as it stands today." : ""}
      </p>
    </section>
  );
}
