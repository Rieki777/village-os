/**
 * OVERVIEW, in the Comms section of Admin (the comms build spec 5.15 and 6).
 *
 * The village's email summed up on one screen:
 *
 *   the setup banner   until the six required items of Comms Settings are
 *                      green, read from the same checklist that screen shows;
 *   the last 30 days   how many emails were written, delivered, bounced,
 *                      refused, skipped or rehearsed, and of which kind;
 *   the next 7 days    what is waiting in the post office, soonest first, and
 *                      the letters scheduled to go;
 *   each journey       on or off, and how many people are walking it;
 *   failures           every email that did not reach its person lately;
 *   Run now            the post office, the journeys and the time votes, moved
 *                      forward by hand (`POST /api/admin/comms/run`). The
 *                      scheduler runs them on its own; this is for a founder
 *                      who wants to see a change land now, and for the e2e
 *                      suites, which run with the scheduler off.
 *
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EMAIL_KINDS, MESSAGE_STATUSES, type EmailKind, type MessageStatus } from "@shared/comms/kinds";
import { refusal } from "@/components/admin/adminApi";
import { commsCall, whenOf, type OverviewPayload } from "./commsSettingsApi";

const KIND_LABEL: Record<EmailKind, string> = {
  essential: "Asked for (password links, confirmations)",
  events: "Gatherings",
  paths: "Paths and welcomes",
  letters: "Letters",
  notices: "Member notices",
};

const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: "Waiting",
  sending: "Sending",
  sent: "Accepted by Resend",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Refused",
  skipped: "Not sent",
  expired: "Too late to send",
  rehearsed: "Rehearsed",
  cancelled: "Cancelled",
};

/** What each "run now" job does, in a founder's words. A job the server adds later shows its own name. */
const JOB_LABEL: Record<string, string> = {
  drain: "Send what is due now",
  journeys: "Move the journeys forward",
  polls: "Settle the time votes",
  letters: "Send the letters that are due",
};

function journeyName(key: string): string {
  if (key === "gathering.going") return "Gatherings, for everybody who said yes";
  if (key === "gathering.host") return "Gatherings, for the host";
  if (key === "member.welcome") return "Welcome for a new member";
  if (key === "joining.request") return "Somebody asking to join";
  if (key.startsWith("path.")) return `The ${key.slice("path.".length).replace(/-/g, " ")} path`;
  return key;
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-200 rounded-xl bg-white px-3 py-2 min-w-[120px] flex-1">
      <div className="text-xl font-semibold text-gray-900">{value}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}

