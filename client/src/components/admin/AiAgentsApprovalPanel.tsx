/**
 * THE ANCHOR'S APPROVAL OF AI AGENTS, on the Players tab beside the agent accounts
 * (role journey L13). Two connector tools touch applicant data: drafting a first
 * reply or a decision letter, and listing the applicants waiting on a holder.
 * They stay closed until a person records here that the Anchor approved, with
 * where it was decided. The record keeps who pressed it and when. Withdrawing it
 * closes the tools again.
 *
 * Light-only, like the rest of the admin tabs.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { API_BASE, authHeaders, refusal } from "./adminApi";

interface Approval {
  approved: boolean;
  by: { userId: string; name: string } | null;
  at: string | null;
  note: string;
}

const field = "w-full rounded-md border border-border bg-white px-2 py-1 text-sm text-foreground";
const primary = "min-h-9 rounded-md bg-teal-deep px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60";
const button = "min-h-9 rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground";

export default function AiAgentsApprovalPanel({ password }: { password: string }) {
  const { t } = useLingui();
  const [doc, setDoc] = useState<Approval | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/admin/ai-agents-approval`, { headers: authHeaders(password) });
      if (!r.ok) throw new Error("read failed");
      setDoc((await r.json()) as Approval);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (approved: boolean) => {
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/admin/ai-agents-approval`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ approved, note }),
      });
      if (!r.ok) {
        toast.error(refusal(await r.json().catch(() => ({})), t`That could not be saved`));
        return;
      }
      setDoc((await r.json()) as Approval);
      setNote("");
      toast.success(approved ? t`Approval recorded` : t`Approval withdrawn`);
    } finally {
      setSaving(false);
    }
  };

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>The approval of AI agents could not be read. Reload to try again.</Trans>
      </p>
    );
  }
  if (!doc) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-white p-4" aria-label={t`Approval of AI agents`}>
      <p className="text-sm font-semibold text-foreground">
        <Trans>Approval of AI agents touching applicant data</Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Until the Anchor approves, an AI agent cannot draft letters to applicants or list the applicants waiting on a holder. It never scores, ranks or summarises a candidate, and a person always sends.
        </Trans>
      </p>
      {doc.approved ? (
        <p className="text-sm text-foreground">
          <Trans>
            Approved by {doc.by?.name || "a member"} on {doc.at ? new Date(doc.at).toLocaleDateString() : ""}. {doc.note}
          </Trans>
        </p>
      ) : (
        <p className="text-sm text-foreground">
          <Trans>Not approved. Both tools are closed.</Trans>
        </p>
      )}
      <label className="block text-sm text-foreground">
        <Trans>Where the Anchor decided this (the thread, the meeting or the date)</Trans>
        <input className={field} value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={saving || note.trim().length < 3} onClick={() => void save(true)}>
          <Trans>Record the Anchor's approval</Trans>
        </button>
        {doc.approved && (
          <button type="button" className={button} disabled={saving} onClick={() => void save(false)}>
            <Trans>Withdraw the approval</Trans>
          </button>
        )}
      </div>
    </div>
  );
}
