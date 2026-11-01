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
 * TWO QUESTIONS BEFORE A CHANGE (Rye, 2026-10-23), both in
 * ./PowerGroupDialogs, which says why. The × only opens `RemoveHolderDialog`,
 * and the removal is sent from its Remove button and from nowhere else. An
 * appointment the holders route refuses for the stage floor opens
 * `BelowFloorDialog`, whose promote button raises the stage through
 * `PUT /api/admin/players/:id/stage` and then sends the same appointment
 * again. The server still refuses anybody below the floor, so the only way
 * past it is the promotion.
 *
 * Light-only, like the rest of the admin panel.
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { CAPABILITY_CONSEQUENCE } from "@shared/draftKinds";
import { useAuth } from "@/contexts/AuthContext";
import { useGameConfig } from "@/lib/gameApi";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { AppointToRole } from "@/components/admin/AppointToRole";
import { BelowFloorDialog, RemoveHolderDialog } from "@/components/admin/PowerGroupDialogs";

/** The rung a stage granted at or above also lets somebody in (`ADMISSION_RUNG`, server/lib/admission.ts). */
const ADMISSION_RUNG = "member";

type Sent = { ok: boolean; status: number; data: any };

/** A server sentence with its last full stop taken off, so one of ours can follow it. */
const unstop = (s: string) => s.replace(/[.\s]+$/, "");

/** An appointment waiting on "promote them, or help them get there". */
type FloorAsk = { roleId: string; userId: string; termEndsOn: string; stageId: string; done: (ok: boolean) => void };

