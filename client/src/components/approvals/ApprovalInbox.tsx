/**
 * THE APPROVAL INBOX (role journey L13, part A): one list of everything the
 * connector proposed and a person alone may do. Each card says who proposed
 * it, when, when it lapses, and what changes in plain words (before, after).
 * Approve or Decline one, or tick several and approve them together.
 *
 * Approving runs that thing's own admin route as THE PERSON PRESSING IT, so a
 * person without the power is told no by the route and the card stays. One
 * column, 44 pixel buttons, nothing that needs a wide screen: it is the page a
 * steward opens on a phone. The same component sits in Admin.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";

interface Card {
  id: string;
  kind: string;
  title: string;
  by: string;
  at: string | null;
  expiresAt: string | null;
  words: { what: string; before: string; after: string };
  canRevert: boolean;
  decision: { state: string; by: string | null; at: string } | null;
  state: string;
}

const card = "bg-card border border-border rounded-xl p-5";
const button = "text-sm border border-border rounded-lg px-4 py-2 min-h-[44px] font-medium disabled:opacity-60";
const primary = `${button} bg-teal-deep text-white border-transparent`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

export default function ApprovalInbox({ headers }: { headers: () => Record<string, string> }) {
  const { t } = useLingui();
  const [waiting, setWaiting] = useState<Card[] | null>(null);
  const [decided, setDecided] = useState<Card[]>([]);
  const [state, setState] = useState<"ok" | "refused" | "failed">("ok");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/approval-inbox", { headers: headers() });
      if (r.status === 401 || r.status === 403) {
        setState("refused");
        return;
      }
      if (!r.ok) throw new Error("read failed");
      const d = (await r.json()) as { waiting: Card[]; decided: Card[] };
      setWaiting(d.waiting);
      setDecided(d.decided);
      setPicked({});
      setState("ok");
    } catch {
      setState("failed");
    }
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (id: string, action: "approve" | "decline" | "revert") => {
    setBusy(id);
    try {
      const r = await fetch(`/api/approval-inbox/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: headers(), body: "{}" });
      const d = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) toast.error(d.message ?? t`That could not be done`);
      else toast.success(action === "approve" ? t`Approved` : action === "decline" ? t`Declined` : t`Put back`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  const approvePicked = async () => {
    const ids = Object.keys(picked).filter((id) => picked[id]);
    if (!ids.length) return;
    setBusy("batch");
    try {
      const r = await fetch("/api/approval-inbox/approve-batch", { method: "POST", headers: headers(), body: JSON.stringify({ ids }) });
      const d = (await r.json().catch(() => ({}))) as { results?: Array<{ id: string; ok: boolean; message?: string }> };
      const failed = (d.results ?? []).filter((x) => !x.ok);
      if (!r.ok) toast.error(t`That could not be done`);
      else if (failed.length) toast.error(failed[0].message || t`Some could not be approved`);
      else toast.success(t`Approved`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (state === "refused") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="inbox-refused">
        <Trans>The approval inbox is for admins and for holders of the powers it covers.</Trans>
      </p>
    );
  }
  if (state === "failed") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="inbox-failed">
        <Trans>The approval inbox could not be read. Reload to try again.</Trans>
      </p>
    );
  }
  if (!waiting) return null;
  const count = Object.values(picked).filter(Boolean).length;

  return (
    <div className="space-y-4" data-testid="approval-inbox">
      <p className="text-sm text-muted-foreground">
        <Trans>Nothing here is live. Approve runs the change through its own page as you, so it only works where you hold the power. A proposal lapses after seven days.</Trans>
      </p>
      {waiting.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>Nothing is waiting.</Trans>
        </p>
      )}
      {waiting.length > 1 && (
        <button type="button" className={primary} disabled={count === 0 || busy !== null} onClick={() => void approvePicked()}>
          <Trans>Approve {count} selected</Trans>
        </button>
      )}
      {waiting.map((c) => (
        <div key={c.id} className={card} data-testid={`inbox-${c.id}`}>
          <label className="flex items-start gap-3 min-h-[44px]">
            {waiting.length > 1 && (
              <input type="checkbox" className="mt-1 h-5 w-5" checked={!!picked[c.id]} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))} aria-label={c.title} />
            )}
            <span className="text-sm font-semibold text-foreground">{c.title}</span>
          </label>
          <p className="text-xs text-muted-foreground mt-1">
            {c.at ? <Trans>Proposed by {c.by} on {day(c.at)}. Lapses {day(c.expiresAt)}.</Trans> : <Trans>Proposed by {c.by}.</Trans>}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                <Trans>Now</Trans>
              </dt>
              <dd className="text-foreground whitespace-pre-line break-words">{c.words.before}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                <Trans>If you approve</Trans>
              </dt>
              <dd className="text-foreground whitespace-pre-line break-words">{c.words.after}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className={primary} disabled={busy !== null} onClick={() => void post(c.id, "approve")}>
              <Trans>Approve</Trans>
            </button>
            <button type="button" className={button} disabled={busy !== null} onClick={() => void post(c.id, "decline")}>
              <Trans>Decline</Trans>
            </button>
          </div>
        </div>
      ))}
      {decided.length > 0 && (
        <section aria-label={t`Decided`} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">
            <Trans>Decided in the last 30 days</Trans>
          </h3>
          {decided.map((c) => (
            <div key={c.id} className="border-t border-border pt-2 text-sm" data-testid={`decided-${c.id}`}>
              <p className="text-foreground">{c.title}</p>
              <p className="text-xs text-muted-foreground">
                {c.state}
                {c.decision ? ` · ${day(c.decision.at)}` : ""}
              </p>
              {c.state === "approved" && c.canRevert && (
                <button type="button" className={button} disabled={busy !== null} onClick={() => void post(c.id, "revert")}>
                  <Trans>Put it back</Trans>
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
