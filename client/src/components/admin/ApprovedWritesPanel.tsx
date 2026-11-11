/**
 * THE CONNECTOR'S APPROVED WRITES, for Admin, Players, Agents.
 *
 * Every write the connector makes under `agents.lead_approved_writes` carries who approved it and their approval in
 * their own words, and leaves one admin-only audit event and one record for the village's organisational memory
 * (server/lib/agentLeadApproval.ts). This lists the latest from the events: when, what, who approved it, the note,
 * and whether the memory holds the record yet. A person reads it; the server refuses an agent account.
 *
 * Light-only, like the rest of the admin tabs.
 */
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { API_BASE, authHeaders } from "./adminApi";

type Memory = "sent" | "waiting" | "failed" | "held" | "dropped" | "none";

export interface ApprovedWrite {
  writeKey: string;
  at: string;
  what: string;
  target: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  text: string;
  memory: Memory;
  memoryError: string | null;
}

export default function ApprovedWritesPanel({ password }: { password: string }) {
  const { t, i18n } = useLingui();
  const [writes, setWrites] = useState<ApprovedWrite[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch(`${API_BASE}/admin/agent-approvals`, { headers: authHeaders(password) });
        if (!r.ok) return;
        const d = (await r.json()) as { writes?: ApprovedWrite[] };
        if (live) setWrites(Array.isArray(d.writes) ? d.writes : []);
      } catch {
        if (live) setWrites(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [password]);

  if (writes === null) return null;

  const MEMORY_WORDS: Record<Memory, string> = {
    sent: t({ message: "In the memory", context: "approved writes, the memory record" }),
    waiting: t({ message: "Waiting to send", context: "approved writes, the memory record" }),
    failed: t({ message: "Trying again", context: "approved writes, the memory record" }),
    held: t({ message: "Held", context: "approved writes, the memory record" }),
    dropped: t({ message: "Not sent", context: "approved writes, the memory record" }),
    none: t({ message: "Not queued", context: "approved writes, the memory record" }),
  };
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(i18n.locale, { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={t({ message: "Approved agent writes", context: "approved writes" })} role="region">
      <p className="text-sm font-semibold text-foreground"><Trans context="approved writes">Approved agent writes</Trans></p>
      <p className="text-sm text-muted-foreground">
        <Trans context="approved writes">
          Each change the connector made with a person's approval: when, what, who approved it and their words. Each one is also sent to the village's organisational memory, and the last column says whether it holds it yet.
        </Trans>
      </p>
      {writes.length === 0 ? (
        <p className="text-sm text-muted-foreground"><Trans context="approved writes">No approved writes yet.</Trans></p>
      ) : (
        <ul className="divide-y divide-border">
          {writes.map((w) => (
            <li key={w.writeKey} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr_8rem] sm:gap-3">
              <span className="text-xs text-muted-foreground">{when(w.at)}</span>
              <div className="min-w-0 space-y-1">
                {w.what ? (
                  <p className="text-sm text-foreground">
                    {w.what}
                    {w.target && <span className="text-muted-foreground"> ({w.target})</span>}
                  </p>
                ) : (
                  <p className="break-words text-sm text-foreground">{w.text}</p>
                )}
                {w.approvedBy && (
                  <p className="text-xs text-muted-foreground">
                    <Trans context="approved writes">Approved by {w.approvedBy}</Trans>
                  </p>
                )}
                {w.approvalNote && <blockquote className="break-words border-l-2 border-border pl-2 text-xs text-foreground">{w.approvalNote}</blockquote>}
              </div>
              <span className={`text-xs ${w.memory === "sent" ? "text-foreground" : "text-muted-foreground"}`} title={w.memoryError ?? undefined}>
                {MEMORY_WORDS[w.memory]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
