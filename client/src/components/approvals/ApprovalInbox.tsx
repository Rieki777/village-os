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
import { BTN_PRIMARY, BTN_SECONDARY, CARD, HINT, TILE } from "@/components/journey/look";
import { byArrival } from "@/components/governance/deciderOrder";

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

const button = BTN_SECONDARY;
const primary = BTN_PRIMARY;
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
      // Decider calm: oldest first, by arrival and nothing else (governance/deciderOrder.ts).
      setWaiting(byArrival(d.waiting, (c) => c.at));
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
      else toast.success(action === "approve" ? t({ message: `Approved`, context: "approval inbox" }) : action === "decline" ? t({ message: `Declined`, context: "approval inbox" }) : t({ message: `Put back`, context: "approval inbox" }));
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
      else toast.success(t({ message: `Approved`, context: "approval inbox" }));
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (state === "refused") {
    return (
      <p className={HINT} data-testid="inbox-refused">
        <Trans>The approval inbox is for admins and for holders of the powers it covers.</Trans>
      </p>
    );
  }
  if (state === "failed") {
    return (
      <p className={HINT} data-testid="inbox-failed">
        <Trans>The approval inbox could not be read. Reload to try again.</Trans>
      </p>
    );
  }
  if (!waiting) return null;
  const count = Object.values(picked).filter(Boolean).length;

  return (
    <div className="space-y-4" data-testid="approval-inbox">
      <p className={HINT}>
        <Trans>Nothing here is live. Approve runs the change through its own page as you, so it only works where you hold the power. A proposal lapses after seven days.</Trans>
      </p>
      {waiting.length === 0 && (
        <p className={HINT}>
          <Trans context="approval inbox">Nothing is waiting.</Trans>
        </p>
      )}
      {waiting.length > 1 && (
        <button type="button" className={primary} disabled={count === 0 || busy !== null} onClick={() => void approvePicked()}>
          <Trans context="approval inbox">Approve {count} selected</Trans>
        </button>
      )}
      {waiting.map((c) => (
        <div key={c.id} className={`${CARD} p-5 sm:p-6`} data-testid={`inbox-${c.id}`}>
          <label className="flex min-h-11 items-start gap-3">
            {waiting.length > 1 && (
              <input type="checkbox" className="mt-1 size-5 accent-notice" checked={!!picked[c.id]} onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))} aria-label={c.title} />
            )}
            <span className="font-display text-lg font-bold text-card-foreground">{c.title}</span>
          </label>
          <p className={`${HINT} mt-1`}>
            {c.at ? <Trans>Proposed by {c.by} on {day(c.at)}. Lapses {day(c.expiresAt)}.</Trans> : <Trans context="approval inbox">Proposed by {c.by}.</Trans>}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className={TILE}>
              <dt className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <Trans context="approval inbox">Now</Trans>
              </dt>
              <dd className="text-foreground whitespace-pre-line break-words">{c.words.before}</dd>
            </div>
            <div className={`${TILE} border-notice/60`}>
              <dt className="text-xs font-semibold uppercase tracking-widest text-notice">
                <Trans context="approval inbox">If you approve</Trans>
              </dt>
              <dd className="text-foreground whitespace-pre-line break-words">{c.words.after}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className={primary} disabled={busy !== null} onClick={() => void post(c.id, "approve")}>
              <Trans context="approval inbox">Approve</Trans>
            </button>
            <button type="button" className={button} disabled={busy !== null} onClick={() => void post(c.id, "decline")}>
              <Trans context="approval inbox">Decline</Trans>
            </button>
          </div>
        </div>
      ))}
      {decided.length > 0 && (
        <section aria-label={t({ message: `Decided`, context: "approval inbox" })} className="space-y-2">
          <h3 className="font-display text-lg font-bold text-card-foreground">
            <Trans>Decided in the last 30 days</Trans>
          </h3>
          {decided.map((c) => (
            <div key={c.id} className="border-t border-border pt-3 text-sm" data-testid={`decided-${c.id}`}>
              <p className="text-foreground">{c.title}</p>
              <p className={HINT}>
                {c.state}
                {c.decision ? ` · ${day(c.decision.at)}` : ""}
              </p>
              {c.state === "approved" && c.canRevert && (
                <button type="button" className={button} disabled={busy !== null} onClick={() => void post(c.id, "revert")}>
                  <Trans context="approval inbox">Put it back</Trans>
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
