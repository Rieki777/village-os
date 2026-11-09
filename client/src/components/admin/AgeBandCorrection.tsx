/**
 * A CONFIRMED CHANGE TO A MEMBER'S AGE BAND (build days S5, spec R10). A member
 * says their band once; a later change needs an admin, and the server records
 * who confirmed it. This is the admin's door to
 * `PUT /api/admin/members/:id/age-band`, which had no caller in the browser
 * (check-admin-reach). It never shows the band itself, and a band is never a
 * birth date.
 *
 * Admin is a light-only workspace by ruling (2026-09-04): fixed grays here.
 */
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "sonner";
import { AGE_BANDS, type AgeBand } from "@shared/ageBands";
import { API_BASE, authHeaders } from "./adminApi";

export default function AgeBandCorrection({ userId, name, password }: { userId: string; name: string; password: string }) {
  const { t } = useLingui();
  const [band, setBand] = useState<AgeBand | "">("");
  const [saving, setSaving] = useState(false);
  const label: Record<AgeBand, string> = {
    under16: t({ message: "Under 16", context: "age band option" }),
    "16to17": t({ message: "16 or 17", context: "age band option" }),
    "18plus": t({ message: "18 or older", context: "age band option" }),
  };

  const confirm = async () => {
    if (!band) return;
    if (!window.confirm(t({ message: `Confirm ${name}'s age band as ${label[band]}? The change is recorded with your name.`, context: "admin age band" }))) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/members/${encodeURIComponent(userId)}/age-band`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ band }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(t({ message: "Age band confirmed", context: "admin age band" }));
        setBand("");
      } else toast.error(d?.error ?? t({ message: "That did not save. Try again.", context: "admin age band" }));
    } catch {
      toast.error(t({ message: "That did not save. Try again.", context: "admin age band" }));
    }
    setSaving(false);
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="text-xs text-gray-600">
        <span className="sr-only">
          <Trans context="admin age band">Confirm a changed age band</Trans>
        </span>
        <select value={band} onChange={(e) => setBand(e.target.value as AgeBand | "")} className="min-h-9 rounded-lg border border-gray-200 px-2 text-xs">
          <option value="">{t({ message: "Confirm a changed age band", context: "admin age band" })}</option>
          {AGE_BANDS.map((b) => (
            <option key={b} value={b}>
              {label[b]}
            </option>
          ))}
        </select>
      </label>
      {band ? (
        <button type="button" disabled={saving} onClick={confirm} className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
          <Trans context="admin age band">Confirm</Trans>
        </button>
      ) : null}
    </span>
  );
}
