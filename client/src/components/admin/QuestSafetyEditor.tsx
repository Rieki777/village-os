/**
 * WHAT A QUEST ASKS OF THE BODY, set by the hands that edit the quest (build
 * days S5, spec US5). The founder's door to `PUT /api/admin/quests/:id/safety`:
 * without it the route was reachable only by curl (check-admin-reach).
 *
 * A physical quest asks 18 unless the minimum is set, and never below 16 (Rye,
 * 2026-11-09; the server refuses lower and this field says why). Only earned
 * or granted badges are offered, because a badge members give themselves gates
 * nothing. After a save the editor says how many open claims the new rules now
 * refuse, so whoever changed them sees who it affects (spec R3).
 *
 * Admin is a light-only workspace by ruling (2026-09-04): fixed grays here.
 */
import { useEffect, useState } from "react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { API_BASE, authHeaders } from "./adminApi";

interface Badge {
  id: string;
  name: string;
  kind: string;
  active?: boolean | number;
}
interface Rules {
  physical: boolean;
  minAge: string;
  requiredBadges: string[];
  safetyNote: string;
  estimateHours: string;
}

const EMPTY: Rules = { physical: false, minAge: "", requiredBadges: [], safetyNote: "", estimateHours: "" };

export default function QuestSafetyEditor({ questId, password }: { questId: string; password: string }) {
  const { t } = useLingui();
  const [rules, setRules] = useState<Rules | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<number | null>(null);

  useEffect(() => {
    let gone = false;
    fetch(`${API_BASE}/game/quests/${encodeURIComponent(questId)}/safety`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (gone) return;
        setRules(
          d && typeof d === "object"
            ? {
                physical: d.physical === true,
                // The read answers the age in force; a physical quest with no
                // minimum of its own reads 18, which is the default it keeps.
                minAge: d.physical && d.minAge === 18 ? "" : d.minAge == null ? "" : String(d.minAge),
                requiredBadges: Array.isArray(d.requiredBadges) ? d.requiredBadges.map((b: any) => String(b?.id ?? b)) : [],
                safetyNote: typeof d.safetyNote === "string" ? d.safetyNote : "",
                estimateHours: d.estimateHours == null ? "" : String(d.estimateHours),
              }
            : EMPTY,
        );
      })
      .catch(() => !gone && setRules(EMPTY));
    fetch(`${API_BASE}/admin/badges`, { headers: authHeaders(password) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (gone) return;
        const list: Badge[] = Array.isArray(d?.badges) ? d.badges : [];
        setBadges(list.filter((b) => (b.kind === "earned" || b.kind === "granted") && b.active !== false && b.active !== 0));
      })
      .catch(() => !gone && setBadges([]));
    return () => {
      gone = true;
    };
  }, [questId, password]);

  if (!rules) return null;
  const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

  const save = async () => {
    setSaving(true);
    setRefused(null);
    try {
      const res = await fetch(`${API_BASE}/admin/quests/${encodeURIComponent(questId)}/safety`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          physical: rules.physical,
          minAge: rules.minAge.trim() === "" ? null : Number(rules.minAge),
          requiredBadges: rules.requiredBadges,
          safetyNote: rules.safetyNote.trim() === "" ? null : rules.safetyNote,
          estimateHours: rules.estimateHours.trim() === "" ? null : Number(rules.estimateHours),
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.error ?? t({ message: "That did not save. Try again.", context: "admin quest safety" }));
      } else {
        toast.success(t({ message: "Safety saved", context: "admin quest safety" }));
        setRefused(Array.isArray(d?.openClaimsNowRefused) ? d.openClaimsNowRefused.length : 0);
      }
    } catch {
      toast.error(t({ message: "That did not save. Try again.", context: "admin quest safety" }));
    }
    setSaving(false);
  };

  const toggleBadge = (id: string, on: boolean) =>
    setRules({ ...rules, requiredBadges: on ? [...rules.requiredBadges, id] : rules.requiredBadges.filter((b) => b !== id) });

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={rules.physical} onChange={(e) => setRules({ ...rules, physical: e.target.checked })} />
        <Trans context="admin quest safety">Physical work on site</Trans>
      </label>
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-500">
          <Trans context="admin quest safety">Minimum age</Trans>
          <input
            inputMode="numeric"
            value={rules.minAge}
            onChange={(e) => setRules({ ...rules, minAge: e.target.value })}
            placeholder={rules.physical ? "18" : ""}
            className={`${inputCls} w-full mt-1`}
          />
        </label>
        <label className="text-xs text-gray-500">
          <Trans context="admin quest safety">Hours it takes</Trans>
          <input inputMode="decimal" value={rules.estimateHours} onChange={(e) => setRules({ ...rules, estimateHours: e.target.value })} className={`${inputCls} w-full mt-1`} />
        </label>
      </div>
      {rules.physical ? (
        <p className="text-sm text-gray-700">
          <Trans context="admin quest safety">
            A physical quest asks 18 unless you set a minimum. It can ask 16 for light work beside a named adult, never lower, and never for machines or heights.
          </Trans>
        </p>
      ) : null}
      {badges.length ? (
        <fieldset>
          <legend className="text-xs text-gray-500">
            <Trans context="admin quest safety">Badges a member needs</Trans>
          </legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {badges.map((b) => (
              <label key={b.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="checkbox" checked={rules.requiredBadges.includes(b.id)} onChange={(e) => toggleBadge(b.id, e.target.checked)} />
                {b.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="block text-xs text-gray-500">
        <Trans context="admin quest safety">Safety note, shown as written</Trans>
        <textarea value={rules.safetyNote} onChange={(e) => setRules({ ...rules, safetyNote: e.target.value })} rows={2} className={`${inputCls} w-full mt-1 resize-y`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={saving} onClick={save} className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40">
          <Trans context="admin quest safety">Save safety</Trans>
        </button>
        {refused ? (
          <p role="status" className="text-sm text-gray-700">
            <Plural
              value={refused}
              one="# open claim on this quest no longer meets these rules. Talk with whoever holds it."
              other="# open claims on this quest no longer meet these rules. Talk with whoever holds them."
            />
          </p>
        ) : null}
      </div>
    </div>
  );
}
