/**
 * The schedule beside Sync now, and the report of every run under it.
 *
 * The founder's words to the vendor, 2026-10-13: a polling schedule beside the
 * Sync now button, live in the module's settings, "with a full report of each
 * run". So the schedule is one choice saved through the module's own config
 * route, and every run, pressed or scheduled, is listed with what it read, what
 * it sent to the review queue, what it skipped, and why it stopped when it did.
 *
 * ── WHAT THIS SCREEN NEVER SHOWS ─────────────────────────────────────────
 *
 * The key, and anything the service wrote. The log the server keeps is typed
 * fields only (`shared/saberraSyncLog.ts`), so there is nothing of either to
 * show, and every line below is built here from those fields.
 *
 * ── THE TIME ─────────────────────────────────────────────────────────────
 *
 * Every time is the village's own, named, because the schedule runs on the
 * server's clock and a founder reads it on their own: "6:00 PM" with no zone is
 * a time two people read two ways.
 *
 * Light-only, by the founder's ruling on the admin workspace, like the panel
 * it sits in.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MODULES_BY_ID, SABERRA_POLL_SCHEDULES, saberraPollSchedule, type SaberraPollSchedule } from "@shared/modules";
import type { SyncFailureWhy, SyncKind, SyncRun, SyncRunsAnswer } from "@shared/saberraSyncLog";
import { API_BASE, authHeaders, refusal } from "./adminApi";

const MODULE_ID = "saberra";

const selectCls =
  "border border-gray-200 rounded-lg px-2 py-1.5 text-sm min-h-[44px] bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-deep";
const btnCls =
  "min-h-[44px] px-3 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-deep disabled:opacity-40";

/** How each schedule is offered. */
export const SCHEDULE_WORDS: Record<SaberraPollSchedule, string> = {
  off: "Off",
  daily: "Daily",
  "every-6-hours": "Every 6 hours",
};

/** How a kind is named on this screen, as the server's `KIND_LABEL` names it. */
const KIND_WORDS: Record<SyncKind, string> = {
  circle: "circle",
  role: "role",
  roleAssignment: "role assignment",
  tension: "tension",
  risk: "risk",
};

/** How a call failed, as `server/lib/saberraClient.ts` names it. */
export const WHY_WORDS: Record<SyncFailureWhy, string> = {
  "no-session": "no session was open",
  refused: "the call did not go through",
  unreadable: "the reply could not be read",
  "vendor-error": "the service said no",
};

const OUTCOME_WORDS: Record<SyncRun["outcome"], string> = {
  landed: "Sent to the review queue",
  "no-change": "No changes",
  failed: "Failed",
  "not-run": "Not run",
};

const TRIGGER_WORDS: Record<SyncRun["trigger"], string> = {
  scheduled: "Scheduled",
  "by-hand": "By hand",
};

const OUTCOME_TONE: Record<SyncRun["outcome"], string> = {
  landed: "text-teal-deep",
  "no-change": "text-gray-700",
  failed: "text-red-700",
  "not-run": "text-amber-800",
};

/** "1 record", "3 records". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const kindList = (kinds: SyncKind[]) => kinds.map((k) => KIND_WORDS[k] ?? k).join(", ");

/** "Wed, Oct 15, 6:00 PM CST" in the village's zone, or the browser's when the zone will not format. */
export function villageTime(iso: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(date);
  }
}

/** "twice", "four times". */
const times = (factor: number) => (factor === 2 ? "twice" : factor === 4 ? "four times" : `${factor} times`);

