/**
 * What the connector proposed, waiting for a person (role journey L13, tier B).
 *
 * A role change is an open org draft: a holder of the power to decide on the
 * village's structure publishes it with one click (the existing
 * `publish-by-power` route). A seating proposal is a note for a holder of the
 * power to fill roles, who records the seating in Admin and marks it done here.
 * Nothing on this card seats, sends or sets pay. A person who holds neither
 * power sees nothing, and a failed read says so instead of showing an empty list.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plural, Trans, useLingui } from "@lingui/react/macro";

interface RoleChange {
  draftId: string;
  title: string;
  why: string | null;
  changes: number;
  changeIds: string[];
}
interface Seating {
  id: string;
  title: string;
  why: string | null;
}

const card = "bg-card border border-border rounded-xl p-5";
const button = "text-sm border border-border rounded-lg px-4 py-2 min-h-[44px] font-medium";

export default function AgentProposalsCard({ headers }: { headers: () => Record<string, string> }) {
  const [roleChanges, setRoleChanges] = useState<RoleChange[]>([]);
  const [seatings, setSeatings] = useState<Seating[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { t } = useLingui();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent-proposals/waiting", { headers: headers() });
      // A person holding neither power is told nothing is theirs here: show no card.
      if (r.status === 401 || r.status === 403) {
        setRoleChanges([]);
        setSeatings([]);
        setFailed(false);
        return;
      }
      if (!r.ok) throw new Error("read failed");
      const d = (await r.json()) as { roleChanges?: RoleChange[]; seatings?: Seating[] };
      setRoleChanges(d.roleChanges ?? []);
      setSeatings(d.seatings ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const publish = async (c: RoleChange) => {
    setBusy(c.draftId);
    try {
      const r = await fetch(`/api/org/drafts/${encodeURIComponent(c.draftId)}/publish-by-power`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ expectedChanges: c.changeIds }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? t`That could not be published`);
      } else {
        toast.success(t({ message: `Published`, context: "connector proposals" }));
      }
    } finally {
      setBusy(null);
      void load();
    }
  };

  const withdraw = async (c: RoleChange) => {
    setBusy(c.draftId);
    try {
      const r = await fetch(`/api/review/drafts/${encodeURIComponent(c.draftId)}/withdraw`, { method: "POST", headers: headers() });
      if (!r.ok) toast.error(t`That could not be withdrawn`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  const resolve = async (s: Seating, status: "taken" | "dismissed") => {
    setBusy(s.id);
    try {
      const r = await fetch(`/api/agent-proposals/${encodeURIComponent(s.id)}/resolve`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) toast.error(t`That could not be saved`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (failed) {
    return (
      <div className={card} data-testid="agent-proposals-failed">
        <p className="text-sm text-muted-foreground"><Trans>The proposals from the connector could not be read. Reload to try again.</Trans></p>
      </div>
    );
  }
  if (!roleChanges.length && !seatings.length) return null;

  return (
    <div className={card} data-testid="agent-proposals">
      <h2 className="text-sm font-semibold text-foreground"><Trans>Proposed through the connector</Trans></h2>
      <p className="text-sm text-muted-foreground mt-2"><Trans>Nothing here is live. A person publishes a change or records a role.</Trans></p>
      <ul className="mt-3 space-y-4">
        {roleChanges.map((c) => (
          <li key={c.draftId} data-testid={`agent-role-change-${c.draftId}`}>
            <p className="text-sm font-medium text-foreground">{c.title}</p>
            {c.why && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{c.why}</p>}
            <p className="text-sm text-muted-foreground mt-1"><Plural value={c.changes} one="# change" other="# changes" /></p>
            <div className="flex flex-wrap gap-2 mt-2">
              {c.changes > 0 && (
                <button disabled={busy === c.draftId} onClick={() => void publish(c)} className={`${button} bg-teal-deep text-white`}>
                  <Trans context="connector proposals">Publish</Trans>
                </button>
              )}
              <button disabled={busy === c.draftId} onClick={() => void withdraw(c)} className={button}>
                <Trans context="connector proposals">Withdraw</Trans>
              </button>
            </div>
          </li>
        ))}
        {seatings.map((s) => (
          <li key={s.id} data-testid={`agent-seating-${s.id}`}>
            <p className="text-sm font-medium text-foreground">{s.title}</p>
            {s.why && <p className="text-sm text-muted-foreground mt-1">{s.why}</p>}
            <p className="text-sm text-muted-foreground mt-1"><Trans>Fill the role in Admin, then mark it done.</Trans></p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button disabled={busy === s.id} onClick={() => void resolve(s, "taken")} className={button}>
                <Trans context="connector proposals">Done</Trans>
              </button>
              <button disabled={busy === s.id} onClick={() => void resolve(s, "dismissed")} className={button}>
                <Trans context="connector proposals">Dismiss</Trans>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