export default function CommsOverview({ password }: { password: string }) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<{ job: string; summary: Record<string, number>; ranAt: string } | null>(null);

  const load = useCallback(async () => {
    const r = await commsCall<OverviewPayload>("/admin/comms/overview", password);
    if (r.ok) {
      setData(r.data);
      setFailed(null);
    } else {
      setFailed(refusal(r.data, "The overview could not be read."));
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (job: string) => {
    setRunning(job);
    const r = await commsCall<{ job: string; summary: Record<string, number>; ranAt: string }>("/admin/comms/run", password, {
      method: "POST",
      body: { job },
    });
    setRunning(null);
    if (!r.ok) {
      toast.error(refusal(r.data, "That job did not run."));
      return;
    }
    setLastRun(r.data);
    toast.success(`${JOB_LABEL[job] ?? job}: done`);
    await load();
  };

  if (!data) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900">Overview</h2>
        {failed ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4" role="alert">
            {failed}
          </p>
        ) : (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        )}
      </div>
    );
  }

  const { setup, numbers, upcoming } = data;
  const written = Object.values(numbers.byStatus).reduce((n, v) => n + v, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Overview</h2>
        <p className="text-sm text-gray-500 mt-1">The village's email: what went out, what is waiting, and anything that needs a person.</p>
      </div>

      {!setup.ready && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4" role="status">
          <p className="text-sm font-semibold text-amber-900">
            Setup is not finished: {setup.done} of {setup.total} required steps done.
          </p>
          <ul className="list-disc pl-5 text-sm text-amber-900 mt-2 space-y-1">
            {setup.open.map((o) => (
              <li key={o.key}>
                {o.label}. {o.fix}
              </li>
            ))}
          </ul>
          <a href="/admin?tab=comms-settings" className="inline-block mt-3 text-sm font-medium text-teal-deep underline">
            Open Comms Settings
          </a>
        </div>
      )}
      {data.paused && (
        <p className="text-sm border border-amber-300 bg-amber-50 text-amber-900 rounded-xl px-4 py-3" role="status">
          Pause all is on. Gathering emails, path emails and letters wait in the queue until it is lifted in Comms Settings.
        </p>
      )}
      {data.lifecycle === "preview" && (
        <p className="text-sm border border-gray-200 bg-white text-gray-700 rounded-xl px-4 py-3">
          Comms is rehearsing: every gathering, path and letter email goes to the rehearsal inbox.
        </p>
      )}

      <section aria-labelledby="comms-numbers">
        <h3 id="comms-numbers" className="text-base font-semibold text-gray-900 mb-2">
          The last {numbers.days} days
        </h3>
        <div className="flex flex-wrap gap-2">
          <Tile label="Written" value={written} />
          {MESSAGE_STATUSES.filter((s) => numbers.byStatus[s]).map((s) => (
            <Tile key={s} label={STATUS_LABEL[s]} value={numbers.byStatus[s]} />
          ))}
        </div>
        {written > 0 && (
          <ul className="text-sm text-gray-700 mt-3 space-y-1">
            {EMAIL_KINDS.filter((k) => numbers.byKind[k]).map((k) => (
              <li key={k}>
                {KIND_LABEL[k]}: {numbers.byKind[k]}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="comms-upcoming">
        <h3 id="comms-upcoming" className="text-base font-semibold text-gray-900 mb-2">
          The next {upcoming.days} days
        </h3>
        {upcoming.total === 0 && upcoming.letters.length === 0 ? (
          <p className="text-sm text-gray-600">Nothing is waiting to go.</p>
        ) : (
          <>
            {upcoming.total > 0 && (
              <p className="text-sm text-gray-600 mb-2">
                {upcoming.total} email{upcoming.total === 1 ? "" : "s"} waiting
                {upcoming.total > upcoming.next.length ? `, the first ${upcoming.next.length} below` : ""}.
              </p>
            )}
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl bg-white">
              {upcoming.letters.map((l) => (
                <li key={l.id} className="px-4 py-2 text-sm">
                  <span className="text-gray-500">{whenOf(l.scheduledFor)}</span>{" "}
                  <span className="text-gray-900">Letter: {l.subject}</span>{" "}
                  <span className="text-gray-500">to {l.recipientCount}</span>
                </li>
              ))}
              {upcoming.next.map((m) => (
                <li key={m.id} className="px-4 py-2 text-sm">
                  <span className="text-gray-500">{m.at ? whenOf(m.at) : "As soon as the post office runs"}</span>{" "}
                  <span className="text-gray-900">{m.subject}</span>{" "}
                  <span className="text-gray-500">
                    ({m.journeyKey ? journeyName(m.journeyKey) : m.origin})
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="comms-journeys">
        <h3 id="comms-journeys" className="text-base font-semibold text-gray-900 mb-2">
          Journeys
        </h3>
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl bg-white">
          {data.journeys.map((j) => (
            <li key={j.key} className="px-4 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
              <span className="text-gray-900">{journeyName(j.key)}</span>
              <span className="text-gray-600">
                {j.state === "on" ? "On" : "Off"}
                {j.edited ? ", edited here" : ""}, {j.active} walking it now
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="comms-failures">
        <h3 id="comms-failures" className="text-base font-semibold text-gray-900 mb-2">
          Emails that did not arrive
        </h3>
        {data.failures.length === 0 ? (
          <p className="text-sm text-gray-600">None in the last {numbers.days} days.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl bg-white">
            {data.failures.map((f) => (
              <li key={f.id} className="px-4 py-2 text-sm">
                <div className="text-gray-900">
                  {f.subject} <span className="text-gray-500">to {f.toEmail}</span>
                </div>
                <div className="text-xs text-gray-600">
                  {STATUS_LABEL[f.status as MessageStatus] ?? f.status}, {whenOf(f.at)}
                  {f.lastError ? `: ${f.lastError}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        <a href="/admin?tab=comms-sent" className="inline-block mt-2 text-sm text-teal-deep underline">
          Every email is in Sent mail
        </a>
      </section>

      <section aria-labelledby="comms-run-now" className="border-t border-gray-100 pt-5">
        <h3 id="comms-run-now" className="text-base font-semibold text-gray-900">
          Run now
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          The post office and the journeys run by themselves every few minutes. Press one to move it along now.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {data.jobs.map((job) => (
            <button
              key={job}
              type="button"
              onClick={() => run(job)}
              disabled={running !== null}
              className="min-h-[44px] px-4 text-sm rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-deep"
            >
              {running === job ? "Running..." : JOB_LABEL[job] ?? job}
            </button>
          ))}
        </div>
        {lastRun && (
          <p className="text-xs text-gray-600 mt-2" role="status">
            {JOB_LABEL[lastRun.job] ?? lastRun.job}:{" "}
            {Object.entries(lastRun.summary)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")}
            .
          </p>
        )}
      </section>
    </div>
  );
}
