/**
 * The role's history in the editor: who changed it, when and what, with one
 * click to put the newest change back. Read from the role's own drafts
 * (server/lib/roleEdit.ts `roleHistory`); only the newest live change can be put
 * back, so a later change is never thrown away by an earlier one's revert.
 */
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { QUIET, SECONDARY, LEDE } from "@/components/roleProposal/parts";
import { readHistory, revertEntry, type EditorState, type HistoryEntry } from "./roleEditApi";

export default function HistoryPanel({ roleId, onReverted }: { roleId: string; onReverted: (s: EditorState) => void }) {
  const { t } = useLingui();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readHistory(roleId).then((r) => {
      if (!live) return;
      if (r.ok) setEntries(r.data.entries);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [roleId]);

  const revert = async (draftId: string) => {
    setBusy(draftId);
    setError(null);
    const r = await revertEntry(roleId, draftId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onReverted(r.data.state);
    const again = await readHistory(roleId);
    if (again.ok) setEntries(again.data.entries);
  };

  if (error && !entries) return <p role="alert" className="text-sm font-semibold text-coral">{error}</p>;
  if (!entries) return <p role="status" className={LEDE}><Trans context="role editor history">Reading the history</Trans></p>;
  if (!entries.length) return <p className={LEDE}><Trans context="role editor history">No changes have been recorded on this role yet.</Trans></p>;
  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm font-semibold text-coral">{error}</p>}
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.draftId} className="rounded-lg border border-border p-3 text-sm" data-reverted={e.status === "reverted" ? "true" : "false"}>
            <p className="font-semibold text-foreground">
              {e.created ? t({ message: "Made", context: "role editor history" }) : t({ message: "Changed", context: "role editor history" })}
              {e.at ? `, ${new Date(e.at).toLocaleString()}` : ""}
              {e.by ? `, ${e.by}` : ""}
              {e.status === "reverted" ? `, ${t({ message: "put back", context: "role editor history" })}` : ""}
            </p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {e.changes.map((c) => (
                <li key={c.field}>
                  <span className="font-medium text-foreground">{c.label}</span>
                  {c.before !== null && <span>: {c.before}</span>}
                  <span> {"->"} {c.after ?? "-"}</span>
                </li>
              ))}
            </ul>
            {e.canRevert && (
              <button type="button" className={`${SECONDARY} mt-2`} disabled={busy === e.draftId} onClick={() => void revert(e.draftId)}>
                <Trans context="role editor history">Put this change back</Trans>
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className={QUIET} onClick={() => void readHistory(roleId).then((r) => r.ok && setEntries(r.data.entries))}>
        <Trans context="role editor history">Read again</Trans>
      </button>
    </div>
  );
}
