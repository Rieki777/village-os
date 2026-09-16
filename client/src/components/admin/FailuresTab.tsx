/**
 * What's Failing: the report the hourly failed-actions job keeps, for the
 * people who run the village.
 *
 * Why the job exists, what it reruns and why it reruns so little is argued
 * once, in server/lib/failedActions.ts. This tab reads GET /api/admin/failures
 * and adds the one thing a list cannot say about itself: whether it is current.
 *
 * AN UNREADABLE REPORT NEVER LOOKS LIKE AN EMPTY ONE. "Nothing is failing" and
 * "the report could not be read" are different news, so a failed read says so
 * in red and the empty state never renders behind it.
 *
 * Light only, like every admin surface: fixed grays on a fixed white ground. A
 * theme token here would put pale text on white the moment a founder switched
 * to dark (the LIGHT_SURFACES zone in scripts/check-tailwind-gray.mjs).
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "./adminApi";

interface FailureItem {
  area: string;
  source: string;
  key: string;
  title: string;
  advice: string;
  lastError: string | null;
  failingForSeconds: number;
  resolvedSecondsAgo: number | null;
}

interface FailuresReport {
  open: FailureItem[];
  resolved: FailureItem[];
  blindSpots: string[];
  job: {
    everyMinutes: number;
    schedulerEnabled: boolean;
    lastRunSecondsAgo: number | null;
    lastResult: string | null;
  };
}

type Tone = "note" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  note: "border-gray-200 bg-gray-50 text-gray-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-red-200 bg-red-50 text-red-700",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "3 days", "5 hours", "20 minutes": the same reading the server's titles use. */
function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86400);
  if (days >= 1) return `${days} ${plural(days, "day", "days")}`;
  const hours = Math.floor(s / 3600);
  if (hours >= 1) return `${hours} ${plural(hours, "hour", "hours")}`;
  const minutes = Math.max(1, Math.floor(s / 60));
  return `${minutes} ${plural(minutes, "minute", "minutes")}`;
}

const cadence = (minutes: number) => (minutes === 60 ? "hour" : duration(minutes * 60));

/** Items grouped by area, in the order the server listed them. */
function byArea(items: FailureItem[]): Array<[string, FailureItem[]]> {
  const groups = new Map<string, FailureItem[]>();
  items.forEach((item) => {
    const list = groups.get(item.area) ?? [];
    list.push(item);
    groups.set(item.area, list);
  });
  return Array.from(groups.entries());
}

const failed = (job: FailuresReport["job"]) => Boolean(job.lastResult?.startsWith("FAILED:"));

/**
 * A run has FINISHED here and did not fail. The scheduler stamps a run when it
 * starts and writes its result only when it ends, so this is the one state in
 * which an empty list means nothing is failing.
 */
const checkedCleanly = (job: FailuresReport["job"]) => job.lastResult != null && !failed(job);

/** Whether the list is current, said plainly. The worst true sentence wins. */
function freshness(job: FailuresReport["job"]): { tone: Tone; text: string } {
  const every = cadence(job.everyMinutes);
  if (!job.schedulerEnabled) {
    return job.lastResult == null
      ? {
          tone: "warn",
          text: "The scheduler is switched off on this server, so this report has never run here and nothing below has been checked.",
        }
      : {
          tone: "warn",
          text: "The scheduler is switched off on this server, so this report has stopped updating. The list below is from its last run.",
        };
  }
  if (failed(job)) {
    return {
      tone: "bad",
      text: `The report's last run failed, so the list below may be out of date. It said: ${String(job.lastResult).slice("FAILED:".length).trim()}`,
    };
  }
  if (job.lastResult == null) {
    return job.lastRunSecondsAgo == null
      ? { tone: "note", text: "The report has not run on this server yet. It first runs shortly after the server starts." }
      : { tone: "note", text: "The report's first run is under way. Reload in a few minutes." };
  }
  if (/out of time/.test(job.lastResult)) {
    return {
      tone: "warn",
      text: "The report's last run ran out of time before reading every area, so parts of the list below may be out of date.",
    };
  }
  if (/skipped: another run/.test(job.lastResult)) {
    return { tone: "note", text: "The report's last run found another run already under way, so the list below may still be filling in." };
  }
  const since = job.lastRunSecondsAgo ?? 0;
  if (since > job.everyMinutes * 60 * 2 + 5 * 60) {
    return {
      tone: "warn",
      text: `The report last ran ${duration(since)} ago and should run every ${every}, so the list below may be out of date.`,
    };
  }
  return { tone: "note", text: `Checked ${duration(since)} ago. The report checks again every ${every}.` };
}

export default function FailuresTab({ password }: { password: string }) {
  const [report, setReport] = useState<FailuresReport | null>(null);
  const [problem, setProblem] = useState("");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/failures`, { headers: authHeaders(password) });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setReport(body as FailuresReport);
        setProblem("");
        setDetail("");
      } else {
        setReport(null);
        setProblem(refusal(body, "The report could not be read."));
        setDetail(typeof body?.detail === "string" ? body.detail : "");
      }
    } catch {
      setReport(null);
      setProblem("The report could not be read. Check your connection, then reload.");
      setDetail("");
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = report ? freshness(report.job) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-gray-900">What's failing</h2>
            <p className="mt-2 text-sm text-gray-600">
              Each item below is still failing, and says what to do about it. The report checks the village every
              hour. Admins and founders get at most one notice a day, when something new appears or an item has gone
              a week without a mention.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Reading" : "Reload"}
          </button>
        </div>
        {status && <p className={`mt-4 rounded-lg border px-3 py-2 text-sm ${TONE[status.tone]}`}>{status.text}</p>}
      </div>

      {problem && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{problem}</p>
          {detail && <p className="mt-1 font-mono text-xs break-words">{detail}</p>}
        </div>
      )}

      {report &&
        report.open.length === 0 &&
        (checkedCleanly(report.job) ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Nothing is failing that this report can see. What it cannot see yet is listed at the bottom of this page.
          </p>
        ) : (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {report.job.lastResult == null
              ? "Nothing is listed because the report has not finished a run here yet."
              : "Nothing is listed, and the last run failed, so an empty list proves nothing."}
          </p>
        ))}

      {report &&
        byArea(report.open).map(([area, items]) => (
          <section key={area} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              {area} ({items.length})
            </h3>
            {items.map((item) => (
              <article key={`${item.source}:${item.key}`} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h4 className="min-w-0 break-words font-medium text-gray-900">{item.title}</h4>
                  <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                    failing for {duration(item.failingForSeconds)}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm text-gray-700">{item.advice}</p>
                {item.lastError && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-600">What the system recorded</p>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 font-mono text-xs text-gray-700">
                      {item.lastError}
                    </pre>
                  </div>
                )}
              </article>
            ))}
          </section>
        ))}

      {report && report.resolved.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Cleared from the list in the last week</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {report.resolved.map((item) => (
              <li key={`${item.source}:${item.key}`}>
                {/* The title was written while the thing was failing, so it is
                    quoted as what the report said, never restated as true now. */}
                <p className="break-words text-gray-900">
                  {item.area}, cleared {item.resolvedSecondsAgo != null ? `${duration(item.resolvedSecondsAgo)} ago` : "recently"}
                </p>
                <p className="break-words text-gray-600">It said: {item.title}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">What this report cannot see yet</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {report.blindSpots.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
