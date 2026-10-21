/**
 * "WALK SOMEONE THROUGH IT" on the Journeys screen: pick somebody on the
 * journey, somebody real by their address, or a made-up person, and see every
 * email they would get, with its date, time and subject, and why any step is
 * skipped. It runs the same planner the sending does, and sends nothing
 * (server/lib/comms/journeys.ts, `walkThrough`).
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useEffect, useState } from "react";
import { fetchSubjects, walk, whenLabel, type JourneyDetail, type WalkRequest, type WalkView } from "./journeysApi";

type Who = "real" | "madeUp";

/** The browser's own zone, offered as the made-up person's. */
const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

export default function JourneyWalk({ password, detail, enrollmentId }: { password: string; detail: JourneyDetail; enrollmentId: string | null }) {
  const [who, setWho] = useState<Who>("madeUp");
  const [email, setEmail] = useState("");
  const [subjectRef, setSubjectRef] = useState("");
  const [subjects, setSubjects] = useState<Array<{ subjectRef: string; label: string; startsAt: string | null }>>([]);
  const [name, setName] = useState("");
  const [zone, setZone] = useState(browserZone());
  const [startsAt, setStartsAt] = useState("");
  const [result, setResult] = useState<WalkView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const event = detail.kind === "event";

  const run = async (request: WalkRequest) => {
    setBusy(true);
    setError("");
    const answer = await walk(password, detail.key, request);
    setBusy(false);
    if (!answer.ok) {
      setResult(null);
      setError(answer.error);
      return;
    }
    setResult(answer.body);
  };

  useEffect(() => {
    if (enrollmentId) run({ enrollmentId });
    // Run once for the person picked from the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId]);

  useEffect(() => {
    if (who !== "real") return;
    fetchSubjects(password, detail.key).then((answer) => {
      if (!answer.ok) return;
      setSubjects(answer.body.subjects);
      setSubjectRef((cur) => cur || answer.body.subjects[0]?.subjectRef || "");
    });
  }, [who, password, detail.key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (who === "real") return run({ email: email.trim(), subjectRef });
    const start = startsAt ? new Date(startsAt).toISOString() : undefined;
    return run({ madeUp: { name: name.trim() || undefined, timezone: zone.trim() || undefined, startsAt: start } });
  };

  const field = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900";
  return (
    <section aria-label="Walk someone through it" className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Walk someone through it</h4>
      <p className="mt-1 text-sm text-gray-600">Every email one person would get from this journey, and when. Nothing is sent.</p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="flex gap-4 text-sm text-gray-700">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="who" checked={who === "madeUp"} onChange={() => setWho("madeUp")} />
            A made-up person
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="who" checked={who === "real"} onChange={() => setWho("real")} />
            Someone real
          </label>
        </div>
        {who === "real" ? (
          <div className="flex flex-wrap gap-2">
            <input aria-label="Their email address" placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} min-w-0 flex-1`} />
            {subjects.length > 0 && (
              <select aria-label="What it is about" value={subjectRef} onChange={(e) => setSubjectRef(e.target.value)} className={`${field} min-w-0 flex-1`}>
                {subjects.map((s) => (
                  <option key={s.subjectRef} value={s.subjectRef}>
                    {s.label}
                    {s.startsAt ? `, ${whenLabel(s.startsAt)}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={`${field} min-w-0 flex-1`} />
            <input aria-label="Their time zone" placeholder="Time zone, such as Europe/Lisbon" value={zone} onChange={(e) => setZone(e.target.value)} className={`${field} min-w-0 flex-1`} />
            {event && (
              <input aria-label="When the gathering starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
            )}
          </div>
        )}
        <button type="submit" disabled={busy || (who === "real" && !email.trim())} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
          {busy ? "Working..." : "Walk them through it"}
        </button>
      </form>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {result && (
        <div className="mt-4">
          <p className="text-sm text-gray-700">
            {result.person.name || result.person.email || "This person"}, from {whenLabel(result.enrolledAt)}. Daytime emails wait for daytime in {result.zone}.
            {result.state === "off" ? " The journey is off, so nothing goes until it is turned on." : ""}
          </p>
          {result.stoppedBy && <p className="mt-1 text-sm text-red-700">This journey has ended for them, so nothing more goes.</p>}
          <ol className="mt-2 space-y-2">
            {result.steps.map((s) => (
              <li key={s.key} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900">{s.label}</span>
                  <span className={s.outcome === "sent" ? "text-gray-900" : "text-gray-500"}>
                    {s.outcome === "sent" ? (s.alreadySent ? "Already sent" : whenLabel(s.sendsAt)) : s.outcome === "skipped" ? "Skipped" : "Not yet known"}
                  </span>
                </div>
                {s.subject && <p className="truncate text-gray-700" title={s.subject}>{s.subject}</p>}
                {s.why && <p className="text-xs text-gray-500">{s.why}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