export default function GameRolesTab({ password }: { password: string }) {
  const { user } = useAuth();
  const config = useGameConfig();
  const [roles, setRoles] = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [holding, setHolding] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<{ roleId: string; userId: string } | null>(null);
  const [floor, setFloor] = useState<FloorAsk | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes, hRes] = await Promise.all([
        fetch(`${API_BASE}/roles`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/admin/capabilities/holding`, { headers: authHeaders(password) }),
      ]);
      const r = await rRes.json();
      const p = await pRes.json();
      setRoles(Array.isArray(r) ? r : []);
      setPlayers(Array.isArray(p) ? p : []);
      // The removal warning reads this; a tab that could not load it warns about nothing.
      setHolding(hRes.ok ? await hRes.json().catch(() => null) : null);
    } catch { setRoles([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  // `termEndsOn` empty sends no date: the seat ends with the season (0199).
  const send = async (roleId: string, userId: string, action: "add" | "remove", termEndsOn = ""): Promise<Sent> => {
    const res = await fetch(`${API_BASE}/admin/roles/${roleId}/holders`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ userId, action, ...(termEndsOn ? { termEndsOn } : {}) }),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  };

  /*
   * Sheet 19: a group can carry admin access. Turning it on hands everyone in
   * the group the panel, so it asks first. The server refuses a founder-only
   * flip before launch and the flip that would leave nobody able to get in,
   * and both refusals are sentences shown as they come.
   */
  const setAdminAccess = async (roleId: string, name: string, on: boolean) => {
    if (on && !confirm(`Everyone in ${name} will be able to open the admin panel while they hold it. It gives no power the group does not already carry.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/roles/${encodeURIComponent(roleId)}/admin-access`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ on }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(on ? `${name} can open the admin panel` : `${name} no longer opens the admin panel`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "That did not save");
    }
  };

  const change = async (roleId: string, userId: string, action: "add" | "remove", termEndsOn = ""): Promise<boolean> => {
    try {
      const sent = await send(roleId, userId, action, termEndsOn);
      // The floor refusal is the only one carrying `minStage`. It becomes a question, not a dead end.
      if (action === "add" && sent.status === 409 && sent.data?.minStage) {
        return await new Promise<boolean>((done) =>
          setFloor({ roleId, userId, termEndsOn, stageId: String(sent.data.minStage), done }),
        );
      }
      if (!sent.ok) throw new Error(refusal(sent.data, "failed"));
      toast.success(action === "add" ? "Appointed" : "Removed");
      load();
      return true;
    } catch (e: any) {
      // The term refusals and the rest come back as sentences written for humans; show them verbatim.
      toast.error(e?.message || "Change failed");
      return false;
    }
  };

  const confirmRemoval = async () => {
    if (!removing) return;
    setBusy(true);
    await change(removing.roleId, removing.userId, "remove");
    setBusy(false);
    setRemoving(null);
  };

  const stageName = (id: string) => config?.stages?.find((s) => s.id === id)?.name ?? id;
  const memberName = (id: string) => players.find((p) => p.id === id)?.name ?? "This member";
  // `GET /api/roles` serves a holder by first name; the roster has the whole one, which is who the admin means.
  const holderName = (h: { userId: string; name?: string }) => players.find((p) => p.id === h.userId)?.name ?? h.name ?? "This member";

  const closeFloor = (ok: boolean) => {
    floor?.done(ok);
    setFloor(null);
  };

  /** Raise their stage to the floor, then send the same appointment again. */
  const promoteAndAppoint = async () => {
    if (!floor) return;
    const name = memberName(floor.userId);
    const target = stageName(floor.stageId);
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/players/${floor.userId}/stage`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        // The key is `stageId`, and it is always sent: an absent key CLEARS the grant.
        body: JSON.stringify({ stageId: floor.stageId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The stage route is admin-only; its bare "auth_required" is not a sentence anybody can act on.
        const why = res.status === 401 ? "Only an admin can change a stage" : unstop(refusal(d, "The stage did not change"));
        toast.error(`${why}. Nobody was appointed.`);
        setBusy(false);
        return;
      }
      const sent = await send(floor.roleId, floor.userId, "add", floor.termEndsOn);
      if (!sent.ok) {
        // Said whole, because the first half did happen and the admin has to know it.
        toast.error(`${name} is at ${target} now, but the appointment did not go through: ${refusal(sent.data, "it was refused")}`);
        load();
        closeFloor(false);
      } else {
        toast.success(`${name} is at ${target} now, and appointed`);
        load();
        closeFloor(true);
      }
    } catch (e: any) {
      toast.error(e?.message || "Change failed");
    }
    setBusy(false);
  };

  const removingRole = removing ? roles.find((r) => r.id === removing.roleId) : null;
  const removingHolder = removing ? (removingRole?.holders ?? []).find((h: any) => h.userId === removing.userId) : null;
  const leftEmpty: string[] = removing
    ? ((holding?.leftEmptyByRemoval?.[removing.roleId]?.[removing.userId] ?? []) as string[]).map(
        (cap) => (holding?.powers ?? []).find((p: any) => p.capability === cap)?.title ?? cap,
      )
    : [];

  const floorRole = floor ? roles.find((r) => r.id === floor.roleId) : null;
  const floorPlayer = floor ? players.find((p) => p.id === floor.userId) : null;
  const ladder = config?.stages ?? [];
  const floorIdx = floor ? ladder.findIndex((s) => s.id === floor.stageId) : -1;
  const doorIdx = ladder.findIndex((s) => s.id === ADMISSION_RUNG);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Power groups</h2>
        <p className="text-sm text-gray-500 mt-1">
          Add and remove the people in each power group. Each group's stage floor
          still applies, and a group is one of the two ways a member gains capabilities.
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : roles.length === 0 ? (
        <p className="text-sm text-gray-400">No power groups yet.</p>
      ) : (
        <div className="space-y-4">
          {roles.map((r) => (
            <div key={r.id} className="border border-gray-200 rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  {r.description && <p className="text-sm text-gray-500 mt-0.5 max-w-xl">{r.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5 min-w-0">
                  {r.minStage && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      stage ≥ {r.minStage}
                    </span>
                  )}
                  {(r.capabilities ?? []).map((c: string) => (
                    <span key={c} className="text-xs bg-teal-deep/10 text-teal-deep px-2 py-0.5 rounded-full font-mono break-all">
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!r.grantsAdmin}
                  disabled={!!r.isExample}
                  onChange={(e) => setAdminAccess(r.id, r.name, e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-medium">Admin access.</span> Whoever holds this group can open the admin panel while they hold it.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {(r.holders ?? []).length === 0 && (
                  <span className="text-xs text-gray-400 italic">Vacant, an open call</span>
                )}
                {(r.holders ?? []).map((h: any) => (
                  <span key={h.userId} className="inline-flex items-center gap-0.5 text-xs bg-gray-100 text-gray-700 pl-2.5 py-1 rounded-full">
                    {holderName(h)}
                    <button
                      type="button"
                      onClick={() => setRemoving({ roleId: r.id, userId: h.userId })}
                      title="Remove from this group"
                      aria-label={`Remove ${holderName(h)} from ${r.name}`}
                      className="group -my-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-gray-500"
                    >
                      <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full group-hover:bg-gray-300">×</span>
                    </button>
                  </span>
                ))}
                <AppointToRole role={r} players={players} onAppoint={(userId, termEndsOn) => change(r.id, userId, "add", termEndsOn)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <RemoveHolderDialog
        open={!!removing}
        memberName={removingHolder ? holderName(removingHolder) : memberName(removing?.userId ?? "")}
        groupName={removingRole?.name ?? "this group"}
        powers={((removingRole?.capabilities ?? []) as string[]).map(
          (c) => (CAPABILITY_CONSEQUENCE as Record<string, string | undefined>)[c] ?? c,
        )}
        isSelf={!!removing && !!user?.id && String(user.id) === String(removing.userId)}
        leftEmpty={leftEmpty}
        busy={busy}
        onKeep={() => setRemoving(null)}
        onRemove={() => void confirmRemoval()}
      />

      <BelowFloorDialog
        open={!!floor}
        memberName={floorPlayer?.name ?? "This member"}
        groupName={floorRole?.name ?? "This group"}
        stage={floorIdx >= 0 ? ladder[floorIdx] : null}
        stageName={floor ? stageName(floor.stageId) : ""}
        currentStageName={floorPlayer?.stageComputed ? stageName(floorPlayer.stageComputed) : ""}
        admits={floorIdx >= 0 && doorIdx >= 0 && floorIdx >= doorIdx}
        busy={busy}
        onPromote={() => void promoteAndAppoint()}
        onClose={() => closeFloor(false)}
      />
    </div>
  );
}
