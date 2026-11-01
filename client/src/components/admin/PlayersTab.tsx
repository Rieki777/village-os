/**
 * The Players tab: everyone with an account, what they may do on this site and
 * where they stand in village life. Moved out of client/src/pages/Admin.tsx so
 * the per-path status, balances and filters (Rye, 2026-10-31) could land
 * without growing a file that sits at its line ratchet. The card and the key
 * live in ./PlayerCard.tsx.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { BulkStageGrant } from "./StageFloorPicker";
import { NO_FILTER, PlayerCard, PlayersFilters, PlayersKey, filterPlayers, type LadderStage, type PathOption, type Player, type PlayerDetail } from "./PlayerCard";

export default function PlayersTab({ password }: { password: string }) {
  const { user: me } = useAuth();
  const iAmFounder = me?.role === "founder";
  const [players, setPlayers] = useState<Player[]>([]);
  const [stages, setStages] = useState<LadderStage[]>([]);
  const [paths, setPaths] = useState<PathOption[]>([]);
  // Ladders, balances and who last set a stage: a second read, so the roster paints first.
  const [detail, setDetail] = useState<any | null>(null);
  const [filter, setFilter] = useState(NO_FILTER);
  /*
   * R90: THE FOUNDER ROLE ENDS WHEN THE VILLAGE STARTS ITS GAME, so who may
   * work the control below changes at that moment and this tab has to know it.
   * Before launch only a founder may change a role. After launch any
   * administrator may, and no new founder can be made.
   *
   * Read from the server rather than inferred from the roster, because a
   * client that guesses at a permission is a client that eventually disagrees
   * with the gate. `/api/game/mechanics` answers strangers and already carries
   * the fact, so this costs no new route and no token.
   */
  const [gameStarted, setGameStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes, mRes] = await Promise.all([
        fetch(`${API_BASE}/admin/players`, { headers: authHeaders(password) }),
        fetch(`${API_BASE}/game/config`),
        fetch(`${API_BASE}/game/mechanics`),
      ]);
      const p = await pRes.json();
      const c = await cRes.json();
      const m = await mRes.json();
      setPlayers(Array.isArray(p) ? p : []);
      setStages(c?.stages ?? []);
      setPaths(c?.paths ?? []);
      fetch(`${API_BASE}/admin/players/detail`, { headers: authHeaders(password) })
        .then((r) => (r.ok ? r.json() : null))
        .then(setDetail)
        .catch(() => setDetail(null));
      setGameStarted(m?.gameStart?.started === true);
    } catch { setPlayers([]); }
    setLoading(false);
  }, [password]);

  useEffect(() => { load(); }, [load]);

  const grant = async (id: string, stageId: string) => {
    try {
      const res = await fetch(`${API_BASE}/admin/players/${id}/stage`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ stageId: stageId || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Stage updated");
      load();
    } catch { toast.error("Update failed"); }
  };

  const remove = async (id: string, email: string) => {
    if (!confirm(`Delete player ${email}? This removes their account. Their past quest claims and ledger entries are kept.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/players/${id}`, {
        method: "DELETE",
        headers: authHeaders(password),
      });
      if (!res.ok) throw new Error();
      toast.success("Player deleted");
      load();
    } catch { toast.error("Delete failed"); }
  };

  const setRole = async (id: string, role: string, name: string) => {
    if (role === "founder" && !confirm(`Make ${name} a FOUNDER? Founders manage admins and can only be demoted by another founder.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/users/${id}/role`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(refusal(data, "failed"));
      toast.success(`${name} now has ${role} access`);
      load();
    } catch (e: any) { toast.error(e?.message || "Role change failed"); }
  };

  const revokeSessions = async (id: string, name: string) => {
    if (!confirm(`Sign ${name} out everywhere? They keep their account and password. Every active session ends, and so do their agent tokens, agent inbox, own model key and private calendar address.`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/users/${id}/revoke-sessions`, {
        method: "POST",
        headers: authHeaders(password),
      });
      if (!res.ok) throw new Error();
      toast.success("Sessions revoked");
    } catch { toast.error("Revoke failed"); }
  };

  const detailFor = (id: string): PlayerDetail | undefined => {
    if (!detail) return undefined;
    const set = detail.stageSetBy?.[id];
    return {
      ladders: detail.ladders?.[id] ?? [],
      holdings: detail.balances?.[id] ?? [],
      stageSet: set ? { at: set.at, by: players.find((x) => x.id === set.actorUserId)?.name ?? null } : null,
    };
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">Players</h2>
        <p className="text-sm text-gray-500 mt-1">
          Everyone with an account: what they may do on this site, and where they stand in village life.
        </p>
      </div>
      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : players.length === 0 ? (
        <p className="text-sm text-gray-400">No players yet.</p>
      ) : (
        <>
          <PlayersKey players={players} stages={stages} gameStarted={gameStarted} />
          <PlayersFilters value={filter} onChange={setFilter} stages={stages} paths={paths} shown={filterPlayers(players, filter).length} total={players.length} />
          <div className="space-y-3">
            {picked.length > 0 && <BulkStageGrant stages={stages} ids={picked} password={password} onDone={() => { setPicked([]); load(); }} />}
            {filterPlayers(players, filter).map((p) => (
              <PlayerCard
                key={p.id}
                player={p}
                detail={detailFor(p.id)}
                stages={stages}
                paths={paths}
                canSetAccess={gameStarted || iAmFounder}
                gameStarted={gameStarted}
                picked={picked.includes(p.id)}
                onPick={(on) => setPicked((s) => (on ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                onAccess={(role) => setRole(p.id, role, p.name)}
                onStage={(id) => grant(p.id, id ?? "")}
                onSignOut={() => revokeSessions(p.id, p.name)}
                onDelete={() => remove(p.id, p.email)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