/** The schedule select and its save, beside the button. */
export function ScheduleControl({
  config,
  save,
  onSaved,
}: {
  config: Record<string, unknown> | null;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  onSaved: () => void;
}) {
  const stored = saberraPollSchedule(config);
  // What a founder picked, or null for "show what is stored": derived, never
  // copied in by an effect, for the reason the address fields give.
  const [draft, setDraft] = useState<SaberraPollSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = draft ?? stored;

  const onSave = async () => {
    if (draft === null || draft === stored) {
      setProblem("The schedule has not changed, so there is nothing to save.");
      return;
    }
    // The merged result is what the server validates, so the browser does too.
    const refused = MODULES_BY_ID[MODULE_ID]?.validateConfig?.({ ...(config ?? {}), pollSchedule: draft }) ?? null;
    if (refused) {
      setProblem(refused);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      if (await save({ pollSchedule: draft })) {
        setDraft(null);
        toast.success(draft === "off" ? "Saved. Syncs run only when somebody presses Sync now" : `Saved. The module syncs ${SCHEDULE_WORDS[draft].toLowerCase()}`);
        onSaved();
      }
    } catch {
      setProblem("That did not reach the server, so nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Sync by itself
          <select
            value={value}
            onChange={(e) => setDraft(e.target.value as SaberraPollSchedule)}
            aria-describedby={problem ? "saberra-schedule-problem" : undefined}
            className={`${selectCls} block mt-1`}
          >
            {SABERRA_POLL_SCHEDULES.map((s) => (
              <option key={s} value={s}>
                {SCHEDULE_WORDS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={btnCls} disabled={saving || draft === null} onClick={onSave}>
          {saving ? "Saving…" : "Save schedule"}
        </button>
      </div>
      {problem && (
        <p
          id="saberra-schedule-problem"
          className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2"
          role="alert"
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/** Believed only in its own shape: a body without a schedule and a list is said to be unreadable. */
function readAnswer(d: unknown): SyncRunsAnswer | null {
  if (!d || typeof d !== "object") return null;
  const a = d as Partial<SyncRunsAnswer>;
  if (typeof a.schedule !== "string" || !Array.isArray(a.runs) || typeof a.timezone !== "string") return null;
  if (!a.backoff || typeof a.backoff.failures !== "number" || typeof a.backoff.factor !== "number") return null;
  return a as SyncRunsAnswer;
}

/** When the schedule next calls the service, or why it will not. */
function nextLine(a: SyncRunsAnswer, now: number): string {
  if (a.schedule === "off") return "Off. A sync runs only when somebody presses Sync now.";
  if (!a.schedulerOn) return "This server runs no background work, so no scheduled sync will run here. Sync now still works.";
  if (a.blocked === "no-address") return "Waiting for a service address. The schedule calls the service once one is saved above.";
  if (a.blocked) return "Waiting for a key this server can use. The schedule calls the service once one is set in Integrations.";
  if (!a.nextAt) return "The next scheduled sync could not be worked out.";
  const at = Date.parse(a.nextAt);
  if (!Number.isFinite(at) || at - now <= 5 * 60 * 1000) return "Next scheduled sync: due now, at the server's next check, within five minutes.";
  return `Next scheduled sync: ${villageTime(a.nextAt, a.timezone)}.`;
}

/**
 * The way from a sync to what it put in the queue. A button, since reviewing
 * the suggestions is the next thing to do after a sync.
 */
export function ReviewQueueButton({ waiting }: { waiting: number }) {
  return (
    <a
      href="/review"
      className="mt-2 inline-flex items-center min-h-11 px-4 py-2 text-sm font-medium rounded-lg bg-teal-deep text-white hover:bg-teal-deep-dark transition-colors"
    >
      Open the review queue ({count(waiting, "suggestion")})
    </a>
  );
}

/** Everything one run did, as sentences built from its fields. */
function runLines(r: SyncRun): string[] {
  const lines: string[] = [];
  if (r.error) lines.push(r.error);
  if (r.outcome === "landed") {
    lines.push(
      `${count(r.records, "record")} read. ${count(r.landed, "suggestion")} reached the review queue: ` +
        `${r.rebatched} carried forward unchanged, ${r.superseded} replaced by a changed claim, ${r.refused} refused. ` +
        `${count(r.facts, "fact")} stored.`,
    );
    if (r.gone > 0) {
      lines.push(`${count(r.gone, "waiting suggestion")} withdrawn: the service stopped sending ${r.gone === 1 ? "its record" : "their records"}.`);
    }
  } else if (r.outcome === "no-change") {
    lines.push(
      `${count(r.records, "record")} read, the same as the last sync that reached the review queue. Nothing in the queue was touched.`,
    );
  } else if (r.outcome === "failed" && r.records > 0) {
    lines.push(`${count(r.records, "record")} read before it stopped.`);
  }
  if (r.failed.length > 0) lines.push(r.failed.map((f) => `${KIND_WORDS[f.kind] ?? f.kind}: ${WHY_WORDS[f.why] ?? "it failed"}`).join(". ") + ".");
  if (r.truncated.length > 0) lines.push(`Cut short, because the service holds more than one sync reads: ${kindList(r.truncated)}.`);
  if (r.held > 0) lines.push(`${count(r.held, "record")} held back from the queue.`);
  if (r.addresses > 0) lines.push(`${count(r.addresses, "record")} carried an email address, and those fields were dropped.`);
  if (r.circles) {
    const c = r.circles;
    lines.push(
      `Circles: ${c.placed} placed, ${c.unresolved} unresolved, ${c.absent} with none, ${c.several} naming several, ` +
        `${c.inArchived} in an archived circle.` +
        (c.shapes.length > 0 ? ` The circle field arrived as: ${c.shapes.join("; ")}.` : ""),
    );
  }
  // What was asked for and how that was decided, on one line.
  const asked = [
    r.skipped.length > 0 ? `Not offered by the service, so not asked for: ${kindList(r.skipped)}.` : "",
    r.plan === "schema" ? "Kinds chosen from the service's own schema." : r.plan === "mail" ? "Kinds chosen from the service's mail, as a guess." : "",
  ].filter((part) => part !== "");
  if (asked.length > 0) lines.push(asked.join(" "));
  return lines;
}

/** The schedule's state and the last twenty runs, read from the server each time `version` moves. */
export function SyncRunLog({ password, version }: { password: string; version: number }) {
  const [answer, setAnswer] = useState<SyncRunsAnswer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/saberra/runs`, { headers: authHeaders(password) });
        const d = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) {
          setAnswer(null);
          setProblem(refusal(d, "The sync log could not be read."));
          return;
        }
        const read = readAnswer(d);
        setAnswer(read);
        setProblem(read ? null : "The sync log came back in a shape this screen cannot read.");
      } catch {
        if (!live) return;
        setAnswer(null);
        setProblem("The sync log could not be read, because the request did not reach the server.");
      }
    })();
    return () => {
      live = false;
    };
  }, [password, version]);

  if (problem) return <p className="text-xs text-amber-800 mt-4">{problem}</p>;
  if (!answer) return <p className="text-xs text-gray-500 mt-4">Reading the sync log…</p>;

  const { backoff, runs } = answer;
  return (
    <div className="mt-4 space-y-3">
      <div className="text-sm text-gray-700 space-y-1">
        <p>{nextLine(answer, Date.now())}</p>
        {answer.schedule !== "off" && backoff.failures === 1 && (
          <p className="text-amber-800">The last sync failed. The schedule tries again at its usual time.</p>
        )}
        {answer.schedule !== "off" && backoff.factor > 1 && (
          <p className="text-amber-800">
            The last {backoff.failures} syncs failed, so the schedule waits {times(backoff.factor)} as long before it
            tries again.
          </p>
        )}
        <p className="text-xs text-gray-500">Times are village time, {answer.timezone.replace(/_/g, " ")}.</p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Recent syncs</h4>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">No sync has run yet.</p>
        ) : (
          <ol className="space-y-2 max-h-[36rem] overflow-y-auto pr-1" aria-label="Recent syncs, newest first">
            {runs.map((r) => (
              <li key={`${r.at}-${r.trigger}`} className="border border-gray-100 rounded-lg px-3 py-2">
                <p className="text-sm">
                  <span className={`font-semibold ${OUTCOME_TONE[r.outcome]}`}>{OUTCOME_WORDS[r.outcome]}</span>
                  <span className="text-gray-500">
                    {" · "}
                    {TRIGGER_WORDS[r.trigger]}
                    {" · "}
                    <time dateTime={r.at}>{villageTime(r.at, answer.timezone)}</time>
                    {r.outcome !== "not-run" && ` · ${(r.ms / 1000).toFixed(1)} seconds`}
                  </span>
                </p>
                <ul className="text-xs text-gray-600 mt-1 space-y-0.5">
                  {runLines(r).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {r.outcome === "landed" && r.landed > 0 && <ReviewQueueButton waiting={r.landed} />}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
