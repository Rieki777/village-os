/**
 * JOURNEYS, in the Comms section of Admin (the comms build spec 5.6 and 6).
 *
 * Every journey the village has, each with whether it is on and how many
 * people are on it now, beside the open journey (JourneyDetail.tsx): its
 * timeline, Turn on and off, step edits, a test of a step, the people on it,
 * and "Walk someone through it". Every journey ships off.
 *
 * The routes are server/routes/commsJourneys.ts. The tab follows the comms
 * module (client/src/lib/adminNav.ts), and so do its routes.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import JourneyDetail from "./JourneyDetail";
import { fetchJourneys, type JourneySummary } from "./journeysApi";

export default function CommsJourneys({ password }: { password: string }) {
  const [journeys, setJourneys] = useState<JourneySummary[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const answer = await fetchJourneys(password);
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setError("");
    setJourneys(answer.body.journeys);
    setSelected((current) => current ?? answer.body.journeys[0]?.key ?? null);
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900">Journeys</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The emails that follow from what people do: saying yes to a gathering, joining, starting a path. Each journey is off until you
          turn it on. Open one to see its steps, change them, and walk someone through it.
        </p>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!journeys && !error && <p className="py-12 text-center text-sm text-gray-400">Loading...</p>}

      {journeys && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Journeys">
            <ul className="space-y-1">
              {journeys.map((j) => (
                <li key={j.key}>
                  <button
                    type="button"
                    onClick={() => setSelected(j.key)}
                    aria-current={j.key === selected ? "true" : undefined}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      j.key === selected ? "border-gray-900 bg-gray-50" : "border-gray-200 bg-white hover:border-gray-400"
                    }`}
                  >
                    <span className="block text-sm font-medium text-gray-900">{j.title}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${j.state === "on" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                        {j.state === "on" ? "On" : "Off"}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                        {j.active} on it
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                        {j.steps.length} {j.steps.length === 1 ? "email" : "emails"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            {selected ? (
              <JourneyDetail key={selected} password={password} journeyKey={selected} onChanged={load} />
            ) : (
              <p className="text-sm text-gray-500">Choose a journey to see its steps.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
