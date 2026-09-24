/**
 * GAME ROLES: appointing and removing role holders.
 *
 * Moved out of client/src/pages/Admin.tsx unchanged, which sits at its line
 * ratchet (scripts/check-file-lines.mjs) with no headroom, so any addition to
 * that file fails however small. Imported statically rather than lazily: the
 * Admin page is already React.lazy in client/src/App.tsx, so this tab is
 * already off the first-paint path, and a second chunk would spend a whole 4 KB
 * block of the block-charged MAX_TOTAL_DIST_KB for nothing.
 *
 * The original section marker, kept verbatim:
 * ── Game Admin: Role appointments (S3 — no more curl) ──
 *
 * Light-only, like the rest of the admin panel.
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { AppointToRole } from "@/components/admin/AppointToRole";

export default function GameRolesTab({ password }: { password: string }) {
  const [roles, setRoles] = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes] = await Promise.all([
        fetch(`${API_BASE}/roles`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
      ]);
      const r = await rRes.json();
      const p = await pRes.json();
      setRoles(Array.isArray(r) ? r : []);
      setPlayers(Array.isArray(p) ? p : []);
    } catch { setRoles([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  // `termEndsOn` empty sends no date: the seat ends with the season (0199).
  const change = async (roleId: string, userId: string, action: "add" | "remove", termEndsOn = ""): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/admin/roles/${roleId}/holders`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ userId, action, ...(termEndsOn ? { termEndsOn } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(action === "add" ? "Appointed" : "Removed");
      load();
      return true;
    } catch (e: any) {
      // The stage-floor and term refusals come back as sentences written for humans; show them verbatim.
      toast.error(e?.message || "Change failed");
      return false;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Game Roles</h2>
        <p className="text-sm text-gray-500 mt-1">
          Appoint and remove role holders. Appointments respect each role's stage
          floor; role grants are one of the two ways a member gains capabilities.
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : roles.length === 0 ? (
        <p className="text-sm text-gray-400">No roles defined yet.</p>
      ) : (
        <div className="space-y-4">
          {roles.map((r) => (
            <div key={r.id} className="border border-gray-200 rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  {r.description && <p className="text-sm text-gray-500 mt-0.5 max-w-xl">{r.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.minStage && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      stage ≥ {r.minStage}
                    </span>
                  )}
                  {(r.capabilities ?? []).map((c: string) => (
                    <span key={c} className="text-xs bg-teal-deep/10 text-teal-deep px-2 py-0.5 rounded-full font-mono">
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {(r.holders ?? []).length === 0 && (
                  <span className="text-xs text-gray-400 italic">Vacant, an open call</span>
                )}
                {(r.holders ?? []).map((h: any) => (
                  <span key={h.userId} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 pl-2.5 pr-1 py-1 rounded-full">
                    {h.name}
                    <button
                      onClick={() => change(r.id, h.userId, "remove")}
                      title="Remove from this role"
                      className="w-4 h-4 rounded-full hover:bg-gray-300 text-gray-500 flex items-center justify-center"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <AppointToRole role={r} players={players} onAppoint={(userId, termEndsOn) => change(r.id, userId, "add", termEndsOn)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
