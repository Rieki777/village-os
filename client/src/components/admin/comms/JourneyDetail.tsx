/**
 * ONE JOURNEY on the Journeys screen: its timeline, Turn on and off, editing a
 * step, a step's test to yourself, the people on it with Stop, its versions,
 * and the walk-through (JourneyWalk.tsx). The routes are
 * server/routes/commsJourneys.ts.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import JourneyWalk from "./JourneyWalk";
import {
  fetchJourney,
  saveStep,
  setJourneyOn,
  stopEnrollment,
  testStep,
  whenLabel,
  type JourneyDetail as Detail,
  type JourneyStepView,
  type StepEdit,
} from "./journeysApi";

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

function splitOffset(offset: number): { amount: number; unit: Unit; before: boolean } {
  const m = Math.abs(offset);
  const unit: Unit = m > 0 && m % 1440 === 0 ? "days" : m > 0 && m % 60 === 0 ? "hours" : "minutes";
  return { amount: m / UNIT_MINUTES[unit], unit, before: offset < 0 };
}

function StepEditor({
  detail,
  step,
  password,
  onSaved,
  onCancel,
}: {
  detail: Detail;
  step: JourneyStepView;
  password: string;
  onSaved: (version: number) => void;
  onCancel: () => void;
}) {
  const start = splitOffset(step.offsetMinutes);
  const [amount, setAmount] = useState(String(start.amount));
  const [unit, setUnit] = useState<Unit>(start.unit);
  const [before, setBefore] = useState(start.before);
  const [window, setWindow] = useState(step.window);
  const [audience, setAudience] = useState(step.audience);
  const [templateKey, setTemplateKey] = useState(step.templateKey);
  const [skipIf, setSkipIf] = useState<string[]>(step.skipIf);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const event = step.anchor !== "enrolled";

  const save = async () => {
    const n = Number(amount);
    const minutes = Math.round(n * UNIT_MINUTES[unit]);
    const edit: StepEdit = {
      offsetMinutes: event && before ? -minutes : minutes,
      window,
      audience,
      templateKey,
      skipIf: skipIf as StepEdit["skipIf"],
    };
    setSaving(true);
    const answer = await saveStep(password, detail.key, step.key, edit);
    setSaving(false);
    if (!answer.ok) {
      setProblems(answer.problems ?? [answer.error]);
      return;
    }
    onSaved(answer.body.version);
  };

  const field = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900";
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <label className="sr-only" htmlFor={`amount-${step.key}`}>
          How long
        </label>
        <input id={`amount-${step.key}`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} w-20`} />
        <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={field}>
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        {event ? (
          <>
            <select aria-label="Before or after" value={before ? "before" : "after"} onChange={(e) => setBefore(e.target.value === "before")} className={field}>
              <option value="before">before</option>
              <option value="after">after</option>
            </select>
            <span>{step.anchor === "event_start" ? "it starts" : "it ends"}</span>
          </>
        ) : (
          <span>after they start</span>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-gray-700">
        <label className="flex items-center gap-2">
          When
          <select value={window} onChange={(e) => setWindow(e.target.value as typeof window)} className={field}>
            <option value="any">Any time</option>
            <option value="daytime">Daytime only, where they are</option>
          </select>
        </label>
        {step.anchor === "event_end" && (
          <label className="flex items-center gap-2">
            Who
            <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className={field}>
              <option value="all">Everyone who said yes</option>
              <option value="came">People who came</option>
              <option value="missed">People who missed it</option>
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          Words
          <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className={field}>
            {detail.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {detail.conditions.length > 0 && (
        <fieldset className="text-sm text-gray-700">
          <legend className="font-medium text-gray-900">Skip this email when</legend>
          {detail.conditions.map((c) => (
            <label key={c.key} className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={skipIf.includes(c.key)}
                onChange={(e) => setSkipIf((cur) => (e.target.checked ? [...cur, c.key] : cur.filter((k) => k !== c.key)))}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
      )}
      {problems.length > 0 && (
        <ul className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
          {saving ? "Saving..." : "Save as a new version"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700">
          Cancel
        </button>
      </div>
      <p className="text-xs text-gray-500">People already on this journey keep the version they started on.</p>
    </div>
  );
}

export default function JourneyDetail({ password, journeyKey, onChanged }: { password: string; journeyKey: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [walkFor, setWalkFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const answer = await fetchJourney(password, journeyKey);
    if (!answer.ok) return setError(answer.error);
    setError("");
    setDetail(answer.body);
  }, [password, journeyKey]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!detail) return <p className="py-12 text-center text-sm text-gray-400">Loading...</p>;

  const toggle = async () => {
    setBusy(true);
    const answer = await setJourneyOn(password, detail.key, detail.state !== "on");
    setBusy(false);
    if (!answer.ok) return setNote(answer.error);
    setNote(answer.body.state === "on" ? "Turned on." : "Turned off.");
    await load();
    onChanged();
  };

  const sendTest = async (step: string) => {
    setTests((t) => ({ ...t, [step]: "Sending..." }));
    const answer = await testStep(password, detail.key, step);
    const line = !answer.ok
      ? answer.error
      : answer.body.status === "sent"
        ? `Sent to ${answer.body.sentTo}.`
        : answer.body.reason === "no_api_key" || answer.body.reason === "no_sender"
          ? "Not sent. Finish the setup in Comms Settings first."
          : "Not sent. Sent mail has the details.";
    setTests((t) => ({ ...t, [step]: line }));
  };

  const stop = async (id: string) => {
    if (!window.confirm("Stop this journey for this person? Nothing more from it reaches them.")) return;
    const answer = await stopEnrollment(password, id);
    setNote(answer.ok ? "Stopped." : answer.error);
    await load();
    onChanged();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{detail.title}</h3>
          <p className="text-sm text-gray-500">
            {detail.state === "on" ? "On" : "Off"}, version {detail.version}
            {detail.own ? ", your own steps" : ", the platform's steps"}. {detail.active} on it now.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={toggle}
          className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60 ${detail.state === "on" ? "border border-gray-300 bg-white text-gray-900" : "bg-gray-900 text-white"}`}
        >
          {detail.state === "on" ? "Turn off" : "Turn on"}
        </button>
      </div>
      {note && <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">{note}</p>}
      {detail.state === "off" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Off. Nobody gets these emails. People who join it wait, and turning it on sends what is still worth sending.
        </p>
      )}
      {detail.followsDials && (
        <p className="text-sm text-gray-600">
          The reminder times follow the dials in Comms Settings until you change a step here.
        </p>
      )}

      <section aria-label="Timeline">
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Timeline</h4>
        <ol className="space-y-3">
          {detail.steps.map((s, i) => (
            <li key={s.key} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">
                  {i + 1}. {s.label}
                </p>
                <p className="text-sm text-gray-600">
                  {s.timing}
                  {s.window === "daytime" ? ", daytime only" : ""}
                </p>
              </div>
              {s.subject && <p className="mt-1 truncate text-sm text-gray-700" title={s.subject}>Subject: {s.subject}</p>}
              {s.skipIf.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  Skipped when: {s.skipIf.map((k) => detail.conditions.find((c) => c.key === k)?.label ?? k).join("; ")}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <button type="button" onClick={() => setEditing(editing === s.key ? null : s.key)} className="text-gray-900 underline">
                  Edit this step
                </button>
                <button type="button" onClick={() => sendTest(s.key)} className="text-gray-900 underline">
                  Send me a test
                </button>
                <a href="/admin?tab=comms-words" className="text-gray-900 underline">
                  Edit the words
                </a>
                <span className="text-xs text-gray-500">{s.words === "village" ? "Your words" : s.words === "platform" ? "Platform words" : "No words yet"}</span>
              </div>
              {tests[s.key] && <p className="mt-1 text-xs text-gray-600">{tests[s.key]}</p>}
              {editing === s.key && (
                <StepEditor
                  detail={detail}
                  step={s}
                  password={password}
                  onCancel={() => setEditing(null)}
                  onSaved={async (version) => {
                    setEditing(null);
                    setNote(`Saved as version ${version}.`);
                    await load();
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ol>
        {detail.stops.length > 0 && (
          <p className="mt-3 text-sm text-gray-600">Ends early when: {detail.stops.map((s) => s.label.toLowerCase()).join("; ")}.</p>
        )}
      </section>

      <JourneyWalk key={walkFor ?? "none"} password={password} detail={detail} enrollmentId={walkFor} />

      <section aria-label="People on it">
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">People on it ({detail.active})</h4>
        {detail.enrollments.length === 0 ? (
          <p className="text-sm text-gray-500">Nobody is on this journey now.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {detail.enrollments.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{e.name || e.email || "Somebody"}</p>
                  <p className="truncate text-xs text-gray-500">
                    {e.email}
                    {e.nextCheckAt ? `, next look ${whenLabel(e.nextCheckAt)}` : ""}, version {e.version}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setWalkFor(e.id)} className="text-gray-900 underline">
                    Walk through
                  </button>
                  <button type="button" onClick={() => stop(e.id)} className="text-red-700 underline">
                    Stop
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.versions.length > 0 && (
        <details className="text-sm text-gray-700">
          <summary className="cursor-pointer font-medium text-gray-900">Versions</summary>
          <ul className="mt-2 space-y-1">
            {detail.versions.map((v) => (
              <li key={v.version}>
                Version {v.version}, saved {whenLabel(v.createdAt)}. {v.active} on it now.
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
