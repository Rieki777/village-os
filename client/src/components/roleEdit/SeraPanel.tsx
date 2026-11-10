/**
 * "See Sera's version": the differences between Sera's latest read of this role
 * and the role here, field by field. "Take Sera's words" only fills the field in
 * the editor above (gold, unsaved); the person's save is what writes it.
 */
import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { LEDE, SECONDARY } from "@/components/roleProposal/parts";
import { readSera, type SeraSuggestion } from "./roleEditApi";

export default function SeraPanel({ roleId, onTake }: { roleId: string; onTake: (field: string, value: string) => void }) {
  const [data, setData] = useState<SeraSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void readSera(roleId).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [roleId]);

  if (error) return <p role="alert" className="text-sm font-semibold text-coral">{error}</p>;
  if (!data) return <p role="status" className={LEDE}><Trans context="role editor sera">Reading Sera's version</Trans></p>;
  if (!data.differences.length) return <p className={LEDE}><Trans context="role editor sera">Sera's version and this role say the same.</Trans></p>;
  return (
    <ul className="space-y-2">
      {data.differences.map((d) => (
        <li key={d.key} className="rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold text-foreground">{d.field ?? d.kind}</p>
          <p className="text-muted-foreground"><Trans context="role editor sera">Here now:</Trans> {d.ours ?? "-"}</p>
          <p className="text-foreground"><Trans context="role editor sera">Sera's:</Trans> {d.sera ?? "-"}</p>
          {d.takeable && d.field && d.sera !== null && (
            <button
              type="button"
              className={`${SECONDARY} mt-2`}
              disabled={taken.has(d.key)}
              onClick={() => {
                onTake(d.field as string, d.sera as string);
                setTaken(new Set(taken).add(d.key));
              }}
            >
              {taken.has(d.key) ? <Trans context="role editor sera">In the form above, not yet saved</Trans> : <Trans context="role editor sera">Take Sera's words</Trans>}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
