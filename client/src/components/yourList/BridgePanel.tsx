/**
 * STEWARD: the feedback bridge to the knowledge library (PR E).
 *
 * What is waiting to be sent and what failed, the notes switch (held until a
 * steward releases notes), "Send now" and "Read changes now", the items the
 * library leaves for a steward (merged, other removals, heard wrong), and
 * tasks members handed to a role. Members' notes are never shown here.
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { SCREEN_REASON_WORDS, type ScreenReason } from "@shared/memberTaskFeedback";
import { BTN_QUIET, BTN_SECONDARY, HINT } from "@/components/sessions/roomUi";

interface Bridge {
  notes: "held" | "released";
  outbox: Record<string, number>;
  errors: { kind: string; error: string; attempts: number }[];
  review: { feedbackId: string; title: string; action: string; reason: string | null; createdAt: string }[];
  roleQueue: { id: string; roleName: string | null; title: string; createdAt: string }[];
}

export default function BridgePanel({ password }: { password: string }) {
  const [b, setB] = useState<Bridge | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/member-tasks/bridge`, { headers: authHeaders(password) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setB(data as Bridge);
      else setLine(refusal(data, "Could not read the bridge."));
    } catch {
      setLine("Could not reach the village.");
    }
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, method: string, body?: unknown, say?: (d: any) => string) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setLine(res.ok ? (say ? say(data) : "Saved.") : refusal(data, "That did not work."));
    } catch {
      setLine("Could not reach the village.");
    }
    setBusy(false);
    await load();
  };

  if (!b) return <p className={`${HINT} mt-4`}>{line ?? "Reading the bridge..."}</p>;
  const count = (k: string) => Object.entries(b.outbox).filter(([key]) => key.endsWith(`:${k}`)).reduce((n, [, v]) => n + v, 0);

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="font-semibold text-foreground">Feedback to the knowledge library</h4>
      <p className={`${HINT} mt-1`}>
        {count("queued")} waiting, {count("sent")} sent, {count("failed")} retrying, {count("held")} notes held.
      </p>
      <p className="mt-2 text-sm text-foreground">
        Notes are {b.notes === "held" ? "held in the village" : "released to the library"}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_SECONDARY}
          disabled={busy}
          onClick={() => call("/admin/member-tasks/bridge/notes", "PUT", { release: b.notes === "held" }, (d) => `Notes are now ${d.notes}.`)}
        >
          {b.notes === "held" ? "Release notes" : "Hold notes again"}
        </button>
        <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => call("/admin/member-tasks/bridge/send", "POST", {}, (d) => String(d.result ?? "Done."))}>Send now</button>
        <button
          type="button"
          className={BTN_QUIET}
          disabled={busy}
          onClick={() => call("/admin/member-tasks/bridge/sync", "POST", {}, (d) => `${d.status}: ${d.created ?? 0} new, ${d.updated ?? 0} refreshed, ${d.closed ?? 0} closed.`)}
        >
          Read changes now
        </button>
      </div>
      {line && <p role="status" className="mt-2 text-sm text-foreground">{line}</p>}
      {b.errors.length > 0 && (
        <ul className={`${HINT} mt-2 list-disc pl-5`}>
          {b.errors.map((e, i) => <li key={i}>{e.kind}: {e.error} (tried {e.attempts})</li>)}
        </ul>
      )}
      {b.review.length > 0 && (
        <>
          <p className="mt-3 text-sm font-semibold text-foreground">For a steward to look at ({b.review.length})</p>
          <ul className="mt-1 space-y-1">
            {b.review.map((r) => (
              <li key={r.feedbackId} className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <span className="min-w-0 flex-1">
                  {r.title || "A task"}: {r.reason ? SCREEN_REASON_WORDS[r.reason as ScreenReason] ?? r.reason : r.action}
                </span>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => call(`/admin/member-tasks/review/${encodeURIComponent(r.feedbackId)}`, "POST", {})}>Looked at</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {b.roleQueue.length > 0 && (
        <>
          <p className="mt-3 text-sm font-semibold text-foreground">Handed to a role ({b.roleQueue.length})</p>
          <ul className="mt-1 space-y-1">
            {b.roleQueue.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <span className="min-w-0 flex-1">{q.title} <span className={HINT}>for {q.roleName ?? "a role"}</span></span>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => call(`/admin/member-tasks/role-queue/${encodeURIComponent(q.id)}`, "POST", { status: "taken" })}>Taken</button>
                <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => call(`/admin/member-tasks/role-queue/${encodeURIComponent(q.id)}`, "POST", { status: "dismissed" })}>Dismiss</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
